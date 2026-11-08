// Practice speed in the player worklet: faster than 100% (and back) keeps the pitch,
// stays smooth, keeps the position right and never runs past the loop or the end.
// node test/stretch.test.mjs
import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const SR = 48000;
const FREQ = 240; // 200 samples per cycle
const AMP = 16000;
const Q = 128;

function makePlayer() {
  const ctx = { currentTime: 0, sampleRate: SR, Math, Float32Array, Int16Array, Int32Array, Array, Number };
  let Cls = null;
  ctx.AudioWorkletProcessor = class {
    constructor() {
      this.port = { posted: [], postMessage: (m) => this.port.posted.push(m) };
    }
  };
  ctx.registerProcessor = (_name, c) => (Cls = c);
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(new URL('../src/renderer/worklets/player-worklet.js', import.meta.url), 'utf8'), ctx);
  const p = new Cls();
  p.ctx = ctx;
  return p;
}

function load(p, seconds) {
  const frames = Math.round(SR * seconds);
  const data = new Int16Array(frames);
  for (let i = 0; i < frames; i++) data[i] = Math.round(AMP * Math.sin((2 * Math.PI * FREQ * i) / SR));
  p.onMessage({ type: 'load', index: 0, buffer: data.buffer, byteOffset: 0, frames, channels: 1, setLength: true });
  return frames;
}

/** Runs quanta until `ended` (or `max` frames), returns the output and the reports. */
function run(p, max, onQuantum) {
  const out = [];
  const reports = [];
  let q = 0;
  for (; out.length < max; q++) {
    if (onQuantum) onQuantum(q, out.length);
    const L = new Float32Array(Q);
    const R = new Float32Array(Q);
    p.port.posted.length = 0;
    p.process([], [[L, R]]);
    p.ctx.currentTime += Q / SR;
    for (const v of L) out.push(v);
    for (const m of p.port.posted) reports.push({ ...m, at: out.length - Q });
    if (p.port.posted.some((m) => m.type === 'ended')) break;
  }
  return { out: Float32Array.from(out), reports };
}

const maxStep = (2 * Math.PI * FREQ * AMP) / SR / 32768; // steepest slope of the sine, per sample

function smooth(out, from, to, label) {
  let worst = 0;
  for (let i = from + 1; i < to; i++) worst = Math.max(worst, Math.abs(out[i] - out[i - 1]));
  assert.ok(worst < maxStep * 2, `${label}: no clicks (largest step ${worst.toFixed(4)}, limit ${(maxStep * 2).toFixed(4)})`);
}

function steadyLevel(out, from, to, label) {
  const win = 2400;
  const want = AMP / 32768 / Math.SQRT2;
  for (let i = from; i + win <= to; i += win) {
    let s = 0;
    for (let k = i; k < i + win; k++) s += out[k] * out[k];
    const rms = Math.sqrt(s / win);
    assert.ok(Math.abs(rms / want - 1) < 0.15, `${label}: level steady at ${i} (${(rms / want).toFixed(2)} of the original)`);
  }
}

function pitch(out, from, to) {
  let first = -1;
  let last = -1;
  let n = 0;
  for (let i = from + 1; i < to; i++) {
    if (out[i - 1] < 0 && out[i] >= 0) {
      const x = i - 1 + -out[i - 1] / (out[i] - out[i - 1]);
      if (first < 0) first = x;
      last = x;
      n++;
    }
  }
  return ((n - 1) * SR) / (last - first);
}

let passed = 0;
const ok = (msg) => {
  passed++;
  console.log(`  ok  ${msg}`);
};

