/**
 * 4.19: a cleaner singer for the songs you sing.
 *
 * The user: "Upon clicking on some form of singing or karaoke, it can then prompt the user if they
 * want to upgrade the stems. With the option to make that the default action." And: nobody should
 * have to convert a library of two thousand songs, or wait before playing.
 *
 * So: every song keeps today's quick split. When Sing along or Karaoke opens on a split song, a note
 * asks once whether to make the singer cleaner. Yes starts it in the background (the song plays on
 * the stems it has; the new ones are used the next time it's opened). "Always" stops the asking.
 */
import { api } from './api.js';
import { state, emit } from './store.js';
import { toast } from './ui.js';

const asked = new Set(); // songs asked about since the app opened
const live = new Map(); // songId -> { state, progress } of a cleaner-singer job

const choice = () => {
  const c = state.settings && state.settings.stems && state.settings.stems.singer;
  return c === 'always' || c === 'never' ? c : 'ask';
};

/** A cleaner-singer job for this song, if one is waiting or running. */
export const singerJob = (songId) => live.get(songId) || null;

async function start(song, quiet) {
  const r = await api.stems.upgrade(song.id).catch(() => null);
  if (!r || !r.ok) return toast({ title: 'The singer couldn’t be made cleaner', message: 'Stem splitting isn’t set up on this PC.', kind: 'err' });
  if (r.better || quiet) return;
  toast({ title: `Making the singer cleaner in ${song.title}`, message: 'It works in the background. Keep playing: the new stems are used the next time you open the song.', kind: 'info', timeout: 7000 });
}

/** Sing along or Karaoke opened on this song: ask (once), or just do it, as chosen in Settings. */
export async function offerSinger(song) {
  if (!song || !api.stems || !api.stems.upgrade || asked.has(song.id)) return;
  const how = choice();
  if (how === 'never' || !state.engine || !state.engine.installed) return;
  asked.add(song.id);
  const st = await api.stems.status(song.id).catch(() => null);
  if (!st || st.state !== 'ready' || st.better || st.upgrade) {
    if (!st || st.state !== 'ready') asked.delete(song.id); // not split yet: ask when it is
    return;
  }
  if (how === 'always') return start(song, true);
  const slow = state.engine.device && state.engine.device !== 'cuda';
  toast({
    title: 'Make the singer cleaner for this song?',
    message: `Stagehand can split it once more with a model made just for voices: more exact notes to sing, and Karaoke takes the singer out more cleanly. It works in the background while you play${slow ? ', but without a graphics card it takes a long time (10 to 30 minutes)' : ' (a few minutes)'}. The first time, it downloads the model (about 640 MB).`,
    kind: 'info',
    timeout: 30000,
    actions: [
      { label: 'Yes', onClick: () => start(song) },
      {
        label: 'Always',
        onClick: async () => {
          const s = await api.settings.set({ stems: { singer: 'always' } }).catch(() => null);
          if (s && s.stems) {
            state.settings = s;
            emit('settings');
          }
          start(song);
        },
      },
      { label: 'Not now', onClick: () => {} },
    ],
  });
}

if (api.on) {
  api.on('stems:upgrade', (u) => {
    if (!u || !u.songId) return;
    if (u.state === 'queued' || u.state === 'running') live.set(u.songId, u);
    else live.delete(u.songId);
    emit('singer-upgrade', u);
    if (u.state !== 'error') return;
    const s = state.songs.get(u.songId);
    toast({ title: `The singer couldn’t be made cleaner${s ? ` in ${s.title}` : ''}`, message: `${u.message || 'The split stopped.'} The song keeps the stems it has.`, kind: 'err', timeout: 9000 });
  });
}
