import { decorativeImage } from './menu-art.js';
import { scrap } from './cameo.js';
/**
 * Getting started (4.1.2, a full tour in 4.1.6, cut down and brought up to
 * date in 4.17.1): a skippable walk-through in four parts. Every page is
 * short: a line or two and at most four steps.
 *  - Get set up: welcome, the cable, getting songs, tuning up.
 *  - Play a song: everything in Stagehand on one page of cards (each jumps
 *    to its page), the highway, stems.
 *  - Around Stagehand: Songs, Jam, Tones and Gear, Progress, Discover,
 *    Backstage.
 *  - More to try: Sing and Karaoke (auto-tune, voice changer), Piano, the
 *    Quest headset, then the keys.
 * The list on the left shows only the part you're in; the others fold to
 * one line each.
 * Every tour page has "Show me": the guide steps aside, goes there and rings
 * the control it's talking about, with a way back to the same page.
 * Offered once on a fresh install with no songs; people who saw the old,
 * shorter guide get one note that the tour is new. Always in the menu.
 */
import { api } from './api.js';
import { state, bus, setPage, setView, setSelection } from './store.js';
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
  const cameo = decorativeImage('guide', 'roadshow-guide-art', {next:true});
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
  m.el?.classList?.add('gs-modal', 'panel-modal');
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
    // only the part you're in is listed in full; the others are one line each (less to take in)
    const cur = PAGES[at].group;
    const mine = PAGES.filter((pg) => pg.group === cur);
    PAGES.forEach((pg, j) => {
      const first = j === 0 || PAGES[j - 1].group !== pg.group;
      if (pg.group !== cur) {
        if (!first) return;
        const n = PAGES.filter((x) => x.group === pg.group).length;
        const g = h(`button.gs-group.gs-group-btn${j < at ? '.done' : ''}`, { type: 'button', html: `<span>${esc(pg.group)}</span><i>${j < at ? icon('check') : n}</i>` });
        g.onclick = () => go(j);
        side.append(g);
        return;
      }
      if (first) side.append(h('div.gs-group.on', { text: pg.group }));
      const k = mine.indexOf(pg);
      const b = h(`button.gs-step${j === at ? '.on' : ''}${j < at ? '.done' : ''}`, { type: 'button', html: `<i>${j < at ? icon('check') : k + 1}</i><span>${esc(pg.title)}</span>` });
      b.onclick = () => go(j);
      side.append(b);
    });
    side.append(cameo);
    body.innerHTML = '';
    body.scrollTop = 0;
    const ctx = { close: () => m.close(), go, at };
    body.append(h('div.gs-count', { text: `${cur} · ${mine.indexOf(PAGES[at]) + 1} of ${mine.length}` }), h('h3', { text: PAGES[at].title }), PAGES[at].draw(ctx));
    if (PAGES[at].show) body.append(h('div.gs-actions.gs-show', null, btn('Show me', { iconName: 'compass', cls: 'primary', onClick: () => showMe(PAGES[at].show, at, () => m.close()) })));
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
  if (!ui.guideSeen && !state.songs.size) return openGuide();
  // 4.17.1: the tour is shorter and has the newer things (singing, auto-tune, piano, the headset)
  if ((ui.guideVersion || 1) < 3) {
    api.settings.set({ ui: { guideVersion: 3 } }).catch(() => {});
    toast({
      title: 'Getting started has a new tour',
      message: 'Everything in Stagehand on one page, then a short page for each: singing with auto-tune, piano, the Quest headset and more. Dip in any time.',
      kind: 'info',
      timeout: 16000,
      actions: [{ label: 'Take the tour', onClick: () => openGuide({ step: TOUR }) }],
    });
  }
}

