/** Progress: time playing, streak, songs, accuracy, minutes per day, songs you're working on, and your takes. */
import { api } from './api.js';
import { state, on, setPage, setView, accBand } from './store.js';
import { h, icon, esc, toast, showMenu, confirmDialog } from './ui.js';
import * as actions from './actions.js';
import { KIND_LABEL } from './scorecard.js';
import { coverEl } from './shell.js';
import { engine } from './stage.js';
import { L, loadLevels } from './rewards.js';

const root = document.getElementById('page-progress');
const P = { period: 'week', data: null, takes: [], playing: null, audio: null };

function fmtTime(sec) {
  const m = Math.round(sec / 60);
  if (m < 60) return `${m} m`;
  return `${Math.floor(m / 60)} h ${m % 60} m`;
}

async function load() {
  try {
    const [d, t] = await Promise.all([api.stats.summary(P.period), api.takes.list()]);
    P.data = d;
    P.takes = t || [];
  } catch (err) {
    P.data = null;
  }
  render();
}

function tile(gel, label, value, sub, extra) {
  const el = h('div.card.ptile', { style: { '--gel': gel } }, h('div.pt-label', null, h('span.dot'), label), h('div.pt-value', { text: value }));
  if (extra) el.append(extra);
  if (sub) el.append(h('div.pt-sub', { html: sub }));
  return el;
}

