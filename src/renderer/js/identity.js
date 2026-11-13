/** Stagehand identity: presentation only. No audio or scoring dependencies. */
import { state, on } from './store.js';
import { h, icon } from './ui.js';
import { ART, PLACEMENTS } from './identity-art.js';
// 4.6: the Gear page borrows the Tones page's pictures
if (!PLACEMENTS.gear) PLACEMENTS.gear = ['amp-imp', 'amp-cherub', 'roadie-cable', 'glass-cherub', 'winged-imp'];
import { director, storage, appearancePrefs as prefs, APPEARANCE_KEY as KEY, advancePageArt, refreshDecorations } from './menu-art.js';
const roadshowMoods = {
  play: ['Jam', 'LET THERE BE RIFFS', 'The neighbors have heard enough. You haven’t.'],
  songs: ['Songs', 'THE SACRED SETLIST', 'One more song. Famous last words.'],
  tones: ['Tones', 'BEHOLD. THE TONE THRONE.', 'Tone is in the fingers. And maybe one more pedal.'],
  gear: ['Gear', 'THE GEAR VAULT', 'Every knob turns. Nobody’s counting how many pedals you own.'],
  discover: ['Discover', 'DIG UP SOMETHING LOUD', 'Seek riffs. Find trouble. Repeat.'],
  progress: ['Progress', 'EARN YOUR THUNDER', 'Even legends had to practice that bit.'],
  greenroom: ['Backstage', 'NO ROADIE LEFT BEHIND', 'Big riffs. Questionable decisions. Good company.'],
};
// Rehearsal Room (data-look="opera"): deadpan, down to earth, guitar-trope jokes. Each visit
// to a page picks one of these at random, with a different sticker, picture and entrance.
const operaLines = {
  play: [['REHEARSAL ROOM B', 'Plug in. Tune up. Pretend the neighbors like it.'],
         ['NO STAIRWAY. WE MEAN IT.', 'Ten minutes of noodling before anything sounds like a song. Tradition.'],
         ['AMP WARMING UP', 'Every knob on seven. Except the ones on ten.']],
  songs: [['THE SETLIST', 'Taped to the floor. Covered in something. Mostly legible.'],
          ['ONE MORE SONG', 'Said every band at 1 a.m., three songs ago.'],
          ['REQUESTS: NO', 'Fine. Maybe one. Not that one.']],
  tones: [['THE AMP CLOSET', 'Louder isn’t better. It is, though.'],
          ['GEAR ACQUISITION SYNDROME', 'Your pedalboard is full. You need a bigger pedalboard.'],
          ['DIALED IN (PROBABLY)', 'Bass on 6, mids on 4, treble wherever the last guy left it.']],
  gear: [['THE GEAR WALL', 'Look with your ears. Touch everything. It’s fine, we asked.'],
         ['TRY BEFORE YOU BUY', 'Nothing here costs anything. Your pedalboard still won’t fit.'],
         ['EVERY KNOB TURNS', 'Including the ones nobody knows what they do.']],
  discover: [['CRATE DIGGING', 'Somewhere in here is the riff you’ll play for the next ten years.'],
             ['USED, LIGHTLY ABUSED', 'Every great song was someone’s new song once.'],
             ['STAFF PICKS', 'The guy behind the counter has opinions. So do we.']],
  progress: [['THE ROAD TO THE ARENA', 'Basement. Bar. County fair. Arena. In that order.'],
             ['TOUR DIARY', 'Day 9: the van smells. The chords sound better.'],
             ['PAYING DUES', 'Calluses don’t grow themselves.']],
  greenroom: [['ALL ACCESS (MOSTLY)', 'The free snacks were a lie. The company’s good, though.'],
              ['BAND ONLY', 'And the drummer. Fine.'],
              ['LOAD-IN AT SIX', 'Nobody is ever here at six.']],
};
const mythologyLines = {
  play: [['THE TEMPLE OF JAM', 'Summon something worth turning up.'], ['LET THERE BE RIFFS', 'A little practice. A little magic. A lot of noise.']],
  songs: [['THE BOOK OF RIFFS', 'Every song is a legend you can learn.'], ['THE SACRED SETLIST', 'Jazz, metal, blues. Different roads to the same altar.']],
  tones: [['RELICS OF THE LOUD', 'Choose your instrument of glorious disturbance.'], ['HEAVEN SENT. HELL BENT.', 'The angel says clean. The devil says one more pedal.']],
  discover: [['BEYOND THE CROSSROADS', 'There is always another song worth finding.'], ['THE LOST CHORD ARCHIVE', 'The next obsession is hiding in here somewhere.']],
  progress: [['THE TRIALS OF THE RIFF', 'Even the chosen one had to practice the bridge.'], ['THE HALL OF METAL', 'Built one stubborn repetition at a time.']],
  greenroom: [['THE FELLOWSHIP OF THE BAND', 'Nobody carries the whole song alone.'], ['THE COUNCIL OF LOUD', 'Bring your riffs. Leave room for the bass.']],
};
for (const [page, lines] of Object.entries(mythologyLines)) operaLines[page].push(...lines);
const STICKERS = ['NO STAIRWAY', 'TURN IT DOWN? NO.', 'TUNED IT LAST TUESDAY', 'DRUMMER WANTED (AGAIN)', 'WILL PLAY FOR PIZZA',
  'FEEDBACK IS A FEATURE', 'STRINGS CHANGED: 2019', 'BASSISTS ARE PEOPLE TOO', 'ONE MORE TAKE', 'WHO TOOK MY CAPO',
  'IT SOUNDED BETTER IN THE BASEMENT', 'IF IT’S TOO LOUD, YOU’RE TOO CLOSE', 'MY OTHER AMP IS A STACK', 'THIS SIDE UP. PROBABLY.',
  'SOLO GOES HERE', 'PLAYS WELL WITH OTHERS (LOUDLY)', 'NO NOODLING IN THE SHOP', 'PICK COUNT: 0'];
