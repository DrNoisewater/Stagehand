/**
 * 4.26: hear a song when you click it in Songs. A short clip (the song's own preview, or a slice of
 * the song when it has none) fades in, fades out at its end, and stops by itself when:
 *   another song is clicked · you leave Songs · a song is played · you press the small Stop.
 * Never starts while a song is playing in the player. Off with Settings › Playback.
 * It plays through the player's extra sound bus (engine.extraOut()), like every other sound in the app.
 */
import { state, on } from './store.js';
import { api } from './api.js';
import { h, icon, esc } from './ui.js';

const FADE_IN = 0.35; // seconds
const FADE_OUT = 0.6;
const LEVEL = 0.7;
const KEEP = 40; // clips remembered, so a second click on a song starts at once

const clips = new Map(); // song id → { url, start, length } (the decoded file itself is kept on disk by the app)
let token = 0;
let cur = null; // { id, el, timer, fade }
let stageMod = null;
let bar = null;

function enabled() {
  const s = state.settings;
  return !(s && s.playback && s.playback.preview === false);
}

/** Is the player playing a song right now? (Then a preview would talk over it.) */
function playerBusy() {
  try {
    return !!(stageMod && stageMod.engine && stageMod.engine.playing);
  } catch (_) {
    return false;
  }
}

function showBar(song) {
  if (!bar) {
    bar = h('div.pv-bar', { role: 'status', hidden: true });
    document.body.append(bar);
  }
  bar.innerHTML = `<span class="pv-ic">${icon('volume')}</span><span class="pv-t">Preview · <b>${esc(song && song.title ? song.title : 'song')}</b></span>`;
  const stop = h('button.pv-stop', { type: 'button', title: 'Stop the preview', 'aria-label': 'Stop the preview', html: `${icon('x')}<span>Stop</span>` });
  stop.onclick = () => stopPreview();
  bar.append(stop);
  bar.hidden = false;
}
function hideBar() {
  if (bar) bar.hidden = true;
}

function ramp(el, to, secs, done) {
  const from = el.volume;
  const t0 = performance.now();
  const rec = { stop: false };
  const step = () => {
    if (rec.stop) return;
    const k = Math.min(1, (performance.now() - t0) / (secs * 1000));
    try {
      el.volume = Math.max(0, Math.min(1, from + (to - from) * k));
    } catch (_) {}
    if (k < 1) rec.raf = setTimeout(step, 30);
    else if (done) done();
  };
  step();
  return rec;
}

function end(c, quick = false) {
  if (!c || c.ended) return;
  c.ended = true;
  clearTimeout(c.timer);
  if (c.fade) c.fade.stop = true;
  if (c.fade) clearTimeout(c.fade.raf);
  if (cur === c) {
    cur = null;
    hideBar();
  }
  const kill = () => {
    try {
      c.el.pause();
      if (c.route) c.route.disconnect();
      c.el.removeAttribute('src');
      c.el.load();
    } catch (_) {}
  };
  if (quick) kill();
  else c.fade = ramp(c.el, 0, 0.18, kill);
}

/** Stop whatever is previewing, fading out. */
export function stopPreview() {
  token++; // a clip still loading must not start after this
  if (cur) end(cur);
}

async function clipFor(id) {
  if (clips.has(id)) {
    const c = clips.get(id);
    clips.delete(id); // most recent last
    clips.set(id, c);
    return c;
  }
  const c = await api.audio.preview(id);
  if (!c) return null;
  clips.set(id, c);
  while (clips.size > KEEP) clips.delete(clips.keys().next().value);
  return c;
}

/** Play a short clip of a song (call it when a song is clicked). */
export async function previewSong(id) {
  if (!enabled()) return;
  if (cur && cur.id === id && !cur.ended) return; // already playing this one
  const mine = ++token;
  if (cur) end(cur);
  if (!stageMod) stageMod = await import('./stage.js').catch(() => null);
  if (mine !== token || playerBusy() || state.page !== 'songs') return;
  const song = state.songs.get(id);
  if (!song) return;
  let clip;
  try {
    clip = await clipFor(id);
  } catch (_) {
    return; // no preview and no decoder: stay quiet, the song still opens as always
  }
  if (!clip || mine !== token || playerBusy() || state.page !== 'songs' || !state.selection.has(id)) return;
  const el = new Audio();
  el.crossOrigin = 'anonymous';
  el.volume = 0;
  el.preload = 'auto';
  el.src = clip.url;
  // 4.1.2 rule: sound goes out the same way the song does (the player's extra bus), never the default speakers
  let route = null;
  try {
    const { ctx, node } = await stageMod.engine.extraOut();
    route = ctx.createMediaElementSource(el);
    route.connect(node);
  } catch (_) {
    return;
  }
  if (mine !== token) return;
  const c = { id, el, route, ended: false, timer: 0, fade: null };
  cur = c;
  el.addEventListener('ended', () => end(c, true));
  el.addEventListener('error', () => end(c, true));
  const length = Math.max(1, clip.length || clip.duration || 30);
  try {
    if (clip.start) el.currentTime = clip.start;
    await el.play();
  } catch (_) {
    return end(c, true);
  }
  if (mine !== token) return end(c, true);
  showBar(song);
  c.fade = ramp(el, LEVEL, FADE_IN);
  // the fade out starts a little before the end
  c.timer = setTimeout(() => {
    if (c.ended) return;
    if (c.fade) c.fade.stop = true;
    c.fade = ramp(el, 0, FADE_OUT, () => end(c, true));
  }, Math.max(0.5, length - FADE_OUT) * 1000);
}

// the player starting (or already playing) ends the preview; so does leaving Songs or picking another song
on('playing', () => stopPreview());
on('stage-song', () => stopPreview());
on('page', () => state.page !== 'songs' && stopPreview());
on('selection', () => {
  if (cur && !state.selection.has(cur.id)) stopPreview();
});
// the player's own play button on the song that is already loaded
setInterval(() => {
  if (cur && playerBusy()) stopPreview();
}, 300);
