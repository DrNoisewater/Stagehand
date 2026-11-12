/**
 * Progress (4.5 redesign): five tabs instead of one long page.
 *   Overview      your level (big), XP to the next, the next gig (venue), this week's rhythm,
 *                 today's and this week's challenges, your last song, what's next, recent
 *                 accomplishments, practice trends
 *   Career        lifetime statistics (never reset with levels): chords, notes, hours, records,
 *                 year in review, techniques
 *   Achievements  by category, six tiers (bronze … legendary), what's next, titles
 *   Songs         song mastery: First play → Mastered, with the thresholds, nearly-there songs
 *   History       the career timeline: levels, venues, firsts, bests, mastery
 */
import { decorativeImage } from './menu-art.js';
import { harvest, artImg } from './artkeep.js';
import { api } from './api.js';
import { state, on, setPage, setView, accBand } from './store.js';
import { h, icon, esc, toast } from './ui.js';
import * as actions from './actions.js';
import { KIND_LABEL } from './scorecard.js';
import { coverEl } from './shell.js';
import { engine } from './stage.js';
import { L, loadLevels, wearTitle } from './rewards.js';
import { VENUES as VENUE_LIST, venueThumb } from './venues.js';

const root = document.getElementById('page-progress');
const TABS = [['overview', 'Overview'], ['career', 'Career stats'], ['achievements', 'Achievements'], ['songs', 'Song mastery'], ['history', 'History']];
const readTab = () => {
  try {
    const t = localStorage.getItem('stagehand.progressTab');
    return TABS.some(([id]) => id === t) ? t : 'overview';
  } catch (_) {
    return 'overview';
  }
};
const P = { period: 'week', data: null, takes: [], playing: null, audio: null, life: null, tab: readTab(), masteryTier: null, counted: new Set() };
const n = (x) => Number(x || 0).toLocaleString();
const METAL = ['bronze', 'silver', 'gold', 'platinum', 'diamond', 'legendary'];
const METAL_NAME = ['Bronze', 'Silver', 'Gold', 'Platinum', 'Diamond', 'Legendary'];
const CUP = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 4h10v5a5 5 0 0 1-10 0V4Z" fill="currentColor"/><path d="M7 6H4.5a2.5 2.5 0 0 0 3 3.5M17 6h2.5a2.5 2.5 0 0 1-3 3.5M12 14v4M8 20h8" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
const LOCK = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="11" width="14" height="10" rx="2" fill="currentColor"/><path d="M8 11V8a4 4 0 0 1 8 0v3" fill="none" stroke="currentColor" stroke-width="2.4"/></svg>';
const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

function fmtTime(sec) {
  const m = Math.round(sec / 60);
  if (m < 60) return `${m} m`;
  return `${Math.floor(m / 60)} h ${m % 60} m`;
}
const fmtHours = (sec) => (sec >= 360000 ? n(Math.round(sec / 3600)) : (sec / 3600).toFixed(sec >= 36000 ? 0 : 1));
// 4.7: date formatters are kept (one per style): making one per date was slow on long histories
const dateFmts = new Map();
function dateText(d, o) {
  if (Number.isNaN(d.getTime())) return d.toLocaleDateString(undefined, o);
  const k = o ? JSON.stringify(o) : '';
  let f = dateFmts.get(k);
  if (!f) dateFmts.set(k, (f = new Intl.DateTimeFormat(undefined, o)));
  return f.format(d);
}
const fmtDate = (ms, o = { year: 'numeric', month: 'short', day: 'numeric' }) => (ms ? dateText(new Date(ms), o) : '—');

async function load() {
  try {
    const [d, t, life] = await Promise.all([api.stats.summary(P.period), api.takes.list(), api.career ? api.career.lifetime().catch(() => null) : null]);
    P.data = d;
    P.takes = t || [];
    P.life = life;
  } catch (err) {
    P.data = null;
  }
  // 4.5: the page refreshes every few seconds while it's open; redraw only when something changed
  const key = JSON.stringify([P.period, P.tab, P.data, P.life && P.life.sessions, P.life && P.life.seconds, L.st && L.st.xp, L.st && L.st.today, P.takes.length]);
  if (key === P.lastKey && root.childElementCount) return;
  P.lastKey = key;
  render();
}

/** A number that counts up once per visit (not on every refresh, never with reduced motion). */
function counter(value, key, fmt = n) {
  const el = h('span.pg-count', { text: fmt(value) });
  if (!P.counted.has(key) && !reduced() && value > 0) {
    P.counted.add(key);
    const t0 = performance.now();
    const dur = 900;
    const step = (t) => {
      const k = Math.min(1, (t - t0) / dur);
      const e = 1 - Math.pow(1 - k, 3);
      el.textContent = fmt(Number.isInteger(value) ? Math.round(value * e) : value * e);
      if (k < 1 && el.isConnected) requestAnimationFrame(step);
      else el.textContent = fmt(value);
    };
    el.textContent = fmt(0);
    requestAnimationFrame(step);
  }
  return el;
}

function render() {
  if (state.page !== 'progress') return;
  const scroll = root.scrollTop;
  harvest(root); // 4.5: covers move to the new page instead of reloading
  root.innerHTML = '';
  const tabs = h('div.pg-tabs', { role: 'tablist', 'aria-label': 'Progress' });
  for (const [id, label] of TABS) {
    const b = h('button.pg-tab', { type: 'button', role: 'tab', 'data-tab': id, 'aria-selected': String(P.tab === id), text: label });
    b.onclick = () => {
      if (P.tab === id) return;
      P.tab = id;
      try {
        localStorage.setItem('stagehand.progressTab', id);
      } catch (_) {}
      render();
      root.scrollTop = 0;
    };
    tabs.append(b);
  }
  tabs.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    const i = TABS.findIndex(([id]) => id === P.tab);
    const j = (i + (e.key === 'ArrowRight' ? 1 : TABS.length - 1)) % TABS.length;
    tabs.children[j].click();
    tabs.children[j].focus();
  });
  const st = L.st;
  const head = h('div.prog-head.pg-head', null, h('h1.page-title', { text: 'Progress' }), tabs, h('span.grow'), st ? h('span.pg-headxp', { title: 'All the XP you’ve earned on the Road to 100' }, h('b', { text: n(st.xp) }), ' XP') : null);
  root.append(head);
  const body = h(`div.pg-body.pg-${P.tab}`);
  root.append(body);
  if (P.tab === 'overview') overview(body, st);
  else if (P.tab === 'career') career(body, st);
  else if (P.tab === 'achievements') achievements(body, st);
  else if (P.tab === 'songs') songsTab(body);
  else if (P.tab === 'history') history(body, st);
  root.scrollTop = scroll;
}

