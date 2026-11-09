/**
 * Backstage (4.3): the page just above Getting started on the left menu. It replaces the
 * Recordings window and Friends (with their codes).
 *  - Everyone: who's in Stagehand now and the clips they show. Watch one (it comes
 *    straight from their PC), see the song, part and tone, try or keep the tone,
 *    open the song if you have it (or find it), and message them about it.
 *  - My clips: everything you've recorded (videos, looper takes, Record take).
 *    Videos get one switch: Show backstage.
 *  - Messages: your conversations, and the ones from before Backstage (to read).
 * State and the service: room.js and services/greenroom.js. Files stay "SH - <song>.mp4/.wav"
 * in Stagehand's recordings folder.
 */
import { api } from './api.js';
import { state, on, setPage } from './store.js';
import { h, icon, confirmDialog, toast, fmtBytes, showMenu } from './ui.js';
import { G, loadRoom, isShown, toggleShown, askName, unreadFor, unreadAll, markRead } from './room.js';
import { connectTo } from './friendlink.js';
import { coverEl } from './shell.js';

const root = document.getElementById('page-greenroom');
const V = {
  tab: 'room', // 'room' | 'mine' | 'messages'
  inst: 'all', // 'all' | 'guitar' | 'bass'
  haveOnly: false, // only songs you have
  who: null, // one person's clips (their address)
  focus: null, // a clip of yours to show first (just saved)
  chat: null, // the conversation open: an address, or an old one's key
  about: null, // the clip a new message is about: { id, title }
  takes: null, // your recordings, read when My clips opens
  links: new Map(), // address -> an open direct link
  watch: null, // what the player shows: see watch()
};
const fetched = new Map(); // `${addr}:${id}` -> blob URL (the last few, so watching again is instant)

const PART = { lead: 'Lead', rhythm: 'Rhythm', bass: 'Bass', jam: 'Jam' };
const fmtLen = (s) => {
  s = Math.max(0, Math.round(Number(s) || 0));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};
const fmtWhen = (at) => {
  const d = new Date(at);
  return `${d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })} ${d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}`;
};
const fmtTime = (at) => new Date(at).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
const sep = () => (state.info && state.info.platform === 'win32' ? '\\' : '/');
const dir = () => (state.info && state.info.dirs && state.info.dirs.takes) || '';
const fileOf = (t) => `${dir()}${sep()}${String(t.file).replace(/\//g, sep())}`;
const tidy = (s) => String(s || '').toLowerCase().replace(/^the\s+/, '').replace(/[^a-z0-9]+/g, '');
const btn = (text, ic, onClick, cls = '') => {
  const b = h(`button.btn${cls}`, { type: 'button', html: ic ? `${icon(ic)}<span></span>` : '' });
  if (ic) b.querySelector('span').textContent = text;
  else b.textContent = text;
  b.onclick = onClick;
  return b;
};

/** The song in your library a clip is of (same title and artist), or null. */
export function findSong(c) {
  if (!c || !c.song) return null;
  const t = tidy(c.song);
  const a = tidy(c.artist);
  for (const s of state.songs.values()) if (tidy(s.title) === t && (!a || tidy(s.artist) === a)) return s;
  return null;
}

/** "Lead · E Standard · 80% speed" */
function partLine(c) {
  return [PART[c.part] || null, c.tuning || null, c.speed && c.speed < 0.995 ? `${Math.round(c.speed * 100)}% speed` : null].filter(Boolean).join(' · ');
}

// ---------------------------------------------------------- the page --
const head = h('div.gr-head');
const player = h('section.gr-player', { hidden: true, 'aria-label': 'Watching' });
const panel = h('div.gr-panel');
if (root) root.append(head, player, panel);

/** Opens Backstage. tab: 'room' | 'mine' | 'messages'; focus: one of your clips; with: a conversation. */
export function openGreenRoom({ tab = 'room', focus = null, with: addr = null } = {}) {
  V.tab = tab;
  V.focus = focus;
  if (addr) V.chat = addr;
  if (tab === 'mine') V.takes = null;
  // the highway and Jam cover the pages: step out of them first
  if (window.__shHighway && window.__shHighway.open()) window.__shHighway.leave();
  if (window.__jam && window.__jam.state.open) window.__jam.close();
  if (state.page === 'greenroom') render();
  else setPage('greenroom');
}
/** 4.2 and before had a Recordings window: the same places, here now. */
export const openRecordings = ({ focus = null, tab = 'mine' } = {}) => openGreenRoom({ tab: tab === 'friends' ? 'room' : 'mine', focus });

function shown() {
  return state.page === 'greenroom' && root && root.isConnected;
}

async function render() {
  if (!shown()) return;
  drawHead();
  const top = root.scrollTop;
  if (V.tab === 'mine') await renderMine();
  else if (V.tab === 'messages') renderMessages();
  else renderRoom();
  root.scrollTop = top;
}

/** Something is being typed in the panel (a rename): don't redraw under it. */
const busyTyping = () => {
  const a = document.activeElement;
  return a && panel.contains(a) && a.matches('input') && !a.classList.contains('gr-type');
};

on('page', () => {
  if (state.page === 'greenroom') {
    V.takes = null;
    loadRoom();
    render();
  } else stopPlayer({ keep: false });
});
on('room', () => shown() && !busyTyping() && render());
on('room-read', () => shown() && drawHead());
on('takes', () => {
  V.takes = null;
  if (shown() && V.tab === 'mine' && !busyTyping()) render();
});

