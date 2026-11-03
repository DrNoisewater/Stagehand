/**
 * Getting started (4.1.2): a short, skippable walk-through for someone who has
 * never played Rocksmith or used CustomsForge. What you need, what a song file
 * is, getting ready for songs (a songs folder when there's no Rocksmith, watching
 * Downloads), downloading a first song, and reading the highway. Offered once on
 * a fresh install with no songs; always in the menu as "Getting started".
 */
import { api } from './api.js';
import { state, bus, setPage } from './store.js';
import { h, icon, esc, modal, toast } from './ui.js';
import { rig } from './rig.js';

const btn = (label, { iconName, cls = '', onClick } = {}) => {
  const b = h(`button.btn${cls ? '.' + cls : ''}`, { type: 'button', html: `${iconName ? icon(iconName) : ''}<span>${esc(label)}</span>` });
  if (onClick) b.addEventListener('click', onClick);
  return b;
};
const p = (text) => h('p', { text });
const steps = (...items) => h('ol.how-steps', null, ...items.map(([b, t]) => h('li', null, h('b', { text: b }), h('span', { text: t }))));
const status = (ok, text) => h(`div.gs-status${ok ? '.ok' : ''}`, null, h('span.gs-dot'), h('span', { text }));

const STRINGS = [
  ['#ff4b55', 'red', 'the thickest string (low E on a guitar)'],
  ['#ffcf3a', 'yellow', 'the next one (A)'],
  ['#3da5ff', 'blue', 'D'],
  ['#ff9a3c', 'orange', 'G'],
  ['#45d07c', 'green', 'B (guitar only)'],
  ['#b67dff', 'purple', 'the thinnest string (high E, guitar only)'],
];

let open = null;

/** Songs already sitting in Downloads (downloaded before watching was on): add them. */
async function lookNow() {
  try {
    const r = await api.imports.scanPC();
    const paths = (r.found || []).map((f) => f.path);
    if (!paths.length) return toast({ title: 'No new songs in Downloads', message: 'Song files end in .psarc. A .zip can be dragged onto Stagehand.', kind: 'info' });
    const { importFiles } = await import('./discover.js');
    await importFiles(paths);
  } catch (e) {
    toast({ title: 'Couldn’t look for songs', message: e.message, kind: 'err' });
  }
}

/** Opens the guide (at the first step, or where you left it this session). */
export function openGuide({ step = null } = {}) {
  if (open) return open.go(step ?? open.at);
  let at = step ?? 0;
  const side = h('nav.gs-steps');
  const body = h('div.gs-body');
  const back = btn('Back', { cls: 'ghost' });
  const next = btn('Next', { cls: 'primary' });
  const skip = btn('Not now', { cls: 'ghost' });
  const offs = [];
  const m = modal({
    title: 'Getting started',
    wide: true,
    body: h('div.gs', null, side, body),
    footer: [skip, h('span.grow'), back, next],
    onClose: () => {
      offs.forEach((f) => f());
      open = null;
      api.settings.set({ ui: { guideSeen: true } }).catch(() => {});
    },
  });
  m.el?.classList?.add('gs-modal');
  skip.onclick = () => m.close();
  back.onclick = () => go(at - 1);
  next.onclick = () => (at >= PAGES.length - 1 ? m.close() : go(at + 1));
  // live bits (the cable, songs arriving) redraw the page you're on
  let alive = true;
  offs.push(() => (alive = false));
  const redraw = () => alive && go(at);
  rig.addEventListener('change', redraw);
  offs.push(() => rig.removeEventListener('change', redraw));
  bus.addEventListener('library', redraw);
  offs.push(() => bus.removeEventListener('library', redraw));

  function go(i) {
    at = Math.max(0, Math.min(PAGES.length - 1, i));
    side.innerHTML = '';
    PAGES.forEach((pg, j) => {
      const b = h(`button.gs-step${j === at ? '.on' : ''}${j < at ? '.done' : ''}`, { type: 'button', html: `<i>${j < at ? icon('check') : j + 1}</i><span>${esc(pg.title)}</span>` });
      b.onclick = () => go(j);
      side.append(b);
    });
    body.innerHTML = '';
    body.append(h('h3', { text: PAGES[at].title }), PAGES[at].draw({ close: () => m.close(), go }));
    back.disabled = at === 0;
    next.querySelector('span').textContent = at === PAGES.length - 1 ? 'Done' : 'Next';
    skip.hidden = at === PAGES.length - 1;
  }
  open = { go, get at() { return at; } };
  go(at);
}

