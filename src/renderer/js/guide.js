/**
 * Getting started (4.1.2, grown into a full tour in 4.1.6): a skippable
 * walk-through in three parts.
 *  - Get set up: what you need, song files, getting ready for songs, a first
 *    song, tuning up and the timing check.
 *  - Play a song: reading the highway and its controls; stems and the mix.
 *  - Around Stagehand: one page per menu section (Songs, Jam, Tones,
 *    Progress, Discover, Backstage), then the keys.
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
      if (pg.group && (j === 0 || PAGES[j - 1].group !== pg.group)) side.append(h('div.gs-group', { text: pg.group }));
      const b = h(`button.gs-step${j === at ? '.on' : ''}${j < at ? '.done' : ''}`, { type: 'button', html: `<i>${j < at ? icon('check') : j + 1}</i><span>${esc(pg.title)}</span>` });
      b.onclick = () => go(j);
      side.append(b);
    });
    body.innerHTML = '';
    body.scrollTop = 0;
    const ctx = { close: () => m.close(), go, at };
    body.append(h('div.gs-count', { text: `${PAGES[at].group || ''}${PAGES[at].group ? ' · ' : ''}step ${at + 1} of ${PAGES.length}` }), h('h3', { text: PAGES[at].title }), PAGES[at].draw(ctx));
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
  // 4.1.6: you saw the short guide (or already have songs): the tour of every section is new
  if ((ui.guideVersion || 1) < 2) {
    api.settings.set({ ui: { guideVersion: 2 } }).catch(() => {});
    toast({
      title: 'New: a tour of Stagehand',
      message: 'Getting started now shows every part of Stagehand: stems, muting parts, the tuner, the timing check, Jam and more. Two minutes, any time.',
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
    const ring = h('div.gs-ring');
    const tip = h('div.gs-tip', { role: 'dialog', 'aria-label': 'Getting started' });
    const backBtn = btn('Back to the guide', { cls: 'ghost', onClick: () => (clearSpot(), openGuide({ step: from })) });
    const done = btn(show.next === false ? 'Got it' : 'Next step', { cls: 'primary', onClick: () => (clearSpot(), show.next === false ? null : openGuide({ step: Math.min(from + 1, PAGES.length - 1) })) });
    tip.append(h('b', { text: show.title || PAGES[from].title }), h('p', { text: show.tip }), h('div.gs-tip-actions', null, backBtn, done));
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
      const below = r.bottom + 14 + 170 < window.innerHeight;
      const left = Math.max(12, Math.min(window.innerWidth - tw - 12, r.left + r.width / 2 - tw / 2));
      const top = below ? r.bottom + 14 : Math.max(12, r.top - 14 - tip.offsetHeight);
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

const PAGES = [
  {
    group: 'Get set up',
    title: 'Welcome',
    draw: ({ go }) =>
      h(
        'div',
        null,
        p('Stagehand teaches you songs on your real guitar or bass. The notes come toward you on a moving “highway”, you play them, and Stagehand listens and tells you how you did.'),
        p('You don’t need the Rocksmith game. You need your instrument, a cable, and some song files. This guide takes about ten minutes and you can leave it any time: it’s always under Getting started in the menu.'),
        steps(['Plug in', 'Connect your guitar or bass with the cable.'], ['Get songs', 'Make a free CustomsForge account and download a song.'], ['Play', 'Open the song, tune up, and play along.']),
        p('Then a quick tour: the highway, stems (mute any part of a song), and every section in the menu. Each page has a Show me button that takes you there.'),
        h('div.gs-actions', null, btn('I’m set up: show me around', { iconName: 'compass', onClick: () => go(TOUR) }))
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
    title: 'Tune up',
    draw: (ctx) =>
      h(
        'div',
        null,
        p('Each song is made for a tuning: most are E Standard, some are Drop D, E♭ Standard and so on. Stagehand remembers what your instrument is tuned to and tells you before you play when a song needs something else.'),
        steps(
          ['The tuner follows the song', 'Open the tuner (on the Jam page, or press U on the highway or in the tab view) and it’s already set to the tuning the song needs. Play one open string at a time; the string lights up and the needle shows how close you are. Pick another tuning in its menu if you like; the next song sets it back.'],
          ['Or let the Drop do it', 'When a song is the same tuning, just lower (E♭ or D Standard, Drop C from Drop D), the Drop lowers your sound for you: no retuning. Click “Match the song” in Master Settings, or turn on Match on the Jam page and it follows every song.'],
          ['String by string', 'For a different tuning (E Standard to Drop D, say), the tuning guide lists which strings to change and listens as you go: Master Settings › Tuning guide.']
        ),
        h('h4', { text: 'The timing check (calibration)' }),
        p('Every PC’s sound arrives a little late. If notes you play on time count as late or missed, run the timing check: a short, easy song of its own on the highway, a few notes on the top three strings. Play along like any song and Stagehand lines the highway up with how you play. It takes about 30 seconds and you only do it once.'),
        p('Stagehand offers it by itself if it can hear you playing but lots of notes aren’t counting. It’s also under Tools › Timing check on the highway, and in Master Settings.'),
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
        h('h4', { text: 'Your input level' }),
        p('The other calibration: on the Jam page press Set input level and strum as hard as you play for 4 seconds. Stagehand sets your level so it hears every note, quiet or loud. Do it once, and again if you change guitars.')
      ),
  },
  {
    group: 'Play a song',
    title: 'The highway',
    draw: () =>
      h(
        'div',
        null,
        p('Double-click a song (or select it and press Play along) to open the highway. Pick Lead, Rhythm or Bass at the top.'),
        p('The highway is like looking down your guitar neck. Each string has a colour, the same everywhere in Stagehand:'),
        h('ul.gs-strings', null, ...STRINGS.map(([c, name, what]) => h('li', null, h('i', { style: { background: c } }), h('b', { text: name }), h('span', { text: what })))),
        p('The number on a note is the fret to press (0 means play the string open). Wide shapes are chords. A long tail means let the note ring; a curve means bend the string; a wavy tail is vibrato.'),
        h('h4', { text: 'Along the top' }),
        steps(
          ['Play, time and speed', 'Space plays and pauses. The speed chip slows the song down (try 70 % on something new) or speeds it up to 150 %, without changing its pitch. [ and ] change it too. ← and → skip 5 seconds.'],
          ['Sections', 'The strip of sections (Intro, Verse, Chorus…): click one to jump there, or its ⟲ to repeat it until you’ve got it. L repeats the section you’re in.'],
          ['Tab, Highway, Waveform', 'Switch views any time; T shows the tab.'],
          ['Tools', 'Score attack (a full run for points), Record a video clip, and the Timing check.'],
          ['Master Settings', 'The pull-out tab on the side: the mix (turn the song, the guitar or any stem up and down), the Drop and tuning, lyrics, chord names, the score card and more.']
        ),
        p('At the end you get a score card: how each section went and what to practise. Click a section to repeat it. Back (or Esc, or your mouse’s back button) returns to your songs.'),
      ),
  },
  {
    title: 'Stems: mute any part',
    show: { title: 'Split stems', at: [() => [...document.querySelectorAll('#inspector button')].find((b) => /stems/i.test(b.textContent)), '#inspector'], go: pickASong, tip: 'Select a song, then press Split stems here. It works in the background; the coloured bars next to the song fill in when its stems are ready.' },
    draw: () =>
      h(
        'div',
        null,
        p('Stagehand can pull a song apart into its instruments: guitar, bass, drums, vocals, keys and everything else. These are called stems. Then you can mute the guitar and play the part yourself, solo the bass to hear it clearly, or turn the vocals down.'),
        steps(
          ['Split a song', 'Select a song and press Split stems (or right-click songs › Split stems; it can do many at once). The first time, Stagehand sets up the splitter: a one-off download of about 1–3 GB.'],
          ['Wait a little', 'A song takes under a minute on an NVIDIA graphics card, a few minutes without one. Keep playing while it works; Songs › Stems ready lists every song that has them.'],
          ['Mute and solo', 'Play the song and open the Waveform view: each stem has its own lane with M (mute) and S (solo) and a volume. Shift+1 to Shift+6 mutes a stem from the keyboard.'],
          ['On the highway', 'Master Settings › Mix has a slider for each stem, your guitar and the whole song. Stagehand remembers your mix for each song.']
        ),
        h('p.fine', { text: 'M switches between the full song and your stems mix. Stems stay on your PC; nothing is uploaded.' })
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
          ['Search', 'Ctrl+F or click the search box. Suggestions come up as you type, even with a typo; pick a song to jump to it, or an artist to see all of theirs.'],
          ['Click to filter', 'Click an artist, album, year or tuning in the list to see the songs that share it. The L R B V letters show only songs with that part.'],
          ['Your lists', 'Favorites (the heart), Recently added and played, Stems ready, Your level (mastered, getting there, learning), Tunings, Artists, and your own setlists: press + by Setlists, then drag songs onto it.'],
          ['One click, two clicks', 'Click a song to see it on the right (parts, tuning, Edit details, Split stems, rating). Double-click to play along; Just listen plays it without the highway.'],
          ['Tidy up', 'List or Tiles at the top; the ⋯ menu finds duplicate songs and keeps the best copy.']
        )
      ),
  },
  {
    title: 'Jam',
    show: { title: 'Jam', at: '#page-play .slots', go: () => setPage('play'), tip: 'Your tone slots: keys 1–9 switch between them as you play. Above: Set input level, Choose song and Play over song. Below: the rig, the tuner, the Drop, drums and the looper.' },
    draw: () =>
      h(
        'div',
        null,
        p('Play without the highway: the page Stagehand opens on.'),
        steps(
          ['Tone slots', 'Nine sounds, keys 1–9. Click a piece of the rig (pedals, amp, cabinet) to turn its knobs; Edit this tone saves your changes.'],
          ['Set input level', 'Strum as hard as you play for 4 seconds and Stagehand sets your level (Rocksmith’s calibration). Do it once when you start; notes are heard better.'],
          ['Play over a song', 'Choose song, then Play over song: the song’s stems become your backing band with your part muted (Mute guitar or Mute bass).'],
          ['Tuner and Drop', 'The tuner follows the tuning you’re in, or the song you last opened. The Drop lowers your sound without retuning; Match follows each song.'],
          ['Drums & metronome', 'Pick a beat (Click, Rock, Shuffle, Metal…) and a tempo, and play along.'],
          ['Looper', 'Press Record, play, press Stop: it loops straight away. Overdub to add layers; it locks to the drums when they’re on.'],
          ['Record video', 'Records you jamming, with the sound. Find it Backstage, under My clips.'],
          ['Visualizer', 'Open visualizer (or J) for a full screen with a moving background that reacts to what you play.']
        )
      ),
  },
  {
    title: 'Tones',
    show: { title: 'Create tone', at: ['.tw-create', '.tones-tabs'], go: () => setPage('tones'), tip: 'Create tone walks you through making your own sound, live as you play. Below it: My tones, From my songs (every tone in your songs) and Presets.' },
    draw: () =>
      h(
        'div',
        null,
        p('Every amp sound you can use. Play your instrument while browsing and you hear each one live.'),
        steps(
          ['My tones, From my songs, Presets', 'The three tabs. Songs bring their own tones; Stagehand switches to the song’s tone as you play (unless you pick one).'],
          ['Create tone', 'The easiest way to make your own: pick guitar or bass, a starting sound, the amp, the cabinet, turn the knobs and save it to a key. You hear every choice live as you play. On the Tones and Jam pages, and in the highway’s tone menu.'],
          ['Edit and save', 'Change any knob, rename it, put it in a slot (2–9).'],
          ['Real amps', 'Recordings of real amps (from TONE3000, free account). Create tone can get every one of them, whatever songs you have; From my songs › Get all gets the ones your songs use.']
        )
      ),
  },
  {
    title: 'Progress',
    show: { title: 'Progress', at: '#page-progress', go: () => setPage('progress'), tip: 'How long you’ve played, your streak, the songs you’re working on, and how each section is going.' },
    draw: () =>
      h(
        'div',
        null,
        p('Stagehand keeps track as you play: time played, your streak of days, accuracy, and the songs you’re working on with each section’s score, so you can see what to practise next. Your best for each song also shows as a small badge next to its title.')
      ),
  },
  {
    title: 'Discover',
    show: { title: 'Discover', at: '.nav-section[data-page="discover"]', go: () => setView({ kind: 'discover', id: 'search' }), tip: 'Search any artist, see what you’re missing, keep a Wanted list, and watch your Downloads.' },
    draw: () =>
      h(
        'div',
        null,
        steps(
          ['Search', 'Any artist or song in the world (MusicBrainz), with which ones you already have.'],
          ['Collection gaps', 'Albums and songs by artists you like that you don’t have yet.'],
          ['Wanted', 'Your list of songs to get. One click copies the name and opens CustomsForge.'],
          ['Imports', 'Which folders Stagehand watches for new downloads, and where songs go.']
        )
      ),
  },
  {
    title: 'Backstage',
    show: { title: 'Backstage', at: '.nav-section[data-page="greenroom"]', go: () => setPage('greenroom'), tip: 'Your clips, the clips other players show, and your messages.' },
    draw: () =>
      h(
        'div',
        null,
        steps(
          ['Video clips', 'On the highway, Tools › Record a video clip records you playing along, with the sound. Jam can record too. Each clip remembers the song, the part and your tone.'],
          ['My clips', 'Everything you’ve recorded, looper takes too. Play, rename, delete, or show the file.'],
          ['Show it', 'Press Show backstage on a video and everyone with Stagehand can watch it while your Stagehand is open. Pick a name the first time.'],
          ['Everyone', 'See who’s here and what they’ve shown. Watch a clip, try or keep their tone, open the song if you have it, or message them.']
        )
      ),
  },
  {
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
            ['← →', 'Back / forward 5 s (Shift: 15 s)'],
            ['H', 'Open the highway'],
            ['T', 'Tab view'],
            ['U', 'Tuner on the highway and in the tab view'],
            ['L', 'Repeat this section'],
            ['D', 'The Drop on or off'],
            ['M', 'Full song or your stems mix'],
            ['1–9', 'Tone slots'],
            ['Shift+1–6', 'Mute a stem'],
            ['J', 'Full-screen Jam'],
            ['Ctrl+F', 'Search'],
            ['Ctrl+,', 'Settings'],
            ['Esc / mouse back', 'Back'],
          ].map(([k, w]) => h('li', null, h('kbd', { text: k }), h('span', { text: w })))
        ),
        p('That’s everything. Play slowly at first: speed comes by itself. This guide is always under Getting started in the menu.'),
        h('div.gs-actions', null, btn('Go to my songs', { iconName: 'library', cls: 'primary', onClick: () => (close(), setPage('songs')) }), btn('Jam', { iconName: 'guitar', onClick: () => (close(), setPage('play')) }))
      ),
  },
];

/** Where the tour of the sections starts (for people who've done the setup). */
const TOUR = PAGES.findIndex((pg) => pg.title === 'The highway');