/** A round initial in a colour of its own per person, with a green dot while they're here. */
function avatar(name, cls = '', online = false) {
  const n = (name || '?').trim();
  let hue = 0;
  for (const ch of n.toLowerCase()) hue = (hue * 31 + ch.codePointAt(0)) % 360;
  return h(`span.gr-av${cls}`, { text: n.slice(0, 1).toUpperCase(), style: { '--hue': String(hue) } }, online ? h('i.gr-here', { title: 'Here now' }) : null);
}

function drawHead() {
  const st = G.st;
  const here = st ? st.people.length : 0;
  const unread = unreadAll();
  const tabs = h('div.gseg.gr-tabs', { role: 'tablist', 'aria-label': 'Backstage', style: { '--gel': 'var(--gel-bass)' } });
  for (const [id, label, ic, n] of [['room', 'Everyone', 'people', here ? String(here) : ''], ['mine', 'My clips', 'record', ''], ['messages', 'Messages', 'edit', unread ? String(unread) : '']]) {
    const b = h('button', { type: 'button', role: 'tab', 'aria-selected': String(V.tab === id), 'aria-pressed': String(V.tab === id), 'data-tab': id, html: `${icon(ic)}<span></span>` });
    b.querySelector('span').textContent = label;
    if (n) b.append(h(`i.gr-count${id === 'messages' ? '.new' : ''}`, { text: n, title: id === 'messages' ? `${n} new` : `${n} here now` }));
    b.onclick = () => {
      if (V.tab === id) return;
      V.tab = id;
      if (id === 'mine') V.takes = null;
      render();
    };
    tabs.append(b);
  }
  let me;
  if (!st) me = h('span.gr-me', { text: 'Getting ready…' });
  else if (st.joined) {
    const name = h('button.gr-me-name', { type: 'button', title: 'Change your name', html: `${icon('person')}<span></span>` });
    name.querySelector('span').textContent = st.name;
    name.onclick = () => askName();
    const more = h('button.icon-btn', { type: 'button', title: 'More', 'aria-label': 'Backstage options', html: icon('more') });
    more.onclick = (e) => {
      const r = e.currentTarget.getBoundingClientRect();
      showMenu(r.left, r.bottom + 4, [
        { label: 'Change my name', icon: 'edit', onClick: () => askName() },
        ...(st.hidden.length ? [{ label: `People I’ve hidden (${st.hidden.length})`, icon: 'people', onClick: () => openHidden() }] : []),
        '-',
        { label: 'Step out of Backstage', icon: 'x', onClick: () => stepOut() },
      ]);
    };
    const watching = G.watching.length ? h('span.gr-live', { text: `${G.watching.join(' and ')} ${G.watching.length > 1 ? 'are' : 'is'} watching your clips` }) : null;
    me = h('div.gr-me.gr-pass', null,
      avatar(st.name, '.big', true),
      h('div.gr-pass-text', null, h('span.gr-me-label', { text: 'Your backstage pass' }), name, h('span.gr-pass-fine', { text: watching ? '' : 'Everyone here sees this name.' }), watching),
      more);
  } else {
    const come = btn('Come in', 'person', () => askName(), '.primary.small');
    me = h('div.gr-me.gr-pass.none', null,
      h('span.gr-av.big.gr-nopass', { html: icon('person') }),
      h('div.gr-pass-text', null, h('span.gr-me-label', { text: 'No pass yet' }), h('span.gr-pass-fine', { text: 'Look around freely. Pick a name to show your clips and message people.' })),
      come);
  }
  const live = !st ? null : !st.inRoom ? h('span.gr-onair.off', { text: 'Reaching Backstage…' }) : h('span.gr-onair', { title: 'People with Stagehand open right now' }, h('i'), h('span', { text: here ? `${here} ${here === 1 ? 'other player' : 'other players'} here now` : 'Just you right now' }));
  head.replaceChildren(
    h('div.gr-title', null, h('div.gr-marquee', null, h('h1.page-title.gr-neon', { text: 'Backstage' }), live), h('p.gr-sub', { text: 'Clips from everyone with Stagehand. Watch them while their owner is online, try their tones, and say hi.' })),
    me,
    tabs
  );
}

async function stepOut() {
  if (!(await confirmDialog({ title: 'Step out of Backstage?', message: 'Nobody sees you or your clips until you pick a name again. Your clips and messages stay on your PC.', confirm: 'Step out' }))) return;
  G.st = await api.room.leave();
  render();
}

function openHidden() {
  const st = G.st;
  const items = st.hidden.map((p) => ({ label: `Show ${p.name} again`, icon: 'people', onClick: () => api.room.hide(p.addr, false) }));
  const r = head.querySelector('.gr-me .icon-btn').getBoundingClientRect();
  showMenu(r.left, r.bottom + 4, items);
}

