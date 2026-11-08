import { createHighway } from './js/highway.js';

const q = new URLSearchParams(location.search);
const scene = q.get('scene') || 'A';

// --- synthetic charts that mirror the three Rocksmith clips -------------
function songA() {
  // Bleed It Out style: double stops G7/B7 + e9 strummed in 8ths at anchor 7, width 4
  const notes = [], chordEvents = [], anchors = [{ t: 0, end: 200, fret: 7, width: 4 }], beats = [];
  const chords = [{ name: 'D Maj 7', fingers: [-1, -1, -1, 1, 1, 3], frets: [-1, -1, -1, 7, 7, 9] }, { name: '', fingers: [-1, -1, -1, 1, -1, 3], frets: [] }];
  const bpm = 110, b = 60 / bpm;
  for (let i = 0; i < 400; i++) beats.push({ t: 1 + i * b, m: i % 4 === 0 ? i / 4 : -1 });
  for (let i = 0; i < 160; i++) {
    const t = 2 + i * b / 2;
    if (i % 8 === 6) { notes.push({ t, s: 5, f: 9, sus: 0 }); continue; }
    const strings = i % 4 === 0 ? [{ s: 3, f: 7 }, { s: 4, f: 7 }, { s: 5, f: 9 }] : [{ s: 3, f: 7 }, { s: 5, f: 9 }];
    chordEvents.push({ t, chord: i % 4 === 0 ? 0 : 1, sus: 0, strings: strings.map((x) => ({ ...x, accent: i % 8 === 0 })) });
  }
  return { strings: 6, notes, chordEvents, anchors, beats, chords, sections: [{ name: 'verse', start: 2, end: 60 }], type: 'lead', tuningName: 'E Standard', length: 90, handShapes: [{ chord: 0, start: 1.9, end: 60 }] };
}
function songB() {
  // open position riff, frets 2-5 with open strings and long sustains
  const notes = [], anchors = [{ t: 0, end: 20, fret: 2, width: 4 }, { t: 20, end: 40, fret: 12, width: 4 }], beats = [];
  const bpm = 96, b = 60 / bpm;
  for (let i = 0; i < 200; i++) beats.push({ t: 1 + i * b, m: i % 4 === 0 ? i / 4 : -1 });
  const pat = [[1, 3, 0.9], [1, 5, 0], [2, 0, 0], [3, 2, 0], [2, 2, 0.25], [1, 3, 0], [0, 0, 0], [4, 3, 0.6], [2, 4, 0], [3, 0, 0], [1, 5, 1.2], [5, 3, 0]];
  for (let i = 0; i < 60; i++) {
    const [s, f, sus] = pat[i % pat.length];
    const n = { t: 2 + i * b / 2, s, f, sus };
    if (i % 12 === 7) n.vibrato = true;
    if (i % 12 === 10) n.bend = 2;
    if (i % 12 === 4) n.slideTo = 4;
    if (i % 9 === 3) n.hammerOn = true;
    notes.push(n);
  }
  for (let i = 0; i < 20; i++) notes.push({ t: 21 + i * b / 2, s: 4 - (i % 3), f: 12 + (i % 4), sus: i % 5 === 0 ? 0.6 : 0 });
  notes.sort((a, b) => a.t - b.t);
  return { strings: 6, notes, chordEvents: [], anchors, beats, chords: [], sections: [{ name: 'intro', start: 2, end: 20 }, { name: 'solo', start: 20, end: 40 }], type: 'lead', tuningName: 'E Standard', length: 60, handShapes: [] };
}
function songT() {
  // techniques side by side: a full bend, vibrato, tremolo picking, then all three again on other strings
  const notes = [], beats = [];
  const anchors = [{ t: 0, end: 60, fret: 5, width: 4 }];
  for (let i = 0; i < 200; i++) beats.push({ t: 1 + i * 0.5, m: i % 4 === 0 ? i / 4 : -1 });
  const mk = (t, s, f, sus, x) => notes.push({ t, s, f, sus, ...x });
  for (let r = 0; r < 4; r++) {
    const t = 2 + r * 4;
    mk(t, 3, 7, 1.2, { bend: 2, bends: [{ t: t + 0.25, step: 2 }, { t: t + 1.2, step: 2 }] });
    mk(t + 1.4, 2, 7, 1.2, { vibrato: true });
    mk(t + 2.8, 4, 5, 1.0, { tremolo: true });
  }
  // 3.13: a bend with vibrato on one note; a picked note with vibrato held into a bend (linkNext);
  // a short bend with no sustain; a bend and release
  mk(18, 2, 7, 1.4, { vibrato: true, bend: 3, bends: [{ t: 18.2, step: 3 }, { t: 19.4, step: 3 }] });
  mk(19.8, 1, 8, 0.5, { vibrato: true, linkNext: true });
  mk(20.3, 1, 8, 1.0, { linked: true, bend: 2, bends: [{ t: 20.4, step: 2 }, { t: 21.3, step: 2 }] });
  mk(21.8, 3, 7, 0, { bend: 1, bends: [{ t: 21.85, step: 1 }] });
  mk(22.4, 2, 8, 1.2, { bend: 2, bends: [{ t: 22.6, step: 2 }, { t: 23.0, step: 2 }, { t: 23.4, step: 0 }] });
  // 4.0.6: bend up, then held on with vibrato and no bend of its own (must stay bent and wobble), twice
  for (const t0 of [24.5, 27]) {
    mk(t0, 2, 9, 0.6, { linkNext: true, bend: 2, bends: [{ t: t0, step: 0 }, { t: t0 + 0.3, step: 2 }] });
    mk(t0 + 0.6, 2, 9, 1.4, { linked: true, vibrato: true });
  }
  return { strings: 6, notes, chordEvents: [], anchors, beats, chords: [], sections: [{ name: 'riff', start: 2, end: 20 }], type: 'lead', tuningName: 'E Standard', length: 60, handShapes: [] };
}
function songC() {
  // solo across the neck: low at 4-7, a long slide up to 17-20, back down
  const notes = [], beats = [];
  const anchors = [{ t: 0, fret: 4, width: 4 }, { t: 6, fret: 17, width: 4 }, { t: 11, fret: 12, width: 4 }, { t: 15, fret: 5, width: 4 }];
  anchors.forEach((a, i) => (a.end = anchors[i + 1] ? anchors[i + 1].t : 30));
  const bpm = 120, b = 60 / bpm;
  for (let i = 0; i < 200; i++) beats.push({ t: 1 + i * b, m: i % 4 === 0 ? i / 4 : -1 });
  let t = 2;
  for (const f of [4, 5, 7, 5, 4, 7, 6, 4]) { notes.push({ t, s: 3, f, sus: 0 }); t += b / 2; }
  notes.push({ t, s: 3, f: 4, sus: 1.4, slideTo: 17 }); t = 6.2;
  for (const [s, f] of [[4, 17], [4, 18], [4, 20], [5, 17], [5, 20], [4, 19]]) { notes.push({ t, s, f, sus: s === 5 && f === 20 ? 1.0 : 0, vibrato: f === 20 }); t += b / 2; }
  t = 11.2;
  for (const [s, f] of [[5, 12], [5, 15], [4, 13], [4, 12]]) { notes.push({ t, s, f, sus: 0.5, bend: f === 15 ? 2 : 0 }); t += b; }
  t = 15.2;
  for (const f of [5, 7, 8, 5, 7]) { notes.push({ t, s: 2, f, sus: 0 }); t += b / 2; }
  return { strings: 6, notes, chordEvents: [], anchors, beats, chords: [], sections: [{ name: 'solo', start: 2, end: 20 }], type: 'lead', tuningName: 'E Standard', length: 30, handShapes: [] };
}
const tab = scene.startsWith('R') ? (await (await fetch('/' + (q.get('file') || 'real.json'))).json())[q.get('part') || (scene === 'RB' ? 'bass' : 'lead')] : { A: songA, B: songB, C: songC, T: songT }[scene]();
tab.id = 'p1';
// secs=song: a song's usual sections (for the section strip and repeats)
if (q.get('secs') === 'song') {
  const names = ['intro', 'verse', 'prechorus', 'chorus', 'verse', 'prechorus', 'chorus', 'bridge', 'solo', 'chorus', 'outro'];
  const a = 1, z = tab.length - 1, w = (z - a) / names.length;
  tab.sections = names.map((name, i) => ({ name, start: a + i * w, end: a + (i + 1) * w }));
}
window.__tab = tab;
window.__parts = [{ id: 'p1', type: 'lead', name: 'Lead' }];

