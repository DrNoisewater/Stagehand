import { api } from './api.js';
import { state, emit, on, loadLibrary, upsertSongs, bump, loadRocksmith } from './store.js';
import './sidebar.js';
import * as library from './library.js';
import * as inspector from './inspector.js';
import * as stage from './stage.js';
import * as dialogs from './dialogs.js';
import * as actions from './actions.js';
import * as discover from './discover.js';
import * as searchbox from './searchbox.js';
import { isTyping, topModal, debounce, toast, modal, h } from './ui.js';
import './shell.js';
import './play.js';
import './practice.js';
import './nowpanel.js';
import './tonespage.js';
import './progress.js';
import './room.js';
import './greenroom.js';
import './stemformat.js';
import { rig } from './rig.js';
import { nudgeSpeed } from './speedpop.js';
import { pct } from './speed.js';
import { loadTones, useSlot } from './tonelib.js';
import { setPage, setView, goBack } from './store.js';
import './jam.js';
import './song-auto.js';

// 3.9: the mouse's back button (and Alt+←, the Back key) goes to the previous screen:
// out of Jam or the highway first, a dialog or menu closes, else the last page or list
let lastBack = 0;
function back() {
  const now = performance.now();
  if (now - lastBack < 300) return; // Windows can send both the button and the app command
  lastBack = now;
  if (document.querySelector('.menu[role="menu"]')) return document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
  if (window.__jam && window.__jam.state.open) return window.__jam.close();
  if (window.__shHighway && window.__shHighway.open()) return window.__shHighway.leave();
  const m = topModal();
  if (m && m.dismissable) return m.close();
  goBack();
}
window.addEventListener('mousedown', (e) => {
  if (e.button === 3) e.preventDefault();
});
window.addEventListener('mouseup', (e) => {
  if (e.button === 3) {
    e.preventDefault();
    back();
  }
});
api.on('nav:back', () => back());
document.addEventListener('keydown', (e) => {
  if ((e.altKey && e.key === 'ArrowLeft') || e.key === 'BrowserBack') {
    e.preventDefault();
    back();
  }
}, true);

// the version, small, after the name in the title bar
api.app
  .info()
  .then((i) => {
    const el = document.getElementById('brand-ver');
    if (el && i && i.version) el.textContent = `v${i.version}`;
  })
  .catch(() => {});

actions.register({ stage, inspector, dialogs });

// 4.1.6: the search box (suggestions, Tab to finish, recent searches) lives in searchbox.js
document.getElementById('btn-settings').onclick = () => dialogs.settings();

on('reveal', (id) => library.revealSong(id));

// ---------------------------------------------------------------- keys --
document.addEventListener('keydown', (e) => {
  if (e.defaultPrevented) return;
  const m = topModal();
  if (m) {
    if (e.key === 'Escape' && m.dismissable) m.close();
    return;
  }
  const ctrl = e.ctrlKey || e.metaKey;
  if (ctrl && e.key.toLowerCase() === 'f') {
    searchbox.focus();
    e.preventDefault();
    return;
  }
  if (ctrl && e.key === ',') {
    dialogs.settings();
    e.preventDefault();
    return;
  }
  if (isTyping()) return;
  // 1–9: tone slots. Shift+1–6: mute a stem.
  const digit = /^(?:Digit|Numpad)([1-9])$/.exec(e.code);
  if (e.code === 'Space') stage.toggle();
  else if (e.key === 'ArrowLeft') stage.seekBy(e.shiftKey ? -15 : -5);
  else if (e.key === 'ArrowRight') stage.seekBy(e.shiftKey ? 15 : 5);
  else if (e.key === 'm' || e.key === 'M') stage.toggleMode();
  else if ((e.key === 't' || e.key === 'T') && !ctrl) stage.toggleTab();
  else if ((e.key === 'h' || e.key === 'H') && !ctrl) stage.openHighway();
  else if (e.key === 'l' || e.key === 'L') stage.toggleSectionLoop();
  else if ((e.key === 'd' || e.key === 'D') && !ctrl) {
    rig.setDrop({ on: !rig.drop.on });
    const ds = rig.dropStatus();
    toast({ title: `Drop ${ds.line.replace(/^(On|Off)/, (w) => w.toLowerCase())}`, message: ds.state === 'on' ? ds.warn : '', kind: 'info', timeout: 2000 });
  }
  else if (digit && !ctrl && e.shiftKey) stage.toggleMute(Number(digit[1]) - 1, e.altKey);
  else if (digit && !ctrl) useSlot(Number(digit[1]));
  else if (e.key === 'Escape' && state.page === 'now' && !stage.highwayOpen()) setPage(state.backPage || 'songs');
  else if (e.key === 'F2' || (ctrl && e.key.toLowerCase() === 'e')) actions.editSongs();
  else if (e.key === '+' || e.key === '=') stage.zoom(1);
  else if (e.key === '-') stage.zoom(-1);
  else if (e.key === '0') stage.zoom(0);
  else if ((e.key === '[' || e.key === ']') && !ctrl && !e.altKey && stage.current()) {
    // practice speed, 5% at a time; say it when no speed chip is in sight
    const s = nudgeSpeed(stage.engine, e.key === ']' ? 1 : -1);
    const chip = [...document.querySelectorAll('.speed-chip')].some((c) => c.offsetParent !== null);
    if (!chip) toast({ title: `Speed ${pct(s)}`, kind: 'info', timeout: 1200 });
  }
  else if (e.key === 'Escape') stage.clearLoop();
  else if (e.key === 'MediaPlayPause') stage.toggle();
  else if (e.key === 'MediaTrackNext') actions.playAdjacent(1);
  else if (e.key === 'MediaTrackPrevious') actions.playAdjacent(-1);
  else return;
  e.preventDefault();
});

