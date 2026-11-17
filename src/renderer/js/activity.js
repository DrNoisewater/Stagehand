/**
 * 4.23: Activity, at the bottom of the menu on the left. What Stagehand is doing in the background,
 * to which song, how far along, and what you can do about it: stem splits, the cleaner singer,
 * reading a singer's notes, imports, clip downloads from Backstage and Stagehand updates.
 *
 * Quiet when nothing is going on. Each job's own code does the work; this only shows it. It is
 * drawn at most five times a second, and only the numbers that changed are touched (no full redraw
 * on every bit of progress). The list (click the summary) has every job: running, waiting,
 * finished and failed, with Cancel, Retry, Do this one next and Clear finished.
 */
import { state, on } from './store.js';
import { api } from './api.js';
import { h, icon, stemsLeft } from './ui.js';

const KEEP_DONE_MS = 90 * 1000; // a finished job stays in the summary this long
const jobs = new Map(); // id -> { id, kind, label, song, state, progress, phase, eta, at, endedAt, cancel, retry, first }
const ICONS = { stems: 'split', singer: 'mic', vocal: 'mic', import: 'download', clip: 'download', update: 'download', record: 'record', tones: 'tones' };

/** A job started or moved on. state: queued | running | finalizing | done | failed | canceled. */
export function setJob(id, patch) {
  const prev = jobs.get(id);
  const j = { ...(prev || { id, at: Date.now() }), ...patch };
  if (['done', 'failed', 'canceled'].includes(j.state) && !(prev && prev.endedAt)) j.endedAt = Date.now();
  if (!['done', 'failed', 'canceled'].includes(j.state)) delete j.endedAt;
  jobs.set(id, j);
  schedule();
}
/** A job that's no longer worth showing (e.g. a split undone). */
export function dropJob(id) {
  if (jobs.delete(id)) schedule();
}
export const allJobs = () => [...jobs.values()];

// ------------------------------------------------------------ sources --
const titleOf = (songId) => (state.songs.get(songId) || {}).title || 'a song';

function fromStems(u) {
  if (!u || !u.songId) return;
  const id = `stems:${u.songId}`;
  const prev = jobs.get(id);
  const base = { kind: 'stems', label: 'Splitting stems', song: titleOf(u.songId), cancel: () => api.stems.cancel(u.songId), retry: () => api.stems.request([u.songId]), next: () => api.stems.prioritize(u.songId) };
  if (u.state === 'queued') setJob(id, { ...base, state: 'queued', progress: null, phase: 'Waiting', eta: '' });
  else if (u.state === 'running') {
    const p = Number.isFinite(u.progress) ? u.progress : null;
    // the last bit is writing the files: said in words, not a bar stuck at 99%
    const finishing = p !== null && p >= 0.985;
    setJob(id, { ...base, state: finishing ? 'finalizing' : 'running', progress: finishing ? null : p, phase: finishing ? 'Finalizing' : u.message || 'Separating', eta: finishing ? '' : stemsLeft(u) });
  } else if (u.state === 'ready') {
    if (prev && !prev.endedAt) setJob(id, { ...base, state: 'done', progress: 1, phase: 'Stems ready', eta: '' });
  } else if (u.state === 'error') setJob(id, { ...base, state: 'failed', progress: null, phase: u.message || 'It didn’t work', eta: '' });
  else if (u.state === 'none' && prev && !prev.endedAt) setJob(id, { ...base, state: 'canceled', progress: null, phase: 'Stopped', eta: '' });
}

function fromSinger(u) {
  if (!u || !u.songId) return;
  const id = `singer:${u.songId}`;
  const prev = jobs.get(id);
  const base = { kind: 'singer', label: 'Making the singer cleaner', song: titleOf(u.songId), cancel: () => api.stems.upgradeCancel(u.songId) };
  if (u.state === 'queued') setJob(id, { ...base, state: 'queued', progress: null, phase: 'Waiting (after the songs you play)' });
  else if (u.state === 'running') setJob(id, { ...base, state: 'running', progress: Number.isFinite(u.progress) ? u.progress : null, phase: u.message || 'Separating' });
  else if (u.state === 'done') setJob(id, { ...base, state: 'done', progress: 1, phase: 'Cleaner singer ready' });
  else if (prev && !prev.endedAt) setJob(id, { ...base, state: u.state === 'error' ? 'failed' : 'canceled', progress: null, phase: u.message || 'Stopped' });
}

function fromImports(st) {
  if (!st) return;
  const pend = (st.pending || []).filter((p) => p.state !== 'done');
  const n = pend.reduce((a, p) => a + (p.count || 0), 0);
  const failed = pend.find((p) => p.state === 'error' || p.error);
  const prev = jobs.get('import');
  if (st.busy || n) setJob('import', { kind: 'import', label: 'Importing songs', song: n ? `${n} file${n === 1 ? '' : 's'}` : '', state: st.busy ? 'running' : 'queued', progress: null, phase: st.busy ? 'Checking and adding to Songs' : 'Waiting' });
  else if (failed) setJob('import', { kind: 'import', label: 'Importing songs', song: '', state: 'failed', progress: null, phase: failed.error || 'A file couldn’t be imported' });
  else if (prev && !prev.endedAt) setJob('import', { ...prev, state: 'done', phase: 'Added to Songs' });
}

