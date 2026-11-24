/**
 * 4.26: hear a song when you click it in Songs. A short clip (the song's own preview, or a slice of
 * the song when it has none) fades in, fades out at its end, and stops by itself when:
 *   another song is clicked · you leave Songs · a song is played · you press the small Stop.
 * Never starts while a song is playing in the player. Off with Settings › Playback.
 * It plays through the player's extra sound bus (engine.extraOut()), like every other sound in the app.
 *
 * 4.29.1: the clip is fetched whole and decoded off the page (decodeAudioData), then played from
 * memory by the sound thread. Before, an <audio> element streamed it from the app's file server
 * into the sound engine, which could stutter or stay silent on a busy PC. Fades are scheduled on
 * the sound clock, so they can't be held up by the page either.
 */
import { state, on } from './store.js';
import { api } from './api.js';
import { h, icon, esc } from './ui.js';

const FADE_IN = 0.35; // seconds
const FADE_OUT = 0.6;
const QUICK = 0.12; // fade when another song or Stop cuts it short
const LEVEL = 0.7;
const KEEP = 40; // clips remembered (where they are), so a second click starts at once
const KEEP_SOUND = 6; // clips kept decoded in memory (about 12 MB each)

const clips = new Map(); // song id → { url, start, length } (the decoded file itself is kept on disk by the app)
const sounds = new Map(); // url → Promise<AudioBuffer>
let token = 0;
let cur = null; // { id, src, gain, ctx, ended, timer }
let stageMod = null;
let bar = null;
let plays = 0;

/** For checks: how many clips have started, and what is playing now. */
export function previewState() {
  return { plays, playing: cur && !cur.ended ? cur.id : null, url: cur && !cur.ended ? cur.url : null };
}

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

function showBar(song, loading) {
  if (!bar) {
    bar = h('div.pv-bar', { role: 'status', hidden: true });
    document.body.append(bar);
  }
  const what = loading ? 'Getting the preview' : 'Preview';
  bar.innerHTML = `<span class="pv-ic">${icon('volume')}</span><span class="pv-t">${what} · <b>${esc(song && song.title ? song.title : 'song')}</b></span>`;
  bar.classList.toggle('loading', !!loading);
  const stop = h('button.pv-stop', { type: 'button', title: 'Stop the preview', 'aria-label': 'Stop the preview', html: `${icon('x')}<span>Stop</span>` });
  stop.onclick = () => stopPreview();
  bar.append(stop);
  bar.hidden = false;
}
function hideBar() {
  if (bar) bar.hidden = true;
}

function end(c, quick = false) {
  if (!c || c.ended) return;
  c.ended = true;
  clearTimeout(c.timer);
  if (cur === c) {
    cur = null;
    hideBar();
  }
  try {
    const t = c.ctx.currentTime;
    const g = c.gain.gain;
    g.cancelScheduledValues(t);
    g.setValueAtTime(g.value, t);
    const fade = quick ? 0.02 : QUICK;
    g.linearRampToValueAtTime(0, t + fade);
    c.src.stop(t + fade + 0.01);
  } catch (_) {}
  // let go of the nodes once the fade is over
  setTimeout(() => {
    try {
      c.src.disconnect();
      c.gain.disconnect();
    } catch (_) {}
  }, 400);
}

/** Stop whatever is previewing, fading out. */
export function stopPreview() {
  token++; // a clip still loading must not start after this
  if (cur) end(cur);
  else hideBar(); // a clip that was still on its way
}

async function clipFor(id, fresh = false) {
  if (!fresh && clips.has(id)) {
    const c = clips.get(id);
    clips.delete(id); // most recent last
    clips.set(id, c);
    return c;
  }
  clips.delete(id);
  const c = await api.audio.preview(id);
  if (!c) return null;
  clips.set(id, c);
  while (clips.size > KEEP) clips.delete(clips.keys().next().value);
  return c;
}

