/**
 * Stagehand 3 shell: which page shows, the bottom now-playing bar, and the
 * guitar status card at the foot of the left menu.
 */
import { artImg, seen, harvest } from './artkeep.js';
import { api } from './api.js';
import { state, on, emit, setPage } from './store.js';
import { h, icon, esc, toast } from './ui.js';
import { rig } from './rig.js';
import { guitarCardHost } from './sidebar.js';
import { overview, drawBars, fmtTime } from './wave.js';
import * as stage from './stage.js';

const app = document.getElementById('app');
const PAGES = ['play', 'songs', 'discover', 'tones', 'gear', 'progress', 'now', 'greenroom'];

/** One colour per song, from the stem gels, so a song looks the same everywhere. */
export const SONG_GELS = ['#ff6b3d', '#8c7bff', '#ff4d8d', '#33c8e0', '#9bdb5a', '#ffb547'];
export function songGel(song) {
  let x = 0;
  for (const c of String((song && (song.artist || song.title || song.id)) || '')) x = (x * 31 + c.charCodeAt(0)) >>> 0;
  return SONG_GELS[x % SONG_GELS.length];
}
export function initials(song) {
  const src = (song && (song.artist || song.title)) || '';
  return src.replace(/^the\s+/i, '').split(/\s+/).filter(Boolean).map((w) => w[0]).join('').slice(0, 2).toUpperCase() || '♪';
}
/** Album art with a gel-tinted stand-in while it loads (or when there is none). */
export function coverEl(song, size = 128, cls = '') {
  const el = h(`div.cover.gelled${cls ? `.${cls}` : ''}`, { style: { '--gel': songGel(song) } }, h('span', { text: initials(song) }));
  if (song && song.art) {
    // 4.5: a picture that has loaded before shows at once (no initials, no reload)
    const src = api.artUrl(song, size);
    const img = artImg(src, { alt: '', loading: 'lazy', decoding: 'async' });
    if (seen.has(src) && img.complete && img.naturalWidth) el.classList.add('has-img');
    img.onload = () => el.classList.add('has-img');
    img.onerror = () => img.remove();
    el.append(img);
  }
  return el;
}

function applyPage() {
  for (const p of PAGES) app.classList.toggle(`page-${p}`, state.page === p);
  emit('page-shown', state.page);
}
on('page', applyPage);
applyPage();

// ------------------------------------------------------------ bottom bar --
const bar = document.getElementById('nowbar');
const N = { song: null, bins: null, binsFor: null, hover: null, raf: 0 };
const art = h('div.nb-art');
const text = h('button.nb-text', { type: 'button', title: 'Open the song (Now playing)' });
const playBtn = h('button.round-play', { type: 'button', 'aria-label': 'Play', html: icon('play') });
const tNow = h('span', { text: '0:00' });
const tEnd = h('span', { text: '0:00' });
const wave = h('canvas', { 'aria-label': 'Song position' });
const prog = h('div.nb-prog', null, tNow, wave, tEnd);
const openBtn = h('button.btn.soft', { type: 'button', text: 'Open song' });
// The song's volume, always right here (it was easy to lose in a panel)
const sVolIcon = h('button.icon-btn', { type: 'button', title: 'Song volume', 'aria-label': 'Mute or unmute the song', html: icon('volume') });
const sVol = h('input.glow-range.nb-vol', { type: 'range', min: '0', max: '1', step: '0.01', value: '0.85', 'aria-label': 'Song volume', title: 'Song volume' });
const sVolBox = h('div.nb-volbox', null, sVolIcon, sVol);
let sPre = null;
sVol.oninput = () => {
  sPre = null;
  stage.setSongLevel(Number(sVol.value));
  paintVol();
};
sVolIcon.onclick = () => {
  if (stage.songLevel() > 0.01) {
    sPre = stage.songLevel();
    stage.setSongLevel(0);
  } else stage.setSongLevel(sPre || 0.85);
  sVol.value = String(stage.songLevel());
  paintVol();
};
function paintVol() {
  const v = stage.songLevel();
  if (document.activeElement !== sVol) sVol.value = String(v);
  sVol.style.setProperty('--p', `${Math.round(v * 100)}%`);
  sVolIcon.innerHTML = icon(v > 0.01 ? 'volume' : 'volumeOff');
  sVolBox.classList.toggle('silent', v <= 0.01);
  sVolBox.title = v <= 0.01 ? 'The song is turned all the way down' : `Song volume ${Math.round(v * 100)}%`;
}
const empty = h('div.nb-empty', { text: 'Nothing playing. Pick a song in Songs, or just play: your guitar is live.' });
bar.append(art, text, playBtn, prog, sVolBox, openBtn, empty);