function render() {
  if (state.page !== 'progress') return;
  root.innerHTML = '';
  const seg = h('div.gseg', { role: 'group', 'aria-label': 'Period', style: { '--gel': 'var(--gel-piano)' } });
  for (const [id, label] of [['week', 'This week'], ['month', 'This month'], ['all', 'All time']]) {
    const b = h('button', { type: 'button', text: label, 'aria-pressed': String(P.period === id) });
    b.onclick = () => {
      P.period = id;
      load();
    };
    seg.append(b);
  }
  root.append(h('div.prog-head', null, h('h1.page-title', { text: 'Progress' }), h('span.grow'), seg));
  // 4.4: your level, today's challenges and things to try
  if (L.st) root.append(levelPanel(L.st));
  const d = P.data;
  if (!d) {
    root.append(h('p', { text: 'Reading your practice…', style: { color: 'var(--ink-3)' } }));
    return;
  }
  const diff = d.prevSeconds !== null && d.prevSeconds !== undefined ? d.seconds - d.prevSeconds : null;
  const per = P.period === 'week' ? 'last week' : 'last month';
  const streakDots = h('div.pt-dots');
  const last7 = d.perDay.slice(-7);
  for (const x of last7) streakDots.append(h(`span${x.minutes ? '.on' : ''}`, { title: `${x.day}: ${x.minutes} min` }));
  const accRing = h('span.pt-ring', { style: { '--deg': `${Math.round((d.accuracy || 0) * 360)}deg` } }, h('i'));
  const tiles = h('div.ptiles');
  tiles.append(
    tile('var(--tungsten)', 'Time playing', fmtTime(d.seconds), diff === null ? '' : `<span class="${diff >= 0 ? 'up' : 'down'}">${diff >= 0 ? '+' : '−'}${fmtTime(Math.abs(diff))}</span> on ${per}`),
    tile('var(--gel-drums)', 'Day streak', `${d.streak} day${d.streak === 1 ? '' : 's'}`, `Best: ${d.bestStreak} day${d.bestStreak === 1 ? '' : 's'}`, streakDots),
    tile('var(--gel-bass)', 'Songs practised', String(d.songs), d.newSongs ? `${d.newSongs} new` : ''),
    tile('var(--gel-piano)', 'Average accuracy', d.accuracy === null ? '–' : `${Math.round(d.accuracy * 100)}%`, d.accuracyChange === null ? '' : `<span class="${d.accuracyChange >= 0 ? 'up' : 'down'}">${d.accuracyChange >= 0 ? '+' : '−'}${Math.abs(Math.round(d.accuracyChange * 100))} points</span>`, accRing)
  );
  // 4.0: your last song and what to practise next side by side, then the numbers
  root.append(h('div.ptop', null, spotlight(d), upNext(d)));
  root.append(tiles);
  root.append(mastery());
  const goals=h('div.goal-grid');
  for(const g of d.goals||[]){
    const earned=g.value>=g.target;
    goals.append(h(`section.card.goal-card${earned?'.earned':''}`,null,h('small',{text:earned?'BADGE EARNED':'YOUR NEXT MILESTONE'}),h('b',{text:(earned?'★ ':'')+g.name}),h('p',{text:g.detail}),h('progress',{max:g.target,value:g.value}),h('small',{text:`${g.value} / ${g.target}`})));
    if(earned&&!localStorage.getItem('stagehand.badge:'+g.id)){localStorage.setItem('stagehand.badge:'+g.id,'1');toast({title:'★ '+g.name,message:'Badge earned. Keep it going!',kind:'ok'});}
  }
  root.append(goals);
  root.append(highlights(d));

  const row = h('div.prog-row');
  // minutes per day
  const days = h('section.card.pdays', { 'aria-label': 'Minutes per day' }, h('div.card-head', null, h('h2', { text: 'Minutes per day' })));
  const bars = h('div.bars');
  const list = P.period === 'week' ? d.perDay.slice(-7) : d.perDay;
  const top = Math.max(30, ...list.map((x) => x.minutes));
  const today = list.length - 1;
  list.forEach((x, i) => {
    const dt = new Date(x.at);
    const lab = list.length <= 7 ? dt.toLocaleDateString(undefined, { weekday: 'short' }) : i % 5 === 4 || i === today ? String(dt.getDate()) : '';
    bars.append(h(`div.bar${i === today ? '.today' : ''}${x.minutes ? '' : '.zero'}`, { title: `${dt.toLocaleDateString()}: ${x.minutes} min` }, h('span.m', { text: x.minutes && list.length <= 7 ? `${x.minutes}m` : '' }), h('i', { style: { height: `${Math.max(3, Math.round((x.minutes / top) * 160))}px` } }), h('span.d', { text: lab })));
  });
  days.append(bars);
  row.append(days);

  // songs you're working on
  const songs = h('section.card.pworking', { 'aria-label': 'Songs you’re working on' }, h('div.card-head', null, h('h2', { text: 'Songs you’re working on' })));
  if (!d.working.length) songs.append(h('p.np-fine', { text: 'Play along with a song (your guitar plugged in) and it shows up here with your accuracy over time.' }));
  for (const w of d.working.slice(0, 6)) {
    const s = state.songs.get(w.songId);
    if (!s) continue;
    const trend = h('div.trend');
    w.trend.forEach((v, i, a) => trend.append(h(`i${v >= 85 ? '.top' : ''}${i === a.length - 1 ? '.last' : ''}`, { style: { height: `${Math.max(3, Math.round((v / 100) * 28))}px` }, title: `${v}%` })));
    const strip = h('span.pw-strip');
    for (const x of w.sections || []) if (x.acc !== null) strip.append(h(`i.${band(x.acc)}`, { title: `${x.label}: ${pctOf(x.acc)}` }));
    const r = h('button.pw-row', { type: 'button', title: 'Open the song' }, coverEl(s, 64, 'sm'), h('span.pw-text', null, h('b', { text: s.title }), h('span', { text: `${{ lead: 'Lead', rhythm: 'Rhythm', bass: 'Bass' }[w.part] || 'Part'} · ${w.sessions} session${w.sessions === 1 ? '' : 's'}` }), strip), trend, h(`b.pw-best${w.best >= 0.85 ? '.top' : ''}`, { text: `${Math.round(w.best * 100)}%` }));
    r.onclick = async () => {
      await actions.playSong(s.id, { autoplay: false });
      setPage('now');
    };
    songs.append(r);
  }
  row.append(songs);

  // recordings: the newest few; everything is backstage (My clips)
  const allRec = h('button.btn.small.ghost', { type: 'button', text: 'All my clips' });
  allRec.onclick = () => import('./greenroom.js').then((r) => r.openGreenRoom({ tab: 'mine' }));
  const takes = h('section.card.ptakes', { 'aria-label': 'Recordings' }, h('div.card-head', null, h('h2', { text: 'Recordings' }), allRec));
  if (!P.takes.length) takes.append(h('p.np-fine', { text: 'Nothing recorded yet. Record a clip from the highway’s Tools, or use the looper in Jam.' }));
  for (const t of P.takes.slice(0, 4)) {
    const on = P.playing === t.id;
    const play = h('button.round-play.sm', { type: 'button', 'aria-label': on ? 'Stop' : 'Play', html: icon(on ? 'stop' : 'play') });
    play.onclick = () => (t.kind === 'video' ? import('./greenroom.js').then((r) => r.openGreenRoom({ tab: 'mine', focus: t.id })) : playTake(t));
    const when = new Date(t.at);
    const meta = `${t.kind === 'video' ? 'Video · ' : ''}${when.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })} · ${Math.floor((t.seconds || 0) / 60)}:${String(Math.round((t.seconds || 0) % 60)).padStart(2, '0')}`;
    takes.append(h(`div.take${on ? '.on' : ''}`, null, play, h('div.tk-text', null, h('b', { text: t.name }), h('span', { text: meta }))));
  }
  row.append(takes);
  root.append(row);
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
    return h('section.card.pspot.vacant', null, h('div.pspot-empty', null, h('span', { html: icon('guitar') }), h('div', null, h('b', { text: 'Play a song with your guitar plugged in' }), h('p', { text: 'Your run shows up here straight away: your score, each section, and what to work on next.' }))));
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
  const NAME = { mastered: 'Mastered (90%+)', close: 'Close (60–89%)', learning: 'Learning', unplayed: 'Not played yet' };
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
  return h('section.card.pmastery', { 'aria-label': 'Your songs' }, h('div.card-head', null, h('h2', { text: 'Your songs' }), h('span.np-fine', { text: `${n.mastered} of ${all.length} mastered` })), bar, legend);
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

// live: while Progress is open, what you're playing is logged and shown every few seconds
setInterval(() => {
  if (state.page !== 'progress') return;
  if (window.__shPractice && engine.playing) window.__shPractice.checkpoint();
  else load();
}, 8000);

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

on('page', () => state.page === 'progress' && load());
on('stats', () => state.page === 'progress' && load());
on('levels', () => state.page === 'progress' && P.data && render());
on('page', () => state.page === 'progress' && loadLevels());
on('takes', () => state.page === 'progress' && load());

// ------------------------------------------------------- 4.4: levels --
/** Your level and pass, the bar to the next one, today's three challenges, and things to try. */
function levelPanel(st) {
  const span = Math.max(1, st.to - st.from);
  const into = st.xp - st.from;
  const medal = h(`div.lv-medal.tier-${st.tier.id}`, { title: `${st.tier.name} pass` }, h('small', { text: 'LEVEL' }), h('b', { text: String(st.level) }));
  const next = st.next ? `Level ${st.next.level} unlocks the ${st.next.name} venue` : 'Every venue is yours';
  const who = h('div.lv-who', null,
    h('div.lv-title', null, h('b', { text: st.tier.name }), h('span', { text: `${st.xp.toLocaleString()} XP` })),
    h('div.lv-bar', { role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': String(span), 'aria-valuenow': String(into), 'aria-label': 'XP to the next level' }, h('i', { style: { width: `${Math.round((into / span) * 100)}%` } })),
    h('div.lv-sub', null, h('span', { text: `${(st.to - st.xp).toLocaleString()} XP to level ${st.level + 1}` }), st.today ? h('span.lv-today', { text: `+${st.today} today` }) : null),
    h('p.lv-next', { text: `${next}. Your pass in Backstage gets fancier as you level up.` }));
  const ch = h('div.lv-chal', null, h('div.lv-h', null, h('b', { text: 'Today’s challenges' }), h('small', { text: 'New ones at midnight' })));
  for (const c of st.challenges) {
    ch.append(h(`div.lv-c${c.done ? '.done' : ''}`, null,
      h('span.lv-check', { html: c.done ? icon('check') : '' }),
      h('div.lv-ctext', null, h('b', { text: c.name }), c.target > 1 ? h('div.lv-cbar', null, h('i', { style: { width: `${Math.round((c.value / c.target) * 100)}%` } })) : null),
      h('span.lv-xp', { text: c.done ? 'Done' : c.target > 1 ? `${c.value}/${c.target} · +${c.xp}` : `+${c.xp} XP` })));
  }
  const panel = h('section.card.lv-panel', { 'aria-label': 'Your level' }, medal, who, ch);
  const todo = st.firsts.filter((f) => !f.done);
  const wrap = h('div.lv-wrap', null, panel);
  if (todo.length) {
    const grid = h('div.lv-try-grid');
    for (const f of todo.slice(0, 8)) {
      const b = h('button.lv-try', { type: 'button', title: f.how }, h('span.lv-xp', { text: `+${f.xp}` }), h('b', { text: f.name }), h('small', { text: f.how }));
      b.onclick = () => goTo(f.go);
      grid.append(b);
    }
    const doneN = st.firsts.length - todo.length;
    wrap.append(h('section.card.lv-try', { 'aria-label': 'Things to try' }, h('div.card-head', null, h('h2', { text: 'Things to try' }), h('span.grow'), h('small.np-fine', { text: `${doneN} of ${st.firsts.length} done` })), grid));
  }
  return wrap;
}

function goTo(page) {
  if (page === 'greenroom') import('./greenroom.js').then((g) => g.openGreenRoom({ tab: 'room' }));
  else if (page === 'discover') setView({ kind: 'discover', id: 'search' });
  else setPage(page || 'songs');
}
