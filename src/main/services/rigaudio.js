'use strict';
/**
 * Runs stagehand-audio.exe (the native guitar rig and song player) and relays
 * between it and the page.
 *
 * Wire format on the helper's stdin/stdout: [u32 type][u32 length][payload]
 *   to helper:   1 = JSON command, 2 = song audio (f32 stereo interleaved)
 *   from helper: 1 = JSON event,   3 = guitar input (f32 mono)
 *
 * The page talks to us over two MessagePorts: "control" (commands, events,
 * input audio) and "song" (song audio, straight from the player's worklet).
 */
const { spawn } = require('child_process');
const { EventEmitter } = require('events');
const fs = require('fs');
const path = require('path');

class RigAudio extends EventEmitter {
  constructor({ log = () => {}, appRoot }) {
    super();
    this.log = log;
    this.appRoot = appRoot;
    this.child = null;
    this.buf = Buffer.alloc(0);
    this.ports = new Set();
    this.hello = null;
    this.state = 'idle';
    this.lastStarted = null;
    this.songBytes = 0;
  }

  /** Path of the helper, or null where it can't run. */
  helperPath() {
    if (process.env.STAGEHAND_AUDIO_HELPER) return process.env.STAGEHAND_AUDIO_HELPER;
    if (process.platform !== 'win32') return null;
    const p = path.join(this.appRoot, 'native', 'bin', 'stagehand-audio.exe');
    return fs.existsSync(p) ? p : null;
  }

  available() {
    return !!this.helperPath();
  }

