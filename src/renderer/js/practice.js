/**
 * Practice: the part you're playing in the current song, scoring as you play
 * (whatever view is showing), passes for the riff repeater, and practice
 * time logged for Progress.
 */
import { api } from './api.js';
import { state, on, emit } from './store.js';
import { rig } from './rig.js';
import { Analyzer, OnsetTracker, Judge, targetsFromTab, tuneShift } from './detect.js';
import * as stage from './stage.js';
import { toast } from './ui.js';
import { breakdown, compact } from './scorecard.js';
import { setMyTuning } from './tuning.js';
import { checkTuning } from './tuning-check.js';

// 4.0.6: the tuning check is a card with every string (tuning-check.js); it replaced
// the 3.7 notes in the corner.
const PREF_KEY = 'stagehand.tab';
function partPref() {
  try {
    return (JSON.parse(localStorage.getItem(PREF_KEY) || '{}') || {}).part || 'lead';
  } catch (_) {
    return 'lead';
  }
}
function setPartPref(p) {
  try {
    const o = JSON.parse(localStorage.getItem(PREF_KEY) || '{}') || {};
    o.part = p;
    localStorage.setItem(PREF_KEY, JSON.stringify(o));
    const hw = JSON.parse(localStorage.getItem('stagehand.highway') || '{}') || {};
    hw.part = p;
    localStorage.setItem('stagehand.highway', JSON.stringify(hw));
  } catch (_) {}
}

export const practice = new (class extends EventTarget {
  constructor() {
    super();
    this.song = null;
    this.parts = [];
    this.tab = null;
    this.targets = [];
    this.judge = null;
    this.an = null;
    this.onset = new OnsetTracker();
    this.buf = new Float32Array(8192);
    this.lastT = 0;
    this.raf = 0;
    this.pass = null; // { start, end, hits0, judged0 } for the riff repeater
    this.session = null;
    this.free = { secs: 0, last: 0 };
  }

  get kind() {
    return this.tab && this.tab.type === 'bass' ? 'bass' : 'guitar';
  }
  get partName() {
    return this.tab ? { lead: 'Lead', rhythm: 'Rhythm', bass: 'Bass', combo: 'Lead' }[this.tab.type] || 'Part' : '';
  }

  async setSong(song) {
    this.flush();
    this.song = song;
    this.parts = [];
    this.tab = null;
    this.targets = [];
    this.judge = null;
    emit('practice');
    if (!song) return;
    api.app.activity(`Playing ${song.title}`).catch(() => {});
    try {
      const parts = await api.tab.list(song.id);
      if (this.song !== song) return;
      this.parts = parts.filter((p) => ['lead', 'rhythm', 'bass', 'combo'].includes(p.type));
      const want = partPref();
      const pick = this.parts.find((p) => p.type === want && !p.bonus) || this.parts.find((p) => p.type === want) || (want === 'lead' ? this.parts.find((p) => p.type === 'combo') : null) || this.parts[0];
      if (pick) await this.loadPart(pick.id, false);
    } catch (_) {}
    emit('practice');
  }

  async loadPart(id, remember = true) {
    const song = this.song;
    if (!song) return;
    const tab = await api.tab.load(song.id, id);
    if (this.song !== song) return;
    this.flush();
    this.tab = tab;
    const kind = tab.type === 'bass' ? 'bass' : 'guitar';
    rig.setSongTuning(tab.tuning, kind, tab.cents || 0);
    checkTuning(tab, song, { engine: stage.engine });
    tuneShift.st = rig.dropAmount();
    this.targets = targetsFromTab(tab);
    this.resetJudge();
    if (remember) setPartPref(tab.type === 'combo' ? 'lead' : tab.type);
    emit('practice');
  }

  resetJudge() {
    this.judge = this.targets.length ? new Judge(this.targets) : null;
    if (this.judge) this.judge.reset(stage.engine.position);
    this.an = new Analyzer(rig.sampleRate);
    this.onset = new OnsetTracker();
    this.pass = null;
  }

  get accuracy() {
    return this.judge ? this.judge.accuracy : null;
  }

  _delay() {
    return ((rig.latencyMs || 20) / 1000 + 0.03) * stage.engine.speed;
  }

  tick() {
    const eng = stage.engine;
    const t = eng.position;
    const now = performance.now();
    const dt = Math.min(0.25, (now - (this._lastTick || now)) / 1000);
    this._lastTick = now;
    // free playing (no song): count time while you're making sound
    if (rig.on && !eng.playing) {
      const l = rig.levels();
      if ((l.input || 0) > 0.01) this.free.last = now;
      if (this.free.prev && now - this.free.last < 4000) this.free.secs += (now - this.free.prev) / 1000;
      this.free.prev = now;
      if (this.free.secs > 300) this._flushFree();
    } else this.free.prev = 0;
    if (!this.judge || !eng.playing) {
      this.lastT = t;
      return;
    }
    // the song looped or jumped back: close the pass, forget what follows
    if (t < this.lastT - 0.3) {
      this._endPass();
      this.judge.rewind(t);
    }
    this.lastT = t;
    if (this.session && rig.on) this.session.secs += dt;
    // the highway scores on its own while it's open: don't analyse the guitar twice
    if (rig.on && !document.getElementById('app').classList.contains('under-highway')) {
      const buf = rig.samples(this.buf);
      if (buf) {
        if (!this.an || this.an.sr !== rig.sampleRate) this.an = new Analyzer(rig.sampleRate);
        const tt = t - this._delay();
        const f = this.an.frame(buf);
        this.judge.push(tt, f, this.onset.update(tt, f));
        this.judge.events.length = 0;
      }
      this.judge.tick(t - this._delay());
    }
  }

  /** Riff repeater: start counting a pass over [start, end). */
  beginPass(start, end) {
    this.pass = { start, end };
  }
  stopPasses() {
    this.pass = null;
  }

  _endPass() {
    const p = this.pass;
    if (!p || !this.judge) return;
    let hits = 0;
    let judged = 0;
    for (const [id, st] of this.judge.state) {
      const tg = this.targets[id];
      if (!tg || tg.t < p.start - 0.05 || tg.t >= p.end) continue;
      judged++;
      if (st.result === 'hit') hits++;
    }
    const total = this.targets.filter((tg) => tg.t >= p.start - 0.05 && tg.t < p.end).length;
    this.dispatchEvent(new CustomEvent('pass', { detail: { hits, judged, total, accuracy: total ? hits / total : null, speed: stage.engine.speed } }));
  }

  /** Where the score comes from: the highway's own judge while it's open, else ours. */
  _source() {
    const hw = typeof window !== 'undefined' ? window.__shHighway : null;
    if (hw && hw.open() && hw.judge() && hw.songId() === (this.song && this.song.id)) return { judge: hw.judge(), part: hw.part(), tab: hw.tab(), targets: hw.targets() };
    return { judge: this.judge, part: this.tab ? (this.tab.type === 'combo' ? 'lead' : this.tab.type) : null, tab: this.tab, targets: this.targets };
  }

  startSession() {
    if (!this.song) return;
    if (!this.session || this.session.songId !== this.song.id) {
      this.flush();
      const src = this._source();
      const j = src.judge;
      this.session = { songId: this.song.id, part: src.part, secs: 0, at: Date.now(), judge: j, hits0: j ? j.hits : 0, judged0: j ? j.judged : 0, tuning: this.tab ? this.tab.tuning : null, cents: this.tab ? this.tab.cents || 0 : 0, title: this.song ? this.song.title : null, kind: this.kind, tab: src.tab, targets: src.targets, pos0: stage.engine.position - 0.5 };
    }
  }

  /**
   * Logs what's been played so far and carries on with a fresh session (3.7:
   * called when the highway opens or closes and when Progress is shown, so the
   * song you just played is there straight away, with the highway's score).
   */
  checkpoint() {
    if (!this.session) return;
    this.flush();
    if (stage.engine.playing && rig.on) this.startSession();
  }

  /** Logs the practice so far (song time with your guitar on). */
  flush() {
    const s = this.session;
    this.session = null;
    if (s && s.secs >= 10) {
      const j = s.judge;
      let hit = j ? j.hits - s.hits0 : 0;
      let notes = j ? j.judged - s.judged0 : 0;
      if (j && (notes < 0 || hit < 0)) (hit = j.hits), (notes = j.judged); // the score was reset (seek back): count what's there
      const accuracy = notes > 0 ? hit / notes : null;
      // played it well with the Drop off: that's how your instrument is tuned now
      if (accuracy !== null && accuracy >= 0.6 && notes >= 30 && !rig.dropAmount() && s.tuning) setMyTuning(s.kind, s.tuning, s.cents || 0, s.title);
      // the breakdown (sections, kinds of notes, longest streak) of what was played in this session
      const detail = j && s.targets ? compact(breakdown(s.tab, s.targets, j, { from: s.pos0 })) : {};
      api.stats.log({ songId: s.songId, part: s.part, seconds: s.secs, accuracy, notes, hit, speed: stage.engine.speed, at: s.at, ...detail }).then(() => emit('stats')).catch(() => {});
    }
  }

  _flushFree() {
    const secs = this.free.secs;
    this.free.secs = 0;
    if (secs >= 10) api.stats.log({ songId: null, part: null, seconds: secs, accuracy: null, at: Date.now() - secs * 1000 }).then(() => emit('stats')).catch(() => {});
  }

  flushAll() {
    this.flush();
    this._flushFree();
  }
})();

