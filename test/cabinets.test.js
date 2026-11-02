'use strict';
/**
 * Real cabinets: the bundled guitar cabinets install without internet, match their
 * checksums, and change the sound of the in-app engine (WebAssembly) without breaking it.
 * (The bass cabinets download on first use; checked by hand: see HANDOFF 4.0.3.)
 */
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { ensureCab } = require('../src/main/services/cabinets');
const manifest = require('../src/renderer/data/cabs/manifest.json');

function firstChannel(file) {
  const b = fs.readFileSync(file);
  let o = 12, fmt, data;
  while (o + 8 <= b.length) {
    const id = b.toString('latin1', o, o + 4), len = b.readUInt32LE(o + 4);
    if (id === 'fmt ') fmt = { tag: b.readUInt16LE(o + 8), ch: b.readUInt16LE(o + 10), bits: b.readUInt16LE(o + 22) };
    if (id === 'data') data = b.subarray(o + 8, o + 8 + len);
    o += 8 + len + (len & 1);
  }
  const bps = fmt.bits / 8, n = Math.floor(data.length / bps / fmt.ch), x = new Float32Array(Math.min(8192, n));
  for (let i = 0; i < x.length; i++) {
    const p = i * fmt.ch * bps;
    x[i] = fmt.tag === 3 ? data.readFloatLE(p) : fmt.bits === 16 ? data.readInt16LE(p) / 32768 : fmt.bits === 24 ? data.readIntLE(p, 3) / 8388608 : data.readInt32LE(p) / 2147483648;
  }
  const e = x.reduce((s, v) => s + v * v, 0), g = e > 0 ? 0.35 / Math.sqrt(e) : 1; // as cabinets.js cabSamples
  for (let i = 0; i < x.length; i++) x[i] *= g;
  return x;
}

const mod = new WebAssembly.Module(fs.readFileSync(path.join(__dirname, '../src/renderer/worklets/rig-dsp.wasm')));
function play(ir) {
  const x = new WebAssembly.Instance(mod, {}).exports;
  const need = x.mem_needed(), have = x.memory.buffer.byteLength;
  if (need > have) x.memory.grow(Math.ceil((need - have) / 65536));
  assert.ok(x.init(48000));
  if (ir) new Float32Array(x.memory.buffer, x.buf_ir(), 8192).set(ir);
  x.set_ir(0, ir ? ir.length : 0);
  const spec = Buffer.from('kind\tguitar\ngear\tamp\tAmp_TW22\n');
  const mem = new Uint8Array(x.memory.buffer, x.buf_spec(), 16384);
  mem.set(spec);
  mem[spec.length] = 0;
  assert.ok(x.build(0));
  x.select(0);
  const N = 128;
  let e = 0, hi = 0, prev = 0, bad = false;
  for (let blk = 0; blk < 750; blk++) {
    const inb = new Float32Array(x.memory.buffer, x.buf_in(), N);
    for (let i = 0; i < N; i++) {
      const t = ((blk * N + i) % 24000) / 48000;
      let s = 0;
      for (let h = 1; h < 12; h++) s += Math.sin(2 * Math.PI * 110 * h * t) / h;
      inb[i] = 0.3 * s * Math.exp(-3 * t);
    }
    x.process(N);
    const L = new Float32Array(x.memory.buffer, x.buf_l(), N);
    if (blk > 375) for (const v of L) { if (!Number.isFinite(v)) bad = true; e += v * v; hi += (v - prev) ** 2; prev = v; }
  }
  return { rms: Math.sqrt(e / (374 * N)), bright: hi / (e || 1), bad };
}

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sh-cabs-'));
  const offline = async () => { throw new Error('offline'); };
  const base = play(null);
  const guitar = Object.keys(manifest).filter((id) => !manifest[id].downloadOnly);
  assert.strictEqual(guitar.length, 4);
  for (const id of guitar) {
    const file = await ensureCab(dir, id, offline);
    const a = play(firstChannel(file));
    assert.ok(!a.bad, `${id}: the engine stays clean`);
    assert.ok(a.rms > 0.02 && a.rms < 2, `${id}: plays at a sane level (${a.rms})`);
    assert.ok(Math.abs(a.bright / base.bright - 1) > 0.05, `${id}: sounds different from the modelled cabinet`);
    console.log(`  ok  ${id} installs offline and plays (level ${a.rms.toFixed(3)})`);
  }
  for (const id of Object.keys(manifest).filter((k) => manifest[k].downloadOnly)) {
    assert.ok(manifest[id].archiveSha256 && manifest[id].entry, `${id}: has a download checksum and entry`);
  }
  console.log('  ok  bass cabinets have a checked download');
  fs.rmSync(dir, { recursive: true, force: true });
  console.log('all ok');
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