// 4.9: hand-made notes from the UI pack, each on the pages where its joke lands
const PAGE_NOTES = {
  play: ['major-pentatonic', 'minor-pentatonic', 'root-note', 'bend-it', 'groove', 'tune-first', 'clean-first'],
  songs: ['one-more-run', 'other-pick', 'wrong-note', 'clean-first'],
  tones: ['eq-sign', 'engineers-inspection', 'tune-first'],
  gear: ['engineers-inspection', 'eq-sign'],
  discover: ['other-pick', 'one-more-run', 'wrong-note'],
  progress: ['clean-first', 'one-more-run', 'bend-it'],
  greenroom: ['engineers-inspection', 'other-pick', 'groove'],
};
const noteFile = (n) => (ART.find((a) => a.id === `scrap-${n}`) || {}).file;
// the marks on the flyer, the tape that holds it up, and what else is stuck on the wall
const MARKS = ['highlight', 'underline', 'star', 'circle', 'none', 'none'];
const TAPES = ['masking', 'gaffer', 'duct', 'clear'];
const WALL = ['flyer', 'sticky', 'tag', 'notebook', 'none', 'none'];
// printed stickers and notes, shown instead of the typed sticker about half the time
const STICKER_ART = ["rehearsal/s-goes-to-11.avif", "rehearsal/s-no-stairway-fine.avif", "rehearsal/s-no-stairway-exceptions.avif", "rehearsal/s-just-one-more.avif", "rehearsal/s-one-more-riff.avif", "rehearsal/s-world-tour.avif", "rehearsal/s-another-pedal.avif", "rehearsal/s-pick-of-destiny.avif", "rehearsal/s-pick.avif"];
const ENTRANCES = ['slap', 'drop', 'peel', 'slide', 'rumble'];
const PAPERS = ['news', 'pink', 'yellow', 'kraft', 'white', 'setlist', 'notebook'];
const pick = (list, avoid) => { const opts = list.length > 1 ? list.filter(x => x !== avoid) : list; return opts[Math.floor(Math.random() * opts.length)]; };
const lastPick = {};
const pickFor = (key, list) => (lastPick[key] = pick(list, lastPick[key]));
const operaMoods = new Proxy({}, { get: (_t, k) => {
  const names = { play: 'Jam', songs: 'Songs', tones: 'Tones', gear: 'Gear', discover: 'Discover', progress: 'Progress', greenroom: 'Backstage' };
  if (!names[k]) return undefined;
  const [kicker, text] = pickFor('line:' + k, operaLines[k]);
  return [names[k], kicker, text];
} });
const opera = () => prefs.look !== 'roadshow';
const moodsNow = () => (opera() ? operaMoods : roadshowMoods);
const moods = new Proxy({}, { get: (_t, k) => moodsNow()[k] });
const banner = document.getElementById('identity-banner');
// the banner picture; replaced by a fresh, already decoded <img> on every change (see swapArt)
let art = h('img.identity-art', { alt: '', 'aria-hidden': 'true', hidden: true });
const label = h('span.identity-kicker');
const title = h('h1.identity-title');
const line = h('p.identity-line');
const prefsButton = h('button.identity-options', { type: 'button', title: 'Artwork and appearance', 'aria-label': 'Artwork and appearance', html: icon('more') });
prefsButton.onclick = () => import('./dialogs.js').then(d => d.settings('appearance'));
const fx = h('div.opera-fx', { 'aria-hidden': 'true', html:
  '<i class="bulb"></i><i class="tape t1"></i><i class="tape t2"></i><i class="stain"></i><i class="wall"></i>' +
  '<span class="dust"><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i></span>' });
