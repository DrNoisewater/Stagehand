/**
 * The Quest companion, the window's side (4.16). While a headset is connected,
 * the song's clock and play state go to it about 30 times a second, and what you
 * pick on the headset (a song, a part, play, pause, a seek) happens here.
 *
 * Off (the switch in Settings › Quest, or no headset connected): nothing runs.
 */
import { api } from './api.js';
import { state, emit } from './store.js';
import * as stage from './stage.js';
import * as actions from './actions.js';

const Q = { clients: 0, timer: 0, last: null, lastSent: 0, status: null };
export const quest = Q;

function snapshot() {
  const hw = window.__shHighway;
  const eng = stage.engine;
  const song = stage.current();
  const open = !!(hw && hw.open());
  const tab = open && hw.tab ? hw.tab() : null;
  const onSong = !!(song && tab && hw.songId() === song.id);
  const judge = open && hw.judge ? hw.judge() : null;
  return {
    songId: song ? song.id : null,
    arrId: onSong ? tab.id : null,
    part: onSong ? hw.part() : null,
    t: eng.position || 0,
    at: performance.timeOrigin + performance.now(),
    playing: !!eng.playing,
    speed: eng.speed || 1,
    open,
    dur: stage.duration() || 0,
    venue: open && hw.venue ? hw.venue() : null,
    score: judge ? { acc: judge.accuracy, streak: judge.streak, hits: judge.hits, judged: judge.judged } : null,
  };
}

function tick() {
  const s = snapshot();
  const p = Q.last;
  const changed = !p || p.songId !== s.songId || p.arrId !== s.arrId || p.playing !== s.playing || p.speed !== s.speed || p.open !== s.open || p.venue !== s.venue || Math.abs(s.t - p.t) > 0.05 || (s.score && (!p.score || p.score.judged !== s.score.judged));
  // playing: every tick (the headset's clock); paused: on a change, and once a second
  if (s.playing || changed || s.at - Q.lastSent > 1000) {
    api.companion.state(s);
    Q.lastSent = s.at;
  }
  Q.last = s;
}

function setClients(n) {
  Q.clients = Number(n) || 0;
  if (Q.clients > 0 && !Q.timer) {
    Q.last = null;
    Q.timer = setInterval(tick, 33);
    window.__shCompanionJudged = (e, tg) => api.companion.judged({ t: tg.t, hit: !!e.hit, notes: (tg.notes || []).map((n) => ({ s: n.s, f: n.f })) });
    tick();
  } else if (Q.clients === 0 && Q.timer) {
    clearInterval(Q.timer);
    Q.timer = 0;
    window.__shCompanionJudged = null;
  }
}

/** Waits (up to a few seconds) for the highway to have read this song. */
async function highwayOn(songId, ms = 8000) {
  const t0 = performance.now();
  while (performance.now() - t0 < ms) {
    const hw = window.__shHighway;
    if (hw && hw.open() && hw.songId() === songId && hw.tab()) return hw;
    await new Promise((r) => setTimeout(r, 100));
  }
  return null;
}

async function command(m) {
  const hw = window.__shHighway;
  switch (m.type) {
    case 'pick': {
      if (!state.songs.get(m.songId)) return;
      await actions.playAlong(m.songId);
      if (m.arrId) {
        const on = await highwayOn(m.songId);
        if (on && on.setPart) await on.setPart(m.arrId);
      }
      break;
    }
    case 'part':
      if (hw && hw.open() && hw.setPart && (!m.songId || hw.songId() === m.songId)) await hw.setPart(m.arrId);
      break;
    case 'play':
      if (!stage.engine.playing) stage.toggle();
      break;
    case 'pause':
      if (stage.engine.playing) stage.toggle();
      break;
    case 'seek':
      if (Number.isFinite(m.t)) stage.seekTo(Math.max(0, m.t));
      break;
    default:
      return;
  }
  Q.last = null; // tell the headset at once
  if (Q.timer) tick();
}

if (api.companion) {
  api.on('companion:clients', (n) => setClients(n));
  api.on('companion:command', (m) => command(m).catch(() => {}));
  api.on('companion:status', (st) => {
    Q.status = st;
    emit('quest');
  });
  // left on last time: pick up any headset that's already back
  api.companion
    .status()
    .then((st) => {
      Q.status = st;
      setClients(st && st.clients);
    })
    .catch(() => {});
}