text.onclick = () => N.song && setPage('now');
openBtn.onclick = () => N.song && setPage('now');
playBtn.onclick = () => stage.toggle();
wave.addEventListener('mousemove', (e) => {
  const r = wave.getBoundingClientRect();
  N.hover = (e.clientX - r.left) / r.width;
  draw();
});
wave.addEventListener('mouseleave', () => {
  N.hover = null;
  draw();
});
wave.addEventListener('click', (e) => {
  const r = wave.getBoundingClientRect();
  const d = stage.duration();
  if (d) stage.seekTo(((e.clientX - r.left) / r.width) * d);
});

function renderBar() {
  const song = stage.current();
  N.song = song;
  const has = !!song;
  for (const el of [art, text, playBtn, prog, sVolBox, openBtn]) el.hidden = !has;
  empty.hidden = has;
  if (!has) return;
  const key=song.id+'|'+String(song.art||'');
  if(art.dataset.key!==key){art.dataset.key=key;harvest(art);art.replaceChildren(h('span.halo',{style:{'--gel':songGel(song)}}),coverEl(song,96));}
  const part = stage.partLabel();
  text.innerHTML = `<b>${esc(song.title)}</b><span>${esc(song.artist || '')}${part ? ` · ${esc(part)}` : ''}</span>`;
  draw();
}

function draw() {
  if (bar.hidden || !N.song || state.page === 'now') return;
  const peaks = stage.mixPeaks();
  if (peaks && N.binsFor !== peaks) {
    N.bins = overview(peaks, 700);
    N.binsFor = peaks;
  }
  if (!peaks) N.bins = null;
  const d = stage.duration() || 0;
  const t = stage.engine.position || 0;
  tNow.textContent = fmtTime(t);
  tEnd.textContent = fmtTime(d);
  const loop = stage.loop();
  drawBars(wave, N.bins, d ? t / d : 0, { loop: loop && d ? [loop.start / d, loop.end / d] : null, hover: N.hover });
  // only swap the icon when it changes: replacing it mid-click loses the click
  paintVol();
  const pl = !!stage.engine.playing;
  if (N.shownPlaying !== pl) {
    N.shownPlaying = pl;
    playBtn.innerHTML = icon(pl ? 'pause' : 'play');
    playBtn.setAttribute('aria-label', pl ? 'Pause' : 'Play');
  }
}

function tick() {
  N.raf = 0;
  draw();
  if (stage.engine.playing) N.raf = requestAnimationFrame(tick);
}
function kick() {
  if (!N.raf) N.raf = requestAnimationFrame(tick);
}
stage.engine.addEventListener('state', () => {
  draw();
  kick();
  if (stage.engine.playing) warnSilent();
});
// If something is turned all the way down, say so once (with a one-click fix),
// instead of leaving you hunting for the right slider.
const warned = { song: false, you: false };
function warnSilent() {
  if (stage.songLevel() <= 0.01 && !warned.song) {
    warned.song = true;
    toast({ title: 'Song volume is at 0', kind: 'info', timeout: 7000, actions: [{ label: 'Turn it up', onClick: () => stage.setSongLevel(0.85) }] });
  }
  if (stage.songLevel() > 0.01) warned.song = false;
}
function warnGuitar() {
  const v = rig.knobs.volume ?? 0.7;
  if (rig.on && !rig.muted && v <= 0.02 && !warned.you) {
    warned.you = true;
    toast({ title: 'Guitar volume is at 0', kind: 'info', timeout: 7000, actions: [{ label: 'Turn it up', onClick: () => stage.setYou(0.7) }] });
  }
  if (v > 0.02) warned.you = false;
}
stage.engine.addEventListener('seek', draw);
on('playing', renderBar);
on('stage-song', renderBar);
on('stage-loaded', () => {
  N.binsFor = null;
  draw();
});
on('page', () => draw());
new ResizeObserver(() => draw()).observe(bar);
renderBar();

// ---------------------------------------------------------- guitar card --
const card = h('div.guitar-card');
guitarCardHost.append(card);
const G = { meter: null, raf: 0 };

