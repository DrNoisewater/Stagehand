/**
 * Friends (4.1): give friends your code and they can watch the highway and
 * Jam videos you share; add theirs to watch theirs. Only videos are shared,
 * never audio takes or songs. The UI is the Friends tab of the Recordings
 * window (recordings.js); the connection is friendlink.js; codes, keys and the
 * relay live in the main process (services/friends.js).
 *
 * Loaded at start, so your Stagehand answers friends even with the window shut.
 */
import { api } from './api.js';
import { emit } from './store.js';
import { toast } from './ui.js';
import { startHost } from './friendlink.js';

export const F = { st: null, peers: 0, watching: [] }; // watching: names of friends watching now (4.1.3)

export async function loadFriends() {
  try {
    F.st = await api.friends.get();
  } catch (_) {
    F.st = null;
  }
  emit('friends');
  return F.st;
}

api.on('friends:change', (st) => {
  F.st = st;
  emit('friends');
});

export const host = startHost(api, {
  onPeers: (n, names = []) => {
    const was = F.watching;
    F.peers = n;
    F.watching = names;
    const fresh = names.filter((x) => !was.includes(x));
    if (fresh.length) toast({ title: `${fresh[0]} is watching`, message: 'They connected with your code and can see the videos you share.', kind: 'info', timeout: 4000 });
    emit('friends');
  },
});
loadFriends();

// 4.1.3: a message from a friend (or someone with your code): say so, unless it's already on screen
api.on('friends:message', (m) => {
  const id = m.friendId || m.key;
  if (document.querySelector(`.fr-type[data-for="${CSS.escape(id)}"]`)) return;
  toast({
    title: `Message from ${m.name}`,
    message: m.text.length > 140 ? `${m.text.slice(0, 140)}…` : m.text,
    kind: 'info',
    timeout: 8000,
    actions: [{ label: 'Open', onClick: () => import('./recordings.js').then((r) => r.openRecordings({ tab: 'friends', friend: id })) }],
  });
});

export const isShared = (id) => !!(F.st && F.st.shared.includes(id));

/** Share or stop sharing one video; sharing one turns sharing on. */
export async function toggleShare(t) {
  const on = !isShared(t.id);
  try {
    F.st = await api.friends.share(t.id, on);
    if (on && !F.st.sharing) {
      F.st = await api.friends.setSharing(true);
      toast({ title: 'Sharing is on', message: `Friends with your code (${F.st.code}) can watch it while Stagehand is open.`, kind: 'ok', actions: [{ label: 'Copy code', onClick: () => copyCode() }] });
    }
    emit('friends');
  } catch (err) {
    toast({ title: 'Couldn’t change sharing', message: err.message, kind: 'err' });
  }
}

export function copyCode() {
  if (!F.st) return;
  navigator.clipboard.writeText(F.st.code).then(
    () => toast({ title: 'Code copied', message: 'Send it to a friend. Anyone with it can watch the videos you share.', kind: 'ok', timeout: 2600 }),
    () => toast({ title: 'Couldn’t copy', message: F.st.code, kind: 'err' })
  );
}
