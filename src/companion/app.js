/**
 * 4.16: the Quest companion page (step 1, the bridge). Pairs with Stagehand on the PC, lists the
 * library, and follows the PC's song: pick a song or play/pause/seek on either screen.
 * Nothing plays here; the sound stays on the PC.
 */
import { PcClock, songPos } from './clock.js';

const $ = (id) => document.getElementById(id);
const KEY = 'stagehand.companion';
const GELS = ['#ff6b3d', '#8c7bff', '#ff4d8d', '#33c8e0', '#9bdb5a', '#ffb547'];

let saved = {};
try {
  saved = JSON.parse(localStorage.getItem(KEY) || '{}') || {};
} catch (_) {}
const save = () => {
  try {
    localStorage.setItem(KEY, JSON.stringify(saved));
  } catch (_) {}
};

const deviceName = (() => {
  const ua = navigator.userAgent;
  const m = /Quest ?(3S|3|Pro|2)/i.exec(ua);
  if (m) return `Meta Quest ${m[1].toUpperCase()}`;
  if (/OculusBrowser/i.test(ua)) return 'Meta Quest';
  return 'Browser';
})();

const clock = new PcClock();
let sock = null;
let paired = false;
let pcName = '';
let songs = [];
let state = null;
let retry = 600;
let pingTimer = 0;
let pingId = 0;
const pings = new Map();

// -------------------------------------------------------------- the link --
function setLink(kind, text) {
  $('link').className = `link ${kind}`;
  $('linkText').textContent = text;
}

function send(m) {
  if (sock && sock.readyState === 1) sock.send(JSON.stringify(m));
}

function connect() {
  const s = new WebSocket(`wss://${location.host}/ws`);
  sock = s;
  s.onopen = () => {
    retry = 600;
    send({ type: 'hello', token: saved.token || null, name: deviceName });
    ping(true);
  };
  s.onmessage = (e) => {
    let m;
    try {
      m = JSON.parse(e.data);
    } catch (_) {
      return;
    }
    onMessage(m);
  };
  s.onclose = () => {
    if (sock !== s) return;
    sock = null;
    paired = false;
    clearTimeout(pingTimer);
    setLink('bad', pcName ? `Lost ${pcName}: trying again…` : 'Looking for Stagehand…');
    setTimeout(connect, retry);
    retry = Math.min(5000, retry * 1.6);
  };
}

function ping(fast) {
  clearTimeout(pingTimer);
  const id = ++pingId;
  const t0 = clock.now();
  pings.set(id, t0);
  send({ type: 'ping', id, t0 });
  // quick ones first to settle the clock, then once a second
  pingTimer = setTimeout(() => ping(clock.samples.length < 8), fast ? 120 : 1000);
}

function onMessage(m) {
  if (m.type === 'pong') {
    const t0 = pings.get(m.id);
    pings.delete(m.id);
    if (t0 != null) clock.add(t0, clock.now(), m.pc);
    if (paired) setLink('ok', `${pcName}${clock.rtt != null ? ` · ${Math.max(1, Math.round(clock.rtt))} ms` : ''}`);
    return;
  }
  if (m.type === 'need-code') {
    pcName = (m.pc && m.pc.name) || pcName;
    paired = false;
    if (saved.token) {
      saved = {};
      save();
    }
    setLink('', `Found ${pcName || 'Stagehand'}: type the code`);
    showPair();
    return;
  }
  if (m.type === 'bad-code') {
    entered = '';
    drawCode();
    $('pairMsg').textContent = m.changed ? 'Too many tries: the PC shows a new code now.' : 'That’s not the code on the PC. Try again.';
    return;
  }
  if (m.type === 'welcome') {
    paired = true;
    pcName = (m.pc && m.pc.name) || 'your PC';
    if (m.token) {
      saved = { token: m.token, pc: pcName };
      save();
    }
    setLink('ok', pcName);
    showHome();
    return;
  }
  if (m.type === 'forgotten') {
    saved = {};
    save();
    return;
  }
  if (m.type === 'library') {
    songs = m.songs || [];
    drawList();
    return;
  }
  if (m.type === 'state') {
    const before = state && state.song && state.song.id;
    state = m;
    if ((m.song && m.song.id) !== before) {
      drawNow();
      markRow();
    }
    drawButtons();
  }
}

// ---------------------------------------------------------------- pairing --
let entered = '';
function showPair() {
  $('home').hidden = true;
  $('pair').hidden = false;
  entered = '';
  $('pairMsg').textContent = '';
  drawCode();
}
function drawCode() {
  const cells = $('code').children;
  for (let i = 0; i < 4; i++) {
    cells[i].textContent = entered[i] || '';
    cells[i].classList.toggle('cur', i === entered.length);
  }
}
function key(k) {
  if (k === 'del') entered = entered.slice(0, -1);
  else if (k === 'clear') entered = '';
  else if (entered.length < 4) entered += k;
  $('pairMsg').textContent = '';
  drawCode();
  if (entered.length === 4) send({ type: 'pair', code: entered, name: deviceName });
}
for (const k of ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'clear', '0', 'del']) {
  const b = document.createElement('button');
  b.type = 'button';
  b.textContent = k === 'del' ? '⌫' : k === 'clear' ? 'Clear' : k;
  if (k === 'del' || k === 'clear') b.className = 'soft';
  b.onclick = () => key(k);
  $('pad').append(b);
}
addEventListener('keydown', (e) => {
  if ($('pair').hidden) return;
  if (/^[0-9]$/.test(e.key)) key(e.key);
  else if (e.key === 'Backspace') key('del');
});

// ---------------------------------------------------------------- library --
function showHome() {
  $('pair').hidden = true;
  $('home').hidden = false;
}