const sticker = h('span.opera-sticker', { 'aria-hidden': 'true' });
const stickerImg = h('img.opera-sticker-img', { alt: '', 'aria-hidden': 'true', decoding: 'async' });
const artWrap = h('div.identity-art-wrap', null, art);
// 4.9: a strip of real tape holding the flyer to the wall (placed on its corner by layoutArt)
const flyerTape = h('i.opera-tape', { 'aria-hidden': 'true' });
if (banner) banner.append(fx, h('div.identity-copy', null, label, title, line), flyerTape, sticker, stickerImg, artWrap, prefsButton);
let shown = null;
let freshVisit = true;
let lastPaint = -1e9;
// a new visit = the page changed, or its menu button was pressed again
document.addEventListener('click', (e) => {
  const b = e.target.closest && e.target.closest('.nav-section');
  if (b && b.dataset.page === state.page) {
    if (prefs.rotateMenus !== false) advancePageArt(state.page);
    freshVisit = true; setTimeout(show, 0);
  }
}, true);
function save() {
  director.write(storage('localStorage'), KEY, prefs);
  document.documentElement.dataset.decoration = prefs.reduced ? 'reduced' : 'full';
  document.documentElement.dataset.calm = prefs.calm ? 'true' : 'false';
  document.documentElement.dataset.look = opera() ? 'opera' : 'roadshow';
}
function restartEntrance(els) {
  for (const el of els) { el.style.animation = 'none'; void el.offsetWidth; el.style.animation = ''; }
}
// Swap the picture only once the new one is loaded and decoded, as a new element: no blank frame,
// no old picture flashing through the start of the entrance, and a quick page change can't land
// a stale picture (the token). The same picture again keeps its element.
let artToken = 0;
let artAspect = 1;
function swapArt(file, id) {
  const token = ++artToken;
  const url = `art/${file}`;
  if (art.dataset.art === id && art.getAttribute('src') === url && art.naturalWidth) {
    art.hidden = false; layoutArt();
    if (opera()) restartEntrance([art]);
    return;
  }
  const next = h('img.identity-art', { alt: '', 'aria-hidden': 'true', decoding: 'sync' });
  next.dataset.art = id;
  next.src = url;
  const ready = next.decode ? next.decode() : new Promise((ok, no) => { next.onload = ok; next.onerror = no; });
  ready.then(() => {
    if (token !== artToken) return;
    artAspect = next.naturalWidth / next.naturalHeight || 1;
    art.replaceWith(next); art = next;
    layoutArt();
  }, () => { if (token === artToken) art.hidden = true; });
}
function paintArt(next = false) {
  if (!banner || !shown) return;
  const pool = PLACEMENTS[shown] || [];
  const id = director.choose(shown, pool, { next });
  if (opera()) {
    banner.dataset.enter = pickFor('enter', ENTRANCES);
    banner.dataset.paper = pickFor('paper', PAPERS);
    sticker.textContent = pickFor('sticker', STICKERS);
    banner.dataset.mark = pickFor('mark', MARKS);
    banner.dataset.tape = pickFor('tape', TAPES);
    banner.dataset.wall = pickFor('wall', WALL);
    // a hand-made note for this page (60%), else a printed sticker or the typed one
    const notes = (PAGE_NOTES[shown] || []).filter(noteFile);
    const r = Math.random();
    const useNote = notes.length && r < 0.6;
    const useImg = useNote || r < 0.8;
    sticker.hidden = useImg; stickerImg.hidden = !useImg;
    stickerImg.classList.toggle('note', !!useNote);
    if (useImg) stickerImg.src = useNote ? `art/${noteFile(pickFor('note:' + shown, notes))}` : `art/${pickFor('stickerImg', STICKER_ART)}`;
    stickerImg.style.setProperty('--tilt', `${(Math.random() * 14 - 7).toFixed(1)}deg`);
    sticker.style.setProperty('--tilt', `${(Math.random() * 10 - 5).toFixed(1)}deg`);
    // restart the entrance animations (a new picture starts its own when it goes in)
    restartEntrance([sticker, stickerImg, title, flyerTape]);
  }
  const item = ART.find(a => a.id === id);
  banner.dataset.pinned = String(!!director.pinned(shown));
  if (!item) { artToken++; art.hidden = true; return; }
  swapArt(item.file, id);
}
/* The picture rises out of the banner into the top bar's empty middle: between the search box
   and the top-bar buttons, never over them, the banner's words or its options button. When that
   stretch is too narrow it sits inside the banner, and with no room at all it stays hidden. */
