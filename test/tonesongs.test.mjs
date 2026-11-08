// 4.1.9: song tones grouped, described and searchable, and keys that never get written over by a click.
import assert from 'node:assert/strict';
import fs from 'node:fs';
const spec = await import('../src/renderer/js/gearspec.js');
spec.setGear(JSON.parse(fs.readFileSync(new URL('../src/renderer/data/gear2014.json', import.meta.url))));
const S = await import('../src/renderer/js/tonesongs.js');
const K = await import('../src/renderer/js/toneslots.js');
let bad = 0;
const ok = (name, fn) => {
  try {
    fn();
    console.log(`ok   ${name}`);
  } catch (e) {
    bad++;
    console.log(`FAIL ${name}\n     ${e.message}`);
  }
};

const G = (slot, key, knobs = {}) => ({ slot, key, knobs });
const heavy = { key: 'dist', name: 'Distortion', kind: 'guitar', gear: [G('pre', 'Pedal_SuperDrive', { Gain: 10 }), G('amp', 'Amp_CA100', { Amp_CA100_Gain: 80 }), G('cab', 'Cab_CA412C_57_Cone')], descriptors: ['High gain', 'Distortion'] };
const clean = { key: 'cln', name: 'Clean', kind: 'guitar', gear: [G('amp', 'Amp_TW40', {}), G('post', 'Pedal_Chorus20')], descriptors: ['Clean'] };
const solo = { key: 'solo', name: 'Solo', kind: 'guitar', gear: [G('amp', 'Amp_MarshallJCM800', {}), G('post', 'Pedal_AnalogueDelay')], descriptors: [] };
const bass = { key: 'bass', name: 'Bass', kind: 'bass', gear: [G('amp', 'Bass_Amp_AT800B', {})], descriptors: ['Clean'] };
const lib = [
  { songId: 'a', title: 'Harvester of Sorrow', artist: 'Metallica', tones: [heavy, clean, solo, bass] },
  { songId: 'b', title: 'Sad but True', artist: 'Metallica', tones: [{ ...heavy, key: 'x', name: 'Rhythm' }] }, // same gear as Harvester's
  { songId: 'c', title: 'Afterlife', artist: 'Avenged Sevenfold', tones: [{ ...solo, key: 'ld', name: 'Lead', gear: [G('pre', 'Pedal_SuperDrive', { Gain: 30 }), G('amp', 'Amp_MarshallJCM800', {})] }] },
  { songId: 'd', title: 'Empty', artist: 'Nobody', tones: [{ key: 'none', name: 'None', gear: [] }] },
];

ok('each tone is described by what it is for and its gear', () => {
  const d = S.describeTone(heavy);
  assert.equal(d.character, 'heavy');
  assert.equal(d.label, 'High gain');
  assert.match(d.text, /^High gain · .+ · /);
  assert.equal(S.describeTone(clean).character, 'clean');
  assert.equal(S.describeTone(solo).character, 'lead'); // by its name
  assert.equal(S.describeTone(bass).label, 'Clean bass');
  // no words from the song: the gear decides
  assert.equal(S.toneCharacter({ name: 'Tone A', gear: [G('pre', 'Pedal_MetalDistortion'), G('amp', 'Amp_TW40')] }), 'heavy');
  assert.equal(S.toneCharacter({ name: 'Tone B', gear: [G('amp', 'Amp_TW40', { Amp_TW40_Gain: 10 })] }), 'clean');
});

ok('the same tone in many songs is shown once, and says where else it is', () => {
  const r = S.groupSongTones(lib);
  assert.equal(r.total, 6); // the toneless one is left out
  assert.equal(r.distinct, 5);
  const all = r.groups.flatMap((g) => g.items);
  const dist = all.filter((i) => i.desc.character === 'heavy');
  assert.equal(dist.length, 1);
  assert.equal(dist[0].title, 'Harvester of Sorrow');
  assert.deepEqual(dist[0].also, ['Sad but True']);
});

ok('grouped by song (artist, then title) or by artist', () => {
  const bySong = S.groupSongTones(lib);
  assert.deepEqual(bySong.groups.map((g) => g.title), ['Afterlife', 'Harvester of Sorrow']);
  const h = bySong.groups[1];
  assert.equal(h.sub, 'Metallica');
  assert.deepEqual(h.items.map((i) => i.desc.character + ':' + i.desc.kind), ['clean:guitar', 'heavy:guitar', 'lead:guitar', 'clean:bass']); // guitar first, clean to lead
  const byArtist = S.groupSongTones(lib, { by: 'artist' });
  assert.deepEqual(byArtist.groups.map((g) => g.title), ['Avenged Sevenfold', 'Metallica']);
  assert.equal(byArtist.groups[1].sub, '1 song');
});