// ---------------------------------------------------------- the room --
function renderRoom() {
  const st = G.st;
  panel.innerHTML = '';
  if (!st) return panel.append(h('p.np-fine', { text: 'Getting Backstage ready…' }));
  if (!st.inRoom) panel.append(h('div.gr-note.wait', null, h('i'), h('span', { text: 'Reaching Backstage… If this takes more than a minute, check your internet connection.' })));
  const people = st.people;
  if (V.who && !people.some((p) => p.addr === V.who)) V.who = null;
  if (!people.length) {
    panel.append(h('div.gr-empty', null, h('span.gr-orb', { html: icon('people') }), h('b', { text: 'Nobody else is here right now' }), h('p', { text: 'People show up here while their Stagehand is open, with the clips they choose to show. Record a clip on the highway or in Jam, then show it from My clips.' })));
    return;
  }
  // who's here: a chip each (pick one to see just their clips)
  const chips = h('div.gr-people');
  for (const p of people) {
    const sel = V.who === p.addr;
    const chip = h(`button.gr-person${sel ? '.sel' : ''}`, { type: 'button', title: sel ? 'Show everyone' : `Just ${p.name}’s clips` }, avatar(p.name, '', true), h('span.gr-pname', { text: p.name }), h('span.gr-pn', { text: p.clips.length ? `${p.clips.length} clip${p.clips.length === 1 ? '' : 's'}` : '' }));
    chip.onclick = () => ((V.who = sel ? null : p.addr), renderRoom());
    chips.append(chip);
  }
  panel.append(h('div.gr-section', null, h('span.gr-label', { text: `Here now · ${people.length}` }), chips));
  if (V.who) {
    const p = people.find((x) => x.addr === V.who);
    panel.append(h('div.gr-personbar', null,
      avatar(p.name, '.big', true),
      h('div.gr-who', null, h('b', { text: p.name }), h('span', { text: p.clips.length ? `${p.clips.length} clip${p.clips.length === 1 ? '' : 's'}` : 'No clips shown yet' })),
      h('span.grow'),
      btn(`Message ${p.name}`, 'edit', () => startChat(p.addr), '.small.soft'),
      btn('Hide', 'x', () => hidePerson(p), '.small.ghost'),
      btn('Everyone', 'people', () => ((V.who = null), renderRoom()), '.small.ghost')));
  }
  // filters
  const seg = h('div.gseg.gr-filter', { role: 'group', 'aria-label': 'Instrument', style: { '--gel': 'var(--gel-guitar)' } });
  for (const [id, label] of [['all', 'All'], ['guitar', 'Guitar'], ['bass', 'Bass']]) {
    const b = h('button', { type: 'button', text: label, 'aria-pressed': String(V.inst === id) });
    b.onclick = () => ((V.inst = id), renderRoom());
    seg.append(b);
  }
  const have = h('button.gr-toggle', { type: 'button', 'aria-pressed': String(V.haveOnly), html: `${icon('music')}<span>Songs I have</span>` });
  have.onclick = () => ((V.haveOnly = !V.haveOnly), renderRoom());
  panel.append(h('div.gr-filters', null, seg, have));

  const all = [];
  for (const p of people) for (const c of p.clips) all.push({ p, c });
  const list = all
    .filter(({ p }) => !V.who || p.addr === V.who)
    .filter(({ c }) => V.inst === 'all' || (V.inst === 'bass' ? c.inst === 'bass' || c.part === 'bass' : c.inst !== 'bass' && c.part !== 'bass'))
    .filter(({ c }) => !V.haveOnly || findSong(c))
    .sort((a, b) => b.c.at - a.c.at);
  if (!list.length) {
    panel.append(h('p.np-fine.gr-none', { text: all.length ? 'No clips match. Try All, or turn off Songs I have.' : 'Nobody here is showing a clip yet.' }));
    return;
  }
  const grid = h('div.gr-grid');
  for (const { p, c } of list) grid.append(card(p, c));
  panel.append(grid);
}

function card(p, c) {
  const song = findSong(c);
  const cover = coverEl(song || { title: c.song || c.title, artist: c.artist || p.name }, 256, 'gr-cover');
  cover.append(h('span.gr-len', { text: fmtLen(c.sec) }), h('span.gr-playic', { html: icon('play') }));
  const on = V.watch && V.watch.addr === p.addr && V.watch.clip.id === c.id;
  const el = h(`button.gr-card${on ? '.on' : ''}`, { type: 'button', 'data-clip': c.id, title: `Watch ${p.name}’s clip` },
    cover,
    h('div.gr-card-text', null,
      h('b', { text: c.title }),
      h('span.gr-by', null, avatar(p.name, '.tiny', true), h('span', { text: p.name })),
      c.song ? h('span.gr-song', { text: c.artist ? `${c.song} · ${c.artist}` : c.song }) : null,
      h('div.gr-tags', null,
        partLine(c) ? h('span.gr-tag', { text: partLine(c) }) : null,
        c.tone ? h('span.gr-tag.tone', { html: `${icon('tones')}<span></span>` }) : null,
        song ? h('span.gr-tag.have', { text: 'You have it' }) : null)));
  const t = el.querySelector('.gr-tag.tone span');
  if (t) t.textContent = c.tone;
  el.onclick = () => watch(p, c);
  el.oncontextmenu = (e) => {
    e.preventDefault();
    showMenu(e.clientX, e.clientY, [
      { label: 'Watch', icon: 'play', onClick: () => watch(p, c) },
      { label: `Message ${p.name} about it`, icon: 'edit', onClick: () => startChat(p.addr, { id: c.id, title: c.title }) },
      '-',
      { label: `Hide ${p.name}`, icon: 'x', onClick: () => hidePerson(p) },
    ]);
  };
  return el;
}

