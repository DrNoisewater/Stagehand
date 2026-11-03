/**
 * Recordings (3.13, rebuilt in 4.1): one window, two tabs.
 *  - Mine: looper takes, Record take, and highway or Jam videos. Play them here,
 *    rename, delete, show the file, and (videos only) share them with friends.
 *  - Friends: your code and the sharing switch, your friends, and the videos a
 *    friend shares, fetched straight from their Stagehand and played here.
 * Files are named "SH - <song>.wav/.mp4" in Stagehand's recordings folder.
 */
import { api } from './api.js';
import { state, bus } from './store.js';
import { h, icon, modal, confirmDialog, toast, fmtBytes, showMenu } from './ui.js';
import { F, loadFriends, isShared, toggleShare, copyCode } from './friends.js';
import { connectTo } from './friendlink.js';

const fmtLen = (s) => {
  s = Math.max(0, Math.round(Number(s) || 0));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};
const fmtWhen = (at) => {
  const d = new Date(at);
  return `${d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })} ${d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}`;
};
const sep = () => (state.info && state.info.platform === 'win32' ? '\\' : '/');
const dir = () => (state.info && state.info.dirs && state.info.dirs.takes) || '';
const fileOf = (t) => `${dir()}${sep()}${String(t.file).replace(/\//g, sep())}`;

// friends' videos already fetched this session (so watching again is instant)
const fetched = new Map(); // `${friendId}:${id}` -> blob URL
function remember(key, url) {
  fetched.set(key, url);
  while (fetched.size > 4) {
    const [k, u] = fetched.entries().next().value;
    URL.revokeObjectURL(u);
    fetched.delete(k);
  }
}

