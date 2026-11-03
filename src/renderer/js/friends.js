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

export const F = { st: null, peers: 0 };

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

startHost(api, {
  onPeers: (n) => {
    const was = F.peers;
    F.peers = n;
    if (n > was) toast({ title: 'A friend is watching', message: 'They’re looking at the videos you share.', kind: 'info', timeout: 3500 });
    emit('friends');
  },
});
loadFriends();

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