async function hidePerson(p) {
  if (!(await confirmDialog({ title: `Hide ${p.name}?`, message: `You won’t see ${p.name}’s clips or get their messages on this PC. They aren’t told. You can show them again from the ⋯ menu next to your name.`, confirm: 'Hide', danger: true }))) return;
  if (V.watch && V.watch.addr === p.addr) stopPlayer({ keep: false });
  if (V.who === p.addr) V.who = null;
  G.st = await api.room.hide(p.addr, true);
  render();
}

// ------------------------------------------------------------ watching --
/** A direct link to someone's Stagehand (kept open while you watch their clips). */
async function linkTo(addr, onStage) {
  const have = V.links.get(addr);
  if (have && !have.closed) return have;
  const go = () => connectTo(api, addr, { name: (G.st && G.st.name) || '', onStage });
  const off = api.on('room:progress', (p) => p && p.addr === addr && onStage(p.stage));
  try {
    // one quiet second try when the internet side or the direct line hiccups
    const link = await go().catch((err) => {
      if (err.code !== 'DIRECT' && err.code !== 'RELAY') throw err;
      onStage('retry');
      return go();
    });
    V.links.set(addr, link);
    link.onclose = () => V.links.get(addr) === link && V.links.delete(addr);
    return link;
  } finally {
    off && off();
  }
}

function remember(key, url) {
  fetched.set(key, url);
  while (fetched.size > 4) {
    const [k, u] = fetched.entries().next().value;
    URL.revokeObjectURL(u);
    fetched.delete(k);
  }
}

/**
 * Watch someone's clip: connect to their Stagehand, get what's in the clip (with the
 * tone), then the video, and play it. A dropped connection mid-video reconnects and
 * carries on from where it stopped (a few tries).
 */
async function watch(p, c) {
  if (V.watch && V.watch.addr === p.addr && V.watch.clip.id === c.id && !V.watch.err) return player.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  stopPlayer({ keep: false });
  const w = (V.watch = { mine: false, addr: p.addr, name: p.name, clip: c, full: null, stage: 'relay', p: 0, retry: 0, err: null, url: null });
  drawPlayer();
  player.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  const live = () => V.watch === w;
  const key = `${p.addr}:${c.id}`;
  const parts = [];
  let have = 0;
  let size = c.size || 0;
  try {
    let link = await linkTo(p.addr, (s) => live() && ((w.stage = s), drawPlayer()));
    if (!live()) return;
    const list = await link.list();
    w.full = (Array.isArray(list) ? list : []).find((x) => x && x.id === c.id) || null;
    if (!w.full) throw Object.assign(new Error(`${p.name} isn’t showing this clip any more.`), { code: 'GONE' });
    if (fetched.has(key)) w.url = fetched.get(key);
    else {
      w.stage = 'getting';
      drawPlayer();
      for (let tries = 0; ; tries++) {
        try {
          if (!link || link.closed) {
            w.retry = tries;
            drawPlayer();
            await new Promise((r) => setTimeout(r, Math.min(8000, 1000 * 2 ** (tries - 1))));
            if (!live()) return;
            link = await linkTo(p.addr, () => {});
          }
          const got = await link.get(c.id, {
            from: have,
            onChunk: (x) => (parts.push(x), (have += x.byteLength)),
            onProgress: (f) => {
              if (!live()) return link.cancel();
              w.p = f;
              w.retry = 0;
              drawProgress();
            },
          });
          size = got.size;
          if (got.cancelled) return;
          if (have < size) throw Object.assign(new Error('The video stopped coming'), { code: 'CLOSED' });
          break;
        } catch (err) {
          const dropped = err.code === 'CLOSED' || err.code === 'DIRECT' || err.code === 'RELAY' || (link && link.closed);
          if (!dropped || tries >= 4 || !live()) throw err;
          link = null;
        }
      }
      w.url = URL.createObjectURL(new Blob(parts, { type: 'video/mp4' }));
      remember(key, w.url);
    }
    if (!live()) return;
    w.stage = 'ready';
    drawPlayer();
  } catch (err) {
    if (!live()) return;
    if (err.code === 'OFFLINE' && have) err.message = `${p.name}’s Stagehand stopped answering. You got ${Math.round((have / Math.max(1, size)) * 100)}% of it; try again when they’re back.`;
    w.err = err;
    drawPlayer();
  }
}