function loop() {
  practice.tick();
  practice.raf = requestAnimationFrame(loop);
}
practice.raf = requestAnimationFrame(loop);

on('stage-song', () => practice.setSong(stage.current()));
stage.engine.addEventListener('state', () => {
  if (stage.engine.playing && rig.on) practice.startSession();
});
// the song ends: log it now, not when the next song starts
stage.engine.addEventListener('state', () => {
  if (!stage.engine.playing && stage.engine.duration && stage.engine.position >= stage.engine.duration - 0.5) practice.flush();
});
on('page', () => {
  if (state.page === 'progress') practice.checkpoint();
});
if (typeof window !== 'undefined') window.__shPractice = practice;
stage.engine.addEventListener('seek', () => {
  if (practice.judge) practice.judge.rewind(stage.engine.position);
});
window.addEventListener('beforeunload', () => practice.flushAll());
// the Drop changes which pitches you play for the same notes: re-aim the scoring
rig.addEventListener('drop', () => {
  const st = rig.dropAmount();
  if (st === tuneShift.st) return;
  tuneShift.st = st;
  if (practice.tab) {
    practice.targets = targetsFromTab(practice.tab);
    practice.resetJudge();
  }
});
setInterval(() => {
  // keep long sessions safe: log every 10 minutes of practice
  if (practice.session && practice.session.secs > 600) {
    practice.flush();
    if (stage.engine.playing && rig.on) practice.startSession();
  }
}, 30000);