/** A one-line question in a small window. Resolves the text, or null. */
function askText({ title, label, value = '', placeholder = '', confirm = 'Save', hint = '', check = null, mono = false }) {
  return new Promise((resolve) => {
    let done = false;
    const input = h(`input.input${mono ? '.fr-input' : ''}`, { value, placeholder, spellcheck: 'false', 'aria-label': label });
    const err = h('div.fr-err');
    const ok = h('button.btn.primary', { type: 'button', text: confirm });
    const cancel = h('button.btn', { type: 'button', text: 'Cancel' });
    const m = modal({ title, body: h('div.fr-ask', null, h('label.fr-label', { text: label }), input, hint ? h('p.np-fine', { text: hint }) : null, err), footer: [cancel, ok], onClose: () => !done && resolve(null) });
    m.el.parentElement.classList.add('over-highway', 'over-rec');
    const go = async () => {
      const e = check ? await check(input.value) : null;
      if (e) {
        err.textContent = e;
        return input.focus();
      }
      done = true;
      m.close();
      resolve(input.value);
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

/**
 * Opens the Recordings window. `focus`: a recording id to show first (just saved).
 * `tab`: 'mine' (default) or 'friends'.
 */
export async function openRecordings({ focus = null, tab = 'mine' } = {}) {
  const R = { tab, friend: null, link: null, linkFor: null, list: null, err: null, loading: null, playing: null };
  const tabs = h('div.gseg.rec-tabs', { role: 'tablist', 'aria-label': 'Recordings', style: { '--gel': 'var(--gel-drums)' } });
  const player = h('div.rec-player', { hidden: true });
  const panel = h('div.rec-panel');
  const body = h('div.rec-body', null, tabs, player, panel);
  const openFolder = h('button.btn.ghost', { type: 'button', html: `${icon('folder')}<span>Open the folder</span>` });
  openFolder.onclick = () => dir() && api.shell.openPath(dir());
  const m = modal({
    title: 'Recordings',
    body,
    footer: [openFolder],
    wide: true,
    onClose: () => {
      stop();
      hangUp();
      offFriends();
    },
  });
  m.el.parentElement.classList.add('over-highway');
  m.el.classList.add('rec-window');

  // ------------------------------------------------------------ player --
  let media = null;
  function stop() {
    if (media) {
      media.pause();
      media.removeAttribute('src');
      media.load();
    }
    media = null;
    R.playing = null;
    player.hidden = true;
    player.innerHTML = '';
    for (const r of panel.querySelectorAll('.rec-row.on')) r.classList.remove('on');
  }
  function show(kind, src, title, sub, key) {
    stop();
    R.playing = key;
    media = h(kind === 'video' ? 'video' : 'audio', { src, controls: true, autoplay: true });
    media.onerror = () => toast({ title: 'Couldn’t play this recording', message: 'The file may have been moved or deleted.', kind: 'err' });
    player.append(h('div.rec-ptitle', null, h('b', { text: title }), sub ? h('span', { text: sub }) : null), media);
    player.hidden = false;
    for (const r of panel.querySelectorAll('.rec-row')) r.classList.toggle('on', r.dataset.key === key);
  }

  function drawTabs() {
    tabs.innerHTML = '';
    const n = F.st ? F.st.friends.length : 0;
    for (const [id, label, ic] of [['mine', 'Mine', 'record'], ['friends', n ? `Friends · ${n}` : 'Friends', 'people']]) {
      const b = h('button', { type: 'button', role: 'tab', 'aria-pressed': String(R.tab === id), 'aria-selected': String(R.tab === id), html: `${icon(ic)}<span>${label}</span>` });
      if (id === 'friends' && F.st && F.st.sharing) b.append(h(`i.fr-dot${F.peers ? '.live' : ''}`, { title: F.peers ? 'A friend is watching now' : 'Sharing is on' }));
      b.onclick = () => {
        if (R.tab === id) return;
        R.tab = id;
        render();
      };
      tabs.append(b);
    }
  }

  async function render() {
    drawTabs();
    if (R.tab === 'mine') await renderMine();
    else renderFriends();
  }

  // -------------------------------------------------------------- mine --
  async function renderMine() {
    let all = [];
    try {
      all = await api.takes.list();
    } catch (e) {
      panel.replaceChildren(h('p.np-fine', { text: `Couldn’t read your recordings: ${e.message}` }));
      return;
    }
    if (R.tab !== 'mine') return;
    panel.innerHTML = '';
    if (!all.length) {
      panel.append(h('p.np-fine', { text: 'Nothing recorded yet. Record a clip on the highway or in Jam, or use the looper and Record take.' }));
      return;
    }
    const shared = all.filter((t) => t.kind === 'video' && isShared(t.id)).length;
    if (shared && F.st) {
      const go = h('button.btn.small.ghost', { type: 'button', text: 'Friends' });
      go.onclick = () => ((R.tab = 'friends'), render());
      panel.append(h(`div.rec-sharing${F.st.sharing ? '.on' : ''}`, null, h('span.rec-share-ic', { html: icon('people') }), h('span.grow', { text: F.st.sharing ? `${shared} video${shared === 1 ? '' : 's'} shared with friends${F.peers ? ' · a friend is watching now' : ''}` : `${shared} video${shared === 1 ? '' : 's'} marked to share, but sharing is off` }), go));
    }
    const list = h('div.rec-list');
    for (const t of all) {
      const video = t.kind === 'video';
      const meta = [video ? 'Video' : 'Audio', fmtWhen(t.at), t.seconds ? fmtLen(t.seconds) : null, t.bytes ? fmtBytes(t.bytes) : null].filter(Boolean).join(' · ');
      const key = `me:${t.id}`;
      const pl = h('button.round-play.sm', { type: 'button', 'aria-label': `Play ${t.name}`, html: icon(R.playing === key ? 'stop' : 'play') });
      const name = h('b', { text: t.name });
      const rename = h('button.icon-btn', { type: 'button', title: 'Rename', html: icon('edit') });
      const showBtn = h('button.icon-btn', { type: 'button', title: 'Show in folder', html: icon('folder') });
      const del = h('button.icon-btn', { type: 'button', title: 'Delete', html: icon('trash') });
      const sh = isShared(t.id);
      const share = video
        ? h(`button.tk-share${sh && F.st && F.st.sharing ? '.on' : sh ? '.paused' : ''}`, { type: 'button', 'aria-pressed': String(sh), title: sh ? (F.st && F.st.sharing ? 'Shared with friends (click to stop)' : 'Marked to share, but sharing is off') : 'Share with friends', 'aria-label': sh ? 'Stop sharing with friends' : 'Share with friends', html: icon('people') })
        : null;
      if (share)
        share.onclick = async () => {
          await toggleShare(t);
          renderMine();
        };
      const row = h(`div.rec-row${video ? '.video' : ''}${sh ? '.shared' : ''}${R.playing === key ? '.on' : ''}`, { 'data-id': t.id, 'data-key': key }, pl, h('span.rec-kind', { html: icon(video ? 'video' : 'volume'), title: video ? 'Video' : 'Audio' }), h('div.rec-text', null, name, h('span', { text: meta })), share, rename, showBtn, del);
      pl.onclick = () => {
        if (R.playing === key) return stop(), renderMine();
        show(video ? 'video' : 'audio', `stagehand://take/${t.id}`, t.name, null, key);
        renderMine();
      };
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
          if (save && input.value.trim() && input.value.trim() !== t.name) await api.takes.rename(t.id, input.value.trim()).catch((e) => toast({ title: 'Couldn’t rename', message: e.message, kind: 'err' }));
          renderMine();
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
        if (!(await confirmDialog({ title: `Delete “${t.name}”?`, message: sh ? 'The recording is deleted from your PC, and friends can no longer watch it.' : 'The recording is deleted from your PC.', confirm: 'Delete', danger: true }))) return;
        if (R.playing === key) stop();
        await api.takes.remove(t.id).catch((e) => toast({ title: 'Couldn’t delete', message: e.message, kind: 'err' }));
        await loadFriends();
        renderMine();
      };
      list.append(row);
      if (focus && t.id === focus) {
        row.classList.add('just');
        setTimeout(() => row.scrollIntoView({ block: 'nearest' }), 50);
        focus = null;
      }
    }
    panel.append(list);
  }

  // ----------------------------------------------------------- friends --
  function renderFriends() {
    panel.innerHTML = '';
    const st = F.st;
    if (!st) {
      panel.append(h('p.np-fine', { text: 'Getting your friend code…' }));
      return;
    }
    panel.append(meCard(st), friendsRow(st));
    if (R.friend) panel.append(friendView());
    else panel.append(h('p.np-fine.fr-tip', { text: st.friends.length ? 'Pick a friend to watch the videos they share.' : 'Add a friend with their code to watch the videos they share. Give them your code so they can watch yours.' }));
  }

  function meCard(st) {
    const sw = h('button.switch', { type: 'button', 'aria-pressed': String(st.sharing), 'aria-label': 'Share my videos', style: { '--gel': 'var(--gel-bass)' } });
    sw.onclick = () => api.friends.setSharing(!st.sharing).catch((err) => toast({ title: 'Couldn’t change sharing', message: err.message, kind: 'err' }));
    const copy = h('button.icon-btn', { type: 'button', title: 'Copy your code', 'aria-label': 'Copy your code', html: icon('copy'), onclick: copyCode });
    const more = h('button.icon-btn', { type: 'button', title: 'More', 'aria-label': 'Friends options', html: icon('more') });
    more.onclick = (e) => {
      const r = e.currentTarget.getBoundingClientRect();
      showMenu(r.left, r.bottom + 4, [
        {
          label: st.name ? `Your name: ${st.name}` : 'Your name for friends',
          icon: 'person',
          onClick: async () => {
            const v = await askText({ title: 'Your name for friends', label: 'Friends see this when they connect', value: st.name, placeholder: 'Your name' });
            if (v !== null) await api.friends.setName(v);
          },
        },
        {
          label: 'New code',
          icon: 'refresh',
          onClick: async () => {
            if (!(await confirmDialog({ title: 'Make a new code?', message: 'Everyone with your old code loses access. Send the new one to the friends you want.', confirm: 'New code', danger: true }))) return;
            await api.friends.newCode();
            toast({ title: 'New code made', message: 'Your old code no longer works.', kind: 'ok' });
          },
        },
        {
          label: 'Relay server',
          icon: 'globe',
          onClick: () =>
            askText({
              title: 'Relay server',
              label: 'Where Stagehands meet before they connect directly',
              value: st.relay,
              hint: 'Any ntfy server. Messages through it are sealed with your code; your videos go straight between the two PCs. You and your friends need the same one.',
              check: (x) => api.friends.setRelay(x).then(() => null, (err) => err.message),
            }),
        },
      ]);
    };
    const shared = st.shared.length;
    const say = st.sharing
      ? F.peers
        ? `${F.peers === 1 ? 'A friend is' : `${F.peers} friends are`} watching now. ${shared} video${shared === 1 ? '' : 's'} shared.`
        : shared
          ? `${shared} video${shared === 1 ? '' : 's'} shared. Friends with your code can watch while Stagehand is open.`
          : 'Nothing shared yet: on the Mine tab, press the share button on a video.'
      : 'Turn sharing on, then press the share button on a video in Mine. Friends with your code can watch it.';
    return h('div.fr-mecard', null,
      h(`div.fr-me${st.sharing ? '.on' : ''}`, null,
        h('div.fr-code-wrap', null, h('span.fr-label', { text: 'Your code' }), h('div.fr-code', null, h('code', { text: st.code }), copy)),
        h('span.grow'),
        h('label.fr-share', null, h('span', { text: st.sharing ? 'Sharing' : 'Not sharing' }), sw),
        more
      ),
      h('div.np-fine.fr-say', null, st.sharing ? h(`span.fr-dot${F.peers ? '.live' : ''}`) : null, say)
    );
  }

  function friendsRow(st) {
    const list = h('div.fr-friends');
    for (const f of st.friends) {
      const chip = h(`button.fr-friend${R.friend && R.friend.id === f.id ? '.sel' : ''}`, { type: 'button', title: `Watch ${f.name}’s videos` }, h('span.fr-av', { text: (f.name || '?').trim().slice(0, 1).toUpperCase() }), h('span.fr-name', { text: f.name }));
      chip.onclick = () => pick(f);
      chip.oncontextmenu = (e) => {
        e.preventDefault();
        showMenu(e.clientX, e.clientY, [
          { label: 'Watch their videos', icon: 'play', onClick: () => pick(f) },
          {
            label: 'Rename',
            icon: 'edit',
            onClick: async () => {
              const v = await askText({ title: 'Rename friend', label: 'Name', value: f.name });
              if (v !== null) await api.friends.rename(f.id, v);
            },
          },
          '-',
          {
            label: 'Remove',
            icon: 'trash',
            onClick: async () => {
              if (!(await confirmDialog({ title: `Remove ${f.name}?`, message: 'You can add them again with their code.', confirm: 'Remove', danger: true }))) return;
              if (R.friend && R.friend.id === f.id) (hangUp(), (R.friend = null));
              await api.friends.remove(f.id);
            },
          },
        ]);
      };
      list.append(chip);
    }
    const add = h('button.fr-friend.add', { type: 'button', title: 'Add a friend with their code' }, h('span.fr-av', { html: icon('plus') }), h('span.fr-name', { text: 'Add a friend' }));
    add.onclick = addFriend;
    list.append(add);
    return list;
  }

  async function addFriend() {
    const code = await askText({
      title: 'Add a friend',
      label: 'Their friend code',
      placeholder: 'ABCD-EFGH-JKMN-PQRS',
      confirm: 'Next',
      mono: true,
      hint: 'Your friend finds it in Recordings › Friends.',
      check: (v) => {
        const c = v.toUpperCase().replace(/[^0-9A-Z]/g, '');
        if (c.length !== 16) return 'A friend code has 16 letters and numbers.';
        if (F.st && c === F.st.code.replace(/-/g, '')) return 'That’s your own code. Ask your friend for theirs.';
        return null;
      },
    });
    if (code === null) return;
    const name = await askText({ title: 'Add a friend', label: 'What do you call them?', placeholder: 'Friend', confirm: 'Add friend' });
    if (name === null) return;
    try {
      const f = await api.friends.add(code, name);
      await loadFriends();
      pick(f);
    } catch (err) {
      toast({ title: 'Couldn’t add that code', message: err.message, kind: 'err' });
    }
  }

  function hangUp() {
    if (R.link) R.link.close();
    R.link = null;
    R.linkFor = null;
  }

  async function pick(f) {
    if (R.friend && R.friend.id === f.id && R.link && !R.link.closed) return;
    hangUp();
    R.friend = f;
    R.list = null;
    R.err = null;
    R.loading = null;
    renderFriends();
    try {
      const link = await connectTo(api, f.id);
      if (!R.friend || R.friend.id !== f.id || !m.el.isConnected) return link.close();
      R.link = link;
      R.linkFor = f.id;
      link.onclose = () => {
        if (R.link !== link) return;
        R.link = null;
        R.loading = null;
        R.err = Object.assign(new Error(`The connection to ${f.name} closed.`), { code: 'CLOSED' });
        if (R.tab === 'friends') renderFriends();
      };
      if (link.name && f.name === 'Friend') api.friends.rename(f.id, link.name).catch(() => {});
      R.list = await link.list();
    } catch (err) {
      if (!R.friend || R.friend.id !== f.id) return;
      R.err = err;
    }
    if (R.tab === 'friends') renderFriends();
  }

  function friendView() {
    const f = R.friend;
    const box = h('div.fr-view');
    if (R.err) {
      const off = R.err.code === 'OFFLINE';
      const again = h('button.btn.primary', { type: 'button', text: 'Try again' });
      again.onclick = () => ((R.err = null), hangUp(), pick(f));
      box.append(h(`div.fr-state.${off ? 'off' : 'bad'}`, null, h('span.fr-orb', { html: icon(off ? 'person' : 'alert') }), h('b', { text: off ? `${f.name} isn’t around` : 'Couldn’t connect' }), h('p', { text: R.err.message }), again));
      return box;
    }
    if (!R.list) {
      box.append(h('div.fr-state.wait', null, h('span.fr-orb.pulse', { html: icon('people') }), h('b', { text: `Connecting to ${f.name}…` }), h('p', { text: 'Their Stagehand needs to be open, with sharing on.' })));
      return box;
    }
    const refresh = h('button.btn.small.ghost', { type: 'button', html: `${icon('refresh')}<span>Check again</span>` });
    refresh.onclick = async () => {
      try {
        R.list = await R.link.list();
      } catch (err) {
        R.err = err;
      }
      renderFriends();
    };
    box.append(h('div.fr-live', null, h('i'), h('span.grow', { text: `Connected to ${(R.link && R.link.name) || f.name}` }), refresh));
    if (!R.list.length) {
      box.append(h('p.np-fine', { text: `${f.name} hasn’t shared any videos yet.` }));
      return box;
    }
    const list = h('div.rec-list');
    for (const v of R.list) {
      const key = `${f.id}:${v.id}`;
      const busy = R.loading && R.loading.key === key ? R.loading : null;
      const playing = R.playing === key;
      const btn = h(`button.round-play.sm${busy ? '.loading' : ''}`, { type: 'button', 'aria-label': busy ? 'Stop getting it' : playing ? 'Stop' : `Watch ${v.name}`, html: icon(busy || playing ? 'stop' : 'play'), style: busy ? { '--p': `${Math.round(busy.p * 360)}deg` } : null });
      btn.onclick = () => (busy ? R.link && R.link.cancel() : playing ? (stop(), renderFriends()) : watch(f, v));
      const meta = busy ? `Getting it… ${Math.round(busy.p * 100)}%` : [fetched.has(key) ? 'Ready' : null, fmtWhen(v.at), v.seconds ? fmtLen(v.seconds) : null, v.size ? fmtBytes(v.size) : null].filter(Boolean).join(' · ');
      list.append(h(`div.rec-row.video${playing ? '.on' : ''}`, { 'data-key': key }, btn, h('span.rec-kind', { html: icon('video') }), h('div.rec-text', null, h('b', { text: v.name }), h('span', { text: meta }))));
    }
    box.append(list);
    return box;
  }

  async function watch(f, v) {
    const key = `${f.id}:${v.id}`;
    if (fetched.has(key)) return show('video', fetched.get(key), v.name, `${f.name}’s video`, key), renderFriends();
    if (!R.link || (R.loading && R.loading.key !== key)) return;
    R.loading = { key, p: 0 };
    renderFriends();
    let last = 0;
    try {
      const got = await R.link.get(v.id, {
        onProgress: (p) => {
          if (!R.loading || R.loading.key !== key) return;
          R.loading.p = p;
          if (p - last > 0.01) {
            last = p;
            if (R.tab === 'friends') renderFriends();
          }
        },
      });
      R.loading = null;
      if (got.cancelled) return renderFriends();
      const url = URL.createObjectURL(new Blob([got.bytes], { type: 'video/mp4' }));
      remember(key, url);
      if (m.el.isConnected) show('video', url, v.name, `${f.name}’s video`, key);
    } catch (err) {
      R.loading = null;
      toast({ title: 'Couldn’t get that video', message: err.message, kind: 'err' });
    }
    if (R.tab === 'friends') renderFriends();
  }

  const onFriends = () => {
    if (!m.el.isConnected) return;
    drawTabs();
    if (R.tab === 'friends') renderFriends();
  };
  bus.addEventListener('friends', onFriends);
  function offFriends() {
    bus.removeEventListener('friends', onFriends);
  }
  await render();
  return m;
}
