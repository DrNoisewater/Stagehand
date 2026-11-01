import { api } from './api.js';
import { state, emit, on, loadLibrary, upsertSongs, bump, loadRocksmith } from './store.js';
import './sidebar.js';
import * as library from './library.js';
import * as inspector from './inspector.js';
import * as stage from './stage.js';
import * as dialogs from './dialogs.js';
import * as actions from './actions.js';
import * as discover from './discover.js';
import { isTyping, topModal, debounce, toast } from './ui.js';
import './shell.js';
import './play.js';
import './practice.js';
import './nowpanel.js';
import './tonespage.js';
import './progress.js';
import './stemformat.js';
import { rig } from './rig.js';
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

const search = document.getElementById('search');
const inDiscover = () => state.page === 'discover' && state.view.kind === 'discover';
search.addEventListener('input', () => {
  // In Discover the same box searches MusicBrainz instead of the library.
  if (inDiscover()) return discover.setQuery(search.value);
  // 3.8: typing anywhere else shows your songs straight away, filtered as you type
  state.search = search.value;
  if (search.value && state.page !== 'songs') {
    if (state.view.kind === 'discover') setView({ kind: 'all' });
    else setPage('songs');
  }
  bump();
  emit('search');
});
search.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    if (search.value) {
      search.value = '';
      search.dispatchEvent(new Event('input'));
    } else search.blur();
    e.stopPropagation();
  } else if (inDiscover() && e.key === 'Enter') {
    discover.setQuery(search.value, { now: true });
    e.preventDefault();
  } else if (!inDiscover() && (e.key === 'ArrowDown' || e.key === 'Enter')) {
    library.focusList();
    e.preventDefault();
  }
});
function syncSearchBox() {
  const d = inDiscover();
  search.closest('.search').classList.toggle('online', d);
  search.placeholder = d ? 'Search MusicBrainz for any artist or song' : 'Search songs, tones, artists';
  search.setAttribute('aria-label', d ? 'Search MusicBrainz' : 'Search your library');
  const want = d ? state.discover.query : state.search;
  if (search.value !== want) search.value = want;
}
on('view', syncSearchBox);
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
    search.focus();
    search.select();
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
    const a = rig.dropAmount();
    toast({ title: rig.drop.on ? `Drop on${a ? (a === 12 ? ': an octave down' : `: down ${a}`) : ''}` : 'Drop off', kind: 'info', timeout: 1500 });
  }
  else if (digit && !ctrl && e.shiftKey) stage.toggleMute(Number(digit[1]) - 1, e.altKey);
  else if (digit && !ctrl) useSlot(Number(digit[1]));
  else if (e.key === 'Escape' && state.page === 'now' && !stage.highwayOpen()) setPage(state.backPage || 'songs');
  else if (e.key === 'F2' || (ctrl && e.key.toLowerCase() === 'e')) actions.editSongs();
  else if (e.key === '+' || e.key === '=') stage.zoom(1);
  else if (e.key === '-') stage.zoom(-1);
  else if (e.key === '0') stage.zoom(0);
  else if (e.key === 'Escape') stage.clearLoop();
  else if (e.key === 'MediaPlayPause') stage.toggle();
  else if (e.key === 'MediaTrackNext') actions.playAdjacent(1);
  else if (e.key === 'MediaTrackPrevious') actions.playAdjacent(-1);
  else return;
  e.preventDefault();
});

// ----------------------------------------------------------------- boot --
async function boot() {
  [state.info, state.settings] = await Promise.all([api.app.info(), api.settings.get()]);
  emit('settings');
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
  // Picked up a bass (or back to guitar): say what tone is playing now, and let you keep yours.
  rig.addEventListener('instrument', (e) => {
    if (!e.detail.sensed) return;
    const what = e.detail.instrument === 'bass' ? 'Bass' : 'Guitar';
    const chosen = rig.tone;
    if (rig.standIn) {
      toast({
        title: `${what} plugged in: playing ${rig.standIn.name}`,
        message: `${chosen ? `${chosen.name} is a ${chosen.kind === 'bass' ? 'bass' : 'guitar'} tone. ` : ''}Your tone comes back when you switch back.`,
        kind: 'info',
        timeout: 7000,
        actions: [{ label: `Keep ${chosen ? chosen.name : 'my tone'}`, onClick: () => rig.holdTone() }],
      });
    } else toast({ title: `${what} plugged in`, kind: 'info', timeout: 2500 });
  });
  // Your guitar just works: start it now, and again whenever the cable shows up.
  loadTones()
    .catch((err) => console.warn('Tones failed to load', err))
    .finally(() => rig.autoStart().catch((err) => console.warn('Guitar failed to start', err)));
  await loadLibrary();
  loadRocksmith();
  loadBest();
  syncSearchBox();
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