/** One of your own clips in the player. */
function watchMine(t) {
  stopPlayer({ keep: false });
  const a = t.about || {};
  const c = { id: t.id, title: t.name, song: a.song && a.song.title, artist: a.song && a.song.artist, official: a.song && a.song.official, part: a.part, tuning: a.tuning, speed: a.speed, tone: a.tone && a.tone.name, sec: t.seconds, at: t.at };
  V.watch = { mine: true, take: t, clip: c, full: { tone: a.tone || null }, stage: 'ready', url: `stagehand://take/${t.id}`, kind: t.kind === 'video' ? 'video' : 'audio', name: (G.st && G.st.name) || 'You' };
  drawPlayer();
  player.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

let media = null;
let route = null; // the player's sound, sent into the sound engine like the song
function stopPlayer({ keep = true } = {}) {
  if (media) {
    media.pause();
    media.removeAttribute('src');
    media.load();
  }
  try {
    route?.disconnect();
  } catch (_) {}
  media = route = null;
  if (!keep) {
    V.watch = null;
    player.hidden = true;
    player.innerHTML = '';
    for (const x of panel.querySelectorAll('.gr-card.on, .gr-row.on')) x.classList.remove('on');
  }
}

function drawProgress() {
  const w = V.watch;
  const bar = player.querySelector('.gr-progress');
  if (!w || !bar) return drawPlayer();
  bar.style.setProperty('--p', `${Math.round(w.p * 100)}%`);
  const t = player.querySelector('.gr-progress-text');
  if (t) t.textContent = progressText(w);
}
const progressText = (w) => (w.retry ? `Connection dropped, reconnecting… (${Math.round(w.p * 100)}% so far)` : `Getting it from ${w.name}’s PC… ${Math.round(w.p * 100)}%`);

function drawPlayer() {
  const w = V.watch;
  if (!w) return stopPlayer({ keep: false });
  for (const x of panel.querySelectorAll('.gr-card, .gr-row')) x.classList.toggle('on', x.dataset.clip === w.clip.id);
  const close = h('button.icon-btn.gr-close', { type: 'button', title: 'Close', 'aria-label': 'Close the player', html: icon('x') });
  close.onclick = () => stopPlayer({ keep: false });
  let screen;
  if (w.err) {
    const code = w.err.code;
    const title = code === 'OFFLINE' ? `${w.name} isn’t answering` : code === 'DIRECT' ? 'Your PCs couldn’t connect' : code === 'RELAY' ? 'Can’t reach Backstage' : code === 'GONE' ? 'That clip is gone' : 'Couldn’t play it';
    const say = code === 'DIRECT' ? `${w.name}’s Stagehand answered, but the direct line between your two PCs didn’t open. A strict network (work, school, some mobile hotspots) can block it. Try again, or from another network.` : code === 'RELAY' ? 'Stagehand couldn’t get online. Check your internet connection, then try again.' : w.err.message;
    const again = btn('Try again', 'refresh', () => {
      const p = { addr: w.addr, name: w.name };
      V.watch = null;
      watch(p, w.clip);
    }, '.primary');
    screen = h('div.gr-screen.msg', null, h('span.gr-orb', { html: icon(code === 'OFFLINE' ? 'person' : 'alert') }), h('b', { text: title }), h('p', { text: say }), code === 'GONE' ? null : again);
  } else if (w.stage !== 'ready') {
    const steps = [
      ['relay', 'Reaching Backstage'],
      ['asking', `Asking ${w.name}’s Stagehand`],
      ['direct', 'Connecting your two PCs'],
      ['getting', 'Getting the clip'],
    ];
    const at = Math.max(0, steps.findIndex(([s]) => s === (w.stage === 'retry' ? 'relay' : w.stage)));
    screen = h('div.gr-screen.msg', null,
      h('span.gr-orb.pulse', { html: icon('people') }),
      h('b', { text: w.stage === 'retry' ? `Trying once more to reach ${w.name}…` : `Getting ${w.name}’s clip…` }),
      h('ol.gr-steps', null, ...steps.map(([, t], i) => h(`li.${i < at ? 'done' : i === at ? 'now' : 'todo'}`, null, h('i', { html: i < at ? icon('check') : '' }), h('span', { text: t })))),
      w.stage === 'getting' ? h('div.gr-progress', { style: { '--p': `${Math.round(w.p * 100)}%` } }, h('i')) : null,
      w.stage === 'getting' ? h('span.gr-progress-text', { text: progressText(w) }) : null);
  } else {
    stopPlayer();
    media = h(w.kind === 'audio' ? 'audio' : 'video', { src: w.url, controls: true, crossOrigin: 'anonymous' });
    media.onerror = () => toast({ title: 'Couldn’t play this clip', message: w.mine ? 'The file may have been moved or deleted.' : 'It may not have come through whole. Try again.', kind: 'err' });
    const el = media;
    // 4.1.2: the sound goes through the same output as the song (else the fastest sound mode shuts it out)
    import('./stage.js')
      .then(async ({ engine }) => {
        const { ctx, node } = await engine.extraOut();
        if (media !== el) return;
        route = ctx.createMediaElementSource(el);
        route.connect(node);
      })
      .catch((e) => console.warn('green room: playing through the default output', e))
      .finally(() => media === el && el.play().catch(() => {}));
    screen = h(`div.gr-screen${w.kind === 'audio' ? '.audio' : ''}`, null, media);
  }
  player.replaceChildren(h('div.gr-stage', null, screen), details(w), close);
  player.hidden = false;
}

/** Beside the clip: what was played, the tone, and what you can do with them. */
function details(w) {
  const c = w.clip;
  const box = h('aside.gr-details');
  box.append(h('h3', { text: c.title }), h('p.gr-meta', { text: [w.mine ? 'Your clip' : `by ${w.name}`, c.at ? fmtWhen(c.at) : null, c.sec ? fmtLen(c.sec) : null].filter(Boolean).join(' · ') }));
  // the song
  if (c.song) {
    const song = findSong(c);
    let act;
    if (song)
      act = btn('Play this song', 'play', () => {
        stopPlayer({ keep: false });
        import('./actions.js').then((a) => a.playAlong(song.id));
      }, '.small.soft');
    else if (c.official) act = h('p.np-fine', { text: 'An official Rocksmith song: it comes from the Rocksmith store.' });
    else if (!w.mine) act = btn('Find it on CustomsForge', 'external', () => import('./discover.js').then((d) => d.findOnCF({ title: c.song, artist: c.artist || '' })), '.small.soft');
    box.append(h('div.gr-block', null, h('span.gr-bic', { html: icon('music') }), h('div', null, h('b', { text: c.artist ? `${c.song} · ${c.artist}` : c.song }), partLine(c) ? h('span', { text: partLine(c) }) : null, act)));
  } else box.append(h('div.gr-block', null, h('span.gr-bic', { html: icon('guitar') }), h('div', null, h('b', { text: 'Jam' }), h('span', { text: 'Not from a song' }))));
  // the tone
  const tone = w.full && w.full.tone && Array.isArray(w.full.tone.gear) && w.full.tone.gear.length ? w.full.tone : null;
  if (tone || c.tone) {
    const acts = [];
    if (tone && !w.mine) {
      acts.push(btn('Try it', 'play', () => tryTone(tone, w.name), '.small.soft'), btn('Keep it', 'plus', () => keepTone(tone, w.name), '.small.ghost'));
    }
    const sub = tone ? `${tone.kind === 'bass' ? 'Bass' : 'Guitar'} tone` : w.full ? 'This clip has no tone details' : 'You can try it once the clip arrives';
    box.append(h('div.gr-block', null, h('span.gr-bic', { html: icon('tones') }), h('div', null, h('b', { text: (tone && tone.name) || c.tone }), h('span', { text: sub }), acts.length ? h('div.gr-acts', null, ...acts) : null)));
  }
  if (!w.mine) box.append(btn(`Message ${w.name} about this clip`, 'edit', () => startChat(w.addr, { id: c.id, title: c.title }), '.small.primary.gr-msgbtn'));
  return box;
}

async function tryTone(tone, who) {
  const { rig } = await import('./rig.js');
  rig.setLiveTone({ ...tone, name: tone.name, fromLabel: `Trying ${who}’s tone`, gel: '#33c8e0' });
  toast({ title: `Playing ${who}’s tone “${tone.name}”`, message: rig.on ? 'Play something. Keep it to save it in your tones.' : 'Connect your instrument to hear it. Keep it to save it in your tones.', kind: 'ok', timeout: 4500 });
}

async function keepTone(tone, who) {
  try {
    const { saveTone } = await import('./tonelib.js');
    const saved = await saveTone({ name: tone.name, kind: tone.kind === 'bass' ? 'bass' : 'guitar', gear: tone.gear, capture: tone.capture || null, cabId: tone.cabId || null, autoCab: tone.autoCab !== false, from: { song: `${who} (Backstage)` } });
    const { emit } = await import('./store.js');
    emit('tones');
    toast({ title: `“${saved.name}” is in your tones`, message: `From ${who}. Find it on the Tones page.`, kind: 'ok', actions: [{ label: 'Tones', onClick: () => setPage('tones') }] });
  } catch (err) {
    toast({ title: 'Couldn’t keep that tone', message: err.message, kind: 'err' });
  }
}

// ------------------------------------------------------------ my clips --
async function renderMine() {
  if (!V.takes) {
    try {
      V.takes = await api.takes.list();
    } catch (e) {
      panel.replaceChildren(h('p.np-fine', { text: `Couldn’t read your recordings: ${e.message}` }));
      return;
    }
  }
  if (V.tab !== 'mine' || !shown()) return;
  const all = V.takes;
  const st = G.st;
  panel.innerHTML = '';
  const folder = btn('Open the folder', 'folder', () => dir() && api.shell.openPath(dir()), '.small.ghost');
  const showing = all.filter((t) => t.kind === 'video' && isShown(t.id)).length;
  const line = !st || !st.joined ? 'Show a video backstage and everyone can watch it while your Stagehand is open.' : showing ? `${showing} clip${showing === 1 ? '' : 's'} backstage. People can watch ${showing === 1 ? 'it' : 'them'} while your Stagehand is open.` : 'Nothing backstage yet. Press Show on a video to put it there.';
  panel.append(h('div.gr-minehead', null, h('span.gr-share-ic', { html: icon('people') }), h('span.grow', { text: line }), folder));
  if (!all.length) {
    panel.append(h('div.gr-empty', null, h('span.gr-orb', { html: icon('record') }), h('b', { text: 'Nothing recorded yet' }), h('p', { text: 'Record a video on the highway (Tools › Record a video clip) or in Jam, or use the looper and Record take.' })));
    return;
  }
  const list = h('div.gr-list');
  let focus = V.focus;
  for (const t of all) list.append(mineRow(t, focus === t.id));
  if (focus && all.some((t) => t.id === focus)) {
    V.focus = null;
    setTimeout(() => list.querySelector('.gr-row.just')?.scrollIntoView({ block: 'nearest' }), 50);
  }
  panel.append(list);
}

function mineRow(t, just) {
  const video = t.kind === 'video';
  const a = t.about || {};
  const what = [a.song && a.song.title ? a.song.title : video ? 'Jam' : null, PART[a.part] && a.part !== 'jam' ? PART[a.part] : null, a.tone && a.tone.name ? a.tone.name : null].filter(Boolean).join(' · ');
  const meta = [video ? 'Video' : 'Sound', fmtWhen(t.at), t.seconds ? fmtLen(t.seconds) : null, t.bytes ? fmtBytes(t.bytes) : null].filter(Boolean).join(' · ');
  const on = V.watch && V.watch.mine && V.watch.clip.id === t.id;
  const pl = h('button.round-play.sm', { type: 'button', 'aria-label': `Play ${t.name}`, html: icon(on ? 'stop' : 'play') });
  const name = h('b', { text: t.name });
  const sh = isShown(t.id);
  const show = video ? h(`button.gr-show${sh ? '.on' : ''}`, { type: 'button', 'aria-pressed': String(sh), title: sh ? 'Backstage: everyone can watch it (click to take it out)' : 'Show it backstage', html: `${icon(sh ? 'check' : 'people')}<span>${sh ? 'Backstage' : 'Show backstage'}</span>` }) : h('span.gr-noshow', { text: 'Sound only', title: 'Only videos can go backstage' });
  if (video) show.onclick = async () => (await toggleShown(t)) && renderMine();
  const rename = h('button.icon-btn', { type: 'button', title: 'Rename', 'aria-label': 'Rename', html: icon('edit') });
  const showBtn = h('button.icon-btn', { type: 'button', title: 'Show in folder', 'aria-label': 'Show in folder', html: icon('folder') });
  const del = h('button.icon-btn', { type: 'button', title: 'Delete', 'aria-label': 'Delete', html: icon('trash') });
  const row = h(`div.gr-row${video ? '.video' : ''}${sh ? '.shared' : ''}${on ? '.on' : ''}${just ? '.just' : ''}`, { 'data-clip': t.id },
    pl, h('span.gr-kind', { html: icon(video ? 'video' : 'volume') }),
    h('div.gr-rtext', null, name, what ? h('span.gr-what', { text: what }) : null, h('span', { text: meta })),
    show, rename, showBtn, del);
  pl.onclick = () => (on ? stopPlayer({ keep: false }) : watchMine(t), renderMine());
  showBtn.onclick = () => dir() && api.shell.showItem(fileOf(t));
  rename.onclick = () => {
    const input = h('input.input', { value: t.name, 'aria-label': 'New name' });
    name.replaceWith(input);
    input.focus();
    input.select();
    let done = false;
    const finish = async (save) => {
      if (done) return;
      done = true;
      if (save && input.value.trim() && input.value.trim() !== t.name) {
        await api.takes.rename(t.id, input.value.trim()).catch((e) => toast({ title: 'Couldn’t rename', message: e.message, kind: 'err' }));
        V.takes = null;
        await loadRoom(); // the room hears the new name
      }
      renderMine();
    };
    input.onkeydown = (ev) => {
      if (ev.key === 'Enter') finish(true);
      if (ev.key === 'Escape') (ev.stopPropagation(), finish(false));
    };
    input.onblur = () => finish(true);
  };
  del.onclick = async () => {
    if (!(await confirmDialog({ title: `Delete “${t.name}”?`, message: sh ? 'The recording is deleted from your PC and leaves Backstage.' : 'The recording is deleted from your PC.', confirm: 'Delete', danger: true }))) return;
    if (on) stopPlayer({ keep: false });
    await api.takes.remove(t.id).catch((e) => toast({ title: 'Couldn’t delete', message: e.message, kind: 'err' }));
    V.takes = null;
    await loadRoom();
    renderMine();
  };
  return row;
}

// ------------------------------------------------------------ messages --
function startChat(addr, about = null) {
  V.tab = 'messages';
  V.chat = addr;
  V.about = about;
  render();
  setTimeout(() => panel.querySelector('.gr-type')?.focus(), 30);
}

/** The conversation for an address (or an old one), even with no messages yet. */
function conversation(st, key) {
  const c = st.chats.find((x) => x.addr === key);
  if (c) return c;
  const old = st.old.find((x) => x.key === key);
  if (old) return { ...old, old: true };
  const p = st.people.find((x) => x.addr === key);
  return p ? { addr: p.addr, name: p.name, here: true, messages: [] } : null;
}

let draft = null; // the message box, kept across redraws so typing isn't lost
function renderMessages() {
  const st = G.st;
  panel.innerHTML = '';
  if (!st) return panel.append(h('p.np-fine', { text: 'Getting your messages…' }));
  const cur = V.chat ? conversation(st, V.chat) : null;
  if (!cur) V.chat = null;
  const side = h('div.gr-convs');
  if (!st.chats.length && !cur) side.append(h('p.np-fine.gr-convs-empty', { text: 'No messages yet. Press Message on someone’s clip under Everyone to say hi.' }));
  const item = (c, old = false) => {
    const last = c.messages[c.messages.length - 1];
    const n = old ? 0 : unreadFor(c);
    const key = old ? c.key : c.addr;
    const b = h(`button.gr-conv${V.chat === key ? '.sel' : ''}${old ? '.old' : ''}`, { type: 'button' },
      avatar(c.name, '', c.here),
      h('div.gr-ctext', null, h('b', { text: c.name }), h('span', { text: last ? `${last.dir === 'out' ? 'You: ' : ''}${last.text}` : 'No messages yet' })),
      n ? h('i.gr-count.new', { text: String(n) }) : null);
    b.onclick = () => ((V.chat = key), V.about && V.about.for !== key && (V.about = null), renderMessages());
    return b;
  };
  if (cur && !cur.old && !st.chats.some((x) => x.addr === cur.addr)) side.append(item(cur));
  for (const c of st.chats) side.append(item(c));
  if (st.old.length) {
    side.append(h('div.gr-label.gr-oldlabel', { text: 'Before Backstage' }));
    for (const c of st.old) side.append(item(c, true));
  }
  const main = h('div.gr-thread');
  if (!cur) main.append(h('div.gr-empty.small', null, h('span.gr-orb', { html: icon('edit') }), h('b', { text: st.chats.length || st.old.length ? 'Pick a conversation' : 'Messages' }), h('p', { text: 'Messages go to people backstage. They arrive even if their Stagehand is closed for a while (up to 12 hours).' })));
  else {
    if (!cur.old) markRead(cur);
    main.append(thread(st, cur));
  }
  panel.append(h('div.gr-messages', null, side, main));
  const list = main.querySelector('.gr-msgs');
  if (list) requestAnimationFrame(() => (list.scrollTop = list.scrollHeight));
}

function thread(st, c) {
  const top = h('div.gr-thead', null, avatar(c.name, '', c.here), h('div.gr-who', null, h('b', { text: c.name }), h('span', { text: c.old ? 'From before Backstage' : c.here ? 'Backstage now' : 'Not backstage right now: they get it when they’re back (within 12 hours)' })));
  if (!c.old && c.here) {
    const see = btn('Their clips', 'video', () => ((V.tab = 'room'), (V.who = c.addr), render()), '.small.ghost');
    top.append(h('span.grow'), see);
  }
  const list = h('div.gr-msgs');
  if (!c.messages.length) list.append(h('p.gr-msgs-empty', { text: `Say hi to ${c.name}.` }));
  for (const x of c.messages) {
    let stt = null;
    if (x.dir === 'out' && !c.old) {
      const old = Date.now() - x.at > 30000;
      if (x.state === 'delivered') stt = h('span.gr-st.ok', { text: 'Delivered' });
      else if (x.state === 'failed') {
        const retry = h('button.gr-link', { type: 'button', text: 'Send again' });
        retry.onclick = () => sendText(c, x.text, x.about);
        stt = h('span.gr-st.bad', null, `Not sent: ${x.error || 'no internet'}. `, retry);
      } else if (x.state === 'sending') stt = h('span.gr-st', { text: 'Sending…' });
      else stt = h(`span.gr-st${old ? '.warn' : ''}`, { text: old ? `Sent: ${c.name}’s Stagehand hasn’t picked it up yet. It waits up to 12 hours.` : 'Sent' });
    }
    list.append(h(`div.gr-msg.${x.dir}`, null,
      x.about ? h('span.gr-about', { html: `${icon('video')}<span></span>` }) : null,
      h('div.gr-bubble', { text: x.text }),
      h('div.gr-mmeta', null, h('span', { text: c.old ? fmtWhen(x.at) : fmtTime(x.at) }), stt)));
    const ab = list.lastElementChild.querySelector('.gr-about span');
    if (ab) ab.textContent = `About “${x.about.title}”`;
  }
  const box = h('div.gr-chat', null, top, list);
  if (c.old) {
    box.append(h('p.np-fine.gr-oldnote', { text: 'Friend codes are gone. If they’re backstage, find them under Everyone and message them there.' }));
    return box;
  }
  if (!st.joined) {
    box.append(h('div.gr-compose.off', null, h('span.grow', { text: 'Pick a name to answer.' }), btn('Come in', 'person', () => askName(), '.small.primary')));
    return box;
  }
  if (!draft || draft.dataset.for !== c.addr) {
    draft = h('textarea.input.gr-type', { rows: 1, maxlength: 500, placeholder: `Message ${c.name}`, 'aria-label': `Message ${c.name}`, dataset: { for: c.addr } });
    draft.onkeydown = (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendText(c, draft.value, V.about);
      }
    };
  }
  const hadFocus = document.activeElement === draft;
  const send = h('button.btn.primary', { type: 'button', text: 'Send' });
  send.onclick = () => sendText(c, draft.value, V.about);
  let aboutChip = null;
  if (V.about) {
    const x = h('button.gr-link', { type: 'button', 'aria-label': 'Not about this clip', html: icon('x') });
    x.onclick = () => ((V.about = null), renderMessages());
    aboutChip = h('div.gr-aboutnow', null, h('span', { html: `${icon('video')}<span></span>` }), x);
    aboutChip.querySelector('span span').textContent = `About your clip “${V.about.title}”`;
  }
  box.append(aboutChip || '', h('div.gr-compose', null, draft, send));
  if (hadFocus) requestAnimationFrame(() => draft.focus());
  return box;
}

async function sendText(c, text, about = null) {
  const t = String(text || '').trim();
  if (!t) return;
  if (draft && draft.value.trim() === t) draft.value = '';
  try {
    await api.room.send(c.addr, t, about ? { id: about.id, title: about.title } : null);
    if (about && V.about === about) V.about = null;
  } catch (err) {
    if (draft && !draft.value) draft.value = t;
    toast({ title: 'Couldn’t send it', message: err.message, kind: 'err' });
  }
  if (shown() && V.tab === 'messages') renderMessages();
  draft && draft.focus();
}

render();