/** The clip's sound, decoded once. Two quick clicks on the same song share one fetch. */
function soundFor(ctx, url) {
  let p = sounds.get(url);
  if (p) {
    sounds.delete(url);
    sounds.set(url, p);
    return p;
  }
  p = (async () => {
    const res = await fetch(url);
    if (!res.ok) throw Object.assign(new Error(`preview ${res.status}`), { gone: true });
    const data = await res.arrayBuffer();
    // decoded on the browser's own thread, at the player's rate, so playing it needs no more work
    return await ctx.decodeAudioData(data);
  })();
  p.catch(() => sounds.get(url) === p && sounds.delete(url));
  sounds.set(url, p);
  while (sounds.size > KEEP_SOUND) sounds.delete(sounds.keys().next().value);
  return p;
}

/** Play a short clip of a song (call it when a song is clicked). */
export async function previewSong(id) {
  if (!enabled()) return;
  if (cur && cur.id === id && !cur.ended) return; // already playing this one
  const mine = ++token;
  if (cur) end(cur);
  if (!stageMod) stageMod = await import('./stage.js').catch(() => null);
  const still = () => mine === token && !playerBusy() && state.page === 'songs' && state.selection.has(id);
  if (mine !== token || playerBusy() || state.page !== 'songs' || !stageMod) return;
  const song = state.songs.get(id);
  if (!song) return;
  // the first time a song is clicked its clip is made, which can take a moment: say so
  const slow = setTimeout(() => still() && showBar(song, true), 250);
  let out = null;
  let clip = null;
  let sound = null;
  try {
    out = await stageMod.engine.extraOut();
    for (let attempt = 0; attempt < 2 && !sound; attempt++) {
      clip = await clipFor(id, attempt > 0);
      if (!clip || !still()) break;
      try {
        sound = await soundFor(out.ctx, clip.url);
      } catch (err) {
        // the app tidied its sound files away since this clip was made: ask for it again
        if (!err.gone) throw err;
      }
    }
  } catch (_) {
    sound = null; // no preview and no decoder: stay quiet, the song still opens as always
  }
  clearTimeout(slow);
  const quiet = () => mine === token && hideBar(); // nothing newer is on its way: no bar left saying "Getting"
  if (!still() || !sound) return quiet();
  // the player may have rebuilt its sound engine while this one was loading
  out = await stageMod.engine.extraOut().catch(() => null);
  if (!out || !still()) return quiet();
  const { ctx, node } = out;
  const src = ctx.createBufferSource();
  src.buffer = sound;
  const gain = ctx.createGain();
  gain.gain.value = 0;
  src.connect(gain);
  gain.connect(node);
  const offset = Math.max(0, Math.min(sound.duration - 0.5, clip.start || 0));
  const length = Math.max(0.5, Math.min(sound.duration - offset, clip.length || sound.duration));
  const c = { id, url: clip.url, src, gain, ctx, ended: false, timer: 0 };
  cur = c;
  src.onended = () => end(c, true);
  const t = ctx.currentTime + 0.02;
  const g = gain.gain;
  g.setValueAtTime(0, t);
  g.linearRampToValueAtTime(LEVEL, t + Math.min(FADE_IN, length / 3));
  const out0 = t + Math.max(Math.min(FADE_IN, length / 3), length - FADE_OUT);
  g.setValueAtTime(LEVEL, out0);
  g.linearRampToValueAtTime(0, t + length);
  try {
    src.start(t, offset, length);
  } catch (_) {
    return end(c, true);
  }
  plays++;
  showBar(song, false);
  // a safety net: the bar goes even if the sound's own end never arrives (a closed engine)
  c.timer = setTimeout(() => end(c, true), (length + 1) * 1000);
}

// the player starting (or already playing) ends the preview; so does leaving Songs or picking another song.
// 4.29.1: only when it really plays: the player says 'playing' for a pause or a song that failed too
on('playing', () => playerBusy() && stopPreview());
on('stage-song', () => stopPreview());
on('page', () => state.page !== 'songs' && stopPreview());
on('selection', () => {
  if (cur && !state.selection.has(cur.id)) stopPreview();
});
// the player's own play button on the song that is already loaded
setInterval(() => {
  if (cur && playerBusy()) stopPreview();
}, 300);