// ------------------------------------------------------------ "Show me" --
// The guide steps aside, opens the right place and rings the control it was
// talking about, with a short note and a way back to the same page.
let spot = null;
function clearSpot() {
  if (!spot) return;
  spot.ring.remove();
  spot.tip.remove();
  window.removeEventListener('resize', spot.place);
  document.removeEventListener('keydown', spot.key, true);
  spot.offPage();
  spot = null;
}
function showMe(show, from, closeGuide) {
  closeGuide();
  clearSpot();
  try {
    show.go && show.go();
  } catch (_) {}
  setTimeout(() => {
    const find = (a) => (typeof a === 'function' ? a() : document.querySelector(a));
    const el = [].concat(show.at).map(find).find((x) => x && x.getClientRects().length);
    const ring = h('div.gs-ring.marker'); // 4.9: a blue marker circle drawn round it
    const tip = h('div.gs-tip', { role: 'dialog', 'aria-label': 'Getting started' });
    const backBtn = btn('Back to the guide', { cls: 'ghost', onClick: () => (clearSpot(), openGuide({ step: from })) });
    const done = btn(show.next === false ? 'Got it' : 'Next step', { cls: 'primary', onClick: () => (clearSpot(), show.next === false ? null : openGuide({ step: Math.min(from + 1, PAGES.length - 1) })) });
    tip.append(scrap('white-chalk-arrow', { cls: 'gs-arrow', enter: 'slap', delay: 400 }) || '', h('b', { text: show.title || PAGES[from].title }), h('p', { text: show.tip }), h('div.gs-tip-actions', null, backBtn, done));
    document.body.append(ring, tip);
    const place = () => {
      const r = el ? el.getBoundingClientRect() : null;
      ring.hidden = !r;
      if (r) Object.assign(ring.style, { left: `${r.left - 6}px`, top: `${r.top - 6}px`, width: `${r.width + 12}px`, height: `${r.height + 12}px` });
      const tw = Math.min(360, window.innerWidth - 24);
      tip.style.width = `${tw}px`;
      if (!r) {
        Object.assign(tip.style, { left: `${(window.innerWidth - tw) / 2}px`, top: '90px' });
        return;
      }
      const below = r.bottom + 70 + 170 < window.innerHeight;
      const left = Math.max(12, Math.min(window.innerWidth - tw - 12, r.left + r.width / 2 - tw / 2));
      const top = below ? r.bottom + 70 : Math.max(12, r.top - 70 - tip.offsetHeight);
      tip.dataset.side = below ? 'below' : 'above';
      tip.style.setProperty('--ax', `${Math.round(Math.max(30, Math.min(tw - 30, r.left + r.width / 2 - left)))}px`);
      Object.assign(tip.style, { left: `${left}px`, top: `${top}px` });
    };
    if (el) el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    place();
    requestAnimationFrame(place);
    const key = (e) => {
      if (e.key === 'Escape') {
        clearSpot();
        e.stopPropagation();
      }
    };
    const onPage = () => setTimeout(place, 50);
    bus.addEventListener('page', onPage);
    spot = { ring, tip, place, key, offPage: () => bus.removeEventListener('page', onPage) };
    window.addEventListener('resize', place);
    document.addEventListener('keydown', key, true);
  }, 380);
}

/** A song to point at (the selected one, else the first in your list), selected. */
function pickASong() {
  setPage('songs');
  const id = [...state.selection][0] || (state.songs.size ? [...state.songs.keys()][0] : null);
  if (id && !state.selection.has(id)) setSelection([id], { anchor: id, focus: id });
}

/** Opens Settings on one of its pages (the guide steps aside). */
const openSettings = (tab) => import('./dialogs.js').then((m) => m.settings(tab)).catch(() => {});

/** Everything in Stagehand on one page: a card each, one line, click to read more. */
const OVERVIEW = [
  ['highway', 'Play along', 'Notes come down the highway; Stagehand listens and scores you.', 'The highway'],
  ['split', 'Stems', 'Mute the guitar, solo the bass, take the singer out.', 'Stems: mute any part'],
  ['library', 'Songs', 'Your library: search, lists, your best scores.', 'Songs'],
  ['guitar', 'Jam', 'Just play: tones, tuner, drums and a looper.', 'Jam'],
  ['tones', 'Tones and Gear', 'Amps and pedals you can turn, and tones of your own.', 'Tones and Gear'],
  ['mic', 'Sing and Karaoke', 'Sing any song, with auto-tune and funny voices.', 'Sing and Karaoke'],
  ['piano', 'Piano', 'Play any song on a USB keyboard, with sheet music.', 'Piano'],
  ['chart', 'Progress', 'Levels, streaks and what to practise next.', 'Progress'],
  ['compass', 'Discover', 'Find new songs and keep a Wanted list.', 'Discover'],
  ['people', 'Backstage', 'Record clips and show them to other players.', 'Backstage'],
  ['globe', 'Quest headset', 'Play with the highway in front of you in VR.', 'Quest headset'],
];

