/**
 * Your recordings in one place (3.13): looper takes, Record take, and highway or
 * Jam videos. Play them right here, rename, delete, or show the file. Files are
 * named "SH - <song>.wav/.mp4" in Stagehand's recordings folder.
 */
import { api } from './api.js';
import { state } from './store.js';
import { h, icon, modal, confirmDialog, toast, fmtBytes } from './ui.js';

const fmtLen = (s) => {
  s = Math.max(0, Math.round(Number(s) || 0));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};
const sep = () => (state.info && state.info.platform === 'win32' ? '\\' : '/');
const dir = () => (state.info && state.info.dirs && state.info.dirs.takes) || '';
const fileOf = (t) => `${dir()}${sep()}${String(t.file).replace(/\//g, sep())}`;

/** Opens the Recordings window. `focus`: a recording id to show first (just saved). */
export async function openRecordings({ focus = null } = {}) {
  const list = h('div.rec-list');
  const player = h('div.rec-player', { hidden: true });
  const body = h('div.rec-body', null, player, list);
  const openFolder = h('button.btn.ghost', { type: 'button', html: `${icon('folder')}<span>Open the folder</span>` });
  openFolder.onclick = () => dir() && api.shell.openPath(dir());
  const m = modal({ title: 'Recordings', body, footer: [openFolder], wide: true, onClose: () => stop() });
  m.el.parentElement.classList.add('over-highway');
  let media = null;
  function stop() {
    if (media) {
      media.pause();
      media.removeAttribute('src');
      media.load();
    }
    media = null;
    player.hidden = true;
    player.innerHTML = '';
    for (const r of list.querySelectorAll('.rec-row.on')) r.classList.remove('on');
  }
  function play(t, row) {
    const was = row.classList.contains('on');
    stop();
    if (was) return;
    row.classList.add('on');
    media = h(t.kind === 'video' ? 'video' : 'audio', { src: `stagehand://take/${t.id}`, controls: true, autoplay: true });
    media.onerror = () => toast({ title: 'Couldn’t play this recording', message: 'The file may have been moved or deleted.', kind: 'err' });
    player.append(h('b', { text: t.name }), media);
    player.hidden = false;
  }
  async function render() {
    let all = [];
    try {
      all = await api.takes.list();
    } catch (e) {
      list.replaceChildren(h('p.np-fine', { text: `Couldn’t read your recordings: ${e.message}` }));
      return;
    }
    list.innerHTML = '';
    if (!all.length) {
      list.append(h('p.np-fine', { text: 'Nothing recorded yet. Record a clip on the highway or in Jam, or use the looper and Record take.' }));
      return;
    }
    for (const t of all) {
      const when = new Date(t.at);
      const meta = [t.kind === 'video' ? 'Video' : 'Audio', when.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) + ' ' + when.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }), t.seconds ? fmtLen(t.seconds) : null, t.bytes ? fmtBytes(t.bytes) : null].filter(Boolean).join(' · ');
      const pl = h('button.round-play.sm', { type: 'button', 'aria-label': `Play ${t.name}`, html: icon('play') });
      const name = h('b', { text: t.name });
      const rename = h('button.icon-btn', { type: 'button', title: 'Rename', html: icon('edit') });
      const show = h('button.icon-btn', { type: 'button', title: 'Show in folder', html: icon('folder') });
      const del = h('button.icon-btn', { type: 'button', title: 'Delete', html: icon('trash') });
      const row = h(`div.rec-row${t.kind === 'video' ? '.video' : ''}`, { 'data-id': t.id }, pl, h('div.rec-text', null, name, h('span', { text: meta })), rename, show, del);
      pl.onclick = () => play(t, row);
      show.onclick = () => dir() && api.shell.showItem(fileOf(t));
      rename.onclick = () => {
        const input = h('input.input', { value: t.name, 'aria-label': 'New name' });
        name.replaceWith(input);
        input.focus();
        input.select();
        let done = false;
        const finish = async (save) => {
          if (done) return;
          done = true;
          if (save && input.value.trim() && input.value.trim() !== t.name) await api.takes.rename(t.id, input.value.trim()).catch((e) => toast({ title: 'Couldn’t rename', message: e.message, kind: 'err' }));
          render();
        };
        input.onkeydown = (ev) => {
          if (ev.key === 'Enter') finish(true);
          if (ev.key === 'Escape') {
            ev.stopPropagation();
            finish(false);
          }
        };
        input.onblur = () => finish(true);
      };
      del.onclick = async () => {
        if (!(await confirmDialog({ title: `Delete “${t.name}”?`, message: 'The recording is deleted from your PC.', confirm: 'Delete', danger: true }))) return;
        if (row.classList.contains('on')) stop();
        await api.takes.remove(t.id).catch((e) => toast({ title: 'Couldn’t delete', message: e.message, kind: 'err' }));
        render();
      };
      list.append(row);
      if (focus && t.id === focus) {
        row.classList.add('just');
        setTimeout(() => row.scrollIntoView({ block: 'nearest' }), 50);
      }
    }
  }
  await render();
  return m;
}
