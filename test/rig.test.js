'use strict';
/**
 * Guitar rig: song tones become real gear chains, and every preset and song
 * tone builds and plays cleanly in the amp engine (WebAssembly build).
 */
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { Psarc } = require('../src/main/core/psarc');
const { songTones } = require('../src/main/core/tones');

const ROOT = path.join(__dirname, '..');
let failed = 0;
const ok = (cond, msg) => {
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${msg}`);
  if (!cond) failed++;
};

(async () => {
  global.localStorage = { getItem: () => null, setItem: () => {} };
  const gs = await import(path.join(ROOT, 'src/renderer/js/gearspec.js'));
  gs.setGear(JSON.parse(fs.readFileSync(path.join(ROOT, 'src/renderer/data/gear2014.json'), 'utf8')));

  // 1. a real manifest's tone → gear chain → engine text
  const p = await Psarc.open(path.join(ROOT, 'test/fixtures/integration_p.psarc'));
  const lead = JSON.parse((await p.read('manifests/songs_dlc_integrationtest/integrationtest_lead.json')).toString('utf8').replace(/^﻿/, ''));
  await p.close();
  const attrs = Object.values(lead.Entries)[0].Attributes;
  const st = songTones(attrs, [], 'lead');
  const t = st.tones[0];
  ok(t.gear.length === 4, `song tone has its whole rig (${gs.describe(t)})`);
  ok(t.gear.find((g) => g.slot === 'amp').key === 'Amp_OrangeAD50', 'amp is the song’s Orange AD50');
  const spec = gs.toSpec(t);
  ok(/k\tGain\t60\t1\t100/.test(spec), 'amp gain carried over (60 of 1–100)');
  ok(/gear\tcab\tCab_OrangePPC212OB_Condenser_Cone/.test(spec), 'cabinet and mic carried over');
  ok(/k\tMix\t20\t1\t100/.test(spec), 'spring reverb mix carried over');
  ok(Math.abs(gs.ampGain(t) - (60 - 1) / 99) < 1e-6, 'gain slider starts where the song has it');

  // 2. engine: build and run presets and the song tone
  const { TONES } = await import(path.join(ROOT, 'src/renderer/js/rig.js')).catch(() => ({ TONES: null }));
  const wasm = new WebAssembly.Module(fs.readFileSync(path.join(ROOT, 'src/renderer/worklets/rig-dsp.wasm')));
  const x = new WebAssembly.Instance(wasm, {}).exports;
  const need = x.mem_needed();
  if (need > x.memory.buffer.byteLength) x.memory.grow(Math.ceil((need - x.memory.buffer.byteLength) / 65536));
  assert(x.init(48000));
  const tones = [...(TONES || []), { id: 'song', name: 'song tone', kind: 'guitar', gear: t.gear }];
  let slot = 0;
  for (const tone of tones) {
    const bytes = Buffer.from(gs.toSpec(tone) + '\0', 'utf8');
    new Uint8Array(x.memory.buffer, x.buf_spec(), 16384).set(bytes);
    const s = slot++ % 2;
    const built = x.build(s);
    x.select(s);
    let peak = 0,
      sum = 0,
      bad = false;
    const freq = tone.kind === 'bass' ? 55 : 110;
    for (let b = 0; b < 94; b++) {
      const inb = new Float32Array(x.memory.buffer, x.buf_in(), 512);
      for (let i = 0; i < 512; i++) inb[i] = 0.2 * Math.sin((2 * Math.PI * freq * (b * 512 + i)) / 48000) * Math.exp(-(b * 512 + i) / 30000);
      x.process(512);
      const L = new Float32Array(x.memory.buffer, x.buf_l(), 512);
      for (const v of L) {
        if (!Number.isFinite(v)) bad = true;
        peak = Math.max(peak, Math.abs(v));
        sum += v * v;
      }
    }
    const rms = Math.sqrt(sum / (94 * 512));
    ok(built && !bad && peak < 1 && rms > 0.005, `${tone.name}: builds and plays (rms ${rms.toFixed(3)}, peak ${peak.toFixed(2)})`);
  }
  if (!TONES) ok(false, 'presets readable');
  console.log(failed ? `${failed} failed` : 'all passed');
  process.exit(failed ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