const GAP = 16;
const titlebar = document.querySelector('.titlebar');
const searchBox = titlebar && titlebar.querySelector('.search');
const tbActions = titlebar && titlebar.querySelector('.titlebar-actions');
const winCtl = titlebar && titlebar.querySelector('.win-ctl');
const copy = label.parentElement;
const textRight = (el) => {
  if (!el.firstChild) return -Infinity;
  const r = document.createRange(); r.selectNodeContents(el);
  return r.getBoundingClientRect().right;
};
const boxRight = (el, b) => (el.hidden || !el.offsetWidth ? -Infinity : b.left + el.offsetLeft + el.offsetWidth);
let lastBox = '';
// the biggest a banner picture gets: about 190 px tall, 360 px wide, and no more area than a 190 px square
const ART_MAX = { w: 360, h: 190, area: 190 * 190 };
function layoutArt() {
  if (!banner || banner.hidden || !titlebar) return;
  const b = banner.getBoundingClientRect();
  if (!b.width) return;
  const tb = titlebar.getBoundingClientRect();
  // the banner's own words, flyer and sticker
  const words = opera() ? boxRight(copy, b) : Math.max(textRight(label), textRight(title), textRight(line));
  const content = Math.max(b.left, words, boxRight(sticker, b), boxRight(stickerImg, b)) + GAP;
  const opt = prefsButton.offsetWidth ? prefsButton.getBoundingClientRect().left - GAP : b.right - GAP;
  const sr = searchBox && searchBox.offsetWidth ? searchBox.getBoundingClientRect().right : tb.left;
  const visible = [tbActions, winCtl].filter(el => el && el.offsetWidth);
  const ar = visible.length ? Math.min(...visible.map(el => el.getBoundingClientRect().left)) : tb.right;
  const bottom = b.bottom + (opera() ? 6 : -3);
  const fit = (left, right, top) => {
    const w = right - left, hgt = bottom - top;
    if (w <= 0 || hgt <= 0) return null;
    // one size budget for every picture, whatever its shape, so new art never takes over the screen
    const pw = Math.min(w, hgt * artAspect, ART_MAX.w, ART_MAX.h * artAspect, Math.sqrt(ART_MAX.area * artAspect)), ph = pw / artAspect;
    return { x: left + (w - pw) / 2, y: bottom - ph, w: pw, h: ph };
  };
  let mode = 'rise';
  let box = fit(Math.max(sr + GAP, content), Math.min(ar - GAP, opt), tb.top + 6);
  // too narrow to reach well up: keep it in the banner instead
  if (!box || box.y > tb.bottom - 20 || box.w < 110) { mode = 'inside'; box = fit(content, opt, b.top + 8); }
  if (!box || box.w < 80 || box.h < 50) mode = 'none';
  // the tape sits on the flyer's top-left corner
  flyerTape.style.left = `${Math.round(copy.offsetLeft - 60)}px`;
  flyerTape.style.top = `${Math.round(copy.offsetTop - 12)}px`;
  const key = mode === 'none' ? mode : [mode, box.x, box.y, box.w, box.h].map(v => (typeof v === 'number' ? Math.round(v) : v)).join();
  if (key === lastBox) return;
  lastBox = key;
  banner.dataset.rise = mode;
  if (mode === 'none') return;
  const set = (x, y) => {
    artWrap.style.setProperty('--art-x', `${x}px`); artWrap.style.setProperty('--art-y', `${y}px`);
  };
  artWrap.style.setProperty('--art-w', `${Math.round(box.w)}px`); artWrap.style.setProperty('--art-h', `${Math.round(box.h)}px`);
  set(Math.round(box.x), Math.round(box.y));
  // if something above ever becomes the fixed box's frame, correct for where it really landed
  const got = artWrap.getBoundingClientRect();
  if (got.width && (Math.abs(got.left - Math.round(box.x)) > 1 || Math.abs(got.top - Math.round(box.y)) > 1)) {
    set(Math.round(2 * box.x - got.left), Math.round(2 * box.y - got.top));
  }
}
let layoutQueued = false;
const queueLayout = () => {
  if (layoutQueued) return;
  layoutQueued = true;
  requestAnimationFrame(() => { layoutQueued = false; layoutArt(); });
};
if (banner && typeof ResizeObserver === 'function') {
  const ro = new ResizeObserver(queueLayout);
  for (const el of [titlebar, searchBox, tbActions, winCtl, banner, copy, sticker, stickerImg, prefsButton]) if (el) ro.observe(el);
}
addEventListener('resize', queueLayout);
document.fonts?.ready?.then(queueLayout);
function show() {
  const mood = moods[state.page];
  document.getElementById('app').dataset.mood = state.page;
  if (!banner) return;
  banner.hidden = !mood;
  if (!mood || (shown === state.page && !opera())) return;
  if (shown === state.page && opera() && (!freshVisit || performance.now() - lastPaint < 400)) { freshVisit = false; return; }
  freshVisit = false; lastPaint = performance.now();
  shown = state.page;
  [title.textContent, label.textContent, line.textContent] = mood;
  title.dataset.text = mood[0];
  banner.dataset.placement = shown; paintArt(); refreshDecorations(); queueLayout();
}
document.addEventListener('error', e => {
  if (e.target?.classList?.contains('gear-photo')) e.target.parentElement.classList.add('photo-failed');
}, true);
on('page', () => { freshVisit = true; show(); }); save(); show();

