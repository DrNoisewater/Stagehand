/** Progress: time playing, streak, songs, accuracy, minutes per day, songs you're working on, and your takes. */
import { api } from './api.js';
import { state, on, setPage } from './store.js';
import { h, icon, esc, toast, showMenu, confirmDialog } from './ui.js';
import * as actions from './actions.js';
import { coverEl } from './shell.js';
import { engine } from './stage.js';

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
  root.append(tiles);

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
    const r = h('button.pw-row', { type: 'button', title: 'Open the song' }, coverEl(s, 64, 'sm'), h('span.pw-text', null, h('b', { text: s.title }), h('span', { text: `${{ lead: 'Lead', rhythm: 'Rhythm', bass: 'Bass' }[w.part] || 'Part'} · ${w.sessions} session${w.sessions === 1 ? '' : 's'}` })), trend, h(`b.pw-best${w.best >= 0.85 ? '.top' : ''}`, { text: `${Math.round(w.best * 100)}%` }));
    r.onclick = async () => {
      await actions.playSong(s.id, { autoplay: false });
      setPage('now');
    };
    songs.append(r);
  }
  row.append(songs);

  // takes
  const takes = h('section.card.ptakes', { 'aria-label': 'Your takes' }, h('div.card-head', null, h('h2', { text: 'Your takes' })), h('div.np-fine', { text: 'Recordings from the looper and Record take.' }));
  if (!P.takes.length) takes.append(h('p.np-fine', { text: 'Nothing recorded yet. Use the looper on Play, or Record take while a song plays.' }));
  for (const t of P.takes.slice(0, 30)) {
    const on = P.playing === t.id;
    const play = h('button.round-play.sm', { type: 'button', 'aria-label': on ? 'Stop' : 'Play take', html: icon(on ? 'stop' : 'play') });
    play.onclick = () => playTake(t);
    const when = new Date(t.at);
    const meta = `${when.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })} · ${t.seconds >= 60 ? `${Math.floor(t.seconds / 60)}:${String(Math.round(t.seconds % 60)).padStart(2, '0')}` : `0:${String(Math.round(t.seconds)).padStart(2, '0')}`}${t.bpm ? ` · ${t.bpm} BPM` : ''}`;
    const r = h(`div.take${on ? '.on' : ''}`, null, play, h('div.tk-text', null, h('b', { text: t.name }), h('span', { text: meta })));
    r.oncontextmenu = (e) => {
      e.preventDefault();
      showMenu(e.clientX, e.clientY, [
        {
          label: 'Rename',
          icon: 'edit',
          onClick: async () => {
            const input = h('input.input', { value: t.name });
            r.querySelector('.tk-text b').replaceWith(input);
            input.focus();
            input.select();
            const done = async () => {
              await api.takes.rename(t.id, input.value).catch(() => {});
              load();
            };
            input.onkeydown = (ev) => ev.key === 'Enter' && done();
            input.onblur = done;
          },
        },
        { label: 'Show in folder', icon: 'folder', onClick: () => state.info && state.info.dirs && state.info.dirs.takes && api.shell.showItem(`${state.info.dirs.takes}${state.info.platform === 'win32' ? '\\' : '/'}${t.file}`) },
        '-',
        {
          label: 'Delete',
          icon: 'trash',
          onClick: async () => {
            if (!(await confirmDialog({ title: `Delete “${t.name}”?`, message: 'The recording is deleted from your PC.', confirm: 'Delete', danger: true }))) return;
            await api.takes.remove(t.id);
            load();
          },
        },
      ]);
    };
    takes.append(r);
  }
  row.append(takes);
  root.append(row);
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

on('page', () => state.page === 'progress' && load());
on('stats', () => state.page === 'progress' && load());
on('takes', () => state.page === 'progress' && load());
