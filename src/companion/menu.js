/**
 * 4.19: the menu inside the headset: everything you'd otherwise take the headset off for. Four pages
 * (Songs, Playing, Placement, View) on one panel, laid out here as big buttons (at arm's length a
 * button is 4 cm or more), pressed with a finger, a pinch or a controller. Pure: what's on the panel
 * and where; vr.js paints it and does what's pressed. test/companion-menu.test.mjs checks it.
 */
export const W = 1024; // the panel's picture, in pixels
export const H = 768;
export const ROWS = 5; // songs on one page
export const TABS = [
  { id: 'songs', label: 'Songs' },
  { id: 'play', label: 'Playing' },
  { id: 'place', label: 'Placement' },
  { id: 'view', label: 'View' },
];
export const SORTS = [
  { id: 'artist', label: 'Artist' },
  { id: 'title', label: 'Title' },
  { id: 'recent', label: 'Recent' },
];
export const LETTERS = '#ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
const PART_ORDER = { lead: 0, combo: 1, rhythm: 2, bass: 3 };

/** The menu's own state (which page, which order, how far down the list). */
export function menuModel() {
  return { tab: 'songs', sort: 'artist', top: 0, letters: false, placeWhat: 'highway' };
}

const words = (s) => String(s || '').replace(/^(the|a|an)\s+/i, '');
const cmp = (a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' });

/** The songs in the menu's order. recent: { id: when picked in the headset } (the PC's own last-played counts too). */
export function sortSongs(songs, sort, recent = {}) {
  const list = (songs || []).slice();
  if (sort === 'title') list.sort((a, b) => cmp(words(a.title), words(b.title)) || cmp(a.artist || '', b.artist || ''));
  else if (sort === 'recent') {
    const when = (s) => Math.max(Number(recent[s.id]) || 0, Number(s.played) || 0);
    // played ones first (latest first), then the newest added
    list.sort((a, b) => when(b) - when(a) || (Number(b.added) || 0) - (Number(a.added) || 0) || cmp(a.title || '', b.title || ''));
  } else list.sort((a, b) => cmp(words(a.artist), words(b.artist)) || cmp(words(a.title), words(b.title)));
  return list;
}
/** The letter a song is filed under in this order (# for numbers and the rest). */
export function letterOf(song, sort) {
  const c = words(sort === 'title' ? song.title : song.artist).trim().charAt(0).toUpperCase();
  return c >= 'A' && c <= 'Z' ? c : '#';
}
/** The first song filed under a letter (or -1). */
export function jumpTo(list, sort, letter) {
  return list.findIndex((s) => letterOf(s, sort) === letter);
}
/** Keeps the list's top row on the list. */
export function clampTop(top, count) {
  return Math.max(0, Math.min(Math.max(0, count - ROWS), Math.floor(top) || 0));
}
/** The parts in a sensible order: lead, rhythm, bass, then bonus ones. */
export function orderParts(list) {
  return (list || []).slice().sort((a, b) => (a.bonus ? 1 : 0) - (b.bonus ? 1 : 0) || (PART_ORDER[a.type] ?? 9) - (PART_ORDER[b.type] ?? 9));
}
/** A part's name on its button: "Lead", "Bass", a bonus one by its own name. */
export function partLabel(p) {
  const base = { lead: 'Lead', combo: 'Lead', rhythm: 'Rhythm', bass: 'Bass' }[p.type] || p.name || 'Part';
  if (!p.bonus) return base;
  return p.name && p.name.toLowerCase() !== base.toLowerCase() ? `${p.name} (bonus)` : `${base} (bonus)`;
}

const fmt = (t) => {
  t = Math.max(0, t || 0);
  const m = Math.floor(t / 60);
  return `${m}:${String(Math.floor(t - m * 60)).padStart(2, '0')}`;
};
const pctOf = (s) => `${Math.round((s || 1) * 100)}%`;

/**
 * What's on the panel now. ctx: { list (sorted songs), songId, title, artist, playing, pos, len,
 * parts, partId, speed, prefs, canPassthrough, handsSeen, aside, phase }.
 * → buttons [{ id, x, y, w, h, kind, label, sub, on, off }]; kind: tab, btn, primary, row, label, bar, value.
 * `off` buttons are drawn dimmed and do nothing.
 */
export function layout(m, c) {
  const out = [];
  const b = (id, x, y, w, h, kind, label, more = {}) => out.push({ id, x, y, w, h, kind, label, ...more });
  TABS.forEach((t, i) => b(`tab:${t.id}`, 16 + i * 228, 16, 216, 84, 'tab', t.label, { on: m.tab === t.id }));
  b('close', 932, 16, 76, 84, 'btn', '✕', { sub: '' });
  const p = c.prefs || {};
  if (m.tab === 'songs') {
    const list = c.list || [];
    SORTS.forEach((s, i) => b(`sort:${s.id}`, 16 + i * 180, 116, 170, 64, 'btn', s.label, { on: m.sort === s.id }));
    if (m.letters) {
      const have = new Set(list.map((s) => letterOf(s, m.sort)));
      b('info', 560, 116, 448, 64, 'label', 'Jump to a letter');
      LETTERS.forEach((L, i) => {
        const col = i % 7;
        const row = Math.floor(i / 7);
        b(`letter:${L}`, 16 + col * 122, 196 + row * 140, 114, 132, 'btn', L, { off: !have.has(L) });
      });
    } else {
      const top = clampTop(m.top, list.length);
      b('info', 560, 116, 448, 64, 'label', list.length ? `${top + 1}–${Math.min(list.length, top + ROWS)} of ${list.length}` : 'No songs yet');
      for (let i = 0; i < ROWS && top + i < list.length; i++) {
        const s = list[top + i];
        b(`song:${s.id}`, 16, 196 + i * 112, 840, 104, 'row', s.title || 'Untitled', { sub: [s.artist, s.year].filter(Boolean).join(' · '), on: s.id === c.songId, parts: s.parts || [] });
      }
    }
    b('up', 872, 196, 136, 176, 'btn', '▲', { off: m.letters || clampTop(m.top, list.length) <= 0 });
    b('letters', 872, 384, 136, 180, 'btn', m.letters ? 'Back' : 'A–Z', { on: m.letters });
    b('down', 872, 576, 136, 172, 'btn', '▼', { off: m.letters || clampTop(m.top, list.length) >= Math.max(0, list.length - ROWS) });
  } else if (m.tab === 'play') {
    const has = !!c.songId;
    b('info', 16, 116, 700, 90, 'label', has ? c.title || '' : 'No song yet', { sub: has ? c.artist || '' : 'Pick one on the Songs page', big: true });
    b('time', 724, 116, 284, 90, 'label', has ? `${fmt(c.pos)} / ${fmt(c.len)}` : '', { right: true, sub: c.phase === 'loading' ? 'Opening on the PC…' : c.phase === 'error' ? 'Didn’t open on the PC' : '' });
    b('bar', 16, 214, 992, 60, 'bar', '', { value: c.len ? Math.min(1, Math.max(0, c.pos / c.len)) : 0, off: !has });
    b('restart', 16, 290, 220, 120, 'btn', 'Start over', { off: !has });
    b('back10', 248, 290, 200, 120, 'btn', '−10 s', { off: !has });
    b('play', 460, 290, 300, 120, 'primary', c.playing ? 'Pause' : 'Play', { off: !has });
    b('fwd10', 772, 290, 236, 120, 'btn', '+10 s', { off: !has });
    b('partLabel', 16, 430, 116, 100, 'label', 'Part');
    const parts = orderParts(c.parts).slice(0, 5);
    if (parts.length) {
      const w = (868 - (parts.length - 1) * 12) / parts.length;
      parts.forEach((pt, i) => b(`part:${pt.id}`, 140 + i * (w + 12), 430, w, 100, 'btn', partLabel(pt), { on: pt.id === c.partId && !c.aside, sub: pt.tuning || '', type: pt.type }));
    } else b('noParts', 140, 430, 868, 100, 'label', has ? 'The parts show once the song is open on the PC' : '');
    b('speedLabel', 16, 550, 116, 92, 'label', 'Speed');
    b('speed-', 140, 550, 110, 92, 'btn', '−', { off: !has });
    b('speedVal', 256, 550, 140, 92, 'value', pctOf(c.speed));
    b('speed+', 402, 550, 110, 92, 'btn', '+', { off: !has });
    b('speed1', 524, 550, 160, 92, 'btn', '100%', { off: !has, on: (c.speed || 1) === 1 });
    b('timingLabel', 16, 656, 240, 92, 'label', 'Note timing', { sub: 'for the headset' });
    b('offsetVal', 256, 656, 180, 92, 'value', p.offset ? `${p.offset > 0 ? '+' : ''}${p.offset} ms` : '0 ms');
    b('sooner', 448, 656, 270, 92, 'btn', 'Notes sooner');
    b('later', 730, 656, 278, 92, 'btn', 'Notes later');
  } else if (m.tab === 'place') {
    b('what:highway', 16, 116, 240, 64, 'btn', 'Highway', { on: m.placeWhat !== 'guitar' });
    b('what:guitar', 268, 116, 300, 64, 'btn', 'Guitar outline', { on: m.placeWhat === 'guitar' });
    const cm = (v) => `${Math.round(Math.abs(v) * 100)} cm`;
    const rows =
      m.placeWhat === 'guitar'
        ? [
            ['g:y', 'Height', `${cm(p.guitar.y)} below your eyes`, 'Lower', 'Higher'],
            ['g:z', 'Distance', `${cm(p.guitar.z)} in front`, 'Nearer', 'Farther'],
            ['g:x', 'Left or right', p.guitar.x < 0 ? `${cm(p.guitar.x)} to the left` : `${cm(p.guitar.x)} to the right`, 'Left', 'Right'],
            ['g:angle', 'Angle', `${Math.round(p.guitar.angle)}°`, 'Flatter', 'Steeper'],
          ]
        : [
            ['h:height', 'Height', `${cm(p.height)} below your eyes`, 'Lower', 'Higher'],
            ['h:dist', 'Distance', `${cm(p.dist)} in front`, 'Nearer', 'Farther'],
            ['h:tilt', 'Tilt', `${Math.round(p.tilt)}° towards you`, 'Flatter', 'Steeper'],
            ['h:size', 'Size', `${Math.round((p.size || 1) * 100)}%`, 'Smaller', 'Bigger'],
          ];
    rows.forEach(([key, label, val, minus, plus], i) => {
      const y = 196 + i * 104;
      b(`${key}Label`, 16, y, 300, 92, 'label', label, { sub: val });
      b(`${key}-`, 330, y, 330, 92, 'btn', minus);
      b(`${key}+`, 672, y, 336, 92, 'btn', plus);
    });
    if (m.placeWhat === 'guitar') b('match', 16, 616, 640, 132, 'primary', 'Line it up with my hand', { sub: c.handsSeen ? 'fretting hand on the 5th fret' : 'needs your hands in view', off: !c.handsSeen });
    else b('front', 16, 616, 640, 132, 'primary', 'Put it in front of me', { sub: 'where you’re facing now' });
    b(m.placeWhat === 'guitar' ? 'resetGuitar' : 'resetHighway', 668, 616, 340, 132, 'btn', 'Start over', { sub: 'the first spot' });
  } else if (m.tab === 'view') {
    const opts = (id, y, label, sub, list, off) => {
      b(`${id}Label`, 16, y, 420, 104, 'label', label, { sub });
      const w = (560 - (list.length - 1) * 12) / list.length;
      list.forEach(([v, text, on], i) => b(`${id}:${v}`, 448 + i * (w + 12), y, w, 104, 'btn', text, { on, off }));
    };
    opts('pass', 116, 'Your room', c.canPassthrough ? 'passthrough' : 'this browser can’t show it', [['off', 'Hidden', !c.passthrough], ['on', 'Shown', !!c.passthrough]], !c.canPassthrough);
    opts('guitar', 236, 'Guitar outline', 'shown when your room is hidden', [['off', 'Off', !p.guitar.on], ['on', 'On', !!p.guitar.on]]);
    opts('hands', 356, 'Your hands', 'while a song plays', [['bright', 'Bright', p.hands === 'bright'], ['dim', 'Dim', p.hands === 'dim'], ['faint', 'Faint', p.hands === 'faint']]);
    b('exit', 16, 600, 992, 140, 'primary', c.leaving ? 'Press again to leave' : 'Leave VR', { sub: c.leaving ? 'or wait and nothing happens' : 'back to the page', warn: true });
  }
  return out;
}

/** The button under a point on the panel (pixels), or null. Dimmed ones and words don't count. */
export function hit(buttons, x, y) {
  for (let i = buttons.length - 1; i >= 0; i--) {
    const k = buttons[i];
    if (k.off || k.kind === 'label' || k.kind === 'value') continue;
    if (x >= k.x && x <= k.x + k.w && y >= k.y && y <= k.y + k.h) return k;
  }
  return null;
}