export function appearancePane(el) {
  el.append(h('h3', { text: 'Make yourself at home' }), h('p', { text: 'The Mythology of Music: fresh characters on return visits, steady artwork while you play with the controls. Gear always keeps its identity.' }));
  const toggle = (key, name, desc) => {
    const input = h('input', { type:'checkbox', checked: !!prefs[key] });
    input.onchange = () => { prefs[key] = input.checked; save(); };
    el.append(h('label.identity-setting', null, input, h('span', null, h('b',{text:name}), h('small',{text:desc}))));
  };
  const look = h('input', { type:'checkbox', checked: opera() });
  look.onchange = () => { prefs.look = look.checked ? 'opera' : 'roadshow'; save(); const p = shown; shown = null; if (p) show(); };
  el.append(h('label.identity-setting', null, look, h('span', null, h('b',{text:'Rehearsal Room look'}), h('small',{text:'Torn flyers, gaffer tape, worn gear and bad jokes. A new picture every visit. Turn it off for the Roadshow look.'}))));
  const rotate = h('input', {type:'checkbox', checked:prefs.rotateMenus !== false});
  rotate.onchange = () => { prefs.rotateMenus = rotate.checked; save(); };
  el.append(h('label.identity-setting', null, rotate, h('span', null, h('b',{text:'Fresh artwork on menu visits'}), h('small',{text:'Shuffle illustrations without immediate repeats. Pinned artwork stays put.'}))));
  toggle('reduced', 'Less decoration', 'Hide illustrations and poster textures. Keep all controls and page labels.');
  toggle('rotateVenues', 'A different room for the next song', 'Shuffle unlocked photo venues only when a different song loads. Turn this off to keep your chosen venue.');
  toggle('calm', 'Calmer interface', 'Stop decorative interface motion. The note highway and music visualizers keep their playback behavior.');
  // 4.11: anything that comes in more than one look is yours to pick, in one place
  el.append(h('h3', { text: 'Pick your look' }), h('p', { text: 'Where Stagehand has more than one look for something, choose the one you like. Each also has its own switch where it lives.' }));
  const pick = (name, note) => {
    const seg = h('span.seg', { role: 'group', 'aria-label': name });
    el.append(h('div.looks-row', null, h('b', { text: name }), seg, note ? h('small', { text: note }) : null));
    return (options, get, set) => {
      const draw = () => {
        seg.innerHTML = '';
        for (const [id, label, tip] of options) {
          const b = h('button', { type: 'button', text: label, title: tip || label, 'aria-pressed': String(get() === id) });
          b.onclick = async () => (await set(id), draw());
          seg.append(b);
        }
      };
      draw();
    };
  };
  const tunerRow = pick('Tuner', 'U opens the tuner anywhere');
  import('./tuner.js').then(({ TUNER_LOOKS, tunerLook, setTunerLook }) => tunerRow(TUNER_LOOKS, tunerLook, setTunerLook)).catch(() => {});
  const singRow = pick('Singing', 'Shown on the highway when Sing is on');
  import('./singlane.js').then(({ SING_LOOKS, singLook, setSingLook }) => singRow(SING_LOOKS, singLook, setSingLook)).catch(() => {});
  const songsRow = pick('Songs');
  Promise.all([import('./store.js'), import('./library.js')]).then(([{ state }, { setSongLayout }]) => songsRow([['list', 'List', 'Rows with every detail'], ['grid', 'Tiles', 'Album covers']], () => (state.layout === 'list' ? 'list' : 'grid'), (v) => setSongLayout(v))).catch(() => {});
  el.append(h('p', { text: 'The highway’s venue and string order are in its Sound & settings panel (and Settings › Playback); Jam’s moving background is picked on the Jam page.' }));
  const section = shown || 'play';
  const preview = h('img.identity-preview',{alt:'Current decorative artwork',width:220,height:140});
  const pin = h('button.btn', {type:'button'});
  const next = h('button.btn.soft', {type:'button',text:'Try another illustration'});
  const refresh = () => {
    const id = director.choose(section, PLACEMENTS[section]);
    preview.src = `art/${ART.find(a=>a.id===id).file}`;
    pin.textContent = director.pinned(section) ? 'Unpin artwork' : 'Pin this artwork';
    pin.setAttribute('aria-pressed',String(!!director.pinned(section)));
    next.disabled = !!director.pinned(section);
  };
  pin.onclick = () => { director.pin(section, director.pinned(section) ? null : director.choose(section, PLACEMENTS[section])); refresh(); paintArt(); };
  next.onclick = () => { director.choose(section, PLACEMENTS[section], {next:true}); refresh(); paintArt(); };
  el.append(h('h3',{text:`Artwork for ${moods[section][0]}`}),preview,h('div.identity-setting-actions',null,pin,next));
  refresh();
  el.append(h('p',{text:'Pinning keeps this illustration on future visits. Decoration never replaces album covers, player identities or status indicators.'}));
}
