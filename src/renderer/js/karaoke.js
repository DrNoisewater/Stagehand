/**
 * Karaoke (4.12, reworked in 4.14): a page of its own on the left. Every song of yours
 * that has words. Click a song anywhere and you're singing it: the words big up top,
 * no neck and no notes, the singer taken out when the song has been split. The small
 * play button on the cover just plays it, here, without leaving the page.
 *
 * Each card says at a glance whether the singer can be taken out (stems split), how
 * hard it is to sing (read from its lyric chart: syllables a minute, how wide the
 * tune goes, how far it jumps) and your best score.
 */
import { state, on, hasPart, setSelection } from './store.js';
import { h, icon, showMenu } from './ui.js';
import { api } from './api.js';
import * as actions from './actions.js';
import { coverEl } from './shell.js';
import { mic } from './mic.js';
import { SING_LEVELS } from './sing.js';
import { singLevel, setSingLevel, tuneLabel, tuneMenu } from './singlane.js';
import { autotune } from './autotune.js';

const root = document.getElementById('page-karaoke');
const MOST = 240; // cards drawn at once; search narrows it
const PREF_KEY = 'stagehand.karaoke';
const DIFF_KEY = 'stagehand.vocalDiff.v1';
const DIFF_NAMES = ['Easy', 'Steady', 'Medium', 'Hard', 'Brutal'];
let q = '';

const load = (k, d) => {
  try {
    return JSON.parse(localStorage.getItem(k)) || d;
  } catch {
    return d;
  }
};
const prefs = { show: 'all', sort: 'artist', ...load(PREF_KEY, {}) };
const savePrefs = () => {
  try {
    localStorage.setItem(PREF_KEY, JSON.stringify(prefs));
  } catch {}
};

// ---- how hard each song is to sing: worked out once per file, kept between runs ----
const diffs = load(DIFF_KEY, {});
const diffKey = (s) => `${s.id}|${s.mtimeMs || 0}`;
const diffOf = (s) => diffs[diffKey(s)];
let saveTimer = 0;
const saveDiffs = () => {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      localStorage.setItem(DIFF_KEY, JSON.stringify(diffs));
    } catch {}
  }, 800);
};
const queue = [];
const queued = new Set();
let running = 0;
function wantDiff(s) {
  const k = diffKey(s);
  if (k in diffs || queued.has(k) || !(api.tab && api.tab.vocals)) return;
  queued.add(k);
  queue.push(s);
  pump();
}
function pump() {
  while (running < 2 && queue.length) {
    const s = queue.shift();
    running++;
    api.tab
      .vocals(s.id)
      .then((d) => (diffs[diffKey(s)] = d ? { level: d.level, rate: d.rate, range: d.range } : 0))
      .catch(() => (diffs[diffKey(s)] = 0))
      .finally(() => {
        running--;
        queued.delete(diffKey(s));
        saveDiffs();
        paintDiff(s);
        pump();
      });
  }
}
const seen = new IntersectionObserver(
  (entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      seen.unobserve(e.target);
      const s = state.songs.get(e.target.dataset.id);
      if (s) wantDiff(s);
    }
  },
  { root, rootMargin: '300px' }
);

function diffHtml(s) {
  const d = diffOf(s);
  if (d === undefined) return '<span class="kk-diff wait" title="Working out how hard it is to sing"><i></i><i></i><i></i><i></i><i></i></span>';
  if (!d) return '<span class="kk-diff none" title="Its words have no timing to judge by">—</span>';
  const pips = DIFF_NAMES.map((_, i) => `<i${i < d.level ? ' class="on"' : ''}></i>`).join('');
  const why = `How hard it is to sing: ${DIFF_NAMES[d.level - 1]}. About ${d.rate} syllables a minute${d.range ? `, the tune spans ${d.range} semitones` : ''}.`;
  return `<span class="kk-diff" data-level="${d.level}" title="${why}">${pips}<em>${DIFF_NAMES[d.level - 1]}</em></span>`;
}
function paintDiff(s) {
  const el = root.querySelector(`.kk-card[data-id="${CSS.escape(s.id)}"] .kk-diff`);
  if (el) el.outerHTML = diffHtml(s);
}

// ---- the list ----
const bestOf = (s) => {
  const b = state.best && state.best[s.id] ? state.best[s.id].vocals : undefined;
  return b === undefined || b === null ? null : b;
};

function allSung() {
  return [...state.songs.values()].filter((s) => hasPart(s, 'vocals'));
}

