/**
 * After 4.26.0: the stem splitting card. While a song waits for its stems (over the highway, or over the
 * other pages), this shows the user's animation, the Unmixer: the bar, what it's doing, the song,
 * and its own "Play now with the full mix" button.
 *
 * THE ANIMATION. The Unmixer lives in src/renderer/vendor/unmixer/ (unmixer.js, art/) exactly as
 * the user sent it; docs/unmixer/Integration.md says how it's driven. It's loaded here on first use
 * (one classic script that finds art/ next to itself) and mounted once per wait:
 * start({ jobId, songId, song, artist, sequence: 0 }), then update() with the split's real progress
 * (never guessed from time) and a sequence that only goes up. A new wait (a new song, or the same
 * song again) is a new job. It looks after less motion itself. If the script can't load, the
 * caller shows its plain card instead (load() resolves false).
 *
 * Screen readers: the drawing names itself (what it's doing, the percentage); a hidden line under
 * it says the same in words for the live region round it.
 */
import { h, stemsLeft } from './ui.js';
import { splitFirst } from './store.js';

const DIR = new URL('../vendor/unmixer/', import.meta.url);
let loading = null;

/** The Unmixer's script, once. Resolves true when it's there. */
export function loadUnmixer() {
  if (window.Unmixer && typeof window.Unmixer.mount === 'function') return Promise.resolve(true);
  if (!loading) {
    loading = new Promise((resolve) => {
      const s = document.createElement('script');
      s.src = new URL('unmixer.js', DIR).href;
      s.onload = () => resolve(!!(window.Unmixer && typeof window.Unmixer.mount === 'function'));
      s.onerror = () => resolve(false);
      document.head.append(s);
    }).then((ok) => (ok || (loading = null), ok));
  }
  return loading;
}

/** Whether the Unmixer can be mounted right now (loaded already). */
export function unmixerReady() {
  return !!(window.Unmixer && typeof window.Unmixer.mount === 'function');
}

/** What the card says under "Splitting the stems" before the split shows a number. */
function stepWords(st) {
  const m = String((st && st.message) || '');
  if (/decod/i.test(m)) return 'Reading the song…';
  if (/start/i.test(m)) return 'Starting the splitter…';
  return '';
}

/** A stems status ({ state, progress, message, eta }) as an Unmixer event, without job or sequence. */
export function unmixerEvent(st) {
  st = st || { state: 'queued' };
  if (st.state === 'ready') return { phase: 'ready', message: 'Loading the stems…' };
  if (st.state === 'queued') return { phase: 'queued', progress: null, message: splitFirst() };
  if (st.state === 'error') return { phase: 'error', message: String(st.message || '') };
  if (st.state === 'cancelled') return { phase: 'cancelled' };
  const p = Number(st.progress) || 0;
  if (p <= 0) return { phase: 'splitting', progress: null, message: stepWords(st) };
  const left = stemsLeft(st);
  return { phase: 'splitting', progress: Math.min(1, p), message: left ? left[0].toUpperCase() + left.slice(1) : '' };
}

/** Words for screen readers, the same as the card. */
function words(st, song) {
  st = st || { state: 'queued' };
  const pct = Math.round((Number(st.progress) || 0) * 100);
  const what = st.state === 'ready' ? 'Loading the stems' : st.state === 'queued' ? `Waiting to split the stems. ${splitFirst()}` : pct ? `Splitting the stems · ${pct}%` : 'Splitting the stems';
  return `${what}${song && song.title ? ` for ${song.title}` : ''}. The song starts by itself when they're ready.`;
}

let jobs = 0;

/**
 * One card for one wait. Returns { el, feed(st), destroy() } or null when the Unmixer isn't loaded.
 * jobKey names the wait (the same key keeps the same job; a new key starts a new one).
 */
export function stemCard({ song, jobKey, onPlay }) {
  if (!unmixerReady()) return null;
  const el = h('div.stem-card');
  const host = h('div.sc-art');
  const said = h('span.sc-said', { style: { position: 'absolute', width: '1px', height: '1px', overflow: 'hidden', clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap' } });
  el.append(host, said);
  let rig;
  try {
    rig = window.Unmixer.mount(host, { onPlayFullMix: () => onPlay && onPlay() });
  } catch (_) {
    return null;
  }
  const jobId = `stems-${jobKey || ''}-${++jobs}`;
  const songId = String((song && song.id) || 'song');
  let seq = 0;
  let last = '';
  rig.start({ jobId, songId, song: (song && song.title) || '', artist: (song && song.artist) || '', sequence: 0, phase: 'queued', progress: null });
  return {
    el,
    jobKey,
    feed(st) {
      const e = unmixerEvent(st);
      const sig = JSON.stringify(e);
      said.textContent = words(st, song);
      if (sig === last) return; // nothing new to say (the time left ticks every second)
      last = sig;
      rig.update({ jobId, songId, sequence: ++seq, ...e });
    },
    destroy() {
      try {
        rig.destroy();
      } catch (_) {}
      el.remove();
    },
  };
}
