/**
 * Stagehand on the Quest (4.16, step 1): the page the headset's browser opens.
 * It connects to Stagehand on the PC, pairs once with a 4-number code, lists
 * the library, and follows the PC's song clock. The PC plays the sound; this
 * page only shows things.
 */
import { ClockSync, SongClock } from './clock.js';

const $ = (id) => document.getElementById(id);
const KEY = 'stagehand.companion';
const saved = (() => {
  try {
    return JSON.parse(localStorage.getItem(KEY) || '{}') || {};
  } catch (_) {
    return {};
  }
})();
const keep = (patch) => {
  Object.assign(saved, patch);
  try {
    localStorage.setItem(KEY, JSON.stringify(saved));
  } catch (_) {}
};

const sync = new ClockSync();
const clock = new SongClock(sync);
const S = { ws: null, paired: false, songs: [], byId: new Map(), state: null, songId: null, arrId: null, pc: null, device: null, tries: 0, code: '' };
window.__companion = { S, sync, clock }; // for the tests

function deviceName() {
  const m = navigator.userAgent.match(/Quest\s*\d*(\s*Pro)?/i);
  return m ? m[0].replace(/\s+/g, ' ').trim() : 'Headset';
}

// ------------------------------------------------------------ connection --
function connect() {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  let ws;
  try {
    ws = new WebSocket(`${proto}//${location.host}/ws`);
  } catch (_) {
    return retry();
  }
  S.ws = ws;
  ws.onopen = () => {
    S.tries = 0;
    link('on', 'Connected');
    ws.send(JSON.stringify({ type: 'hello', token: saved.token || null, name: deviceName() }));
    pingBurst();
  };
  ws.onmessage = (e) => {
    let m;
    try {
      m = JSON.parse(e.data);
    } catch (_) {
      return;
    }
    onMessage(m);
  };
  ws.onclose = () => {
    if (S.ws !== ws) return;
    S.ws = null;
    S.paired = false;
    link('off', 'Not connected');
    show('wait', 'Lost the PC. Trying again… (is Stagehand open, with Quest switched on?)');
    retry();
  };
  ws.onerror = () => {};
}
function retry() {
  S.tries++;
  setTimeout(connect, Math.min(5000, 600 * S.tries));
}
function send(m) {
  if (S.ws && S.ws.readyState === 1) S.ws.send(JSON.stringify(m));
}

// The clock: quick pings first, then one a second (and the fastest are kept).
function ping() {
  send({ type: 'ping', c: performance.timeOrigin + performance.now() });
}
function pingBurst() {
  for (let i = 0; i < 8; i++) setTimeout(ping, i * 120);
}
setInterval(ping, 1000);

function onMessage(m) {
  switch (m.type) {
    case 'pong':
      sync.add(m.c, m.s, performance.timeOrigin + performance.now());
      return;
    case 'pair-needed':
      if (saved.token) keep({ token: null }); // the PC forgot this headset
      return showPair();
    case 'pair-wrong':
      S.code = '';
      drawDots();
      return pairMsg(m.left > 0 ? 'That’s not it. Check the numbers on the PC.' : 'Too many tries. Wait a minute, then try again.', true);
    case 'pair-wait':
      S.code = '';
      drawDots();
      return pairMsg(`Too many tries. Try again in ${m.seconds} seconds.`, true);
    case 'welcome':
      if (m.token) keep({ token: m.token });
      S.paired = true;
      S.pc = m.pc;
      S.device = m.device;
      link('on', `Connected to ${m.pc && m.pc.name ? m.pc.name : 'your PC'}`);
      show('main');
      return;
    case 'library':
      S.songs = m.songs || [];
      S.byId = new Map(S.songs.map((s) => [s.id, s]));
      drawList();
      drawNow();
      return;
    case 'song':
      S.songId = m.songId;
      S.arrId = m.arrId;
      drawNow();
      markList();
      return;
    case 'state':
      S.state = m;
      clock.set(m);
      if (m.songId !== S.songId) {
        S.songId = m.songId;
        drawNow();
        markList();
      }
      drawScore();
      return;
    default:
  }
}

// ----------------------------------------------------------------- views --
function show(which, msg) {
  $('pair').hidden = which !== 'pair';
  $('wait').hidden = which !== 'wait';
  $('main').hidden = which !== 'main';
  if (msg) $('waitMsg').textContent = msg;
}
function link(kind, text) {
  const el = $('link');
  el.dataset.on = kind;
  el.querySelector('span').textContent = text;
}

// pairing: four numbers on a big pad (easy to point at with a controller)
function showPair() {
  S.code = '';
  drawDots();
  pairMsg('');
  show('pair');
}
function pairMsg(text, bad) {
  const el = $('pairMsg');
  el.textContent = text;
  el.classList.toggle('bad', !!bad);
}
function drawDots() {
  [...$('dots').children].forEach((d, i) => {
    d.className = i < S.code.length ? 'on' : '';
    d.textContent = S.code[i] || '';
  });
}
function press(k) {
  if (k === 'del') S.code = S.code.slice(0, -1);
  else if (S.code.length < 4) S.code += k;
  drawDots();
  pairMsg('');
  if (S.code.length === 4) {
    pairMsg('Checking…');
    send({ type: 'pair', code: S.code, name: deviceName() });
  }
}
(() => {
  const pad = $('pad');
  for (const k of ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', 'del']) {
    const b = document.createElement('button');
    b.className = 'key';
    b.type = 'button';
    if (!k) b.disabled = true;
    b.textContent = k === 'del' ? '⌫' : k;
    b.onclick = () => k && press(k);
    pad.append(b);
  }
  window.addEventListener('keydown', (e) => {
    if ($('pair').hidden) return;
    if (/^\d$/.test(e.key)) press(e.key);
    else if (e.key === 'Backspace') press('del');
  });
})();