export function guitarStatus() {
  if (rig.on) {
    const how = rig.kind === 'native' ? (rig.info && rig.info.mode === 'exclusive' ? 'direct' : 'shared output') : 'in-app engine';
    return { cls: rig.muted ? 'warn' : '', title: rig.muted ? 'Guitar muted' : 'Guitar ready', line: `${esc((rig.info && rig.info.inName) || 'Rocksmith cable')} → ${esc((rig.info && rig.info.outName) || 'your speakers')}`, sub: `${rig.latencyMs ? `${rig.latencyMs} ms delay · ` : ''}${how}` };
  }
  if (rig.status === 'starting' || rig._starting) return { cls: 'warn', title: 'Starting your guitar…', line: 'Opening the Rocksmith cable', sub: '' };
  if (rig.status === 'error') return { cls: 'err', title: 'Guitar didn’t start', line: esc(rig.error || 'The sound engine stopped.'), sub: 'Trying again in a moment' };
  return { cls: 'idle', title: 'Plug in your Rocksmith cable', line: 'Your guitar starts by itself when it’s connected.', sub: '' };
}

function renderCard() {
  // don't rebuild under a slider that's being dragged
  if (card.contains(document.activeElement) && document.activeElement.tagName === 'INPUT') return;
  const s = guitarStatus();
  card.className = `guitar-card${s.cls ? ` ${s.cls}` : ''}`;
  card.innerHTML = '';
  const mute = h('button.icon-btn', { type: 'button', title: rig.muted ? 'Unmute your guitar' : 'Mute your guitar', 'aria-label': 'Mute guitar', 'aria-pressed': String(!!rig.muted), html: icon(rig.muted ? 'volumeOff' : 'volume') });
  mute.onclick = () => rig.setMuted(!rig.muted);
  const top = h('div.gc-top', null, h(`span.dot${rig.on && !rig.muted ? '.glow' : ''}`), h('span', { text: s.title }));
  if (rig.on) top.append(mute);
  card.append(top);
  if (s.line || s.sub) card.append(h('div.gc-text', { html: `${s.line}${s.sub ? `<br>${s.sub}` : ''}` }));
  // 4.11: nothing plugged in: the cable shows the way
  if (s.cls === 'idle') card.append(h('img.gc-cable', { src: 'art/scraps/guitar-cable-arrow.avif', alt: '', draggable: false }));
  // 4.11: the tuner, one press away on every page (someone went an hour without finding it)
  if (rig.on) {
    const tb = h('button.gc-tuner', { type: 'button', title: 'Open the tuner (U)' }, h('span', { html: icon('tuning') }), h('span', { text: 'Tuner' }), h('kbd', { text: 'U' }));
    tb.onclick = async () => (await import('./tuner.js')).openTuner();
    card.append(tb);
  }
  G.meter = null;
  if (rig.on) {
    const m = h('div.meter-bar', null, h('i'));
    G.meter = m;
    card.append(m);
    // your guitar's level, always one slide away
    const v = rig.knobs.volume ?? 0.7;
    const vol = h('input.glow-range.gc-vol', { type: 'range', min: '0', max: '1', step: '0.01', value: String(v), 'aria-label': 'Your guitar volume', title: 'Your guitar volume', style: { '--g': '#ff6b3d', '--p': `${Math.round(v * 100)}%` } });
    vol.oninput = () => {
      stage.setYou(Number(vol.value));
      vol.style.setProperty('--p', `${Math.round(Number(vol.value) * 100)}%`);
    };
    vol.onchange = () => {
      vol.blur();
      renderCard();
    };
    const row = h('label.gc-vol-row', { title: 'Your guitar volume' }, h('span.gc-vol-ic', { html: icon(v > 0.02 ? 'volume' : 'volumeOff') }), vol);
    row.classList.toggle('silent', v <= 0.02);
    card.append(row);
    meterLoop();
    warnGuitar();
  }
}

let smooth = 0;
function meterLoop() {
  if (G.raf) return;
  const stepFn = () => {
    G.raf = 0;
    if (!G.meter || !rig.on) return;
    const l = rig.levels();
    const v = Math.min(1, Math.sqrt(l.input || 0) * 1.6);
    smooth = v > smooth ? smooth + (v - smooth) * 0.6 : smooth + (v - smooth) * 0.12;
    G.meter.firstChild.style.transform = `scaleX(${smooth.toFixed(3)})`;
    G.meter.classList.toggle('clip', !!l.clip);
    G.raf = requestAnimationFrame(stepFn);
  };
  G.raf = requestAnimationFrame(stepFn);
}
rig.addEventListener('change', renderCard);
renderCard();