// ----------------------------------------------------------------- boot --
/** 4.0.7: the window stopped and Stagehand brought it back: say what happened, and what was saved. */
function crashNotice(n) {
  if (!n) return;
  const body = h('div');
  body.append(h('p', { text: `Stagehand’s window stopped because ${n.words}${n.activity ? `, while: ${n.activity}` : ''}. It has been reloaded, so you can carry on.` }));
  const recs = h('div');
  const showRec = (r) => {
    recs.innerHTML = '';
    for (const x of n.recordings || []) {
      recs.append(h('p', { text: x.saving ? `Saving the recording of ${x.title} as far as it got…` : x.name ? `The recording was saved as far as it got: “${x.name}”, Backstage, under My clips.` : x.error ? `The recording couldn’t be saved: ${x.error}` : 'The recording had nothing in it yet.' }));
    }
  };
  showRec();
  body.append(recs);
  body.append(h('p', { text: 'If it keeps happening, the Activity log (Settings) has the details.' }));
  const ok = h('button.btn.primary', { type: 'button', text: 'OK' });
  const m = modal({ title: 'Stagehand had to reload', body, footer: [ok] });
  ok.onclick = () => m.close();
  api.on('app:recovered', (r) => {
    const x = (n.recordings || []).find((y) => y.title === r.title && y.saving);
    if (x) Object.assign(x, r);
    showRec();
  });
}