ok('search matches artist, song, amp and character; filters narrow it', () => {
  const titles = (o) => S.groupSongTones(lib, o).groups.flatMap((g) => g.items.map((i) => `${i.title}/${i.tone.name}`));
  assert.deepEqual(titles({ query: 'metallica lead' }), ['Harvester of Sorrow/Solo']);
  assert.deepEqual(titles({ query: 'sevenfold' }), ['Afterlife/Lead']);
  assert.deepEqual(titles({ query: 'sad but' }), ['Harvester of Sorrow/Distortion']); // found through the song that shares it
  assert.ok(titles({ query: 'distortion' }).length === 1, 'distortion finds the high-gain tone only');
  assert.deepEqual(titles({ query: 'chorus' }), ['Harvester of Sorrow/Clean']);
  assert.deepEqual(titles({ kind: 'bass' }), ['Harvester of Sorrow/Bass']);
  assert.deepEqual(titles({ character: 'lead' }).sort(), ['Afterlife/Lead', 'Harvester of Sorrow/Solo']);
  assert.deepEqual(titles({ kind: 'guitar', character: 'clean' }), ['Harvester of Sorrow/Clean']);
  const amp = S.describeTone(solo).amp.split(' ')[0].toLowerCase();
  assert.ok(titles({ query: amp }).length >= 2, `the amp's name (${amp}) finds its tones`);
  const capped = S.groupSongTones(lib, { limit: 1 });
  assert.equal(capped.groups.length, 1);
  assert.equal(capped.hidden, capped.count - 1);
});

// --- keys
const mine = [
  { id: 't1', name: 'Clean', slot: 2, gear: [] },
  { id: 't2', name: 'Thrash', slot: null, gear: [] },
  { id: 't3', name: 'Lead', slot: 4, gear: [] },
];
ok('putting a tone on a key says what it replaces and can be undone', () => {
  const ch = K.slotChange(mine, 't2', 2);
  assert.equal(ch.replaces.id, 't1');
  assert.equal(ch.from, null);
  assert.equal(K.slotChangeText(ch), 'Put “Thrash” on key 2? It replaces “Clean”, which stays in your tones.');
  const after = K.applySlotChange(mine, ch);
  assert.deepEqual(after.map((t) => t.slot), [null, 2, 4]); // one tone per key, nothing deleted
  assert.deepEqual(K.undoSlotChange(after, ch).map((t) => t.slot), [2, null, 4]);
  assert.deepEqual(mine.map((t) => t.slot), [2, null, 4], 'the list itself is not changed');
  const move = K.slotChange(mine, 't3', 5);
  assert.equal(move.replaces, null);
  assert.deepEqual(K.undoSlotChange(K.applySlotChange(mine, move), move).map((t) => t.slot), [2, null, 4]);
  assert.ok(K.slotChange(mine, 't1', 2).noop, 'already there');
  assert.ok(K.slotChange(mine, 'nope', 3).noop, 'no such tone');
  assert.equal(K.slotChangeText(K.slotChange(mine, 't3', null)), 'Take “Lead” off key 4?');
});

ok('an edit is a change until it is saved; turning a knob back is not', () => {
  const saved = { name: 'Thrash', kind: 'guitar', gear: [G('amp', 'Amp_CA100', { Gain: 8 }), G('pre', 'Pedal_SuperDrive', { Gain: 5 })] };
  const same = { ...saved, gear: [G('pre', 'Pedal_SuperDrive', { Gain: 5.00001 }), G('amp', 'Amp_CA100', { Gain: 8 })] };
  assert.equal(K.isChanged(saved, same), false);
  assert.equal(K.isChanged(saved, { ...saved, gear: [G('amp', 'Amp_CA100', { Gain: 9 }), saved.gear[1]] }), true);
  assert.equal(K.isChanged(saved, { ...saved, name: 'Thrash 2' }), true);
  assert.equal(K.isChanged(saved, { ...saved, gear: [G('amp', 'Amp_CA100', { Gain: 8, Amp_CA100_Gain: 8 }), saved.gear[1]] }), false, 'the long knob name is the same knob');
  assert.equal(K.isChanged(saved, { ...saved, gear: [saved.gear[0], { ...saved.gear[1], bypass: true }] }), true);
});

if (bad) process.exit(1);
console.log('all ok');
