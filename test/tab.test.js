'use strict';
/* Tab data: .sng decoding checked against the XML copy, song tones, tuner accuracy. `node test/tab.test.js` */
const assert = require('assert');
const path = require('path');
const { Psarc } = require('../src/main/core/psarc');
const sng = require('../src/main/core/sng');
const { parseXml } = require('../src/main/core/xmlarr');
const { mapTone, songTones } = require('../src/main/core/tones');
const { TabService } = require('../src/main/services/tabs');
const rocksmith = require('../src/main/core/rocksmith');

const FIX = path.join(__dirname, 'fixtures');
let passed = 0;
const tests = [];
const test = (name, fn) => tests.push({ name, fn });

test('.sng notes match the readable XML copy exactly (lead and rhythm)', async () => {
  const p = await Psarc.open(path.join(FIX, 'legacy_p.psarc'));
  try {
    for (const a of ['lead', 'rhythm']) {
      const fromSng = sng.toTab(sng.parse(sng.unpack(await p.read(`songs/bin/generic/testtest_${a}.sng`))), { type: a });
      const fromXml = parseXml((await p.read(`songs/arr/testtest_${a}.xml`)).toString(), { type: a });
      for (const k of ['notes', 'chordEvents', 'beats', 'sections', 'tuning', 'handShapes', 'length']) assert.deepStrictEqual(fromSng[k], fromXml[k], `${a}: ${k}`);
      assert.deepStrictEqual(fromSng.chords.map((c) => [c.name, c.frets, c.fingers]), fromXml.chords.map((c) => [c.name, c.frets, c.fingers]));
    }
  } finally {
    await p.close();
  }
});

test('techniques come through: slides, vibrato, harmonics, hammer-ons, chords', async () => {
  const p = await Psarc.open(path.join(FIX, 'legacy_p.psarc'));
  const tab = sng.toTab(sng.parse(sng.unpack(await p.read('songs/bin/generic/testtest_rhythm.sng'))), { type: 'rhythm' });
  await p.close();
  assert.ok(tab.notes.some((n) => n.slideTo === 14));
  assert.ok(tab.notes.some((n) => n.vibrato));
  assert.ok(tab.notes.some((n) => n.harmonic));
});

test('lyrics, parts and song tones load through the tab service', async () => {
  const file = path.join(FIX, 'integration_p.psarc');
  const p = await Psarc.open(file);
  const song = (await rocksmith.readSongs(p))[0];
  await p.close();
  Object.assign(song, { path: file, mtimeMs: 1 });
  const svc = new TabService();
  const parts = svc.list(song);
  assert.deepStrictEqual(parts.map((x) => x.type), ['lead', 'bass']);
  const lead = await svc.load(song, parts[0].id);
  assert.strictEqual(lead.strings, 6);
  assert.ok(lead.notes.length + lead.chordEvents.length > 0);
  assert.ok(lead.lyrics.length > 50 && lead.lyrics[0].w === 'But');
  assert.strictEqual(lead.songTones.tones[0].amp, 'Orange AD50');
  assert.strictEqual(lead.songTones.tones[0].preset, 'crunch');
  const bass = await svc.load(song, parts[1].id);
  assert.strictEqual(bass.strings, 4);
  assert.strictEqual(bass.songTones.tones[0].preset, 'bass-grit');
});

test('Rocksmith tones map to sensible presets', () => {
  const amp = (key, gain) => ({ Amp: { Type: 'Amps', Key: key, KnobValues: { [`${key}_Gain`]: gain, [`${key}_Bass`]: 50, [`${key}_Mid`]: 50, [`${key}_Treble`]: 50 } } });
  const t = (desc, gear, name = 'x') => mapTone({ Name: name, Key: name, ToneDescriptors: desc.map((d) => `$[1]${d}`), GearList: gear }, 'lead');
  assert.strictEqual(t(['CLEAN'], amp('Amp_TW40', 20)).preset, 'clean');
  assert.strictEqual(t(['HIGH GAIN'], amp('Amp_Recto', 90)).preset, 'metal');
  assert.strictEqual(t(['DISTORTION'], amp('Amp_X', 40)).preset, 'crunch');
  assert.strictEqual(t(['DISTORTION'], amp('Amp_X', 85)).preset, 'metal');
  assert.strictEqual(t(['OVERDRIVE'], amp('Amp_X', 50)).preset, 'overdrive');
  assert.strictEqual(t(['FUZZ'], amp('Amp_X', 50)).preset, 'fuzz');
  assert.strictEqual(t(['DISTORTION'], amp('Amp_X', 60), 'solo lead').preset, 'lead');
  const st = songTones({ Tone_Base: 'Clean', Tone_A: 'Clean', Tone_B: 'Dirt', Tones: [{ Key: 'Clean', Name: 'Clean', ToneDescriptors: ['$[1]CLEAN'], GearList: amp('Amp_A', 10) }, { Key: 'Dirt', Name: 'Dirt', ToneDescriptors: ['$[1]HIGH GAIN'], GearList: amp('Amp_B', 90) }] }, [{ time: 30.5, id: 1 }, { time: 60, id: 0 }], 'lead');
  assert.strictEqual(st.base, 'Clean');
  assert.deepStrictEqual(st.changes, [{ t: 30.5, key: 'Dirt' }, { t: 60, key: 'Clean' }]);
});

test('tuner: within a quarter cent from a low B on bass to high C', async () => {
  const { detectPitch, PitchSmoother } = await import('../src/renderer/js/pitch.js');
  const sr = 48000;
  let worst = 0;
  for (const midi of [23, 28, 33, 40, 45, 50, 55, 59, 64, 76, 84]) {
    for (const cents of [-31.7, -3.3, 0, 1.2, 9.9]) {
      const f = 440 * Math.pow(2, (midi - 69 + cents / 100) / 12);
      const sm = new PitchSmoother();
      let got;
      for (let k = 0; k < 5; k++) {
        const b = new Float32Array(8192);
        for (let i = 0; i < b.length; i++) {
          const t = 0.1 + k * 0.08 + i / sr;
          let v = 0;
          for (let hm = 1; hm <= 8; hm++) v += (hm === 1 ? 0.6 : 0.5 / hm) * Math.sin(2 * Math.PI * f * hm * t + hm);
          b[i] = 0.25 * v * Math.exp(-t * 1.5);
        }
        const p = detectPitch(b, sr);
        got = sm.push(p && p.hz);
      }
      assert.ok(got, `no reading for ${midi}`);
      worst = Math.max(worst, Math.abs(1200 * Math.log2(got / f)));
    }
  }
  assert.ok(worst < 0.25, `worst ${worst.toFixed(3)} cents`);
});

(async () => {
  for (const t of tests) {
    try {
      await t.fn();
      passed++;
      console.log(`  ok  ${t.name}`);
    } catch (err) {
      console.log(`  FAIL ${t.name}\n       ${String(err.stack).split('\n').slice(0, 5).join('\n       ')}`);
      process.exitCode = 1;
    }
  }
  console.log(`\n${passed}/${tests.length} passed`);
})();
