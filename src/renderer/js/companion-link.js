/**
 * 4.16: the page's side of the Quest companion. While a headset is connected, tells it where
 * the song is (30 times a second while playing) and does what the headset asks (pick a song,
 * play, pause, seek), exactly as if you'd clicked here. With the companion off, or no headset
 * connected, this does nothing at all.
 */
import { api } from './api.js';
import * as stage from './stage.js';
import * as actions from './actions.js';

let clients = 0;
let timer = 0;
let sent = null; // what the headset last heard: send again only when it changed (or now and then)

const now = () => performance.timeOrigin + performance.now();

/** Something on the PC's screen waiting for you that the headset should mention. */
const training = () => !!(window.__shHighway && window.__shHighway.training && window.__shHighway.training());
const syncBox = () => document.querySelector('.hw-syncbox:not([hidden])');
function notice() {
  if (training()) return 'training';
  if (syncBox()) return 'timing';
  return null;
}

function snapshot() {
  const song = stage.current();
  const engine = stage.engine;
  const info = stage.loadInfo ? stage.loadInfo() : {};
  return {
    song: song ? { id: song.id, title: song.title || '', artist: song.artist || '', length: stage.duration() || song.length || 0 } : null,
    pos: engine ? engine.position || 0 : 0,
    playing: !!(engine && engine.playing),
    speed: (engine && engine.speed) || 1,
    phase: info.phase || null,
    part: stage.partLabel ? stage.partLabel() || null : null,
    notice: notice(),
    at: now(),
  };
}

function tick() {
  timer = 0;
  if (clients <= 0) return;
  const s = snapshot();
  const p = sent;
  // while paused, only when something changed (a seek, a new song) or once a second
  const moved = p && p.playing && s.playing ? Math.abs(s.pos - (p.pos + ((s.at - p.at) / 1000) * p.speed)) > 0.002 : true;
  const changed = !p || s.playing || p.playing !== s.playing || (p.song && p.song.id) !== (s.song && s.song.id) || Math.abs(p.pos - s.pos) > 0.01 || p.phase !== s.phase || p.part !== s.part || p.notice !== s.notice || p.speed !== s.speed || s.at - p.at > 1000;
  if (changed || moved) {
    sent = s;
    try {
      api.companion.state(s);
    } catch (_) {}
  }
  timer = setTimeout(tick, 33);
}

function setClients(n) {
  clients = Number(n) || 0;
  if (clients > 0 && !timer) {
    sent = null;
    tick();
  }
  if (clients <= 0 && timer) {
    clearTimeout(timer);
    timer = 0;
  }
}

// play pressed in the headset while the song is still opening on the PC: it plays once it's ready
let waitPlay = 0;
function playWhenReady() {
  clearTimeout(waitPlay);
  const until = Date.now() + 20000;
  let settle = 0;
  let played = false;
  const step = () => {
    if (!settle && stage.loadInfo && stage.loadInfo().phase === 'ready') settle = Date.now() + 1500;
    waitPlay = 0;
    const phase = stage.loadInfo ? stage.loadInfo().phase : 'ready';
    if (phase === 'ready' && stage.engine && stage.engine.duration !== 0) {
      // the PC may offer the timing check just as the song gets ready: play from the headset means "not now"
      const box = syncBox();
      const notNow = box && !training() && box.querySelector('.btn.ghost');
      if (notNow) notNow.click();
      if (!stage.engine.playing && (!played || notNow)) stage.toggle();
      played = true;
      // keep an eye out a moment longer, in case it shows up a beat later
      if (Date.now() < settle) waitPlay = setTimeout(step, 150);
      return;
    }
    if (phase === 'error' || Date.now() > until) return;
    waitPlay = setTimeout(step, 100);
  };
  step();
}

async function command(c) {
  if (!c || !c.type) return;
  const engine = stage.engine;
  const ready = !stage.loadInfo || stage.loadInfo().phase === 'ready';
  if (c.type === 'pick') {
    clearTimeout(waitPlay);
    waitPlay = 0;
    return actions.playAlong(c.id, { autoplay: false });
  }
  const wantPlay = c.type === 'play' || (c.type === 'toggle' && !(engine && engine.playing) && !waitPlay);
  if (wantPlay) {
    if (training()) return; // the timing check song is yours to play on the PC
    // play pressed in the headset while the PC offers the timing check: that's a "not now"
    const box = syncBox();
    const notNow = box && box.querySelector('.btn.ghost');
    if (notNow) notNow.click();
    if (!ready) return playWhenReady();
    if (engine && !engine.playing) stage.toggle();
    // the page may not have taken it yet (the player still getting the audio ready): try until it does
    setTimeout(() => engine && !engine.playing && playWhenReady(), 300);
    return;
  }
  if (c.type === 'pause' || c.type === 'toggle') {
    if (waitPlay) {
      clearTimeout(waitPlay);
      waitPlay = 0;
    }
    if (engine && engine.playing) stage.toggle();
    return;
  }
  if (c.type === 'seek') return stage.seekTo(c.t);
}

try {
  api.on('companion:status', (st) => setClients(st && st.on ? st.clients : 0));
  api.on('companion:cmd', (c) => {
    sent = null; // answer straight away
    command(c).catch((e) => console.warn('Quest companion:', e));
  });
  // it may have been switched on before this page loaded
  if (api.companion && api.companion.status)
    Promise.resolve(api.companion.status())
      .then((st) => st && setClients(st.on ? st.clients : 0))
      .catch(() => {});
} catch (_) {}
