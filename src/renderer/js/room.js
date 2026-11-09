/**
 * Backstage in the page (4.3; Friends before): your name, the clips you show,
 * who's here, and messages. The page is greenroom.js; the direct link for watching
 * is friendlink.js; the meeting point and addresses live in the main process
 * (services/greenroom.js).
 *
 * Loaded at start, so your Stagehand answers people who want to watch your clips
 * even when the Backstage page isn't open.
 */
import { api } from './api.js';
import { emit, state } from './store.js';
import { h, modal, toast } from './ui.js';
import { startHost } from './friendlink.js';

export const G = { st: null, peers: 0, watching: [] }; // watching: names of people watching your clips now

export async function loadRoom() {
  try {
    G.st = await api.room.get();
  } catch (_) {
    G.st = null;
  }
  emit('room');
  return G.st;
}

api.on('room:change', (st) => {
  G.st = st;
  emit('room');
});

export const host = startHost(api, {
  onPeers: (n, names = []) => {
    const was = G.watching;
    G.peers = n;
    G.watching = names;
    const fresh = names.filter((x) => !was.includes(x));
    if (fresh.length) toast({ title: `${fresh[0]} is watching your clips`, message: 'From Backstage.', kind: 'info', timeout: 4000 });
    emit('room');
  },
});
loadRoom();

// ------------------------------------------------------------ unread --
// messages read per person (kept on this PC), for the counts on the menu and the Messages tab
const seen = (() => {
  try {
    return new Map(Object.entries(JSON.parse(localStorage.getItem('stagehand.roomSeen') || '{}')));
  } catch (_) {
    return new Map();
  }
})();
const incoming = (c) => c.messages.filter((m) => m.dir === 'in').length;
export function unreadFor(c) {
  return Math.max(0, incoming(c) - (seen.get(c.addr) ?? 0));
}
export function unreadAll() {
  return G.st ? G.st.chats.reduce((n, c) => n + unreadFor(c), 0) : 0;
}
export function markRead(c) {
  if (!c || seen.get(c.addr) === incoming(c)) return;
  seen.set(c.addr, incoming(c));
  try {
    localStorage.setItem('stagehand.roomSeen', JSON.stringify(Object.fromEntries(seen)));
  } catch (_) {}
  emit('room-read');
}

// a message: say so, unless that conversation is on screen
api.on('room:message', (m) => {
  if (state.page === 'greenroom' && document.querySelector(`.gr-type[data-for="${CSS.escape(m.addr)}"]`)) return;
  toast({
    title: `Message from ${m.name}`,
    message: m.text.length > 140 ? `${m.text.slice(0, 140)}…` : m.text,
    kind: 'info',
    timeout: 8000,
    actions: [{ label: 'Open', onClick: () => import('./greenroom.js').then((g) => g.openGreenRoom({ tab: 'messages', with: m.addr })) }],
  });
});

// ------------------------------------------------------------ you --
export const isShown = (id) => !!(G.st && G.st.joined && G.st.shared.includes(id));

/**
 * Asks for your name backstage (the first time you show a clip or message
 * someone). Resolves true once you're in.
 */
export function askName({ why = '' } = {}) {
  return new Promise((resolve) => {
    let done = false;
    const st = G.st || {};
    const input = h('input.input', { value: st.name || st.suggest || '', placeholder: 'Your name', maxlength: 40, spellcheck: 'false', 'aria-label': 'Your name backstage' });
    const err = h('div.gr-err');
    const ok = h('button.btn.primary', { type: 'button', text: st.joined ? 'Save' : 'Come in' });
    const cancel = h('button.btn', { type: 'button', text: 'Cancel' });
    const body = h('div.gr-ask', null,
      why ? h('p', { text: why }) : null,
      h('label.gr-label', { text: 'Your name' }),
      input,
      h('p.np-fine', { text: 'Everyone backstage sees this name next to the clips you show. No password, no email.' }),
      err);
    const m = modal({ title: st.joined ? 'Your name backstage' : 'Come backstage', body, footer: [cancel, ok], onClose: () => !done && resolve(false) });
    m.el.parentElement.classList.add('over-highway');
    const go = async () => {
      ok.disabled = true;
      try {
        G.st = await api.room.setName(input.value);
        emit('room');
        done = true;
        m.close();
        resolve(true);
      } catch (e) {
        err.textContent = e.message;
        input.focus();
      } finally {
        ok.disabled = false;
      }
    };
    ok.onclick = go;
    cancel.onclick = () => m.close();
    input.onkeydown = (e) => {
      if (e.key === 'Enter') go();
      if (e.key === 'Escape') e.stopPropagation(), m.close();
    };
    setTimeout(() => (input.focus(), input.select()), 30);
  });
}

/** Show a video backstage, or take it out. Asks for your name first if you haven't one. */
export async function toggleShown(t) {
  const on = !isShown(t.id);
  try {
    if (on && !(G.st && G.st.joined) && !(await askName({ why: 'Pick the name people see next to your clips.' }))) return false;
    G.st = await api.room.share(t.id, on);
    emit('room');
    if (on) toast({ title: 'Backstage', message: 'Everyone can watch it while your Stagehand is open.', kind: 'ok', timeout: 3500 });
    return true;
  } catch (err) {
    toast({ title: 'Couldn’t change that', message: err.message, kind: 'err' });
    return false;
  }
}