function songs() {
  const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const by = (a, b, k) => String(a[k] || '').localeCompare(String(b[k] || ''));
  const lvl = (s) => (diffOf(s) ? diffOf(s).level : 9);
  const sorts = {
    artist: (a, b) => by(a, b, 'artist') || by(a, b, 'title'),
    title: (a, b) => by(a, b, 'title') || by(a, b, 'artist'),
    easy: (a, b) => lvl(a) - lvl(b) || by(a, b, 'artist') || by(a, b, 'title'),
    hard: (a, b) => (lvl(b) % 9) - (lvl(a) % 9) || by(a, b, 'artist') || by(a, b, 'title'),
    best: (a, b) => (bestOf(b) ?? -1) - (bestOf(a) ?? -1) || by(a, b, 'artist'),
  };
  return allSung()
    .filter((s) => prefs.show === 'all' || (prefs.show === 'split' ? actions.stemPhase(s) === 'ready' : actions.stemPhase(s) !== 'ready'))
    .filter((s) => !words.length || words.every((w) => `${s.title || ''} ${s.artist || ''} ${s.album || ''}`.toLowerCase().includes(w)))
    .sort(sorts[prefs.sort] || sorts.artist);
}

function stemTag(s) {
  const p = actions.stemPhase(s);
  if (p === 'ready') return h('span.kk-stem.ready', { title: 'Split: the singer is taken out, so it’s just you and the band', html: `${icon('check')}<span>Singer out</span>` });
  if (p === 'working') return h('span.kk-stem.working', { title: 'Splitting now: the singer will be taken out', html: `<i></i><span>Splitting</span>` });
  return h('span.kk-stem.none', { title: 'Not split yet: you’ll sing over the original singer. Right-click › Split stems to take them out.', html: `<span>With singer</span>` });
}

function card(s) {
  const best = bestOf(s);
  const el = h('div.kk-card', { role: 'button', tabindex: '0', title: `Sing ${s.title || 'this song'}`, 'aria-label': `Sing ${s.title || 'this song'} by ${s.artist || 'unknown artist'}` });
  el.dataset.id = s.id;
  el.dataset.stems = actions.stemPhase(s);
  const listen = h('button.kk-listen', { type: 'button', title: 'Just play it (stay here)', 'aria-label': `Play ${s.title || 'this song'}`, html: icon('play') });
  listen.dataset.listen = '';
  const cov = h('div.kk-cov', null, coverEl(s, 256), stemTag(s), h('span.kk-mic-big', { html: icon('mic'), 'aria-hidden': 'true' }), listen);
  const meta = h('div.kk-meta', { html: diffHtml(s) });
  if (best !== null) meta.append(h('span.kk-best', { title: 'Your best singing score', html: `${icon('mic')}${Math.round(best * 100)}%` }));
  el.append(cov, h('b.kk-title', { text: s.title || 'Untitled' }), h('span.kk-artist', { text: s.artist || '' }), meta);
  seen.observe(el);
  return el;
}

function grid() {
  const list = songs();
  const box = h('div.kk-grid');
  for (const s of list.slice(0, MOST)) box.append(card(s));
  const wrap = h('div.kk-list', null, box);
  if (!list.length) {
    const any = allSung().length;
    wrap.prepend(
      h('p.kk-empty', {
        text: any
          ? prefs.show === 'split'
            ? 'None of these has been split yet. Split one and the singer steps out.'
            : 'No song matches that.'
          : state.songs.size
            ? 'None of your songs has words to sing yet. Songs with a vocals part show up here.'
            : 'Add songs to your library and the ones with words show up here.',
      })
    );
  } else if (list.length > MOST) wrap.append(h('p.kk-more', { text: `Showing ${MOST} of ${list.length}. Type to find a song.` }));
  return wrap;
}

// any click on a card sings it; the little play button just plays it
root.addEventListener('click', (e) => {
  const c = e.target.closest('.kk-card');
  if (!c) return;
  const id = c.dataset.id;
  if (e.target.closest('[data-listen]')) {
    e.stopPropagation();
    setSelection([id], { anchor: id, focus: id });
    actions.playSong(id, { autoplay: true });
    return;
  }
  actions.playKaraoke(id);
});
root.addEventListener('keydown', (e) => {
  const c = e.target.closest && e.target.closest('.kk-card');
  if (!c || e.target !== c || (e.key !== 'Enter' && e.key !== ' ')) return;
  e.preventDefault();
  actions.playKaraoke(c.dataset.id);
});
root.addEventListener('contextmenu', (e) => {
  const c = e.target.closest('.kk-card');
  if (!c) return;
  e.preventDefault();
  const s = state.songs.get(c.dataset.id);
  if (!s) return;
  const p = actions.stemPhase(s);
  showMenu(e.clientX, e.clientY, [
    { label: 'Sing it', icon: 'mic', onClick: () => actions.playKaraoke(s.id) },
    { label: 'Just listen', icon: 'play', onClick: () => actions.playSong(s.id, { autoplay: true }) },
    { label: 'Play along on guitar', icon: 'guitar', onClick: () => actions.playAs(s.id, 'guitar') },
    { label: 'Play it on piano', icon: 'piano', onClick: () => actions.playAs(s.id, 'piano') },
    p === 'none' ? { label: 'Split stems (take the singer out)', icon: 'split', onClick: () => actions.requestStems([s.id]) } : null,
    {
      label: 'Show in Songs',
      icon: 'music',
      onClick: () => {
        setSelection([s.id], { anchor: s.id, focus: s.id });
        import('./store.js').then((m) => (m.setPage('songs'), m.emit('reveal', s.id)));
      },
    },
  ].filter(Boolean));
});