const PAGES = [
  {
    group: 'Get set up',
    title: 'Welcome',
    draw: ({ go }) =>
      h(
        'div',
        null,
        p('Stagehand teaches you songs on your real guitar or bass. The notes come toward you on a moving “highway”, you play them, and Stagehand listens and tells you how you did.'),
        steps(['Plug in', 'Connect your guitar or bass with the cable.'], ['Get songs', 'Download a song, or use the ones you have.'], ['Play', 'Open the song, tune up, and play along.']),
        p('That’s the whole setup: four short pages. After that there’s a tour you can dip into whenever you like. Leave any time; this guide is always under Getting started in the menu.'),
        h('div.gs-actions', null, btn('I’m set up: show me what’s here', { iconName: 'compass', onClick: () => go(TOUR) }))
      ),
  },
  {
    group: 'Get set up',
    title: 'Your guitar',
    draw: () =>
      h(
        'div',
        null,
        p('Stagehand uses the Rocksmith Real Tone Cable: one end goes in your guitar or bass like a normal cable, the other into a USB port on your PC. You don’t need the game.'),
        p('Plug it in and Stagehand finds it by itself. You hear yourself through your PC speakers or headphones, with an amp sound already set up.'),
        rig.on ? status(true, 'Your instrument is connected. Strum a string: you should hear it.') : status(false, 'No cable found yet. Plug it in; this turns green when Stagehand hears it.'),
        h('p.fine', { text: 'Too loud, too quiet, or a delay? Settings › Guitar & audio has the input level and the “fastest” sound mode.' })
      ),
  },
  {
    group: 'Get set up',
    title: 'Get songs',
    draw: () => {
      const n = state.songs.size;
      const box = h('div');
      box.append(p('Songs are files ending in .psarc. Fans make them for free and share them on a site called CustomsForge (free account). Stagehand watches your Downloads folder and adds each song by itself.'));
      const st = h('div', null, status(false, 'Checking…'));
      const set = btn('Set it up for me', { cls: 'primary', iconName: 'check' });
      set.onclick = async () => {
        set.disabled = true;
        try {
          const r = await api.imports.readySongs();
          if (r.made) toast({ title: 'Made a songs folder', message: r.made, kind: 'ok' });
          show(r);
        } catch (e) {
          toast({ title: 'Couldn’t set it up', message: e.message, kind: 'err' });
        }
        set.disabled = false;
      };
      const show = (s) => {
        st.innerHTML = '';
        const ready = s && s.watch && s.target;
        st.append(ready ? status(true, `Ready. New songs in ${s.watchDir} go to ${s.target.path}${s.target.game ? ' (your Rocksmith songs)' : ''}.`) : status(false, s && s.target ? 'Downloads aren’t being watched yet.' : 'Stagehand doesn’t have a place for songs yet.'));
        set.hidden = !!ready;
      };
      api.imports.status().then(show).catch(() => show(null));
      box.append(
        st,
        h('div.gs-actions', null, set),
        steps(['Search', 'On CustomsForge, type an artist or song you know. Pick something not too fast.'], ['Download', 'Press download. Pick the PC version when there’s a choice.'], ['It arrives', 'Stagehand adds it and says so in the corner.']),
        h('div.gs-actions', null, btn('Open CustomsForge', { iconName: 'external', cls: 'primary', onClick: () => api.discover.customsforge({ open: true }).catch(() => {}) }), btn('Look in Downloads now', { iconName: 'search', onClick: lookNow })),
        n ? status(true, `You have ${n} song${n === 1 ? '' : 's'}. On to playing!`) : status(false, 'No songs yet. This turns green when the first one arrives.'),
        h('p.fine', { text: 'A song that comes as a .zip: drag it onto the Stagehand window. Already have Rocksmith songs? Add their folder in Settings › Library.' })
      );
      return box;
    },
  },
  {
    group: 'Get set up',
    title: 'Tune up',
    draw: (ctx) =>
      h(
        'div',
        null,
        p('Stagehand tells you before you play when a song needs a different tuning.'),
        steps(
          ['The tuner', 'Press U (or the Tuner button, top right). It’s already set to what the song needs: play one string at a time and follow the needle.'],
          ['The Drop', 'For songs tuned lower (E♭, D…), the Drop lowers your sound for you, so you don’t retune. Press D.'],
          ['The timing check', 'If notes you play on time count as late, run this once: a 30-second song that lines the highway up with your playing.']
        ),
        h(
          'div.gs-actions',
          null,
          btn('Do the timing check now', {
            iconName: 'clock',
            onClick: async () => {
              ctx.close();
              (await import('./stage.js')).openTimingCheck();
            },
          })
        ),
        h('p.fine', { text: 'One more for later: Set input level on the Jam page. Strum hard for 4 seconds and Stagehand hears every note, quiet or loud.' })
      ),
  },
  {
    group: 'Play a song',
    title: 'What’s in Stagehand',
    draw: ({ go }) =>
      h(
        'div',
        null,
        p('Everything on one page. Click anything to read about it, or just press Next.'),
        h(
          'div.gs-cards',
          null,
          ...OVERVIEW.map(([ic, name, line, to]) => {
            const b = h('button.gs-card', { type: 'button', html: `${icon(ic)}<b>${esc(name)}</b><span>${esc(line)}</span>` });
            b.onclick = () => go(PAGES.findIndex((pg) => pg.title === to));
            return b;
          })
        ),
        h('p.fine', { text: 'Every page has a Show me button that takes you to the real thing and circles it.' })
      ),
  },
  {
    group: 'Play a song',
    title: 'The highway',
    draw: () =>
      h(
        'div',
        null,
        p('Double-click a song to open the highway, and pick Lead, Rhythm or Bass at the top. It’s like looking down your guitar neck. Each string has a colour:'),
        h('ul.gs-strings', null, ...STRINGS.map(([c, name, what]) => h('li', null, h('i', { style: { background: c } }), h('b', { text: name }), h('span', { text: what })))),
        p('The number on a note is the fret to press (0 is the open string). Wide shapes are chords; a long tail means let it ring.'),
        steps(
          ['Slow it down', 'The speed chip at the top: try 70 % on something new. The pitch stays the same.'],
          ['Repeat a part', 'Click a section (Verse, Chorus…) to jump there, or press L to repeat it until you’ve got it.'],
          ['Tools', 'Score attack, record a video clip, and the timing check.'],
          ['Master Settings', 'The pull-out tab on the side: the mix, tuning, lyrics, chord names and more.']
        ),
        p('At the end, a score card shows how each section went and what to practise.')
      ),
  },
  {
    group: 'Play a song',
    title: 'Stems: mute any part',
    show: { title: 'Split stems', at: [() => [...document.querySelectorAll('#inspector button')].find((b) => /stems/i.test(b.textContent)), '#inspector'], go: pickASong, tip: 'Select a song, then press Split stems here. It works in the background; the coloured bars next to the song fill in when its stems are ready.' },
    draw: () =>
      h(
        'div',
        null,
        p('Stagehand can pull a song apart into guitar, bass, drums, vocals, keys and the rest. These are stems. Mute the guitar and play it yourself, or solo the bass to hear it clearly.'),
        steps(
          ['Split a song', 'Select a song and press Split stems. The first time, Stagehand downloads its splitter (1–3 GB, once).'],
          ['Keep playing', 'It works in the background: under a minute with an NVIDIA graphics card, a few minutes without.'],
          ['Mute and solo', 'On the highway, Master Settings › Mix has a slider for every stem. Your mix is remembered for each song.']
        ),
        h('p.fine', { text: 'Stems stay on your PC; nothing is uploaded.' })
      ),
  },
  {
    group: 'Around Stagehand',
    title: 'Songs',
    show: { title: 'Search', at: '.titlebar .search', go: () => setView({ kind: 'all' }), tip: 'Type here from anywhere: songs, artists, albums and tunings come up as you type. Tab finishes a name, ↑ ↓ and Enter pick one, Esc clears it.' },
    draw: () =>
      h(
        'div',
        null,
        p('Every song you have, with its parts, tuning, length and your best score.'),
        steps(
          ['Search', 'Ctrl+F, then type. It forgives typos.'],
          ['Click to filter', 'Click an artist, album or tuning in the list to see the songs that share it.'],
          ['Your lists', 'Favorites, Recently played, Stems ready, and your own setlists: press + by Setlists and drag songs onto it.'],
          ['One click, two clicks', 'Click a song to see it on the right. Double-click to play along.']
        )
      ),
  },
  {
    group: 'Around Stagehand',
    title: 'Jam',
    show: { title: 'Jam', at: '#page-play .slots', go: () => setPage('play'), tip: 'Your tone slots: keys 1–9 switch between them as you play. Above: Set input level, Choose song and Play over song. Below: the rig, the tuner, the Drop, drums and the looper.' },
    draw: () =>
      h(
        'div',
        null,
        p('Play without a song: the page Stagehand opens on.'),
        steps(
          ['Tone slots', 'Nine sounds on keys 1–9. Click a pedal, the amp or the cabinet to turn its knobs.'],
          ['Play over a song', 'Choose a song and it becomes your backing band, with your part taken out.'],
          ['Drums and looper', 'Pick a beat and a tempo. Record a riff and it loops straight away; add layers on top.'],
          ['Full screen', 'Press J for a moving background that reacts to what you play.']
        )
      ),
  },
  {
    group: 'Around Stagehand',
    title: 'Tones and Gear',
    show: { title: 'Create tone', at: ['.tw-create', '.tones-tabs'], go: () => setPage('tones'), tip: 'Create tone walks you through making your own sound, live as you play. Below it: My tones, From my songs (every tone in your songs) and Presets.' },
    draw: () =>
      h(
        'div',
        null,
        p('Every sound you can use. Play while you browse and you hear each one live.'),
        steps(
          ['Songs bring their tones', 'Stagehand switches to the song’s own tone as you play, unless you pick one.'],
          ['Create tone', 'Build your own on a pedalboard: pick pedals, an amp and a cabinet, turn the knobs, save it to a key.'],
          ['Gear', 'Its own page in the menu: every amp, cabinet and pedal as a photo with knobs that turn, and what real gear it’s based on.'],
          ['Real amps', 'Recordings of real amps in place of the built-in ones (free TONE3000 account). Set up once in Settings › Real amps.']
        )
      ),
  },
  {
    group: 'Around Stagehand',
    title: 'Progress',
    show: { title: 'Progress', at: '#page-progress', go: () => setPage('progress'), tip: 'How long you’ve played, your streak, the songs you’re working on, and how each section is going.' },
    draw: () =>
      h(
        'div',
        null,
        p('Stagehand keeps track as you play, so you can see yourself getting better.'),
        steps(
          ['Levels', 'Playing well earns points. Levels open new venues, trophies and titles.'],
          ['Streaks and challenges', 'Your run of days, plus something to aim at each day and week.'],
          ['Song mastery', 'How each song and each section is going, and what to practise next.']
        )
      ),
  },
  {
    group: 'Around Stagehand',
    title: 'Discover',
    show: { title: 'Discover', at: '.nav-section[data-page="discover"]', go: () => setView({ kind: 'discover', id: 'search' }), tip: 'Search any artist, see what you’re missing, keep a Wanted list, and watch your Downloads.' },
    draw: () =>
      h(
        'div',
        null,
        p('Where new songs come from.'),
        steps(
          ['Search', 'Any artist or song, with the ones you already have marked.'],
          ['What you’re missing', 'Albums and songs by artists you like that you don’t have yet.'],
          ['Wanted and Find', 'Keep a list of songs to get. Find opens CustomsForge searching for that song, and what you download lands in your library.']
        )
      ),
  },
  {
    group: 'Around Stagehand',
    title: 'Backstage',
    show: { title: 'Backstage', at: '.nav-section[data-page="greenroom"]', go: () => setPage('greenroom'), tip: 'Your clips, the clips other players show, and your messages.' },
    draw: () =>
      h(
        'div',
        null,
        p('Record yourself and see what other players are up to.'),
        steps(
          ['Record a clip', 'On the highway: Tools › Record a video clip. Jam can record too.'],
          ['My clips', 'Everything you’ve recorded, with the song, the part and your tone.'],
          ['Show it', 'Press Show backstage on a clip and everyone with Stagehand can watch it. Try their tones, or message them.']
        )
      ),
  },
  {
    group: 'More to try',
    title: 'Sing and Karaoke',
    show: { title: 'Karaoke', at: '.nav-section[data-page="karaoke"]', go: () => setPage('karaoke'), tip: 'Every song with words. Click one to sing it. The wand at the top is auto-tune and the voice changer.' },
    draw: () =>
      h(
        'div',
        null,
        p('Any microphone works: USB, a headset, a webcam. It stays off until you press it.'),
        steps(
          ['Sing along', 'Press Sing on the highway. The words become a lane with a bar for every syllable and a dot for your voice, and your singing gets its own score.'],
          ['Karaoke', 'Its own page in the menu: pick a song and sing with the words big and the singer taken out.'],
          ['Auto-tune', 'Hear your voice lifted onto the song’s notes: Natural, Pop, or Hard tune (the T-Pain sound).'],
          ['Voice changer', 'Sing as a deep voice, a giant, a high voice or a chipmunk.']
        ),
        h('p.fine', { text: 'Auto-tune and the voices are on the strip of tape on the singing lane. Headphones are best.' })
      ),
  },
  {
    group: 'More to try',
    title: 'Piano',
    draw: ({ close }) =>
      h(
        'div',
        null,
        p('Plug a digital piano or keyboard in by USB and play any song on it.'),
        steps(
          ['Press Piano', 'On the highway. Stagehand writes a piano part from the song itself: the tune, the chords, the bass line.'],
          ['Read it your way', 'Real sheet music on top, glowing notes falling onto a keyboard below.'],
          ['Take it easy', 'Easy, Medium or Hard; one hand or both. Every note is scored.']
        ),
        h('div.gs-actions', null, btn('Pick my keyboard in Settings', { iconName: 'piano', onClick: () => (close(), openSettings('guitar')) }))
      ),
  },
  {
    group: 'More to try',
    title: 'Quest headset',
    draw: ({ close }) =>
      h(
        'div',
        null,
        p('Have a Meta Quest? Play with the highway in front of you and the venue all around you. Your guitar and the sound stay on the PC.'),
        steps(
          ['Switch it on', 'Settings › Quest headset. It shows an address and a 4-digit code.'],
          ['In the headset', 'Open the Browser, type the address, then the code. Nothing to install.'],
          ['Play', 'Pick a song in the headset or on the PC, then Enter VR, or Passthrough to see your room.']
        ),
        h('div.gs-actions', null, btn('Open Settings › Quest headset', { iconName: 'globe', onClick: () => (close(), openSettings('quest')) })),
        h('p.fine', { text: 'The headset must be on the same home network as the PC.' })
      ),
  },
  {
    group: 'More to try',
    title: 'Keys and you’re set',
    draw: ({ close }) =>
      h(
        'div',
        null,
        h(
          'ul.gs-keys',
          null,
          ...[
            ['Space', 'Play / pause'],
            ['← →', 'Back / forward 5 s'],
            ['[ ]', 'Slower / faster'],
            ['L', 'Repeat this section'],
            ['T', 'Tab view'],
            ['U', 'Tuner'],
            ['D', 'The Drop on or off'],
            ['1–9', 'Tone slots'],
            ['J', 'Full-screen Jam'],
            ['Ctrl+F', 'Search'],
            ['Esc', 'Back'],
          ].map(([k, w]) => h('li', null, h('kbd', { text: k }), h('span', { text: w })))
        ),
        p('That’s everything. Play slowly at first: speed comes by itself.'),
        h('div.gs-actions', null, btn('Go to my songs', { iconName: 'library', cls: 'primary', onClick: () => (close(), setPage('songs')) }), btn('Jam', { iconName: 'guitar', onClick: () => (close(), setPage('play')) }))
      ),
  },
];

/** Where the tour starts (for people who've done the setup): everything on one page. */
const TOUR = PAGES.findIndex((pg) => pg.title === 'What’s in Stagehand');