on('stems-update', fromStems);
on('singer-upgrade', fromSinger);
if (api.on) {
  // 4.24: setting up stem splitting (downloads and installs), the audio decoder, reading tones in songs
  api.on('engine:progress', (p) => {
    if (!p) return;
    const done = p.done || p.state === 'done';
    setJob('engine', { kind: 'update', label: 'Setting up stem splitting', song: '', state: p.error ? 'failed' : done ? 'done' : 'running', progress: Number.isFinite(p.value) && p.value > 0 ? p.value : null, phase: p.error || p.step || p.detail || (done ? 'Ready' : 'Working') });
  });
  api.on('tools:progress', (p) => {
    if (!p) return;
    const v = Number(p.value) || 0;
    setJob('tools', { kind: 'update', label: 'Installing the audio decoder', song: '', state: v >= 1 ? 'done' : 'running', progress: v > 0 && v < 1 ? v : null, phase: v >= 1 ? 'Installed' : 'Downloading' });
  });
  api.on('tones:progress', (p) => {
    if (!p || !p.total) return;
    const done = p.done >= p.total;
    setJob('tones', { kind: 'tones', label: 'Reading the tones in your songs', song: '', state: done ? 'done' : 'running', progress: done ? 1 : p.done / p.total, phase: done ? 'Every song’s tones read' : `${p.done} of ${p.total} songs` });
  });
  api.on('import:update', fromImports);
  api.on('updates:progress', (p) => {
    if (!p) return;
    const done = p.p >= 1;
    setJob('update', { kind: 'update', label: 'Downloading the update', song: 'Stagehand', state: done ? 'done' : 'running', progress: done ? 1 : p.p, phase: done ? 'Ready to install' : 'Downloading' });
  });
}
// the queue as it stands when Stagehand starts (jobs carried over from last time)
setTimeout(() => {
  if (!(api.stems && api.stems.queue)) return;
  api.stems
    .queue()
    .then((q) => (Array.isArray(q) ? q : []).forEach((u) => fromStems(u)))
    .catch(() => {});
}, 1500);

// ------------------------------------------------------------ drawing --
const host = h('section.sh-activity.idle', { 'aria-label': 'Activity' });
const head = h('button.act-head', { type: 'button', 'aria-expanded': 'false', title: 'Everything Stagehand is doing in the background' });
const rowsEl = h('div.act-rows');
host.append(head, rowsEl);
const side = document.getElementById('sidebar');
if (side) {
  const card = side.querySelector('.guitar-card-host');
  side.insertBefore(host, card || null);
}
head.onclick = () => openDrawer();

const live = (j) => !j.endedAt;
const order = { running: 0, finalizing: 0, queued: 1, failed: 2, done: 3, canceled: 4 };
const sorted = () => allJobs().sort((a, b) => order[a.state] - order[b.state] || a.at - b.at);

let timer = 0;
function schedule() {
  if (timer) return;
  timer = setTimeout(() => {
    timer = 0;
    paint();
    if (drawer) paintDrawer();
  }, 200);
}
setInterval(() => {
  // finished jobs leave the summary after a while (they stay in the list until cleared)
  const now = Date.now();
  if (allJobs().some((j) => j.endedAt && now - j.endedAt > KEEP_DONE_MS && !j.faded)) {
    for (const j of jobs.values()) if (j.endedAt && now - j.endedAt > KEEP_DONE_MS) j.faded = true;
    schedule();
  }
}, 5000);

function summaryText(list) {
  const act = list.filter((j) => j.state === 'running' || j.state === 'finalizing').length;
  const q = list.filter((j) => j.state === 'queued').length;
  const bad = list.filter((j) => j.state === 'failed' && !j.faded).length;
  const parts = [];
  if (act) parts.push(`${act} working`);
  if (q) parts.push(`${q} waiting`);
  if (bad) parts.push(`${bad} need${bad === 1 ? 's' : ''} you`);
  return parts.length ? parts.join(' · ') : 'All done';
}

/** One job's row: built once, then only its words and bar are changed. */
function rowFor(j, el) {
  if (!el) {
    el = h('div.act-row', { role: 'status' });
    el.innerHTML = `<span class="act-ic"></span><span class="act-txt"><b></b><small></small></span><span class="act-bar"><i></i></span>`;
  }
  const ic = icon(ICONS[j.kind] || 'clock');
  if (el.__ic !== ic) el.querySelector('.act-ic').innerHTML = el.__ic = ic;
  el.dataset.state = j.state;
  const title = j.song ? `${j.label}: ${j.song}` : j.label;
  const b = el.querySelector('b');
  if (b.textContent !== (j.song || j.label)) b.textContent = j.song || j.label;
  el.title = title;
  const pct = j.progress !== null && j.progress !== undefined && j.state === 'running' ? `${Math.round(j.progress * 100)}%` : '';
  const sub = [pct, j.state === 'done' ? j.phase || 'Done' : j.state === 'failed' ? j.phase || 'Failed' : j.state === 'canceled' ? 'Stopped' : j.phase, j.eta, j.song ? j.label : ''].filter(Boolean).join(' · ');
  const sm = el.querySelector('small');
  if (sm.textContent !== sub) sm.textContent = sub;
  const bar = el.querySelector('.act-bar');
  const det = j.progress !== null && j.progress !== undefined && j.state === 'running';
  bar.classList.toggle('busy', !det && (j.state === 'running' || j.state === 'finalizing'));
  bar.hidden = !(j.state === 'running' || j.state === 'finalizing' || j.state === 'queued');
  bar.firstChild.style.width = det ? `${Math.round(j.progress * 1000) / 10}%` : '';
  return el;
}

