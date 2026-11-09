/**
 * Stems are stored as lossless FLAC, or (4.4, Settings › Stems) as smaller Opus
 * 192 kbps: new ones are converted as they're made, and stems already made can be
 * converted from Settings › Stems (FLAC to Opus; never back).
 */
import { api } from './api.js';
import { state, on, emit } from './store.js';
import { h, icon, esc, toast, modal, fmtBytes } from './ui.js';
import { parseWav } from './audio-engine.js';
import { encodeFlac, encodeOpus, opusSupported, decodeTo, wavChannels, FORMATS } from './codec.js';
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
function flac() {
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
  return flacWorker;
}
function encode(fmt, l, r, rate) {
  if (fmt.bitrate) {
    const L = Float32Array.from(l, (x) => x / 32768);
    const R = Float32Array.from(r, (x) => x / 32768);
    return encodeOpus(L, R, rate, fmt.bitrate);
  }
  if (typeof Worker === 'undefined') return encodeFlac(l, r, rate);
  const id = ++flacSeq;
  const L = l.slice();
  const R = r.slice();
  return new Promise((resolve, reject) => {
    flacWait.set(id, { resolve, reject });
    flac().postMessage({ id, l: L, r: R, rate }, [L.buffer, R.buffer]);
  });
}
/** A WAV stem straight to FLAC: the bytes go to the worker untouched (nothing heavy on the page). */
function encodeWav(buf) {
  const id = ++flacSeq;
  return new Promise((resolve, reject) => {
    flacWait.set(id, { resolve, reject });
    flac().postMessage({ id, wav: buf }, [buf]);
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
      let bytes;
      if (fmt.id === 'flac' && /\.wav(\?|$)/i.test(s.url) && typeof Worker !== 'undefined') {
        bytes = await encodeWav(await (await fetch(s.url)).arrayBuffer());
      } else {
        const a = await readStem(s.url, st.sampleRate, st.frames);
        bytes = await encode(fmt, a.l, a.r, a.rate);
      }
      await api.stems.store(songId, model, s.name, fmt.ext, bytes);
      // let the page (and the highway) breathe between stems
      await new Promise((r) => setTimeout(r, 30));
    }
  }
  // (back to WAV isn't offered: the WAVs are gone once converted)
  if (fmt.id !== 'wav') await api.stems.finish(songId, model, format);
  // If this song is open: FLAC is a perfect copy of what's already playing, so
  // nothing is reloaded (that used to decode every stem again mid-song and made
  // the highway stutter). Only a lossy format would need the new audio.
  const cur = stage.current();
  if (cur && cur.id === songId) {
    if (fmt.id === 'flac') stage.stemsMoved && stage.stemsMoved();
    else stage.reloadStems();
  }
}

// New stems get stored in the chosen format as soon as they're made.
/** How new stems are stored: lossless FLAC (the default) or the smaller Opus 192 kbps. */
export function storeFormat() {
  const f = state.settings && state.settings.stems && state.settings.stems.format;
  return f === 'opus192' && opusSupported() ? 'opus192' : 'flac';
}

api.on('stems:done', (d) => {
  const f = storeFormat();
  if (d && d.songId) enqueue([{ songId: d.songId, model: d.model || (state.settings.stems.model || 'htdemucs_6s') }], f);
});

// ============================================================ settings UI
// (when a song's length isn't known: Opus 192 kbps is roughly a fifth of FLAC)
const OPUS_SHARE = 0.22;

/** Rows for Settings › Stems. */
export async function settingsRows(setting) {
  const rows = [];
  const canOpus = opusSupported();
  const pick = h('select.input', { 'aria-label': 'How stems are stored' });
  for (const [v, l] of [
    ['flac', 'Lossless (FLAC)'],
    ['opus192', 'Smaller (Opus 192 kbps, about a fifth of the size)'],
  ])
    pick.append(h('option', { value: v, text: l, disabled: v !== 'flac' && !canOpus ? true : null }));
  pick.value = storeFormat();
  pick.onchange = async () => {
    state.settings = await api.settings.set({ stems: { format: pick.value } });
    emit('settings');
  };
  const info = h('span', { text: 'Measuring…', style: { color: 'var(--ink-2)' } });
  const conv = h('button.btn.small.soft', { type: 'button', text: 'Convert', disabled: true });
  const row = setting('How stems are stored', '', pick, info, conv);
  const desc = row.querySelector('.d');
  rows.push(row);
  const refresh = async () => {
    let list = [];
    try {
      list = await api.stems.formats();
    } catch (_) {}
    const f = storeFormat();
    const total = list.reduce((a, x) => a + x.bytes, 0);
    // what can be converted to the chosen format: WAV to either; FLAC to Opus (never back)
    const todo = list.filter((x) => (f === 'flac' ? x.format === 'wav' : x.format === 'wav' || x.format === 'flac'));
    const todoBytes = todo.reduce((a, x) => a + x.bytes, 0);
    // Opus is a fixed rate: 192 kbps per stem for the song's length
    const opusBytes = (x) => (x.seconds ? x.seconds * 24000 * (x.model === 'htdemucs_6s' ? 6 : 4) : x.bytes * OPUS_SHARE);
    const after = f === 'flac' ? todoBytes * 0.5 : todo.reduce((a, x) => a + Math.min(x.bytes, opusBytes(x)), 0);
    info.textContent = `${list.length} song${list.length === 1 ? '' : 's'} · ${fmtBytes(total)} in all`;
    conv.textContent = f === 'flac' ? 'Convert to FLAC' : 'Make them smaller';
    if (Q.running) {
      desc.textContent = `Converting ${Q.done + 1} of ${Q.total}${Q.current && state.songs.get(Q.current.songId) ? `: ${state.songs.get(Q.current.songId).title}` : ''}…`;
      conv.disabled = true;
    } else {
      const what = f === 'flac' ? 'Lossless: a perfect copy of what separation makes. New stems are stored this way.' : 'Opus 192 kbps: sounds the same for playing along, about a fifth of the size. New stems are stored this way.';
      desc.textContent = todo.length
        ? `${what} ${todo.length} song${todo.length === 1 ? '' : 's'} could be converted, saving about ${fmtBytes(Math.max(0, todoBytes - after))}. It runs in the background; you can keep playing.${f !== 'flac' ? ' Smaller stems can’t be turned back into lossless ones.' : ''}`
        : what;
      conv.disabled = !todo.length;
    }
    conv.hidden = !todo.length && !Q.running;
    conv.onclick = () => {
      enqueue(todo.map((x) => ({ songId: x.songId, model: x.model })), f);
      refresh();
    };
  };
  refresh();
  on('shrink', () => row.isConnected && refresh());
  on('settings', () => row.isConnected && refresh());
  return rows;
}