// ------------------------------------------------------------- overview --
/** A venue's picture: the photo, or a swatch for a moving scene. */
function venuePic(v, locked) {
  const rv = VENUE_LIST.find((x) => x.id === v.venue);
  const th = rv ? venueThumb(rv) : null;
  return h(`span.pg-vpic${locked ? '.locked' : ''}`, null, th ? artImg(th, { alt: '', loading: 'lazy', decoding: 'async' }) : h(`i.vsw.sc-${v.venue}`), locked ? h('span.pg-vlock', { html: LOCK }) : null);
}

function hero(st) {
  const span = Math.max(1, st.to - st.from);
  const into = st.xp - st.from;
  const pctTo = st.atMax ? 1 : into / span;
  const medal = h(`div.pg-level.tier-${st.tier.id}`, { title: `${st.tier.name} pass` }, h('small', { text: 'LEVEL' }), h('b.pg-level-n', { text: String(st.level) }), h('span', { text: `of ${st.max || 100}` }));
  const rh = st.rhythm || { days: 0, mult: 1, week: [] };
  const dayNames = [];
  for (let i = 6; i >= 0; i--) dayNames.push(dateText(new Date(Date.now() - i * 864e5), { weekday: 'narrow' }));
  const dots = h('div.pg-rhythm', { title: 'Days you played in the last seven. More days this week = a little more XP for playing. Missing a day never takes anything away.' },
    ...rh.week.map((on, i) => h(`span${on ? '.on' : ''}${i === 6 ? '.today' : ''}`, null, h('i'), h('small', { text: dayNames[i] }))),
    h('b', { text: `×${rh.mult.toFixed(2)}` }),
    h('em', { text: rh.days >= 5 ? 'Top rhythm this week' : rh.today ? `${rh.days} day${rh.days === 1 ? '' : 's'} this week` : `Play today for ×${rh.nextMult.toFixed(2)}` }));
  const who = h('div.pg-who', null,
    h('div.pg-tier', null, h('b', { text: st.tier.name }), st.title ? h('span.lv-worn', { text: `“${st.title.name}”` }) : null, st.nextTier ? h('small', { text: `${st.nextTier.name} pass at level ${st.nextTier.from}` }) : h('small', { text: 'The top pass' })),
    h('div.pg-xpbar', { role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': String(span), 'aria-valuenow': String(into), 'aria-label': 'XP to the next level' }, h('i', { style: { width: `${Math.round(pctTo * 1000) / 10}%` } })),
    h('div.pg-xpsub', null,
      h('span', { text: st.atMax ? `Level 100. ${n(st.xp - st.from)} XP beyond it.` : `${n(st.to - st.xp)} XP to level ${st.level + 1}` }),
      st.today ? h('span.lv-today', { text: `+${n(st.today)} today` }) : null,
      st.nextMilestone && !st.atMax ? h('span.pg-mile', { text: `Next milestone: level ${st.nextMilestone}` }) : null),
    dots);
  return h('section.card.pg-hero', { 'aria-label': 'Your level' }, medal, who, nextGig(st));
}

function nextGig(st) {
  const v = st.next;
  const box = h('div.pg-nextgig');
  if (!v) {
    box.append(h('div.pg-eyebrow', { text: 'Every venue is yours' }), venuePic({ venue: 'valhalla' }, false), h('b', { text: 'Valhalla' }), h('small', { text: 'You’ve played your way to the top.' }));
    return box;
  }
  const lx = st.levelXp || [];
  const prev = (st.venues || []).filter((x) => x.level <= st.level).map((x) => x.level).pop() || 1;
  const from = lx[Math.min(prev, st.level)] || st.from;
  const to = lx[v.level] || st.to;
  const left = Math.max(0, to - st.xp);
  const pctTo = to > from ? Math.max(0, Math.min(1, (st.xp - from) / (to - from))) : 0;
  box.append(
    h('div.pg-eyebrow', { text: 'Next gig' }),
    h('div.pg-gigrow', null, venuePic(v, true), h('div', null, h('b', { text: v.name }), h('small', { text: `Opens at level ${v.level}${v.milestone ? ' · milestone' : ''}` }))),
    h('div.pg-gigbar', null, h('i', { style: { width: `${Math.round(pctTo * 100)}%` } })),
    h('small.pg-gigleft', { text: `${n(left)} XP to go` }));
  box.title = 'Preview it in the highway’s venue list (locked venues show a preview)';
  return box;
}

function overview(body, st) {
  if (!st) {
    body.append(h('p.np-fine', { text: 'Reading your progress…' }));
    return;
  }
  body.append(hero(st));
  // challenges, side by side
  const ch = h('section.card.pg-chal', { 'aria-label': 'Today’s challenges' }, h('div.card-head', null, h('h2', { text: 'Today' }), h('span.grow'), h('small.np-fine', { text: 'New ones at midnight · optional' })));
  for (const c of st.challenges) ch.append(challengeRow(c, tagOf(c)));
  const wk = h('section.card.pg-chal', { 'aria-label': 'This week' }, h('div.card-head', null, h('h2', { text: 'This week' }), h('span.grow'), h('small.np-fine', { text: st.weekLeft > 1 ? `${st.weekLeft} days left` : 'Last day' })));
  for (const c of st.weekly || []) {
    const r = challengeRow(c, tagOf(c));
    if (c.songId) {
      r.classList.add('go');
      r.title = 'Play it now';
      r.onclick = () => actions.playAlong(c.songId);
    }
    wk.append(r);
  }
  body.append(h('div.pg-two', null, ch, wk));
  const d = P.data;
  if (d) body.append(h('div.ptop', null, spotlight(d), upNext(d)));
  body.append(h('div.pg-three', null, recentCard(st), d ? highlights(d) : h('span'), trendsCard(d)));
  body.append(takesCard());
  const todo = (st.firsts || []).filter((f) => !f.done);
  if (todo.length) {
    const grid = h('div.lv-try-grid');
    for (const f of todo.slice(0, 4)) {
      const b = h('button.lv-try', { type: 'button', title: f.how }, h('span.lv-xp', { text: `+${f.xp}` }), h('b', { text: f.name }), h('small', { text: f.how }));
      b.onclick = () => goTo(f.go);
      grid.append(b);
    }
    body.append(h('section.card.lv-try', { 'aria-label': 'Things to try' }, h('div.card-head', null, h('h2', { text: 'Things to try' }), h('span.grow'), h('small.np-fine', { text: `${st.firsts.length - todo.length} of ${st.firsts.length} done` })), grid));
  }
}

const EV_ICON = { level: 'star', venue: 'sparkle', trophy: 'check', mastery: 'music', best: 'chart', first: 'play', migrate: 'repeat' };
function eventRow(e, songs = true) {
  const s = e.songId ? state.songs.get(e.songId) : null;
  const el = h(`div.pg-ev.ev-${e.type}${e.tier !== undefined ? `.t${e.tier}` : ''}`, null,
    h('span.pg-evic', { html: e.type === 'trophy' ? CUP : icon(EV_ICON[e.type] || 'star') }),
    h('div.pg-evtext', null, h('b', { text: e.text }), h('small', { text: fmtDate(e.at, { month: 'short', day: 'numeric', year: 'numeric' }) })),
    songs && s ? coverEl(s, 40, 'sm') : null);
  if (s) {
    el.classList.add('go');
    el.title = 'Play it';
    el.onclick = () => actions.playAlong(s.id);
  }
  return el;
}

function recentCard(st) {
  const card = h('section.card.pg-recent', { 'aria-label': 'Recent accomplishments' }, h('div.card-head', null, h('h2', { text: 'Recent accomplishments' }), h('span.grow')));
  const list = (st.timeline || []).slice(0, 6);
  if (!list.length) card.append(h('p.np-fine', { text: 'Your milestones show up here: levels, venues, new bests, songs mastered.' }));
  for (const e of list) card.append(eventRow(e));
  const more = h('button.btn.small.ghost', { type: 'button', text: 'Whole history' });
  more.onclick = () => (P.tab = 'history', render());
  if (list.length) card.querySelector('.card-head').append(more);
  return card;
}

function trendsCard(d) {
  const seg = h('div.gseg', { role: 'group', 'aria-label': 'Period' });
  for (const [id, label] of [['week', 'Week'], ['month', 'Month'], ['all', 'All']]) {
    const b = h('button', { type: 'button', text: label, 'aria-pressed': String(P.period === id) });
    b.onclick = () => ((P.period = id), load());
    seg.append(b);
  }
  const card = h('section.card.pg-trend', { 'aria-label': 'Practice trends' }, h('div.card-head', null, h('h2', { text: 'Practice' }), h('span.grow'), seg));
  if (!d) return card;
  const diff = d.prevSeconds !== null && d.prevSeconds !== undefined ? d.seconds - d.prevSeconds : null;
  card.append(h('div.pg-mini', null,
    h('div', null, h('b', { text: fmtTime(d.seconds) }), h('small', { html: diff === null ? 'playing' : `<span class="${diff >= 0 ? 'up' : 'down'}">${diff >= 0 ? '+' : '−'}${fmtTime(Math.abs(diff))}</span>` })),
    h('div', null, h('b', { text: String(d.songs) }), h('small', { text: d.newSongs ? `songs · ${d.newSongs} new` : 'songs' })),
    h('div', null, h('b', { text: d.accuracy === null ? '–' : `${Math.round(d.accuracy * 100)}%` }), h('small', { html: d.accuracyChange === null || d.accuracyChange === undefined ? 'accuracy' : `accuracy <span class="${d.accuracyChange >= 0 ? 'up' : 'down'}">${d.accuracyChange >= 0 ? '+' : '−'}${Math.abs(Math.round(d.accuracyChange * 100))}</span>` }))));
  const bars = h('div.bars');
  const list = P.period === 'week' ? d.perDay.slice(-7) : d.perDay;
  const top = Math.max(30, ...list.map((x) => x.minutes));
  const today = list.length - 1;
  list.forEach((x, i) => {
    const dt = new Date(x.at);
    const lab = list.length <= 7 ? dateText(dt, { weekday: 'short' }) : i % 5 === 4 || i === today ? String(dt.getDate()) : '';
    bars.append(h(`div.bar${i === today ? '.today' : ''}${x.minutes ? '' : '.zero'}`, { title: `${dateText(dt)}: ${x.minutes} min` }, h('span.m', { text: x.minutes && list.length <= 7 ? `${x.minutes}m` : '' }), h('i', { style: { height: `${Math.max(3, Math.round((x.minutes / top) * 110))}px` } }), h('span.d', { text: lab })));
  });
  card.append(bars);
  return card;
}

/** Your newest recordings (everything is in Backstage › My clips). */
function takesCard() {
  const allRec = h('button.btn.small.ghost', { type: 'button', text: 'All my clips' });
  allRec.onclick = () => import('./greenroom.js').then((r) => r.openGreenRoom({ tab: 'mine' }));
  const card = h('section.card.ptakes', { 'aria-label': 'Recordings' }, h('div.card-head', null, h('h2', { text: 'Recordings' }), h('span.grow'), allRec));
  if (!P.takes.length) card.append(h('p.np-fine', { text: 'Nothing recorded yet. Record a clip from the highway’s Tools, or use the looper in Jam.' }));
  const grid = h('div.pg-takes');
  for (const t of P.takes.slice(0, 4)) {
    const on = P.playing === t.id;
    const play = h('button.round-play.sm', { type: 'button', 'aria-label': on ? 'Stop' : 'Play', html: icon(on ? 'stop' : 'play') });
    play.onclick = () => (t.kind === 'video' ? import('./greenroom.js').then((r) => r.openGreenRoom({ tab: 'mine', focus: t.id })) : playTake(t));
    const when = new Date(t.at);
    const meta = `${t.kind === 'video' ? 'Video · ' : ''}${dateText(when, { weekday: 'short', month: 'short', day: 'numeric' })} · ${Math.floor((t.seconds || 0) / 60)}:${String(Math.round((t.seconds || 0) % 60)).padStart(2, '0')}`;
    grid.append(h(`div.take${on ? '.on' : ''}`, null, play, h('div.tk-text', null, h('b', { text: t.name }), h('span', { text: meta }))));
  }
  card.append(grid);
  return card;
}

// --------------------------------------------------------------- career --
function career(body, st) {
  const l = P.life;
  if (!l) {
    body.append(h('p.np-fine', { text: 'Reading your career…' }));
    return;
  }
  const big = h('div.pg-bignums');
  const BIG = [
    ['Chords played', l.chordsPlayed, `${n(l.chordsHit)} hit`, 'chords'],
    ['Notes hit', l.notesHit, `of ${n(l.notes)} played`, 'notes'],
    ['Hours playing', l.seconds, `${n(l.sessions)} sessions`, 'hours'],
  ];
  for (const [label, v, sub, key] of BIG) big.append(h(`div.card.pg-bignum.k-${key}`, null, h('small', { text: label }), h('b', null, key === 'hours' ? counter(v, `life-${key}`, fmtHours) : counter(v, `life-${key}`)), h('span', { text: sub })));
  body.append(big);
  const pc = (x) => (x === null || x === undefined ? '–' : `${Math.round(x * 1000) / 10}%`);
  const cells = [
    ['Songs played', n(l.songsPlayed), 'sessions with a song'],
    ['Different songs', n(l.uniqueSongs), `${n(l.uniqueArtists)} artists`],
    ['Whole songs', n(l.fullSongs), `${n(l.bassFull)} on bass`],
    ['Parts mastered', n(l.masteredSongs), 'song parts at Mastered'],
    ['Best accuracy', pc(l.bestAccuracy), 'a whole song, full speed'],
    ['Average accuracy', pc(l.averageAccuracy), 'every judged note'],
    ['Perfect songs', n(l.perfectSongs), `${n(l.songs95)} at 95%+`],
    ['Personal bests', n(l.personalBests), 'beaten by 2 points or more'],
    ['Longest note streak', n(l.bestStreak), 'notes in a row'],
    ['Clean sections', n(l.cleanSections), 'no misses, 10+ notes'],
    ['Days played', n(l.daysPlayed), `best run: ${n(l.longestDayRun)} in a row`],
    ['Tunings', n(l.tunings), 'different tunings'],
    ['Challenges done', n(st ? st.challengesDone : 0), 'daily and weekly'],
    ['Total XP', n(st ? st.xp : 0), st && st.legacyLevel ? `was level ${st.legacyLevel} before the Road to 100` : 'on the Road to 100'],
    ['Venues unlocked', st ? `${st.unlocked.length} / ${st.venues.length}` : '–', 'on the highway'],
    ['First played', fmtDate(l.firstAt), l.firstAt ? `${n(Math.round((Date.now() - l.firstAt) / 864e5))} days ago` : ''],
  ];
  const grid = h('div.pg-statgrid');
  for (const [label, v, sub] of cells) grid.append(h('div.pg-stat', null, h('small', { text: label }), h('b', { text: v }), h('span', { text: sub })));
  body.append(h('section.card.pg-stats', { 'aria-label': 'All-time statistics' }, h('div.card-head', null, h('h2', { text: 'All time' }), h('span.grow'), h('small.np-fine', { text: 'Kept for good: resetting levels never changes these' })), grid));
  // year in review + techniques + records
  const year = String(new Date().getFullYear());
  const y = (l.years || []).find((x) => x.year === year);
  const yr = h('section.card.pg-year', { 'aria-label': 'Year in review' }, h('div.card-head', null, h('h2', { text: `${year} so far` })));
  if (y) yr.append(h('div.pg-mini', null,
    h('div', null, h('b', { text: fmtHours(y.seconds) }), h('small', { text: 'hours' })),
    h('div', null, h('b', { text: n(y.songs) }), h('small', { text: 'songs' })),
    h('div', null, h('b', { text: n(y.chords) }), h('small', { text: 'chords' })),
    h('div', null, h('b', { text: n(y.days) }), h('small', { text: 'days' }))));
  const months = h('div.pg-months');
  const top = Math.max(60, ...(l.months || []).map((m) => m.minutes));
  for (const m of l.months || []) months.append(h(`div${m.minutes ? '' : '.zero'}`, { title: `${dateText(new Date(m.at), { month: 'long', year: 'numeric' })}: ${fmtTime(m.minutes * 60)}` }, h('i', { style: { height: `${Math.max(3, Math.round((m.minutes / top) * 90))}px` } }), h('small', { text: dateText(new Date(m.at), { month: 'narrow' }) })));
  yr.append(h('div.pspot-label', { text: 'Minutes a month, the last 12' }), months);
  const tech = h('section.card.pg-tech', { 'aria-label': 'Techniques' }, h('div.card-head', null, h('h2', { text: 'By kind of note' })));
  const kinds = Object.entries(l.kinds || {}).filter(([, v]) => v[1] >= 10).sort((a, b) => b[1][1] - a[1][1]);
  if (!kinds.length) tech.append(h('p.np-fine', { text: 'Play with scoring on and the kinds of notes you hit show here.' }));
  for (const [k, [hit, all]] of kinds) tech.append(h(`div.ph-kind.${band(hit / all)}`, null, h('span', { text: KIND_LABEL[k] || k }), h('span.bar', null, h('i', { style: { width: `${Math.round((hit / all) * 100)}%` } })), h('b', { text: `${n(hit)} / ${n(all)}` })));
  const rec = h('section.card.pg-records', { 'aria-label': 'Personal records' }, h('div.card-head', null, h('h2', { text: 'Records' })));
  const recRow = (label, r, val) => {
    const s = r && r.songId ? state.songs.get(r.songId) : null;
    const el = h('div.pg-rec', null, s ? coverEl(s, 44, 'sm') : h('span.pg-rec-blank'), h('div', null, h('small', { text: label }), h('b', { text: val }), h('span', { text: s ? `${s.title} · ${fmtDate(r.at)}` : r ? fmtDate(r.at) : '' })));
    if (s) (el.classList.add('go'), (el.onclick = () => actions.playAlong(s.id)));
    return el;
  };
  rec.append(
    recRow('Best accuracy', l.records && l.records.bestAccuracy, pc(l.bestAccuracy)),
    recRow('Longest streak', l.records && l.records.bestStreak, `${n(l.bestStreak)} notes`),
    recRow('Longest session', null, fmtTime(l.longestSession)),
    recRow('Most days in a row', null, `${n(l.longestDayRun)} days`));
  body.append(h('div.pg-three', null, yr, tech, rec));
  if (l.recovered) body.append(h('p.np-fine', { text: `Your history file was damaged once and was ${l.recovered.from ? 'recovered from a backup' : 'started over'}; the damaged copy is kept next to it.` }));
}

// --------------------------------------------------------- achievements --
function achievements(body, st) {
  if (!st || !st.trophies) return;
  const counts = METAL.map((_, i) => st.trophies.filter((t) => t.tier >= i).length);
  const total = st.trophies.reduce((a, t) => a + t.tiers.length, 0);
  const got = st.trophies.reduce((a, t) => a + t.tier + 1, 0);
  const sum = h('section.card.pg-achsum', null,
    h('div.pg-achbig', null, h('b', { text: `${got}` }), h('span', { text: `of ${total} tiers` })),
    h('div.pg-metals', null, ...METAL.map((m, i) => h(`span.pg-metal.metal-${m}`, { title: `${METAL_NAME[i]}: ${counts[i]}` }, h('i', { html: CUP }), h('b', { text: String(counts[i]) }), h('small', { text: METAL_NAME[i] })))));
  // the closest next tiers
  const near = st.trophies.filter((t) => t.next).map((t) => {
    const from = t.tier >= 0 ? t.tiers[t.tier] : 0;
    return { t, k: Math.max(0, Math.min(1, (t.value - from) / (t.next - from))) };
  }).sort((a, b) => b.k - a.k).slice(0, 3);
  const nextBox = h('div.pg-achnext', null, h('div.pg-eyebrow', { text: 'Closest next' }), ...near.map(({ t, k }) => h('div.pg-achn', null, h('b', { text: `${t.name} · ${METAL_NAME[t.tier + 1]}` }), h('div.lv-cbar', null, h('i', { style: { width: `${Math.round(k * 100)}%` } })), h('small', { text: `${n(t.value)} / ${n(t.next)}${t.nextXp ? ` · +${t.nextXp} XP` : ''}` }))));
  sum.append(nextBox);
  body.append(sum);
  const groups = [...new Set(st.trophies.map((t) => t.group || 'Other'))];
  for (const g of groups) {
    const grid = h('div.lv-tro-grid');
    for (const t of st.trophies.filter((x) => (x.group || 'Other') === g)) {
      const m = t.tier >= 0 ? METAL[t.tier] : 'none';
      const from = t.tier >= 0 ? t.tiers[t.tier] : 0;
      const pctTo = t.next ? Math.max(0, Math.min(1, (t.value - from) / (t.next - from))) : 1;
      const pips = h('span.lv-pips', null, ...t.tiers.map((need, i) => h(`i.${i <= t.tier ? METAL[i] : 'off'}`, { title: `${METAL_NAME[i]}: ${n(need)}` })));
      grid.append(h(`div.lv-tro.metal-${m}${t.tier < 0 ? '.locked' : ''}`, { title: `${t.what}. Tiers: ${t.tiers.map((x, i) => `${METAL_NAME[i]} ${n(x)}`).join(' · ')}` },
        h('span.lv-cup', { html: CUP }),
        h('div.lv-trotext', null,
          h('b', { text: t.name }),
          h('small', { text: t.what }),
          h('div.lv-cbar', null, h('i', { style: { width: `${Math.round(pctTo * 100)}%` } })),
          h('div.lv-trofoot', null, h('span', { text: t.next ? `${n(t.value)} / ${n(t.next)}${t.tier >= 0 ? '' : ' for bronze'}` : `${n(t.value)} · all done` }), pips))));
    }
    body.append(h('section.card.pg-group', { 'aria-label': g }, h('div.card-head', null, h('h2', { text: g })), grid));
  }
  // titles
  if (st.titles && st.titles.length) {
    const earned = st.titles.filter((t) => t.earned);
    const tl = h('section.card.lv-titles', { 'aria-label': 'Titles' }, h('div.card-head', null, h('h2', { text: 'Titles for your Backstage pass' }), h('span.grow'), h('small.np-fine', { text: `${earned.length} of ${st.titles.length} earned` })));
    const chips = h('div.lv-tchips');
    for (const t of st.titles) {
      const on = st.title && st.title.id === t.id;
      const b = h(`button.lv-tchip${t.earned ? '' : '.locked'}${on ? '.on' : ''}`, { type: 'button', title: t.earned ? (on ? 'On your pass now' : 'Wear it on your Backstage pass') : t.how, 'aria-pressed': String(!!on) }, h('b', { text: t.name }), t.earned ? null : h('small', { text: t.how }));
      if (t.earned) b.onclick = () => wearTitle(on ? null : t.id);
      else b.disabled = true;
      chips.append(b);
    }
    tl.append(chips);
    body.append(tl);
  }
}

// ------------------------------------------------------------ mastery --
const TIER_COLORS = ['#4a443d', '#6f7b86', '#8c7bff', '#33c8e0', '#9bdb5a', '#ffb547', '#ff6b3d'];
function songsTab(body) {
  const l = P.life;
  if (!l) {
    body.append(h('p.np-fine', { text: 'Reading your songs…' }));
    return;
  }
  const all = Object.values(l.masteryBySong || {}).filter((m) => state.songs.has(m.songId));
  const counts = [0, 0, 0, 0, 0, 0, 0];
  for (const m of all) counts[m.tier]++;
  counts[0] = Math.max(0, state.songs.size - new Set(all.map((m) => m.songId)).size);
  const ladder = h('div.pg-ladder', { role: 'list' });
  (l.mastery || []).forEach((t) => {
    const b = h(`button.pg-rung${P.masteryTier === t.tier ? '.on' : ''}`, { type: 'button', role: 'listitem', style: { '--rung': TIER_COLORS[t.tier] }, title: t.how || 'Songs in your library you haven’t played yet', 'aria-pressed': String(P.masteryTier === t.tier) },
      h('b', { text: n(counts[t.tier]) }), h('span', { text: t.name }), h('small', { text: t.how || 'in your library' }));
    b.onclick = () => ((P.masteryTier = P.masteryTier === t.tier ? null : t.tier), render());
    ladder.append(b);
  });
  body.append(h('section.card.pg-mastery', { 'aria-label': 'Song mastery' }, h('div.card-head', null, h('h2', { text: 'Song mastery' }), h('span.grow'), h('small.np-fine', { text: 'Per song and part · full speed · whole songs with 50+ notes' })), ladder));
  const row = (m, why) => {
    const s = state.songs.get(m.songId);
    const el = h('button.pw-row.pg-mrow', { type: 'button', title: 'Play it' }, coverEl(s, 52, 'sm'),
      h('span.pw-text', null, h('b', { text: s.title }), h('span', { text: `${s.artist || ''} · ${{ lead: 'Lead', rhythm: 'Rhythm', bass: 'Bass' }[m.part] || m.part}${why ? ` · ${why}` : ''}` })),
      h('span.pg-mtag', { style: { '--rung': TIER_COLORS[m.tier] }, text: m.name }),
      h(`b.pw-best${m.best >= 0.9 ? '.top' : ''}`, { text: m.best ? `${Math.round(m.best * 100)}%` : '–' }));
    el.onclick = () => actions.playAlong(s.id);
    return el;
  };
  if (P.masteryTier !== null && P.masteryTier > 0) {
    const list = all.filter((m) => m.tier === P.masteryTier).sort((a, b) => b.last - a.last);
    const card = h('section.card.pg-mlist', null, h('div.card-head', null, h('h2', { text: `${(l.mastery[P.masteryTier] || {}).name}: ${list.length}` })));
    for (const m of list.slice(0, 60)) card.append(row(m));
    if (list.length > 60) card.append(h('p.np-fine', { text: `and ${list.length - 60} more` }));
    body.append(card);
  } else if (P.masteryTier === 0) {
    body.append(h('p.np-fine', { text: 'Songs you haven’t played yet are under Songs › Your level › Not played yet.' }));
  }
  // nearly there, and opportunities
  const nearly = all.filter((m) => m.tier === 5 || (m.tier === 4 && m.best >= 0.86)).sort((a, b) => b.best - a.best || b.last - a.last).slice(0, 8);
  const grow = all.filter((m) => (m.tier === 3 || m.tier === 2) && Date.now() - m.last < 60 * 864e5).sort((a, b) => b.last - a.last).slice(0, 8);
  const c1 = h('section.card.pg-mlist', null, h('div.card-head', null, h('h2', { text: 'Nearly mastered' })));
  if (!nearly.length) c1.append(h('p.np-fine', { text: 'Songs at 86% and up show here, with what each still needs.' }));
  for (const m of nearly) c1.append(row(m, m.tier === 5 ? (m.best >= 0.95 ? `${m.runs90}/2 runs at 90%+` : 'needs a 95% run') : 'needs 90% for Expert'));
  const c2 = h('section.card.pg-mlist', null, h('div.card-head', null, h('h2', { text: 'Room to improve' })));
  if (!grow.length) c2.append(h('p.np-fine', { text: 'Songs you’ve played lately that are still climbing show here.' }));
  for (const m of grow) c2.append(row(m, m.tier === 2 ? 'aim for 60%' : 'aim for 80%'));
  body.append(h('div.pg-two', null, c1, c2));
  body.append(mastery());
}

// ------------------------------------------------------------- history --
function history(body, st) {
  const l = P.life;
  const evs = [...((st && st.timeline) || [])];
  if (st && st.devLog) for (const e of st.devLog.filter((x) => x.type === 'migrate')) evs.push({ at: e.at, type: 'migrate', text: e.text });
  if (l && l.firstAt) evs.push({ at: l.firstAt, type: 'first', text: 'Your first song in Stagehand' });
  evs.sort((a, b) => b.at - a.at);
  const card = h('section.card.pg-history', { 'aria-label': 'Career timeline' }, h('div.card-head', null, h('h2', { text: 'Your career' }), h('span.grow'), h('small.np-fine', { text: `${n(evs.length)} moments` })));
  if (!evs.length) card.append(h('p.np-fine', { text: 'Play a few songs and your story starts here.' }));
  let month = '';
  for (const e of evs) {
    const m = dateText(new Date(e.at), { month: 'long', year: 'numeric' });
    if (m !== month) (month = m), card.append(h('div.pg-month', { text: m }));
    card.append(eventRow(e));
  }
  body.append(card);
}

// ------------------------------------------------- 3.9: spotlight + highlights --
const PART = { lead: 'Lead', rhythm: 'Rhythm', bass: 'Bass' };
const band = (a) => (a >= 0.9 ? 'g' : a >= 0.7 ? 'y' : a >= 0.5 ? 'o' : 'r');
const pctOf = (a) => `${Math.round(a * 100)}%`;
// bars from 40 % up, so the differences that matter show
// 4.0.9: as tall as the accuracy (below 40% used to look empty)
const barH = (a) => Math.max(4, Math.min(100, Math.round(a * 100)));

/** Your most recent run, big: score, change, sections, what went well and what to work on. */
function spotlight(d) {
  const L = d.last;
  const s = L && state.songs.get(L.songId);
  if (!L || !s) {
    return h('section.card.pspot.vacant', null, h('div.pspot-empty', null, decorativeImage('empty-progress'), h('div', null, h('b', { text: 'Play a song with your guitar plugged in' }), h('p', { text: 'Your run shows up here straight away: your score, each section, and what to work on next.' }))));
  }
  const card = h('section.card.pspot', { 'aria-label': 'Your last song' });
  const ring = h(`div.pspot-ring.${band(L.accuracy)}`, { style: { '--deg': `${Math.round(L.accuracy * 360)}deg` } }, h('b', { text: pctOf(L.accuracy) }), h('span', { text: 'accuracy' }));
  const delta = L.prevLast !== null && L.prevLast !== undefined ? L.accuracy - L.prevLast : null;
  const isBest = L.prevBest === null || L.prevBest === undefined ? L.notes >= 20 : L.accuracy > L.prevBest + 0.005;
  const when = new Date(L.at);
  const ago = Math.round((Date.now() - L.at) / 60000);
  const whenTxt = ago < 1 ? 'just now' : ago < 60 ? `${ago} min ago` : when.toLocaleString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' });
  const chips = h('div.pspot-chips');
  if (isBest) chips.append(h('span.chip-best', { html: `${icon('star')}<span>${L.prevBest === null || L.prevBest === undefined ? 'First score' : 'New best'}</span>` }));
  if (delta !== null && Math.abs(delta) >= 0.005) chips.append(h(`span.${delta > 0 ? 'chip-up' : 'chip-down'}`, { text: `${delta > 0 ? '+' : '−'}${Math.abs(Math.round(delta * 100))} since last time` }));
  if (L.bestStreak) chips.append(h('span', { text: `${L.bestStreak} in a row` }));
  chips.append(h('span', { text: `${L.hit}/${L.notes} notes` }));
  if (L.runs > 1) chips.append(h('span', { text: `run ${L.runs}` }));
  const text = h('div.pspot-text', null, h('div.pspot-eyebrow', { text: `Your last song · ${whenTxt}` }), h('h2', { text: s.title }), h('div.pspot-sub', { text: `${s.artist || ''}${L.part ? ` · ${PART[L.part] || L.part}` : ''}` }), chips);
  const top = h('div.pspot-top', null, coverEl(s, 128, 'md'), ring, text);
  card.append(top);
  const secs = (L.sections || []).map(([label, hit, notes]) => ({ label, hit, notes, acc: notes ? hit / notes : 0 })).filter((x) => x.notes);
  if (secs.length) {
    const bars = h('div.pspot-bars');
    for (const x of secs) bars.append(h(`div.pspot-bar.${band(x.acc)}`, { title: `${x.label}: ${pctOf(x.acc)} (${x.hit}/${x.notes})` }, h('i', { style: { height: `${barH(x.acc)}%` } }), h('span', { text: x.label })));
    card.append(h('div.pspot-label', { text: 'Section by section' }), bars);
    const solid = secs.filter((x) => x.notes >= 4);
    const best = solid.length ? solid.reduce((a, b) => (b.acc > a.acc ? b : a)) : null;
    const worst = solid.length > 1 ? solid.reduce((a, b) => (b.acc < a.acc ? b : a)) : null;
    const notes = h('div.pspot-notes');
    if (best) notes.append(h('div.good', null, h('span', { html: icon('star') }), h('span', null, 'Nailed it: ', h('b', { text: `${best.label} · ${pctOf(best.acc)}` }))));
    if (worst && worst !== best && worst.acc < 0.95) notes.append(h('div.work', null, h('span', { html: icon('repeat') }), h('span', null, 'Next to work on: ', h('b', { text: `${worst.label} · ${pctOf(worst.acc)}` }), h('small', { text: ' — repeat it slower on the highway (hover the section strip, ⟲), then speed it up.' }))));
    card.append(notes);
  }
  const kinds = Object.entries(L.kinds || {}).filter(([, [, n]]) => n >= 3);
  if (kinds.length > 1) {
    const k = h('div.pspot-kinds');
    for (const [kind, [hit, n]] of kinds) k.append(h(`span.${band(hit / n)}`, { title: `${hit}/${n}` }, `${KIND_LABEL[kind] || kind} `, h('b', { text: pctOf(hit / n) })));
    card.append(k);
  }
  const play = h('button.btn.glow-primary', { type: 'button', html: `${icon('play')}<span>Play it again</span>` });
  play.onclick = () => actions.playAlong(s.id);
  card.append(h('div.pspot-actions', null, play));
  return card;
}

/**
 * What to practise next, with one button: the weakest section of a song you're
 * working on (repeat it slowly), else a song that's close to mastered, else a
 * song you haven't tried yet.
 */
function upNext(d) {
  const card = h('section.card.pnext', { 'aria-label': 'Up next' }, h('div.pspot-eyebrow', { text: 'Up next' }));
  let pick = null;
  for (const w of d.working || []) {
    const s = state.songs.get(w.songId);
    if (!s) continue;
    const secs = (w.sections || []).filter((x) => x.acc !== null && x.acc !== undefined);
    const low = secs.length ? secs.reduce((a, b) => (b.acc < a.acc ? b : a)) : null;
    if (low && low.acc < 0.9 && (!pick || low.acc < pick.acc)) pick = { s, label: low.label, acc: low.acc, why: 'section' };
  }
  if (!pick) {
    const close = [...state.songs.values()].filter((s) => accBand(s) === 'close').sort((a, b) => (state.best[b.id].best || 0) - (state.best[a.id].best || 0))[0];
    if (close) pick = { s: close, acc: state.best[close.id].best, why: 'close' };
  }
  if (!pick) {
    const fresh = [...state.songs.values()].filter((s) => accBand(s) === 'unplayed' && s.audioEntry !== null)[0];
    if (fresh) pick = { s: fresh, why: 'new' };
  }
  if (!pick) {
    card.append(h('h2', { text: 'Pick any song' }), h('p.np-fine', { text: 'Add songs to your library and Stagehand will suggest what to practise.' }));
    return card;
  }
  const title = pick.why === 'section' ? `${pick.label} in ${pick.s.title}` : pick.s.title;
  const why =
    pick.why === 'section'
      ? `Your weakest part right now, at ${pctOf(pick.acc)}. On the highway, hover its name in the section strip and press ⟲ to repeat it; start at 70% speed and speed up as it gets clean.`
      : pick.why === 'close'
        ? `You’re at ${pctOf(pick.acc)}: close to mastering it (90%). One or two clean runs could do it.`
        : 'A song you haven’t played yet. Something new keeps it fun.';
  const go = h('button.btn.glow-primary', { type: 'button', html: `${icon('play')}<span>${pick.why === 'section' ? 'Practise it' : 'Play it'}</span>` });
  go.onclick = () => actions.playAlong(pick.s.id);
  card.append(h('div.pnext-row', null, coverEl(pick.s, 96, 'md'), h('div', null, h('h2', { text: title }), h('div.pspot-sub', { text: pick.s.artist || '' }))), h('p.pnext-why', { text: why }), h('div.pspot-actions', null, go));
  return card;
}

/** Your whole library by how well you play it; click a part to see those songs. */
function mastery() {
  const all = [...state.songs.values()];
  const n = { mastered: 0, close: 0, learning: 0, unplayed: 0 };
  for (const s of all) n[accBand(s)]++;
  const total = all.length || 1;
  const NAME = { mastered: '90% and up', close: '60–89%', learning: 'Learning', unplayed: 'Not played yet' };
  const bar = h('div.pm-bar');
  const legend = h('div.pm-legend');
  for (const k of ['mastered', 'close', 'learning', 'unplayed']) {
    if (n[k]) bar.append(h(`i.pm-${k}`, { style: { width: `${(n[k] / total) * 100}%` }, title: `${NAME[k]}: ${n[k]}` }));
    const b = h(`button.pm-key.pm-${k}`, { type: 'button', title: `Show these songs` }, h('span.dot'), h('span', { text: NAME[k] }), h('b', { text: String(n[k]) }));
    b.onclick = () => {
      setView({ kind: 'acc', id: k });
      setPage('songs');
    };
    legend.append(b);
  }
  return h('section.card.pmastery', { 'aria-label': 'Your songs' }, h('div.card-head', null, h('h2', { text: 'Your library by best score' }), h('span.np-fine', { text: `${n.mastered} of ${all.length} at 90% or better` })), bar, legend);
}

/** Encouragement built from what you actually did. */
function highlights(d) {
  const items = [];
  for (const im of d.improved || []) {
    const s = state.songs.get(im.songId);
    if (s) items.push(['up', `<b>${esc(s.title)}</b> went from ${pctOf(im.from)} to ${pctOf(im.to)} <span class="up">+${Math.round(im.gain * 100)}</span>`]);
  }
  if (d.streak >= 2) items.push(['fire', `<b>${d.streak} days in a row.</b> ${d.streak >= d.bestStreak ? 'Your longest streak yet.' : `Your best is ${d.bestStreak}: keep going.`}`]);
  else if (d.streak === 1) items.push(['fire', 'You played today. Come back tomorrow to start a streak.']);
  if (d.bestRun >= 10) items.push(['star', `Longest run of notes without a miss: <b>${d.bestRun}</b>.`]);
  const kinds = (d.kinds || []).filter((k) => k.notes >= 10);
  if (kinds.length) {
    const top = kinds.reduce((a, b) => (b.acc > a.acc ? b : a));
    const low = kinds.reduce((a, b) => (b.acc < a.acc ? b : a));
    items.push(['good', `Your strongest: <b>${esc(KIND_LABEL[top.kind] || top.kind)}</b> at ${pctOf(top.acc)}.`]);
    if (low !== top && low.acc < 0.85) items.push(['work', `Room to grow: <b>${esc(KIND_LABEL[low.kind] || low.kind)}</b> at ${pctOf(low.acc)}. Pick a song that's full of them and slow it down.`]);
  }
  if (d.newSongs) items.push(['new', `You tried <b>${d.newSongs} new song${d.newSongs === 1 ? '' : 's'}</b>.`]);
  if (!items.length) items.push(['new', 'Play a few songs and Stagehand will point out what’s getting better and what to try next.']);
  const card = h('section.card.phigh', { 'aria-label': 'Highlights' }, h('div.card-head', null, h('h2', { text: 'Highlights' })));
  const ICON = { up: 'chart', fire: 'sparkle', star: 'star', good: 'check', work: 'repeat', new: 'music' };
  for (const [kind, html] of items.slice(0, 7)) card.append(h(`div.ph-item.${kind}`, null, h('span.ph-ic', { html: icon(ICON[kind]) }), h('span', { html })));
  // accuracy per kind of note, as bars
  if (kinds.length) {
    const kb = h('div.ph-kinds');
    for (const k of kinds) kb.append(h(`div.ph-kind.${band(k.acc)}`, null, h('span', { text: KIND_LABEL[k.kind] || k.kind }), h('span.bar', null, h('i', { style: { width: `${Math.round(k.acc * 100)}%` } })), h('b', { text: pctOf(k.acc) })));
    card.append(h('div.pspot-label', { text: 'By kind of note' }), kb);
  }
  return card;
}


/** Takes play through the same output as the song. */
async function playTake(t) {
  if (P.audio) {
    try {
      P.audio.stop();
    } catch (_) {}
  }
  if (P.playing === t.id) {
    P.playing = null;
    P.audio = null;
    return render();
  }
  try {
    const { ctx, node } = await engine.extraOut();
    const buf = await (await fetch(api.takeUrl(t.id))).arrayBuffer();
    const audio = await ctx.decodeAudioData(buf);
    const src = ctx.createBufferSource();
    src.buffer = audio;
    src.connect(node);
    src.onended = () => {
      if (P.audio === src) {
        P.audio = null;
        P.playing = null;
        render();
      }
    };
    src.start();
    P.audio = src;
    P.playing = t.id;
    render();
  } catch (err) {
    toast({ title: 'Couldn’t play the take', message: err.message, kind: 'err' });
  }
}


/** One challenge: a tick, the name, a bar when it takes more than one go, and the points. */
function challengeRow(c, tag) {
  const short = c.name.replace(/^Daily gig: /, '').replace(/^Song of the week: /, '');
  const name = short.charAt(0).toUpperCase() + short.slice(1);
  const bar = c.target > 1 && !c.done ? h('div.lv-cbar', null, h('i', { style: { width: `${Math.round((c.value / c.target) * 100)}%` } })) : null;
  const sub = c.songId ? h('small.lv-csub', { text: [c.artist, c.best ? `Best this week: ${Math.round(c.best * 100)}%` : 'Not played this week'].filter(Boolean).join(' · ') }) : null;
  const count = c.target > 1 ? `${n(c.value)} / ${n(c.target)}${c.unit ? ` ${c.unit}` : ''} · ` : '';
  return h(`div.lv-c${c.done ? '.done' : ''}${c.bonus ? '.gig' : ''}${c.songId ? '.sotw' : ''}`, null,
    h('span.lv-check', { html: c.done ? icon('check') : '' }),
    h('div.lv-ctext', null, tag ? h('span.lv-tag', { text: tag }) : null, h('b', { text: name }), sub, bar),
    h('span.lv-xp', { text: c.done ? `Done · +${c.xp}` : `${count}+${c.xp} XP` }));
}
const tagOf = (c) => (c.bonus ? 'Daily gig' : c.songId ? 'Song of the week' : c.kind === 'backstage' ? 'Backstage' : c.kind === 'explore' ? 'Try something' : '');


function goTo(page) {
  if (page === 'greenroom') import('./greenroom.js').then((g) => g.openGreenRoom({ tab: 'room' }));
  else if (page === 'discover') setView({ kind: 'discover', id: 'search' });
  else setPage(page || 'songs');
}

// live: while Progress is open, what you're playing is logged and shown every few seconds
setInterval(() => {
  if (state.page !== 'progress') return;
  if (window.__shPractice && engine.playing) window.__shPractice.checkpoint();
  else load();
}, 8000);

on('page', () => state.page === 'progress' && load());
on('stats', () => state.page === 'progress' && load());
on('levels', () => state.page === 'progress' && P.data && render());
on('page', () => state.page === 'progress' && loadLevels());
on('takes', () => state.page === 'progress' && load());
