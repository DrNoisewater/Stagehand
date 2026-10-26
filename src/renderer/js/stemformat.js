/**
 * Stems are stored as lossless FLAC: new ones are converted as they're made,
 * and any WAV stems can be converted from Settings › Stems.
 */
import { api } from './api.js';
import { state, on, emit } from './store.js';
import { h, icon, esc, toast, modal, fmtBytes } from './ui.js';
import { parseWav } from './audio-engine.js';
import { encodeFlac, decodeTo, wavChannels, FORMATS } from './codec.js';
import * as stage from './stage.js';

const fmtById = (id) => FORMATS.find((f) => f.id === id) || FORMATS[0];
const STEM_LABEL = { guitar: 'Guitar', bass: 'Bass', drums: 'Drums', vocals: 'Vocals', piano: 'Keys', other: 'Other' };

/** One stem's audio, whatever it's stored as: Int16 left/right at its rate. */
async function readStem(url, rate, frames) {
  const buf = await (await fetch(url)).arrayBuffer();
  if (/\.wav(\?|$)/i.test(url)) {
    const wav = parseWav(buf);
    return { ...wavChannels(buf, wav), rate: wav.sampleRate, frames: wav.frames };
  }
  const d = await decodeTo(buf, rate, frames);
  const l = new Int16Array(d.L.length);
  const r = new Int16Array(d.R.length);
  for (let i = 0; i < l.length; i++) {
    l[i] = Math.max(-32768, Math.min(32767, Math.round(d.L[i] * 32767)));
    r[i] = Math.max(-32768, Math.min(32767, Math.round(d.R[i] * 32767)));
  }
  return { l, r, rate, frames: l.length };
}

// FLAC encoding runs in a worker (a background thread), not on the page.
let flacWorker = null;
let flacSeq = 0;
const flacWait = new Map();
function encode(fmt, l, r, rate) {
  if (typeof Worker === 'undefined') return encodeFlac(l, r, rate);
  if (!flacWorker) {
    flacWorker = new Worker(new URL('../workers/flac-worker.js', import.meta.url), { type: 'module' });
    flacWorker.onmessage = (e) => {
      const w = flacWait.get(e.data.id);
      if (!w) return;
      flacWait.delete(e.data.id);
      if (e.data.error) w.reject(new Error(e.data.error));
      else w.resolve(new Uint8Array(e.data.bytes));
    };
  }
  const id = ++flacSeq;
  const L = l.slice();
  const R = r.slice();
  return new Promise((resolve, reject) => {
    flacWait.set(id, { resolve, reject });
    flacWorker.postMessage({ id, l: L, r: R, rate }, [L.buffer, R.buffer]);
  });
}

// =========================================================== converting
const Q = { list: [], running: false, done: 0, total: 0, current: null, failed: 0 };
export const shrinkState = Q;

/** Queue songs to be stored in `format` (only from lossless stems: WAV or FLAC). */
export function enqueue(items, format) {
  for (const it of items) if (!Q.list.some((x) => x.songId === it.songId && x.model === it.model)) Q.list.push({ ...it, format });
  Q.total = Q.done + Q.list.length;
  emit('shrink');
  run();
}

async function run() {
  if (Q.running) return;
  Q.running = true;
  while (Q.list.length) {
    const job = Q.list.shift();
    Q.current = job;
    emit('shrink');
    try {
      await convert(job.songId, job.model, job.format);
    } catch (err) {
      Q.failed++;
      console.warn('stem shrink', err);
    }
    Q.done++;
    emit('shrink');
  }
  Q.running = false;
  Q.current = null;
  emit('shrink');
  if (Q.total) {
    toast({ title: 'Stems converted', message: `${Q.done - Q.failed} song${Q.done - Q.failed === 1 ? '' : 's'} done${Q.failed ? `, ${Q.failed} couldn’t be converted` : ''}.`, kind: Q.failed ? 'info' : 'ok' });
    Q.done = Q.total = Q.failed = 0;
  }
}

async function convert(songId, model, format) {
  const st = await api.stems.status(songId);
  if (!st || st.state !== 'ready' || st.model !== model) return;
  if ((st.format || 'wav') === format) return;
  if (!['wav', 'flac'].includes(st.format || 'wav')) return; // don't re-encode compressed stems
  const fmt = fmtById(format);
  if (fmt.id !== 'wav') {
    for (const s of st.stems) {
      const a = await readStem(s.url, st.sampleRate, st.frames);
      const bytes = await encode(fmt, a.l, a.r, a.rate);
      await api.stems.store(songId, model, s.name, fmt.ext, bytes);
    }
  }
  // (back to WAV isn't offered: the WAVs are gone once converted)
  if (fmt.id !== 'wav') await api.stems.finish(songId, model, format);
  // if this song is open, reload its stems in the new format
  const cur = stage.current();
  if (cur && cur.id === songId) stage.reloadStems();
}

// New stems get stored in the chosen format as soon as they're made.
api.on('stems:done', (d) => {
  const f = 'flac'; // lossless only for now
  if (d && d.songId) enqueue([{ songId: d.songId, model: d.model || (state.settings.stems.model || 'htdemucs_6s') }], f);
});

// ============================================================ settings UI
/** Rows for Settings › Stems. */
export async function settingsRows(setting) {
  const rows = [];
  const f = 'flac';
  const info = h('span', { text: 'Measuring…', style: { color: 'var(--ink-2)' } });
  const shrink = h('button.btn.small.soft', { type: 'button', text: 'Convert to FLAC', disabled: true });
  const row = setting('Stems are stored as lossless FLAC', '', info, shrink);
  const desc = row.querySelector('.d');
  rows.push(row);
  const refresh = async () => {
    let list = [];
    try {
      list = await api.stems.formats();
    } catch (_) {}
    const total = list.reduce((a, x) => a + x.bytes, 0);
    const todo = list.filter((x) => x.format === 'wav');
    info.textContent = `${list.length} song${list.length === 1 ? '' : 's'} · ${fmtBytes(total)}`;
    if (Q.running) {
      desc.textContent = `Converting ${Q.done + 1} of ${Q.total}${Q.current && state.songs.get(Q.current.songId) ? `: ${state.songs.get(Q.current.songId).title}` : ''}…`;
      shrink.disabled = true;
    } else {
      desc.textContent = todo.length ? `${todo.length} song${todo.length === 1 ? '' : 's'} still in WAV. Converting runs in the background; you can keep playing.` : 'A perfect copy of what separation makes, at about half the size of WAV.';
      shrink.disabled = !todo.length;
    }
    shrink.hidden = !todo.length && !Q.running;
    shrink.onclick = () => {
      enqueue(todo.map((x) => ({ songId: x.songId, model: x.model })), f);
      refresh();
    };
  };
  refresh();
  on('shrink', () => row.isConnected && refresh());
  on('settings', () => row.isConnected && refresh());
  return rows;
}
