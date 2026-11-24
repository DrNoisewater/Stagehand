'use strict';
/**
 * TEMPORARY (4.32): hands Stagehand's sound to Glimpse, the screen recorder.
 *
 * With the sound engine in Fastest mode, Windows lets no other app hear the speakers,
 * so a screen recorder records silence. While Glimpse is recording it connects here and
 * gets the engine's full mix (the song, the amp, drums, the voice), as the speakers get it.
 * Nothing is sent, and the engine isn't asked for anything, while nobody is connected.
 *
 * Remove with: this file, its two lines in main.js, setGlimpseMonitor/pageMonitor in
 * rigaudio.js, test/glimpse-line.test.js and its entry in package.json (see TODO.md).
 *
 * Line: Windows named pipe \\.\pipe\stagehand-sound (a socket file elsewhere, for tests).
 * Each packet, little-endian: u32 'SHS1' (0x31534853), u32 rate, u32 frames, u32 0,
 * then frames × 2 float32 (left, right). Packets are dropped, never queued, when
 * Glimpse falls behind: late sound is no use to a recording.
 */
const net = require('net');
const os = require('os');
const path = require('path');
const fs = require('fs');

const MAGIC = 0x31534853;
const PIPE = process.platform === 'win32' ? '\\\\.\\pipe\\stagehand-sound' : path.join(os.tmpdir(), 'stagehand-sound.sock');
const BEHIND = 512 * 1024; // about 0.7 s of sound waiting: drop instead of queueing more

/** One packet for the line. */
function packet(f32, rate) {
  const frames = f32.length >> 1;
  const head = Buffer.alloc(16);
  head.writeUInt32LE(MAGIC, 0);
  head.writeUInt32LE(rate >>> 0, 4);
  head.writeUInt32LE(frames, 8);
  head.writeUInt32LE(0, 12);
  return Buffer.concat([head, Buffer.from(f32.buffer, f32.byteOffset, frames * 8)]);
}

class GlimpseLine {
  constructor({ rigAudio, log = () => {}, pipe = PIPE }) {
    this.rig = rigAudio;
    this.log = log;
    this.pipe = pipe;
    this.clients = new Set();
    this.server = null;
    this.dropped = 0;
    this.onMix = (f32, rate) => this.feed(f32, rate);
  }

  start() {
    if (this.server) return;
    if (process.platform !== 'win32') {
      try {
        fs.unlinkSync(this.pipe);
      } catch (_) {}
    }
    this.rig.on('mix', this.onMix);
    const server = net.createServer((sock) => this._client(sock));
    server.on('error', (e) => this.log(`Glimpse sound line: ${e.message}`));
    server.listen(this.pipe);
    this.server = server;
  }

  _client(sock) {
    this.clients.add(sock);
    this.log('Glimpse connected: sending it Stagehand’s sound');
    this.rig.setGlimpseMonitor(true);
    sock.on('data', () => {}); // Glimpse sends nothing; ignore anything
    sock.on('error', () => {});
    sock.on('close', () => {
      this.clients.delete(sock);
      if (!this.clients.size) {
        this.rig.setGlimpseMonitor(false);
        this.log(`Glimpse disconnected${this.dropped ? ` (${this.dropped} late pieces skipped)` : ''}`);
        this.dropped = 0;
      }
    });
  }

  feed(f32, rate) {
    if (!this.clients.size || !f32 || f32.length < 2) return;
    const buf = packet(f32, rate);
    for (const sock of this.clients) {
      if (sock.writableLength > BEHIND) this.dropped++;
      else sock.write(buf);
    }
  }

  stop() {
    this.rig.off('mix', this.onMix);
    for (const sock of this.clients) sock.destroy();
    this.clients.clear();
    this.rig.setGlimpseMonitor(false);
    if (this.server) this.server.close();
    this.server = null;
  }
}

module.exports = { GlimpseLine, packet, MAGIC, PIPE };