const shownRows = new Map();
function paint() {
  const list = sorted();
  const shown = list.filter((j) => live(j) || !j.faded).slice(0, 3);
  // 4.24: always there, one quiet line when nothing is going on (click for what happened lately)
  host.hidden = false;
  host.classList.toggle('idle', !shown.length);
  const txt = shown.length ? summaryText(list.filter((j) => live(j) || !j.faded)) : list.length ? `All quiet · ${list.length} done lately` : 'All quiet';
  const html = `${icon('clock')}<span>Activity</span><em>${txt}</em>`;
  if (head.__html !== html) head.innerHTML = head.__html = html;
  const keep = new Set(shown.map((j) => j.id));
  for (const [id, el] of shownRows) if (!keep.has(id)) (el.remove(), shownRows.delete(id));
  shown.forEach((j, i) => {
    const el = rowFor(j, shownRows.get(j.id));
    shownRows.set(j.id, el);
    if (rowsEl.children[i] !== el) rowsEl.insertBefore(el, rowsEl.children[i] || null);
  });
}

// ------------------------------------------------------------ the list --
let drawer = null;
function openDrawer() {
  if (drawer) return closeDrawer();
  drawer = h('div.act-drawer', { role: 'dialog', 'aria-label': 'Activity' });
  document.body.append(drawer);
  head.setAttribute('aria-expanded', 'true');
  paintDrawer();
  const r = host.getBoundingClientRect();
  drawer.style.left = `${Math.round(r.right + 8)}px`;
  drawer.style.bottom = `${Math.max(12, Math.round(window.innerHeight - r.bottom))}px`;
  setTimeout(() => document.addEventListener('pointerdown', outside, true), 0);
  document.addEventListener('keydown', esc, true);
}
function closeDrawer() {
  if (!drawer) return;
  drawer.remove();
  drawer = null;
  head.setAttribute('aria-expanded', 'false');
  document.removeEventListener('pointerdown', outside, true);
  document.removeEventListener('keydown', esc, true);
}
const outside = (e) => drawer && !drawer.contains(e.target) && !host.contains(e.target) && closeDrawer();
const esc = (e) => {
  if (e.key === 'Escape' && drawer) {
    e.stopPropagation();
    closeDrawer();
  }
};
function paintDrawer() {
  if (!drawer) return;
  const list = sorted();
  drawer.innerHTML = '';
  const clear = h('button.btn.soft', { type: 'button', text: 'Clear finished', disabled: !list.some((j) => j.endedAt) });
  clear.onclick = () => {
    for (const j of [...jobs.values()]) if (j.endedAt) jobs.delete(j.id);
    schedule();
  };
  drawer.append(h('header', null, h('b', { text: 'Activity' }), h('span', { text: summaryText(list) }), clear));
  if (!list.length) drawer.append(h('p.act-empty', { text: 'Nothing going on. Stem splits, imports, downloads and the like show here while they work.' }));
  const groups = [
    ['Working', (j) => j.state === 'running' || j.state === 'finalizing'],
    ['Waiting', (j) => j.state === 'queued'],
    ['Needs you', (j) => j.state === 'failed'],
    ['Finished', (j) => j.state === 'done' || j.state === 'canceled'],
  ];
  for (const [name, f] of groups) {
    const g = list.filter(f);
    if (!g.length) continue;
    drawer.append(h('div.act-group', { text: name }));
    for (const j of g) {
      const row = rowFor(j);
      const acts = h('span.act-acts');
      if ((j.state === 'running' || j.state === 'queued' || j.state === 'finalizing') && j.cancel) acts.append(act('Cancel', 'x', j.cancel));
      if (j.state === 'queued' && j.next) acts.append(act('Do this one next', 'chevronUp', j.next));
      if (j.state === 'failed' && j.retry) acts.append(act('Try again', 'repeat', j.retry));
      row.append(acts);
      drawer.append(row);
    }
  }
}
function act(label, ic, fn) {
  const b = h('button.icon-btn', { type: 'button', title: label, 'aria-label': label, html: icon(ic) });
  b.onclick = (e) => {
    e.stopPropagation();
    Promise.resolve(fn()).catch(() => {});
  };
  return b;
}

window.__activity = { setJob, dropJob, allJobs, openDrawer }; // tests
schedule(); // the quiet line from the start