for (const speed of [1.25, 1.5]) {
  const p = makePlayer();
  const frames = load(p, 4);
  p.onMessage({ type: 'speed', speed });
  p.onMessage({ type: 'play' });
  const { out, reports } = run(p, frames * 2);
  const ended = reports.find((m) => m.type === 'ended');
  assert.ok(ended, `${speed}: playback ends`);
  const want = frames / speed;
  assert.ok(Math.abs(out.length - want) < 2400, `${speed}: about ${Math.round(want)} frames out (got ${out.length})`);
  ok(`${speed * 100}%: ${out.length} frames out for ${frames} in (expected about ${Math.round(want)})`);
  const pos = reports.filter((m) => m.type === 'pos' && m.playing);
  let worstPos = 0;
  for (const m of pos) {
    assert.ok(m.frame >= 0 && m.frame <= frames, `${speed}: position ${m.frame} inside the song (${frames}), at ${m.at}`);
    assert.equal(m.speed, speed);
    worstPos = Math.max(worstPos, Math.abs(m.frame - Math.min(frames, m.at * speed)));
  }
  assert.ok(worstPos < 1500, `${speed}: position follows the output (off by ${worstPos} frames at most)`);
  ok(`${speed * 100}%: position reports follow output × speed (within ${worstPos} frames, ${pos.length} reports)`);
  const body = [2048, out.length - 4096];
  smooth(out, body[0], body[1], `${speed}`);
  steadyLevel(out, body[0], body[1], `${speed}`);
  const f = pitch(out, body[0], body[1]);
  assert.ok(Math.abs(f / FREQ - 1) < 0.01, `${speed}: pitch kept (${f.toFixed(1)} Hz)`);
  ok(`${speed * 100}%: smooth, steady level, pitch ${f.toFixed(1)} Hz (240 Hz in)`);
}

// a loop at 150%: the position never leaves it, the sound keeps going
{
  const p = makePlayer();
  load(p, 4);
  p.onMessage({ type: 'loop', loop: { start: SR, end: 2 * SR } });
  p.onMessage({ type: 'seek', frame: SR });
  p.onMessage({ type: 'speed', speed: 1.5 });
  p.onMessage({ type: 'play' });
  const { out, reports } = run(p, SR * 3);
  assert.ok(!reports.some((m) => m.type === 'ended'), 'a loop never ends');
  const pos = reports.filter((m) => m.type === 'pos');
  for (const m of pos) assert.ok(m.frame >= SR && m.frame < 2 * SR, `loop: position ${m.frame} inside the loop`);
  assert.ok(p.pos >= SR && p.pos < 2 * SR, `loop: player position ${p.pos} inside the loop`);
  let wraps = 0;
  for (let i = 1; i < pos.length; i++) if (pos[i].frame < pos[i - 1].frame) wraps++;
  assert.ok(wraps >= 3, `loop: went round (${wraps} times)`);
  steadyLevel(out, 2048, out.length - 2048, 'loop');
  ok(`150% in a loop: ${pos.length} reports all inside it, went round ${wraps} times, level steady`);
}

// changing speed while playing: 100% → 125% → 150% → 100% → 75%, no clicks, pitch kept
{
  const p = makePlayer();
  load(p, 6);
  p.onMessage({ type: 'play' });
  const steps = [
    [60, 1.25],
    [120, 1.5],
    [180, 1],
    [240, 0.75],
  ];
  const { out } = run(p, Q * 320, (q) => {
    for (const [at, s] of steps) if (q === at) p.onMessage({ type: 'speed', speed: s });
  });
  smooth(out, 1, out.length, 'speed changes');
  steadyLevel(out, 2400, out.length - 2400, 'speed changes');
  const f = pitch(out, 0, out.length);
  assert.ok(Math.abs(f / FREQ - 1) < 0.01, `speed changes: pitch kept (${f.toFixed(1)} Hz)`);
  ok(`speed changed 4 times mid-play: no clicks, steady level, pitch ${f.toFixed(1)} Hz`);
}

// out-of-range speeds are held to 25%..150%
{
  const p = makePlayer();
  load(p, 1);
  p.onMessage({ type: 'speed', speed: 3 });
  assert.equal(p.speed, 1.5);
  p.onMessage({ type: 'speed', speed: 0.1 });
  assert.equal(p.speed, 0.25);
  ok('speeds are held between 25% and 150%');
}

console.log(`stretch: all passed (${passed})`);