const gel = (s) => {
  let n = 0;
  for (const c of `${s.artist}${s.title}`) n = (n * 31 + c.charCodeAt(0)) >>> 0;
  return GELS[n % GELS.length];
};
const initials = (s) => (s.title || '?').replace(/[^\p{L}\p{N} ]/gu, '').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase() || '♪';
const artUrl = (id, size) => `/art/${encodeURIComponent(id)}?size=${size}&k=${encodeURIComponent(saved.token || '')}`;

function artEl(s, size, cls) {
  const d = document.createElement('div');
  d.className = cls;
  d.style.backgroundColor = gel(s);
  d.textContent = initials(s);
  const img = new Image();
  img.onload = () => {
    d.style.backgroundImage = `url("${img.src}")`;
    d.textContent = '';
  };
  img.src = artUrl(s.id, size);
  return d;
}

const PART = { lead: 'LEAD', rhythm: 'RHY', combo: 'LEAD', bass: 'BASS', vocals: 'VOX' };
const LIMIT = 250;
function drawList() {
  const q = $('search').value.trim().toLowerCase();
  const words = q.split(/\s+/).filter(Boolean);
  const hits = words.length ? songs.filter((s) => words.every((w) => `${s.title} ${s.artist} ${s.album}`.toLowerCase().includes(w))) : songs;
  $('count').textContent = `${hits.length} song${hits.length === 1 ? '' : 's'}`;
  const list = $('list');
  list.innerHTML = '';
  const frag = document.createDocumentFragment();
  for (const s of hits.slice(0, LIMIT)) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'row';
    b.dataset.id = s.id;
    const mid = document.createElement('div');
    mid.innerHTML = '<div class="t"></div><div class="a"></div>';
    mid.firstChild.textContent = s.title;
    mid.lastChild.textContent = [s.artist, s.year].filter(Boolean).join(' · ');
    const parts = document.createElement('div');
    parts.className = 'parts';
    for (const p of s.parts) {
      if (!PART[p] || (p === 'combo' && s.parts.includes('lead'))) continue;
      const c = document.createElement('span');
      c.className = `chip ${p}`;
      c.textContent = PART[p];
      parts.append(c);
    }
    b.append(artEl(s, 128, 'art'), mid, parts);
    b.onclick = () => send({ type: 'pick', id: s.id });
    frag.append(b);
  }
  list.append(frag);
  if (hits.length > LIMIT) {
    const more = document.createElement('div');
    more.className = 'more';
    more.textContent = `${hits.length - LIMIT} more: type to narrow it down`;
    list.append(more);
  }
  markRow();
}
$('search').addEventListener('input', drawList);

function markRow() {
  const id = state && state.song && state.song.id;
  for (const r of $('list').querySelectorAll('.row')) r.classList.toggle('on', r.dataset.id === id);
}

// ------------------------------------------------------------ now playing --
const fmt = (t, tenths) => {
  t = Math.max(0, t || 0);
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  return tenths ? `${m}:${s.toFixed(1).padStart(4, '0')}` : `${m}:${String(Math.floor(s)).padStart(2, '0')}`;
};

function drawNow() {
  const s = state && state.song;
  const host = $('nowArt');
  host.style.backgroundImage = '';
  host.textContent = '';
  if (!s) {
    $('nowTitle').textContent = 'No song yet';
    $('nowArtist').textContent = 'Pick one on the left, or on the PC';
    host.style.backgroundColor = '';
    return;
  }
  const row = songs.find((x) => x.id === s.id) || s;
  $('nowTitle').textContent = s.title;
  $('nowArtist').textContent = s.artist;
  const a = artEl(row, 256, 'now-art');
  host.style.backgroundColor = a.style.backgroundColor;
  host.textContent = a.textContent;
  const img = new Image();
  img.onload = () => {
    host.style.backgroundImage = `url("${img.src}")`;
    host.textContent = '';
  };
  img.src = artUrl(s.id, 256);
}

function drawButtons() {
  const playing = !!(state && state.playing);
  $('play').firstElementChild.className = `ico ${playing ? 'pause' : 'play'}`;
  const phase = state && state.phase;
  const words = [];
  if (phase === 'loading') words.push('Opening…');
  else if (phase === 'error') words.push('Didn’t open on the PC');
  if (state && state.notice === 'timing') words.push('The PC offers the timing check: Play skips it');
  if (state && state.notice === 'training') words.push('Timing check on the PC');
  if (state && state.part) words.push(state.part);
  if (state && state.speed && state.speed !== 1) words.push(`${Math.round(state.speed * 100)}% speed`);
  $('nowState').textContent = words.join(' · ');
}

function frame() {
  const len = (state && state.song && state.song.length) || 0;
  const p = songPos(state, clock.pcNow());
  $('pos').textContent = fmt(p, true);
  $('len').textContent = len ? `/ ${fmt(len)}` : '';
  const f = len ? Math.min(1, p / len) : 0;
  $('fill').style.width = `${f * 100}%`;
  $('head').style.left = `${f * 100}%`;
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

$('play').onclick = () => send({ type: 'toggle' });
$('back').onclick = () => send({ type: 'seek', t: Math.max(0, songPos(state, clock.pcNow()) - 10) });
$('fwd').onclick = () => send({ type: 'seek', t: songPos(state, clock.pcNow()) + 10 });
$('bar').onclick = (e) => {
  const len = state && state.song && state.song.length;
  if (!len) return;
  const r = $('bar').getBoundingClientRect();
  send({ type: 'seek', t: Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * len });
};

// for tests: what the page thinks
window.__companion = { clock, get state() { return state; }, get songs() { return songs; }, songPos: () => songPos(state, clock.pcNow()), get paired() { return paired; } };

connect();