const engine = Object.assign(new EventTarget(), { playing: q.get('play') === '1', speed: 1, duration: tab.length, tracks: [], sinkId: '', sampleRate: 48000, setSpeed(s) { s = Math.round(Math.max(0.25, Math.min(1.5, s)) * 100) / 100; if (s === this.speed) return; const p = this.position; this.speed = s; this.position = p; this.dispatchEvent(new Event('speed')); }, setPlayAlong() {}, level: () => 0, extraLatency: 0, async extraOut() { this._ac = this._ac || new AudioContext(); await this._ac.resume(); return { ctx: this._ac, node: this._ac.destination }; } });
// a smooth song clock, moving while playing (tests may also set it by hand)
let clockAt = Number(q.get('t') || 3);
let clockFrom = performance.now();
Object.defineProperty(engine, 'position', {
  get() { return this.playing ? clockAt + ((performance.now() - clockFrom) / 1000) * this.speed : clockAt; },
  set(v) { clockAt = v; clockFrom = performance.now(); },
});
// enough of the song player for the timing check's training song
Object.assign(engine, {
  async reset(sr, frames) { this.pause(); this.tracks = []; this.duration = frames / sr; this.position = 0; },
  loadTrack(i, name, buffer, wav) { this.tracks[i] = { name, frames: wav.frames }; this.duration = wav.frames / wav.sampleRate; this.loaded = { name, bytes: buffer.byteLength, wav }; },
  setMode(m) { this.mode = m; },
  async play() { if (!this.playing) { this.position = this.position; this.playing = true; this.dispatchEvent(new Event('state')); } },
  pause() { if (this.playing) { const p = this.position; this.playing = false; this.position = p; this.dispatchEvent(new Event('state')); } },
  seek(t) { this.position = t; },
  setLoop() {},
  unloadAll() { this.tracks = []; this.loaded = null; },
});
const stage = { engine, stems: () => [], toggle() {}, seek(t) { engine.position = t; engine.dispatchEvent(new Event('seek')); }, setMode() {}, setLoop(l) { this._loop = l; }, getLoop() { return this._loop || null; }, gel: () => '#fff', label: (x) => x, trackIndex: () => 0, setStem() {}, songLevel: () => 0.8, setSongLevel() {}, setYou() {} };
stage.borrowPlayer = () => { engine.pause(); const snap = { at: engine.position, duration: engine.duration }; engine.unloadAll(); stage.borrowed = snap; return snap; };
stage.giveBack = (snap) => { stage.borrowed = null; if (!snap) return; engine.duration = snap.duration; engine.position = snap.at; stage.gaveBack = snap; };
const hw = createHighway(stage);
window.__stage = stage;
await hw.open({ id: 's1', title: 'Scene ' + scene, artist: 'Test' });
// the first-time timing check offer would cover the highway in every shot (TCHECK/PLAYCAL open it themselves)
{ const H = document.querySelector('.highway').__hw; H.prefs.syncChecked = true; const box = document.querySelector('.hw-syncbox'); if (box && !box.hidden) box.querySelector('.btn.ghost')?.click(); }
window.__hwReady = true;
