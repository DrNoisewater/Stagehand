'use strict';
/* The sound engine's line for the singer's tuned voice (4.17): pieces sent as the page sends them
 * must come out of the speakers whole (no gaps), close behind, and beside the song.
 *   node test/voice-native.js native/build/stagehand-audio-fake
 */
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const exe = process.argv[2];
if (!exe || !fs.existsSync(exe)) {
  console.error('usage: node test/voice-native.js <stagehand-audio-fake>');
  process.exit(2);
}
const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'sh-voice-')), 'out.wav');
const child = spawn(exe, [], { stdio: ['pipe', 'pipe', 'inherit'] });
const frame = (type, bytes) => {
  const h = Buffer.alloc(8);
  h.writeUInt32LE(type, 0);
  h.writeUInt32LE(bytes.length, 4);
  child.stdin.write(Buffer.concat([h, bytes]));
};
const cmd = (o) => frame(1, Buffer.from(JSON.stringify(o)));
let buf = Buffer.alloc(0);
const waiters = [];
child.stdout.on('data', (d) => {
  buf = Buffer.concat([buf, d]);
  while (buf.length >= 8) {
    const type = buf.readUInt32LE(0);
    const len = buf.readUInt32LE(4);
    if (buf.length < 8 + len) break;
    if (type === 1) {
      const ev = JSON.parse(buf.subarray(8, 8 + len).toString());
      for (const w of [...waiters]) if (w.ok(ev)) (waiters.splice(waiters.indexOf(w), 1), w.res(ev));
    }
    buf = buf.subarray(8 + len);
  }
});
const wait = (ok) => new Promise((res) => waiters.push({ ok, res }));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (ok, name) => (results.push(ok), console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}`));

(async () => {
  const started = wait((e) => e.ev === 'started' || e.ev === 'error');
  cmd({ cmd: 'start', input: '', output: '', exclusive: 1, buffer: 1, fakeOut: out });
  const ev = await started;
  check(ev.ev === 'started' && ev.voice === 1, 'the engine starts and says it takes a voice');
  // a song (220 Hz, 512 frames a piece) and, from 1 s on, a voice (466 Hz, 256 frames a piece, at 44.1 kHz)
  cmd({ cmd: 'song', rate: 48000, on: 1 });
  const t0 = process.hrtime.bigint();
  const now = () => Number(process.hrtime.bigint() - t0) / 1e9;
  let sn = 0;
  let vn = 0;
  let voiceOn = false;
  const VR = 44100;
  while (now() < 4) {
    const t = now();
    while (sn / 48000 < t + 0.02) {
      const b = new Float32Array(1024);
      for (let i = 0; i < 512; i++, sn++) b[2 * i] = b[2 * i + 1] = 0.2 * Math.sin((2 * Math.PI * 220 * sn) / 48000);
      frame(2, Buffer.from(b.buffer));
    }
    if (t >= 1 && !voiceOn) {
      voiceOn = true;
      cmd({ cmd: 'voice', rate: VR, on: 1 });
      vn = Math.round(t * VR);
    }
    if (voiceOn && t < 3) {
      // only what has been "sung" by now: nothing ahead of time, as from a microphone
      while ((vn + 256) / VR <= t) {
        const b = new Float32Array(512);
        for (let i = 0; i < 256; i++, vn++) b[2 * i] = b[2 * i + 1] = 0.3 * Math.sin((2 * Math.PI * 466.16 * vn) / VR);
        frame(4, Buffer.from(b.buffer));
      }
    } else if (voiceOn && t >= 3 && voiceOn !== 'off') {
      voiceOn = 'off';
      cmd({ cmd: 'voice', on: 0 });
    }
    await sleep(2);
  }
  const stopped = wait((e) => e.ev === 'stopped');
  cmd({ cmd: 'stop' });
  await Promise.race([stopped, sleep(1500)]);
  cmd({ cmd: 'quit' });
  child.stdin.end();
  await sleep(300);
  const w = fs.readFileSync(out);
  const f = new Float32Array(w.buffer.slice(w.byteOffset + 44, w.byteOffset + w.length - ((w.length - 44) % 8)));
  const n = f.length / 2;
  const g = (hz, a, len) => {
    let c = 0;
    let s = 0;
    for (let i = a; i < a + len; i++) (c += f[2 * i] * Math.cos((2 * Math.PI * hz * i) / 48000)), (s += f[2 * i] * Math.sin((2 * Math.PI * hz * i) / 48000));
    return (2 * Math.sqrt(c * c + s * s)) / len;
  };
  // the voice in 50 ms pieces across the file
  const W = 2400;
  const lv = [];
  for (let a = 0; a + W <= n; a += W) lv.push(g(466.16, a, W));
  const first = lv.findIndex((v) => v > 0.15);
  const last = lv.length - 1 - [...lv].reverse().findIndex((v) => v > 0.15);
  const body = lv.slice(first + 1, last);
  const low = Math.min(...body);
  check(first > 0 && body.length >= 30, `the voice plays for its two seconds (${((body.length + 2) * 0.05).toFixed(2)} s)`);
  check(low > 0.25, `…whole, without gaps (quietest 50 ms: ${low.toFixed(3)} of 0.300)`);
  check(Math.max(...lv.slice(0, Math.max(0, first - 1))) < 0.02 && Math.max(...lv.slice(last + 3)) < 0.02, 'no voice before it starts or after it stops');
  const song = g(220, (first + 5) * W, 24000);
  check(song > 0.17, `the song plays on beside it (${song.toFixed(3)} of 0.200)`);
  console.log(results.every(Boolean) ? 'all passed' : 'FAILED');
  process.exit(results.every(Boolean) ? 0 : 1);
})();