// the library
const PART = { lead: 'Lead', rhythm: 'Rhythm', bass: 'Bass' };
const fmt = (s) => {
  s = Math.max(0, Math.floor(s || 0));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};
const coverUrl = (id, size = 120) => `/cover/${encodeURIComponent(id)}?size=${size}&k=${encodeURIComponent(saved.token || '')}`;
const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

let shown = 200;
function matches() {
  const q = norm($('search').value).trim();
  if (!q) return S.songs;
  const words = q.split(/\s+/);
  return S.songs.filter((s) => {
    const hay = norm(`${s.title} ${s.artist} ${s.album}`);
    return words.every((w) => hay.includes(w));
  });
}
function drawList() {
  const list = $('list');
  const all = matches();
  $('count').textContent = `${all.length} song${all.length === 1 ? '' : 's'}`;
  list.textContent = '';
  const frag = document.createDocumentFragment();
  for (const s of all.slice(0, shown)) {
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'row';
    row.dataset.id = s.id;
    const img = document.createElement('img');
    img.loading = 'lazy';
    img.alt = '';
    img.src = coverUrl(s.id);
    img.onerror = () => img.classList.add('none');
    const txt = document.createElement('div');
    txt.className = 'rt';
    txt.innerHTML = `<b></b><span></span>`;
    txt.firstChild.textContent = s.title;
    txt.lastChild.textContent = s.artist;
    const tags = document.createElement('div');
    tags.className = 'tags';
    for (const t of [...new Set(s.parts.filter((p) => !p.bonus).map((p) => p.type))]) {
      const i = document.createElement('i');
      i.className = `tag ${t}`;
      i.textContent = PART[t] || t;
      tags.append(i);
    }
    row.append(img, txt, tags);
    row.onclick = () => pick(s);
    frag.append(row);
  }
  list.append(frag);
  if (all.length > shown) {
    const more = document.createElement('button');
    more.className = 'btn more';
    more.textContent = `Show more (${all.length - shown} left)`;
    more.onclick = () => {
      shown += 300;
      drawList();
    };
    list.append(more);
  }
  markList();
}
function markList() {
  for (const r of $('list').querySelectorAll('.row')) r.classList.toggle('playing', r.dataset.id === S.songId);
}
$('search').addEventListener('input', () => {
  shown = 200;
  drawList();
  $('list').scrollTop = 0;
});

function pick(s, arrId) {
  // the PC opens the song on the highway; the state that comes back moves this page
  const part = arrId || (s.parts.find((p) => p.type === (saved.part || 'lead') && !p.bonus) || s.parts[0] || {}).id;
  send({ type: 'pick', songId: s.id, arrId: part || undefined });
  S.songId = s.id;
  S.arrId = part || null;
  drawNow();
  markList();
}

// what's playing
function drawNow() {
  const s = S.songId ? S.byId.get(S.songId) : null;
  $('nowEmpty').hidden = !!s;
  $('nowSong').hidden = !s;
  if (!s) return;
  if ($('art').dataset.id !== s.id) {
    $('art').dataset.id = s.id;
    $('art').innerHTML = '';
    const img = document.createElement('img');
    img.alt = '';
    img.src = coverUrl(s.id, 400);
    img.onerror = () => img.remove();
    $('art').append(img);
  }
  $('title').textContent = s.title;
  $('artist').textContent = [s.artist, s.album, s.year].filter(Boolean).join(' · ');
  const parts = $('parts');
  parts.textContent = '';
  for (const p of s.parts) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = `chip ${p.type}`;
    b.textContent = p.bonus ? `${p.name}` : PART[p.type] || p.name;
    b.setAttribute('aria-pressed', String(p.id === S.arrId));
    b.onclick = () => {
      keep({ part: p.type });
      S.arrId = p.id;
      send({ type: 'part', songId: s.id, arrId: p.id });
      drawNow();
    };
    parts.append(b);
  }
}
function drawScore() {
  const sc = S.state && S.state.score;
  const el = $('score');
  if (!sc || sc.judged === undefined) {
    el.textContent = '';
    return;
  }
  el.innerHTML = `<b>${sc.acc == null ? '–' : Math.round(sc.acc * 100) + '%'}</b><span>accuracy</span><b>${sc.streak || 0}</b><span>streak</span>`;
}

$('playBtn').onclick = () => send({ type: S.state && S.state.playing ? 'pause' : 'play' });
$('back5').onclick = () => send({ type: 'seek', t: Math.max(0, clock.target(performance.timeOrigin + performance.now()) - 5) });
$('fwd5').onclick = () => send({ type: 'seek', t: clock.target(performance.timeOrigin + performance.now()) + 5 });

// every frame: the clock and the bar
function frame() {
  const now = performance.timeOrigin + performance.now();
  const st = S.state;
  if (st && !$('nowSong').hidden) {
    const t = clock.at(now);
    const dur = st.dur || (S.byId.get(st.songId) || {}).length || 0;
    $('tNow').textContent = fmt(t);
    $('tDur').textContent = `/ ${fmt(dur)}`;
    $('tBar').style.width = `${dur ? Math.min(100, (t / dur) * 100) : 0}%`;
    const pb = $('playBtn');
    if (pb.dataset.pl !== String(st.playing)) {
      pb.dataset.pl = String(st.playing);
      pb.innerHTML = st.playing ? '<svg viewBox="0 0 24 24"><rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/></svg>' : '<svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>';
    }
  }
  const sy = $('sync');
  if (sync.ready) sy.textContent = `In step with the PC (network ${Math.round(sync.rtt)} ms there and back)`;
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

connect();