/** First time only: a fresh install with no songs gets the guide (with "Not now"). */
export function offerGuide() {
  const ui = (state.settings && state.settings.ui) || {};
  if (ui.guideSeen || state.songs.size) return;
  openGuide();
}

const PAGES = [
  {
    title: 'Welcome',
    draw: () =>
      h(
        'div',
        null,
        p('Stagehand teaches you songs on your real guitar or bass. The notes come toward you on a moving “highway”, you play them, and Stagehand listens and tells you how you did.'),
        p('You don’t need the Rocksmith game. You need your instrument, a cable, and some song files. This guide takes about five minutes and you can leave it any time: it’s always under Getting started in the menu.'),
        steps(['Plug in', 'Connect your guitar or bass with the cable.'], ['Get songs', 'Make a free CustomsForge account and download a song.'], ['Play', 'Open the song, tune up, and play along.'])
      ),
  },
  {
    title: 'Your guitar',
    draw: () =>
      h(
        'div',
        null,
        p('Stagehand uses the Rocksmith Real Tone Cable: one end goes in your guitar or bass like a normal cable, the other into a USB port on your PC. (It’s sold on its own; you don’t need the game.)'),
        p('Plug it in and Stagehand finds it by itself. You hear yourself through your PC speakers or headphones, with an amp sound already set up.'),
        rig.on ? status(true, 'Your instrument is connected. Strum a string: you should hear it.') : status(false, 'No cable found yet. Plug it in; this turns green when Stagehand hears it.'),
        h('p.fine', { text: 'Too loud, too quiet, or a delay? Settings › Guitar & audio has the input level and the “fastest” sound mode.' })
      ),
  },
  {
    title: 'What a song file is',
    draw: () =>
      h(
        'div',
        null,
        p('Each Rocksmith song is one file ending in .psarc. It holds the music and the notes for guitar and bass.'),
        p('Fans make songs that aren’t in the game and share them for free. They’re called custom songs (or CDLC), and CustomsForge is the big site where they’re shared. Its song search is called Ignition.'),
        steps(['Make an account', 'CustomsForge needs a free account before you can download. Sign up once.'], ['PC files', 'Pick the PC version when there’s a choice. PC files usually end in _p.psarc; Mac files end in _m.psarc and won’t work.'], ['ZIP files', 'Now and then a song comes as a .zip. Drag the .zip onto the Stagehand window and it takes the songs out for you.']),
        h('div.gs-actions', null, btn('Open CustomsForge', { iconName: 'external', cls: 'primary', onClick: () => api.discover.customsforge({ open: true }).catch(() => {}) })),
        h('p.fine', { text: 'CustomsForge doesn’t allow apps to download for you, so you download in your web browser and Stagehand picks it up from there.' })
      ),
  },
  {
    title: 'Get ready for songs',
    draw: () => {
      const box = h('div');
      box.append(p('Stagehand watches your Downloads folder: when a song finishes downloading, it moves it into your library by itself. If you have the Rocksmith game, songs go into the game too.'));
      const st = h('div', null, status(false, 'Checking…'));
      const go = btn('Set it up for me', { cls: 'primary', iconName: 'check' });
      go.onclick = async () => {
        go.disabled = true;
        try {
          const r = await api.imports.readySongs();
          if (r.made) toast({ title: 'Made a songs folder', message: r.made, kind: 'ok' });
          show(r);
        } catch (e) {
          toast({ title: 'Couldn’t set it up', message: e.message, kind: 'err' });
        }
        go.disabled = false;
      };
      const show = (s) => {
        st.innerHTML = '';
        const ready = s && s.watch && s.target;
        st.append(
          ready ? status(true, `Ready. New songs in ${s.watchDir} go to ${s.target.path}${s.target.game ? ' (your Rocksmith songs)' : ''}.`) : status(false, s && s.target ? 'Downloads aren’t being watched yet.' : 'Stagehand doesn’t have a place for songs yet.')
        );
        go.hidden = !!ready;
      };
      api.imports.status().then(show).catch(() => show(null));
      box.append(st, h('div.gs-actions', null, go));
      box.append(h('p.fine', { text: 'You can change these folders any time in Discover › Imports.' }));
      return box;
    },
  },
  {
    title: 'Download your first song',
    draw: () => {
      const n = state.songs.size;
      const box = h(
        'div',
        null,
        p('Pick a song you know and like, and not too fast. Then:'),
        steps(['Search', 'In Ignition, type the artist or song in the search box.'], ['Download', 'Click the song, then the download button. Some songs open a file site (like Google Drive): press download there too.'], ['Wait a moment', 'When the download finishes, Stagehand adds it and says so in the corner.']),
        h('div.gs-actions', null, btn('Open CustomsForge', { iconName: 'external', cls: 'primary', onClick: () => api.discover.customsforge({ open: true }).catch(() => {}) }), btn('Look in Downloads now', { iconName: 'search', onClick: lookNow })),
        n ? status(true, `You have ${n} song${n === 1 ? '' : 's'}. On to playing!`) : status(false, 'No songs yet. This turns green when the first one arrives.'),
        h('p.fine', { text: 'Tip: Discover (in the menu) suggests songs by artists you like and keeps a Wanted list.' })
      );
      return box;
    },
  },
  {
    title: 'Tune up and play',
    draw: ({ close }) =>
      h(
        'div',
        null,
        steps(['Open a song', 'Go to Songs and double-click one. Pick Lead, Rhythm or Bass at the top.'], ['Tune', 'If the song needs a different tuning, Stagehand shows which string to tune to which note. On the highway, press U for the tuner.'], ['Play along', 'Play each note as it reaches the line nearest you. Slow the song down with the speed buttons, and loop a hard part as many times as you like.']),
        h('h4', { text: 'Reading the highway' }),
        p('The highway is like looking down your guitar neck. Each string has a colour, the same everywhere in Stagehand:'),
        h('ul.gs-strings', null, ...STRINGS.map(([c, name, what]) => h('li', null, h('i', { style: { background: c } }), h('b', { text: name }), h('span', { text: what })))),
        p('The number on a note is the fret to press (0 means play the string open). Wide shapes are chords. A long tail means let the note ring; a curve means bend the string.'),
        h('div.gs-actions', null, btn('Go to Songs', { iconName: 'library', cls: 'primary', onClick: () => (close(), setPage('songs')) }))
      ),
  },
  {
    title: 'More to try',
    draw: () =>
      h(
        'div',
        null,
        steps(
          ['Jam', 'Drums and a looper to play along with, no song needed.'],
          ['Stems', 'Stagehand can split a song into guitar, bass, drums and vocals, so you can turn the guitar down and play the part yourself. The first time takes a while to set up.'],
          ['Tones', 'Amp sounds for your instrument. Keys 1–9 switch between them while you play.'],
          ['Recordings', 'Record a video of yourself on the highway, or loops and takes from Jam.'],
          ['Progress', 'How much you’ve played and how your songs are coming along.']
        ),
        p('That’s it. Have fun, and play slowly at first: speed comes by itself.')
      ),
  },
];
