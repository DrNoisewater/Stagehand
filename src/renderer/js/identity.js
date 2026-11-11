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
// printed stickers and notes, shown instead of the typed sticker about half the time
const STICKER_ART = ["rehearsal/s-goes-to-11.webp", "rehearsal/s-no-stairway-fine.webp", "rehearsal/s-no-stairway-exceptions.webp", "rehearsal/s-just-one-more.webp", "rehearsal/s-one-more-riff.webp", "rehearsal/s-world-tour.webp", "rehearsal/s-another-pedal.webp", "rehearsal/s-pick-of-destiny.webp", "rehearsal/s-pick.webp"];
const ENTRANCES = ['slap', 'drop', 'peel', 'slide', 'rumble'];
const PAPERS = ['news', 'pink', 'yellow', 'kraft', 'white'];
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
const art = h('img.identity-art', { alt: '', width: 240, height: 112, decoding: 'async', 'aria-hidden': 'true' });
const label = h('span.identity-kicker');
const title = h('h1.identity-title');
const line = h('p.identity-line');
const prefsButton = h('button.identity-options', { type: 'button', title: 'Artwork and appearance', 'aria-label': 'Artwork and appearance', html: icon('more') });
prefsButton.onclick = () => import('./dialogs.js').then(d => d.settings('appearance'));
const fx = h('div.opera-fx', { 'aria-hidden': 'true', html:
  '<i class="bulb"></i><i class="tape t1"></i><i class="tape t2"></i><i class="stain"></i>' +
  '<span class="dust"><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i></span>' });
const sticker = h('span.opera-sticker', { 'aria-hidden': 'true' });
const stickerImg = h('img.opera-sticker-img', { alt: '', 'aria-hidden': 'true', decoding: 'async' });
const artWrap = h('div.identity-art-wrap', null, art);
if (banner) banner.append(fx, h('div.identity-copy', null, label, title, line), sticker, stickerImg, artWrap, prefsButton);
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
function paintArt(next = false) {
  if (!banner || !shown) return;
  const pool = PLACEMENTS[shown] || [];
  const id = director.choose(shown, pool, { next });
  if (opera()) {
    banner.dataset.enter = pickFor('enter', ENTRANCES);
    banner.dataset.paper = pickFor('paper', PAPERS);
    sticker.textContent = pickFor('sticker', STICKERS);
    const useImg = Math.random() < 0.5;
    sticker.hidden = useImg; stickerImg.hidden = !useImg;
    if (useImg) stickerImg.src = `art/${pickFor('stickerImg', STICKER_ART)}`;
    stickerImg.style.setProperty('--tilt', `${(Math.random() * 14 - 7).toFixed(1)}deg`);
    sticker.style.setProperty('--tilt', `${(Math.random() * 10 - 5).toFixed(1)}deg`);
    // restart the entrance animations
    for (const el of [art, sticker, stickerImg, title]) { el.style.animation = 'none'; void el.offsetWidth; el.style.animation = ''; }
  }
  const item = ART.find(a => a.id === id);
  if (!item) { art.hidden = true; return; }
  art.hidden = false; art.src = `art/${item.file}`; art.dataset.art = id;
  banner.dataset.pinned = String(!!director.pinned(shown));
}
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
  banner.dataset.placement = shown; paintArt(); refreshDecorations();
}
art.onerror = () => { art.hidden = true; };
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