  ensure() {
    if (this.child) return true;
    const exe = this.helperPath();
    if (!exe) return false;
    try {
      this.child = spawn(exe, [], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    } catch (e) {
      this.log(`Audio helper failed to start: ${e.message}`);
      this.child = null;
      return false;
    }
    const child = this.child;
    this.buf = Buffer.alloc(0);
    child.stdout.on('data', (d) => this._data(d));
    child.stderr.on('data', (d) => this.log(`audio: ${String(d).trim()}`));
    child.stdin.on('error', () => {});
    child.on('error', (e) => {
      this.log(`Audio helper error: ${e.message}`);
    });
    child.on('exit', (code, sig) => {
      if (this.child === child) this.child = null;
      const was = this.state;
      this.state = 'idle';
      this.log(`Audio helper exited (${code ?? sig})`);
      if (was === 'running') this._broadcast({ ev: 'lost', message: 'The sound engine stopped unexpectedly.' });
      this._broadcast({ ev: 'exit' });
    });
    return true;
  }

  _data(d) {
    this.buf = this.buf.length ? Buffer.concat([this.buf, d]) : d;
    let off = 0;
    while (this.buf.length - off >= 8) {
      const type = this.buf.readUInt32LE(off);
      const len = this.buf.readUInt32LE(off + 4);
      if (this.buf.length - off < 8 + len) break;
      const payload = this.buf.subarray(off + 8, off + 8 + len);
      off += 8 + len;
      if (type === 1) {
        let ev;
        try {
          ev = JSON.parse(payload.toString('utf8'));
        } catch (_) {
          continue;
        }
        this._event(ev);
      } else if (type === 3 || type === 4 || type === 5) {
        const f = new Float32Array(len / 4);
        Buffer.from(f.buffer).set(payload);
        for (const p of this.ports) if (p.kind === 'control') p.port.postMessage({ t: type === 3 ? 'in' : type === 4 ? 'processed' : 'mixed', d: f });
      }
    }
    this.buf = off >= this.buf.length ? Buffer.alloc(0) : this.buf.subarray(off);
  }

  _event(ev) {
    if (ev.ev === 'hello') this.hello = ev;
    if (ev.ev === 'started') {
      this.state = 'running';
      this.lastStarted = ev;
      this.log(`Audio: ${ev.mode} ${ev.inName} → ${ev.outName} @ ${ev.rate} Hz, in ${ev.inPeriod} / out ${ev.outPeriod} frames, about ${Math.round(ev.latencyMs)} ms`);
    }
    if (ev.ev === 'stopped') this.state = 'idle';
    if (ev.ev === 'error') this.log(`Audio error (${ev.code}): ${ev.message}`);
    if (ev.ev === 'lost') {
      this.state = 'idle';
      this.log(`Audio lost: ${ev.message}`);
    }
    this.emit('event', ev);
    this._broadcast(ev);
  }

  _broadcast(ev) {
    for (const p of this.ports) if (p.kind === 'control') p.port.postMessage({ t: 'ev', ev });
  }

  send(obj) {
    if (!this.ensure()) return false;
    const json = Buffer.from(JSON.stringify(obj), 'utf8');
    const hdr = Buffer.alloc(8);
    hdr.writeUInt32LE(1, 0);
    hdr.writeUInt32LE(json.length, 4);
    this.child.stdin.write(Buffer.concat([hdr, json]));
    if (obj.cmd === 'start') this.state = 'starting';
    if (obj.cmd === 'stop') this.state = 'idle';
    return true;
  }

  sendSong(f32) {
    if (!this.child || this.state !== 'running') return;
    // Never queue up audio behind a stalled pipe: late audio is useless.
    if (this.child.stdin.writableLength > 256 * 1024) return;
    const bytes = Buffer.from(f32.buffer, f32.byteOffset, f32.byteLength);
    const hdr = Buffer.alloc(8);
    hdr.writeUInt32LE(2, 0);
    hdr.writeUInt32LE(bytes.length, 4);
    this.child.stdin.write(hdr);
    this.child.stdin.write(bytes);
    this.songBytes += bytes.length;
  }

  /** A page port: "control" or "song". */
  attach(port, kind) {
    const entry = { port, kind };
    this.ports.add(entry);
    port.on('message', (e) => {
      const m = e.data;
      if (!m) return;
      if (kind === 'song') {
        if (m.t === 'song' && m.d) {
          const d = m.d;
          const f = d instanceof Float32Array ? d : ArrayBuffer.isView(d) ? new Float32Array(d.buffer, d.byteOffset, d.byteLength >> 2) : d instanceof ArrayBuffer ? new Float32Array(d) : Array.isArray(d) ? Float32Array.from(d) : null;
          if (f && f.length) this.sendSong(f);
        }
        return;
      }
      if (m.t === 'cmd' && m.cmd) {
        if (m.cmd.cmd === 'status') {
          port.postMessage({ t: 'ev', ev: { ev: 'status', available: this.available(), state: this.state, started: this.lastStarted, hello: this.hello } });
          return;
        }
        if (!this.send(m.cmd)) port.postMessage({ t: 'ev', ev: { ev: 'error', code: 'unavailable', message: 'The sound engine isn’t available on this computer.', during: m.cmd.cmd } });
      }
    });
    port.on('close', () => {
      this.ports.delete(entry);
      // The page went away (reload/close): release the devices.
      if (kind === 'control' && ![...this.ports].some((p) => p.kind === 'control') && this.child) this.send({ cmd: 'stop' });
    });
    port.start();
  }

  /** The page died (4.0.7): let go of its lines and the devices, so the reloaded page starts fresh. */
  pageGone() {
    for (const e of [...this.ports]) {
      this.ports.delete(e);
      try {
        e.port.close();
      } catch (_) {}
    }
    if (this.child) {
      this.send({ cmd: 'monitor', on: 0 });
      this.send({ cmd: 'stop' });
    }
  }

  quit() {
    if (!this.child) return;
    try {
      this.send({ cmd: 'stop' });
      this.send({ cmd: 'quit' });
      this.child.stdin.end();
    } catch (_) {}
    const c = this.child;
    setTimeout(() => {
      try {
        c.kill();
      } catch (_) {}
    }, 1500);
  }
}

module.exports = { RigAudio };