function chips(list) {
  const counts = { all: list.length, split: list.filter((s) => actions.stemPhase(s) === 'ready').length };
  counts.notsplit = counts.all - counts.split;
  const box = h('div.kk-show', { role: 'group', 'aria-label': 'Which songs' });
  for (const [id, label, tip] of [
    ['all', 'All', 'Every song with words'],
    ['split', 'Singer out', 'Split already: the singer is taken out'],
    ['notsplit', 'With singer', 'Not split yet'],
  ]) {
    const b = h('button', { type: 'button', title: tip, 'aria-pressed': String(prefs.show === id), html: `<span>${label}</span><small>${counts[id]}</small>` });
    b.onclick = () => {
      prefs.show = id;
      savePrefs();
      render();
    };
    box.append(b);
  }
  return box;
}

function sortSelect() {
  const sel = h('select.kk-sort', { 'aria-label': 'Sort songs', title: 'Sort' });
  for (const [v, t] of [
    ['artist', 'Artist'],
    ['title', 'Title'],
    ['easy', 'Easiest to sing'],
    ['hard', 'Hardest to sing'],
    ['best', 'Your best score'],
  ])
    sel.append(h('option', { value: v, text: t, selected: prefs.sort === v ? '' : null }));
  sel.value = prefs.sort;
  sel.onchange = () => {
    prefs.sort = sel.value;
    savePrefs();
    // sorting by difficulty needs every song's: ask for the ones not worked out yet
    if (prefs.sort === 'easy' || prefs.sort === 'hard') allSung().forEach(wantDiff);
    render();
  };
  return sel;
}

let focusSearch = false;
function render() {
  if (state.page !== 'karaoke') return;
  const scroll = root.scrollTop;
  root.innerHTML = '';
  const list = allSung();
  const search = h('input.input.kk-search', { type: 'search', placeholder: 'Find a song or an artist', value: q, 'aria-label': 'Find a song to sing' });
  let listEl = grid();
  search.oninput = () => {
    q = search.value;
    const next = grid();
    listEl.replaceWith(next);
    listEl = next;
  };
  const levels = h('div.kk-levels', { role: 'group', 'aria-label': 'How strict the scoring is', title: 'How strict the scoring is' });
  for (const [id, l] of Object.entries(SING_LEVELS)) {
    const b = h('button', { type: 'button', text: l.name, 'aria-pressed': String(singLevel() === id) });
    b.onclick = () => {
      setSingLevel(id);
      for (const x of levels.children) x.setAttribute('aria-pressed', String(x === b));
    };
    levels.append(b);
  }
  const micBtn = h('button.btn.small.soft.kk-micbtn', { type: 'button', html: `${icon('mic')}<span>${mic.label ? mic.label : 'Microphone'}</span>`, title: 'Choose and try your microphone' });
  micBtn.onclick = () => import('./dialogs.js').then((d) => d.settings('guitar'));
  // auto-tune for the songs you sing from here: off, or a style
  const tuneBtn = h('button.btn.small.soft.kk-micbtn.kk-tunebtn', { type: 'button', title: 'Auto-tune and the voice changer: your voice moved onto the right notes, made deep or high, and played with the song', 'aria-pressed': String(autotune.wanted) });
  const paintTune = () => {
    tuneBtn.innerHTML = `${icon('wand')}<span>${tuneLabel()}</span>`;
    tuneBtn.setAttribute('aria-pressed', String(autotune.wanted));
  };
  paintTune();
  tuneBtn.onclick = () => {
    const r = tuneBtn.getBoundingClientRect();
    showMenu(r.left, r.bottom + 6, tuneMenu());
  };
  autotune.addEventListener('change', () => tuneBtn.isConnected && paintTune());
  const split = list.filter((s) => actions.stemPhase(s) === 'ready').length;
  root.append(
    h(
      'div.kk-head',
      null,
      h('div', null, h('h2.kk-title-big', { text: 'Sing it' }), h('p.kk-sub', { text: `${list.length} song${list.length === 1 ? '' : 's'} with words · ${split} with the singer taken out. Click one to sing.` })),
      h('span.grow'),
      levels,
      tuneBtn,
      micBtn
    ),
    h('div.kk-tools', null, search, chips(list), h('span.grow'), sortSelect()),
    listEl
  );
  root.scrollTop = scroll;
  if (focusSearch) search.focus();
}

on('page', render);
on('library', render);
on('stats', render);
// a song finishing its split changes its tag; redraw only when something changed
let lastStems = '';
on('stems', () => {
  if (state.page !== 'karaoke') return;
  const sig = allSung().map((s) => actions.stemPhase(s)[0]).join('');
  if (sig !== lastStems) (lastStems = sig), render();
});
root.addEventListener('focusin', (e) => (focusSearch = e.target.classList && e.target.classList.contains('kk-search')));
mic.addEventListener('change', () => state.page === 'karaoke' && !mic.on && render());
render();