async function boot() {
  [state.info, state.settings] = await Promise.all([api.app.info(), api.settings.get()]);
  emit('settings');
  api.app.crashNote().then(crashNotice).catch(() => {});
  api.on('library:reset', debounce(() => loadLibrary(), 120));
  api.on('library:songs', (songs) => upsertSongs(songs));
  api.on('scan:progress', (p) => {
    state.scan = p;
    emit('scan');
  });
  api.on('stems:update', (u) => {
    const prev = state.stems.get(u.songId);
    state.stems.set(u.songId, u);
    const s = state.songs.get(u.songId);
    if (s && u.state === 'ready' && !s.hasStems) {
      s.hasStems = true;
      bump();
    }
    if (s && u.state === 'none' && s.hasStems) {
      s.hasStems = false;
      bump();
    }
    if (!prev || prev.state !== u.state) emit('stems');
    else emit('stems-progress');
    emit('stems-update', u);
  });
  api.on('stems:done', (d) => {
    const s = state.songs.get(d.songId);
    if (!s) return;
    const where = d.device === 'cuda' ? `on your ${d.deviceName || 'GPU'}` : 'on the CPU';
    const secs = Math.round(d.seconds || 0);
    const took = secs >= 90 ? `${Math.floor(secs / 60)} min ${secs % 60} s` : `${secs} seconds`;
    const a = state.engine && state.engine.advice;
    const hint = d.device !== 'cuda' && a && a.action ? ` Your ${a.gpu} could do it much faster.` : d.note && /GPU/.test(d.note) ? ` ${d.note}.` : '';
    const acts = [];
    if (stage.current() && stage.current().id !== d.songId) acts.push({ label: 'Play', onClick: () => actions.playSong(s.id) });
    if (d.device !== 'cuda' && a && a.action) acts.push({ label: a.action === 'driver' ? 'Get driver' : 'Use GPU', onClick: () => dialogs.fixDevice(a) });
    toast({ title: `Stems ready for ${s.title}`, message: `Took ${took} ${where}.${hint}`, actions: acts, kind: hint ? 'info' : 'ok' });
  });
  api.on('engine:changed', async () => {
    state.engine = await api.engine.status();
    emit('engine');
  });
  // A tone the engine couldn't play (a song's tone change mid-song…): say so, not silently.
  let lastToneErr = 0;
  rig.addEventListener('tone-error', (e) => {
    if (document.querySelector('.tone-toast') || Date.now() - lastToneErr < 10000) return; // the key note already says it
    lastToneErr = Date.now();
    toast({ title: 'Tone didn’t change', message: e.detail.error || 'The sound engine didn’t answer.', kind: 'err', timeout: 6000 });
  });
  // Your guitar just works: start it now, and again whenever the cable shows up.
  loadTones()
    .catch((err) => console.warn('Tones failed to load', err))
    .finally(() => rig.autoStart().catch((err) => console.warn('Guitar failed to start', err)));
  await loadLibrary();
  // 4.1.4: newer Stagehand on GitHub: a button in the menu, and a note once
  import('./updates.js').then((u) => u.initUpdates()).catch((err) => console.warn('Updates failed to start', err));
  // 4.1.2: a fresh install with no songs is offered Getting started (once; "Not now" is fine)
  import('./guide.js').then((g) => g.offerGuide()).catch((err) => console.warn('Getting started failed', err));
  loadRocksmith();
  loadBest();
  searchbox.sync();
  discover.init().catch((err) => console.warn('Discover failed to start', err));
  // Pick up changes made in the game while Stagehand was in the background.
  let lastRsCheck = 0;
  window.addEventListener('focus', async () => {
    if (Date.now() - lastRsCheck < 3000) return;
    lastRsCheck = Date.now();
    const before = state.rs && state.rs.modified;
    const next = await api.rocksmith.read().catch(() => null);
    if (next && (next.modified !== before || !state.rs || !state.rs.profile)) {
      state.rs = next;
      bump();
      emit('rocksmith');
    }
  });
  api.engine
    .status()
    .then((s) => {
      state.engine = s;
      emit('engine');
    })
    .catch(() => {});
  api.stems
    .queue()
    .then((q) => {
      for (const it of q) state.stems.set(it.songId, it);
      if (q.length) emit('stems');
    })
    .catch(() => {});
  if (state.settings.ui && state.settings.ui.sinkId) stage.setSink(state.settings.ui.sinkId).catch(() => {});
}

on('engine', () => stage.requestDraw());

/** Your best accuracy per song (practice stats), for the Songs list and tiles. */
function loadBest() {
  api.stats
    .best()
    .then((b) => {
      state.best = b || {};
      bump();
      emit('best');
    })
    .catch(() => {});
}
on('stats', loadBest);
boot().catch((err) => {
  document.getElementById('library').innerHTML = `<div class="empty"><div class="box"><h2>Stagehand could not start</h2><p>${String(err.message)}</p></div></div>`;
});

// Noisewater Labs logo: plays the splash over Stagehand, then fades back.
const nwBtn = document.getElementById('btn-nw');
if (nwBtn)
  nwBtn.addEventListener('click', async () => {
    if (!window.NoisewaterSplash || document.querySelector('.nw-backdrop')) return;
    const back = document.createElement('div');
    back.className = 'nw-backdrop';
    document.body.append(back);
    requestAnimationFrame(() => back.classList.add('on'));
    try {
      await window.NoisewaterSplash.show({ transparent: true, hold: 900 });
    } finally {
      back.classList.remove('on');
      setTimeout(() => back.remove(), 300);
    }
  });
