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
// how each friend's last connection went this session: 'ok', 'bad' or 'wait' (a dot on their chip)
const friendStatus = new Map();
// messages read per friend (kept on this PC), for the little count on their chip
const seenChat = new Map(
  (() => {
    try {
      return Object.entries(JSON.parse(localStorage.getItem('stagehand.chatSeen') || '{}'));
    } catch (_) {
      return [];
    }
  })()
);
function markSeen(id, n) {
  if (seenChat.get(id) === n) return;
  seenChat.set(id, n);
  try {
    localStorage.setItem('stagehand.chatSeen', JSON.stringify(Object.fromEntries(seenChat)));
  } catch (_) {}
}
function unread(id, msgs) {
  const n = (msgs || []).filter((x) => x.dir === 'in').length - (seenChat.get(id) ?? 0);
  return n > 0 ? h('span.fr-unread', { text: String(n), title: `${n} new message${n === 1 ? '' : 's'}` }) : null;
}

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
export async function openRecordings({ focus = null, tab = 'mine', friend = null } = {}) {
  const R = { tab, friend: null, link: null, linkFor: null, list: null, err: null, loading: null, playing: null, stage: null, status: friendStatus };
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
  let route = null; // the player's sound, sent into the sound engine like the song
  function stop() {
    if (media) {
      media.pause();
      media.removeAttribute('src');
      media.load();
    }
    try {
      route?.disconnect();
    } catch (_) {}
    media = route = null;
    R.playing = null;
    player.hidden = true;
    player.innerHTML = '';
    for (const r of panel.querySelectorAll('.rec-row.on')) r.classList.remove('on');
  }
  function show(kind, src, title, sub, key) {
    stop();
    R.playing = key;
    // 4.1.2: the sound plays through the same output as the song, looper and takes.
    // Played the ordinary way, it went to Windows' default speakers, and while the
    // sound engine has the speakers to itself (fastest mode) that sound was shut out:
    // videos seemed to have no sound although the files had it.
    media = h(kind === 'video' ? 'video' : 'audio', { src, controls: true, crossOrigin: 'anonymous' });
    media.onerror = () => toast({ title: 'Couldn’t play this recording', message: 'The file may have been moved or deleted.', kind: 'err' });
    const el = media;
    import('./stage.js')
      .then(async ({ engine }) => {
        const { ctx, node } = await engine.extraOut();
        if (media !== el) return;
        route = ctx.createMediaElementSource(el);
        route.connect(node);
      })
      .catch((e) => console.warn('recordings: playing through the default output', e))
      .finally(() => {
        if (media === el) el.play().catch(() => {});
      });
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
    if (R.friend) markSeen(R.friend.id, thread(st, R.friend).filter((x) => x.dir === 'in').length);
    panel.append(meCard(st), friendsRow(st));
    if (R.friend && R.friend.stranger) panel.append(strangerView(st), chatView(st));
    else if (R.friend) panel.append(friendBar(st), friendView(), chatView(st));
    else panel.append(h('p.np-fine.fr-tip', { text: st.friends.length ? 'Pick a friend to watch the videos they share and send them a message.' : 'Add a friend with their code to watch the videos they share. Give them your code so they can watch yours.' }));
  }

  /** 4.1.4: the friend you picked, with what you can do, in plain sight (was a right-click menu). */
  function friendBar(st) {
    const f = st.friends.find((x) => x.id === R.friend.id) || R.friend;
    const b = (text, ic, onClick, cls = '') => {
      const x = h(`button.btn.small.ghost${cls}`, { type: 'button', html: `${icon(ic)}<span>${text}</span>` });
      x.onclick = onClick;
      return x;
    };
    return h('div.fr-bar', null,
      h('span.fr-av', { text: (f.name || '?').trim().slice(0, 1).toUpperCase() }),
      h('div.fr-who', null, h('b', { text: f.name }), h('span', null, 'Their code: ', h('code', { text: f.code || '' }))),
      h('span.grow'),
      b('Rename', 'edit', () => renameFriend(f)),
      b('Change code', 'edit', () => fixCode(f)),
      b('Remove', 'trash', () => removeFriend(f), '.danger'));
  }
  async function renameFriend(f) {
    const v = await askText({ title: 'Rename friend', label: 'Name', value: f.name });
    if (v !== null) await api.friends.rename(f.id, v);
  }
  async function removeFriend(f) {
    if (!(await confirmDialog({ title: `Remove ${f.name}?`, message: 'You can add them again with their code. Your messages with them are kept.', confirm: 'Remove', danger: true }))) return;
    if (R.friend && R.friend.id === f.id) (hangUp(), (R.friend = null));
    await api.friends.remove(f.id);
  }

  // ---------------------------------------------------------- messages --
  // 4.1.3: messages go through the internet meeting point, so they work even when
  // the videos can't connect: a quick way to test that the code and the internet work.
  const thread = (st, fr) => {
    if (!fr) return [];
    const x = fr.stranger ? st.strangers.find((y) => y.key === fr.id) : st.friends.find((y) => y.id === fr.id);
    return (x && x.messages) || [];
  };
  const fmtTime = (at) => new Date(at).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  let draft = null; // the message box, kept across redraws so typing isn't lost
  function chatView(st) {
    const fr = R.friend;
    const msgs = thread(st, fr);
    const list = h('div.fr-msgs');
    if (!msgs.length) list.append(h('p.fr-msgs-empty', { text: `Say hi to ${fr.name}. Messages go through the internet meeting point, so they work even when videos can’t connect: if yours says “Delivered”, the code and the internet are fine.` }));
    for (const x of msgs) {
      let state = null;
      if (x.dir === 'out') {
        const old = Date.now() - x.at > 30000;
        if (x.state === 'delivered') state = h('span.fr-st.ok', { text: 'Delivered' });
        else if (x.state === 'failed') {
          const retry = h('button.fr-link', { type: 'button', text: 'Send again' });
          retry.onclick = () => sendText(x.text);
          state = h('span.fr-st.bad', null, `Not sent: ${x.error || 'no internet'}. `, retry);
        } else if (x.state === 'sending') state = h('span.fr-st', { text: 'Sending…' });
        else state = h(`span.fr-st${old ? '.warn' : ''}`, { text: old ? `Sent, not delivered yet: ${fr.name}’s Stagehand hasn’t picked it up (it’s closed, or the code is wrong). It waits up to 12 hours.` : 'Sent' });
      }
      list.append(h(`div.fr-msg.${x.dir}`, null, h('div.fr-bubble', { text: x.text }), h('div.fr-meta', null, h('span', { text: fmtTime(x.at) }), state)));
    }
    if (!draft || draft.dataset.for !== fr.id) {
      draft = h('textarea.input.fr-type', { rows: 1, maxlength: 500, placeholder: `Message ${fr.name}`, 'aria-label': `Message ${fr.name}`, dataset: { for: fr.id } });
      draft.onkeydown = (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          sendText(draft.value);
        }
      };
    }
    const hadFocus = document.activeElement === draft;
    const send = h('button.btn.primary', { type: 'button', text: 'Send' });
    send.onclick = () => sendText(draft.value);
    const box = h('div.fr-chat', null, h('div.fr-chat-head', null, h('b', { text: 'Messages' })), list, h('div.fr-compose', null, draft, send));
    requestAnimationFrame(() => {
      list.scrollTop = list.scrollHeight;
      if (hadFocus) draft.focus();
    });
    return box;
  }
  async function sendText(text) {
    const fr = R.friend;
    const t = String(text || '').trim();
    if (!fr || !t) return;
    if (draft && draft.value.trim() === t) draft.value = '';
    try {
      await api.friends.send(fr.id, t);
    } catch (err) {
      toast({ title: 'Couldn’t send it', message: err.message, kind: 'err' });
    }
    if (draft) draft.focus();
  }
  /** Someone with your code wrote, but isn't in your list: add them back in one go. */
  function strangerView(st) {
    const fr = R.friend;
    const x = st.strangers.find((y) => y.key === fr.id);
    const add = h('button.btn.primary', { type: 'button', text: `Add ${fr.name} as a friend` });
    add.onclick = async () => {
      const name = await askText({ title: 'Add a friend', label: 'What do you call them?', value: fr.name, confirm: 'Add' });
      if (name === null) return;
      try {
        const f = await api.friends.add(x.code, name);
        await loadFriends();
        R.friend = null;
        pick(f);
      } catch (err) {
        toast({ title: 'Couldn’t add them', message: err.message, kind: 'err' });
      }
    };
    const mine = friendFor(st, x);
    if (mine) {
      const use = h('button.btn.primary', { type: 'button', text: `Yes: use this code for ${mine.name}` });
      use.onclick = () => useCode(mine, x.code);
      return h('div.fr-view', null, h('div.fr-state.off', null, h('span.fr-orb', { html: icon('person') }), h('b', { text: `Is this ${mine.name}?` }), h('p', null, `${fr.name} wrote from the code `, h('code', { text: x.code }), `. The code you typed for ${mine.name} is `, h('code', { text: mine.code }), ', which is nearly the same: probably a typo.'), h('div.fr-acts', null, use, add)));
    }
    return h('div.fr-view', null, h('div.fr-state.off', null, h('span.fr-orb', { html: icon('person') }), h('b', { text: `${fr.name} wrote to you` }), h('p', { text: `${fr.name} has your code but isn’t in your list. Add them to watch the videos they share; you can answer here either way.` }), h('div.fr-acts', null, add)));
  }

  function meCard(st) {
    const sw = h('button.switch', { type: 'button', 'aria-pressed': String(st.sharing), 'aria-label': 'Share my videos', style: { '--gel': 'var(--gel-bass)' } });
    sw.onclick = () => api.friends.setSharing(!st.sharing).catch((err) => toast({ title: 'Couldn’t change sharing', message: err.message, kind: 'err' }));
    const copy = h('button.icon-btn', { type: 'button', title: 'Copy your code', 'aria-label': 'Copy your code', html: icon('copy'), onclick: copyCode });
    const change = h('button.btn.small.ghost', { type: 'button', text: 'Change', title: 'Choose your own word or phrase' });
    change.onclick = changeMyCode;
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
        { label: 'Change my code', icon: 'edit', onClick: changeMyCode },
        {
          label: 'Make up a new code for me',
          icon: 'refresh',
          onClick: async () => {
            if (!(await confirmDialog({ title: 'Make a new code?', message: 'Everyone with your old code loses access, and nobody is told the new one: send it to the friends you want. (To change your code and keep your friends, use Change instead.)', confirm: 'New code', danger: true }))) return;
            await api.friends.newCode();
            toast({ title: 'New code made', message: 'Your old code no longer works.', kind: 'ok' });
          },
        },
        {
          label: 'Meeting points',
          icon: 'globe',
          onClick: () =>
            askText({
              title: 'Meeting points',
              label: 'Where Stagehands find each other before they connect directly',
              value: st.relay,
              hint: 'Any ntfy servers, separated by commas; all are tried at once. Messages through them are sealed with your code; your videos go straight between the two PCs. You and your friends need at least one in common. Leave it empty for the standard ones.',
              check: (x) => api.friends.setRelay(x).then(() => null, (err) => err.message),
            }),
        },
      ]);
    };
    // 4.1.3: one plain line that says exactly where things stand
    const shared = st.shared.length;
    const vids = `${shared} video${shared === 1 ? '' : 's'} shared`;
    const who = F.watching.length ? F.watching.join(' and ') : F.peers ? (F.peers === 1 ? 'A friend' : `${F.peers} friends`) : '';
    const [cls, say] = !st.sharing
      ? ['off', 'Video sharing is off: friends can still message you, but can’t watch your videos until you turn it on.']
      : !st.listening
        ? ['wait', 'Getting ready: connecting to the internet meeting point… If this doesn’t turn green, check your internet.']
        : who
          ? ['live', `${who} ${F.watching.length > 1 || F.peers > 1 ? 'are' : 'is'} connected and watching now. ${vids}.`]
          : ['ok', `Ready. Friends with your code can connect now. ${shared ? vids + '.' : 'Nothing shared yet: on the Mine tab, press the share button on a video.'}`];
    return h('div.fr-mecard', null,
      h(`div.fr-me${st.sharing ? '.on' : ''}`, null,
        h('div.fr-code-wrap', null, h('span.fr-label', { text: 'Your code' }), h('div.fr-code', null, h('code', { text: st.code }), copy, change)),
        h('span.grow'),
        h('label.fr-share', null, h('span', { text: st.sharing ? 'Sharing' : 'Not sharing' }), sw),
        more
      ),
      h(`div.fr-status.${cls}`, null, h('i'), h('span', { text: say }))
    );
  }

  async function changeMyCode() {
    const st = F.st;
    if (!st) return;
    const v = await askText({
      title: 'Your code',
      label: 'A word or phrase your friends type to watch your videos',
      value: st.code,
      placeholder: 'e.g. tiger-427',
      confirm: 'Use this code',
      hint: 'Capitals, spaces and dashes don’t matter. Anyone who knows it can watch what you share, so pick something only your friends would guess. The friends in your list are told the new code by their Stagehand (within 12 hours, even if theirs is closed).',
      check: (x) => (x.trim() === st.code ? null : api.friends.setCode(x).then(() => null, (err) => err.message)),
    });
    if (v !== null && v.trim() !== st.code) toast({ title: 'Code changed', message: `Your code is now “${F.st ? F.st.code : v}”. Your friends’ Stagehands are told it.`, kind: 'ok', actions: [{ label: 'Copy', onClick: () => copyCode() }] });
  }

  function friendsRow(st) {
    const list = h('div.fr-friends');
    for (const f of st.friends) {
      const stt = R.status.get(f.id) || '';
      const chip = h(`button.fr-friend${R.friend && R.friend.id === f.id ? '.sel' : ''}${stt ? '.' + stt : ''}`, { type: 'button', title: `Watch ${f.name}’s videos (code: ${f.code})` }, h('span.fr-av', { text: (f.name || '?').trim().slice(0, 1).toUpperCase() }), h('span.fr-name', { text: f.name }), stt ? h('i.fr-chipdot') : null, unread(f.id, f.messages));
      chip.onclick = () => pick(f);
      chip.oncontextmenu = (e) => {
        e.preventDefault();
        showMenu(e.clientX, e.clientY, [
          { label: 'Watch their videos', icon: 'play', onClick: () => pick(f) },
          { label: 'Rename', icon: 'edit', onClick: () => renameFriend(f) },
          { label: 'Change their code', icon: 'edit', onClick: () => fixCode(f) },
          '-',
          { label: 'Remove', icon: 'trash', danger: true, onClick: () => removeFriend(f) },
        ]);
      };
      list.append(chip);
    }
    for (const x of st.strangers || []) {
      const chip = h(`button.fr-friend.stranger${R.friend && R.friend.id === x.key ? '.sel' : ''}`, { type: 'button', title: `${x.name} wrote to you` }, h('span.fr-av', { text: (x.name || '?').trim().slice(0, 1).toUpperCase() }), h('span.fr-name', { text: `${x.name} (new)` }), unread(x.key, x.messages));
      chip.onclick = () => {
        hangUp();
        R.err = null;
        R.list = null;
        R.friend = { id: x.key, name: x.name, code: x.code, stranger: true };
        renderFriends();
      };
      list.append(chip);
    }
    const add = h('button.fr-friend.add', { type: 'button', title: 'Add a friend with their code' }, h('span.fr-av', { html: icon('plus') }), h('span.fr-name', { text: 'Add a friend' }));
    add.onclick = addFriend;
    list.append(add);
    return list;
  }

  // 4.1.3: codes are a word or phrase; capitals, spaces and dashes don't matter
  const tidy = (v) => String(v || '').toUpperCase().replace(/[^0-9A-Z]/g, '');
  const codeCheck = (v, exceptId = null) => {
    const c = tidy(v);
    if (c.length < 6) return 'A code has at least 6 letters or numbers. Ask your friend to read you theirs.';
    if (F.st && tidy(F.st.code) === c) return 'That’s your own code. Ask your friend for theirs.';
    const other = F.st && F.st.friends.find((x) => x.id !== exceptId && tidy(x.code) === c);
    if (other) return `That’s ${other.name}’s code: they’re already in your list.`;
    return null;
  };
  // 4.1.5: a mistyped code is the usual reason for "No answer". Someone who wrote to you sends
  // their real code; if it's a near miss of the one you typed for a friend (or the same name),
  // that's almost certainly them: offer to use it.
  const editDist = (a, b) => {
    const d = Array.from({ length: b.length + 1 }, (_, i) => i);
    for (let i = 1; i <= a.length; i++) {
      let prev = d[0];
      d[0] = i;
      for (let j = 1; j <= b.length; j++) {
        const t = d[j];
        d[j] = Math.min(d[j] + 1, d[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
        prev = t;
      }
    }
    return d[b.length];
  };
  const nearMiss = (codeA, nameA, codeB, nameB) => {
    const a = tidy(codeA);
    const b = tidy(codeB);
    if (!a || !b || a === b) return false;
    return editDist(a, b) <= 2 || (!!nameA && !!nameB && nameA.trim().toLowerCase() === nameB.trim().toLowerCase());
  };
  /** someone who wrote to you who is probably friend f (with the right code) */
  const lookalikeOf = (st, f) => (st.strangers || []).find((x) => nearMiss(x.code, x.name, f.code, f.name)) || null;
  /** the friend a stranger probably is (you typed their code a little wrong) */
  const friendFor = (st, x) => st.friends.find((f) => nearMiss(x.code, x.name, f.code, f.name)) || null;
  async function useCode(f, code) {
    try {
      await api.friends.setFriendCode(f.id, code);
      await loadFriends();
      const nf = (F.st && F.st.friends.find((y) => y.id === f.id)) || f;
      hangUp();
      R.friend = null;
      R.err = null;
      toast({ title: `${f.name}’s code fixed`, message: `It’s “${code}” now. Connecting…`, kind: 'ok' });
      pick(nf);
    } catch (err) {
      toast({ title: 'Couldn’t change the code', message: err.message, kind: 'err' });
    }
  }
  const CODE_HINT = 'The word or phrase your friend sees under “Your code” in their Recordings › Friends. Capitals, spaces and dashes don’t matter.';

  async function addFriend() {
    const code = await askText({ title: 'Add a friend', label: 'Their code', placeholder: 'e.g. tiger-427', confirm: 'Next', hint: CODE_HINT, check: (v) => codeCheck(v) });
    if (code === null) return;
    const name = await askText({ title: 'Add a friend', label: 'What do you call them?', placeholder: 'Friend', confirm: 'Add and connect' });
    if (name === null) return;
    try {
      const f = await api.friends.add(code, name);
      await loadFriends();
      pick(f);
    } catch (err) {
      toast({ title: 'Couldn’t add that code', message: err.message, kind: 'err' });
    }
  }

  /** Fix a friend's code (a typo, or they changed it), then try again. */
  async function fixCode(f) {
    const v = await askText({
      title: `${f.name}’s code`,
      label: `The code you have for ${f.name}`,
      value: f.code || '',
      confirm: 'Save and connect',
      hint: CODE_HINT,
      check: (x) => codeCheck(x, f.id) || api.friends.setFriendCode(f.id, x).then(() => null, (err) => err.message),
    });
    if (v === null) return;
    await loadFriends();
    const nf = (F.st && F.st.friends.find((x) => x.id === f.id)) || f;
    hangUp();
    R.friend = null;
    pick(nf);
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
    R.stage = 'start';
    R.status.set(f.id, 'wait');
    renderFriends();
    const onStage = (stage) => {
      if (!R.friend || R.friend.id !== f.id || R.list) return;
      R.stage = stage;
      if (R.tab === 'friends') renderFriends();
    };
    const offStage = api.on('friends:progress', (p) => p && p.friendId === f.id && onStage(p.stage));
    try {
      // 4.1.3: one quiet second try when the internet side or the direct line hiccups
      // (not when nobody answered: that needs you or your friend to change something)
      const go = () => connectTo(api, f.id, { name: (F.st && (F.st.shownName || F.st.name)) || '', onStage });
      const link = await go()
        .catch((err) => {
          if (err.code !== 'DIRECT' && err.code !== 'RELAY') throw err;
          if (!R.friend || R.friend.id !== f.id) throw err;
          R.stage = 'relay';
          R.retrying = true;
          if (R.tab === 'friends') renderFriends();
          return go();
        })
        .finally(() => {
          R.retrying = false;
          offStage && offStage();
        });
      if (!R.friend || R.friend.id !== f.id || !m.el.isConnected) return link.close();
      R.link = link;
      R.linkFor = f.id;
      watchClose(link, f);
      if (link.name && f.name === 'Friend') api.friends.rename(f.id, link.name).catch(() => {});
      R.list = await link.list();
      R.status.set(f.id, 'ok');
    } catch (err) {
      if (!R.friend || R.friend.id !== f.id) return;
      R.err = err;
      R.status.set(f.id, 'bad');
    }
    if (R.tab === 'friends') renderFriends();
  }

  const st0 = () => F.st || { friends: [], strangers: [] };
  function friendView() {
    const f = R.friend;
    const box = h('div.fr-view');
    const btn = (text, onClick, primary = false) => {
      const b = h(`button.btn${primary ? '.primary' : ''}`, { type: 'button', text });
      b.onclick = onClick;
      return b;
    };
    const again = () => btn('Try again', () => ((R.err = null), hangUp(), pick(f)), true);
    if (R.err) {
      const code = R.err.code;
      const fix = btn('Fix their code', () => fixCode(f));
      let title, body, acts;
      if (code === 'OFFLINE') {
        title = `No answer from ${f.name}`;
        body = h('div', null,
          h('p', { text: `Nobody answered to the code you have for ${f.name}. Check these two things:` }),
          h('ol.fr-checks', null,
            h('li', null, h('div', null, h('b', { text: `Is ${f.name}’s Stagehand open, with Sharing on?` }), h('span', { text: 'They see “Ready. Friends with your code can connect now.” at the top of their Friends tab.' }))),
            h('li', null, h('div', null, h('b', { text: 'Is the code right?' }), h('span', null, 'You have ', h('code', { text: f.code || '' }), `. It must match what ${f.name} sees under “Your code”.`)))
          ));
        acts = [again(), fix];
        const look = lookalikeOf(st0(), f);
        if (look) {
          const use = btn(`Use “${look.code}”`, () => useCode(f, look.code), true);
          body.prepend(h('div.fr-found', null, h('b', { text: 'Found it: the code is a little different' }), h('span', null, `A message from ${look.name} came from the code `, h('code', { text: look.code }), ', and you have ', h('code', { text: f.code || '' }), ` for ${f.name}. That’s almost certainly them.`), h('div.fr-acts', null, use)));
          acts = [again()];
        }
      } else if (code === 'RELAY') {
        title = 'Can’t reach the internet meeting point';
        body = h('p', { text: 'Stagehand couldn’t get online to look for your friend. Check your internet connection, then try again.' });
        acts = [again()];
      } else if (code === 'DIRECT') {
        title = `${f.name} answered, but your PCs couldn’t connect`;
        body = h('p', { text: `The code is right: ${f.name}’s Stagehand answered. But the direct line between your two PCs didn’t open. A strict network (work, school, some mobile hotspots) can block it. Try again, or try from another network.` });
        acts = [again()];
      } else {
        title = code === 'CLOSED' ? `The connection to ${f.name} closed` : 'Couldn’t connect';
        body = h('p', { text: code === 'CLOSED' ? `${f.name}’s Stagehand may have closed, or turned Sharing off.` : R.err.message });
        acts = [again()];
      }
      box.append(h(`div.fr-state.${code === 'OFFLINE' ? 'off' : 'bad'}`, null, h('span.fr-orb', { html: icon(code === 'OFFLINE' ? 'person' : 'alert') }), h('b', { text: title }), body, h('div.fr-acts', null, ...acts)));
      return box;
    }
    if (!R.list) {
      // each step of connecting, so you can see how far it got
      const order = ['relay', 'asking', 'direct'];
      const at = Math.max(0, order.indexOf(R.stage));
      const steps = [
        ['Reaching the internet meeting point', ''],
        [`Asking ${f.name}’s Stagehand`, 'It answers if it’s open with Sharing on, and the code is right. Up to 20 seconds.'],
        ['Connecting your two PCs directly', `${f.name} answered: the code is right.`],
      ];
      box.append(h('div.fr-state.wait', null, h('span.fr-orb.pulse', { html: icon('people') }), h('b', { text: R.retrying ? `Trying once more to connect to ${f.name}…` : `Connecting to ${f.name}…` }),
        h('ol.fr-steps', null, ...steps.map(([t, sub], i) => h(`li.${i < at ? 'done' : i === at ? 'now' : 'todo'}`, null, h('i', { html: i < at ? icon('check') : '' }), h('div', null, h('b', { text: t }), sub && i <= at ? h('span', { text: sub }) : null))))));
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
    box.append(h('div.fr-live', null, h('i'), h('span.grow', null, h('b', { text: `Connected to ${(R.link && R.link.name) || f.name}.` }), ' The code is right.'), refresh));
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
      const meta = busy ? (busy.retry ? `Connection dropped, reconnecting… (${Math.round(busy.p * 100)}% so far)` : `Getting it… ${Math.round(busy.p * 100)}%`) : [fetched.has(key) ? 'Ready' : null, fmtWhen(v.at), v.seconds ? fmtLen(v.seconds) : null, v.size ? fmtBytes(v.size) : null].filter(Boolean).join(' · ');
      list.append(h(`div.rec-row.video${playing ? '.on' : ''}`, { 'data-key': key }, btn, h('span.rec-kind', { html: icon('video') }), h('div.rec-text', null, h('b', { text: v.name }), h('span', { text: meta }))));
    }
    box.append(list);
    return box;
  }

  /** When the connection drops: mid-download the download reconnects by itself; otherwise say so. */
  function watchClose(link, f) {
    link.onclose = () => {
      if (R.link !== link) return;
      R.link = null;
      if (R.loading) return;
      R.err = Object.assign(new Error(`The connection to ${f.name} closed.`), { code: 'CLOSED' });
      if (R.tab === 'friends') renderFriends();
    };
  }

  /**
   * Gets a friend's video and plays it. If the connection drops partway it
   * reconnects and carries on from where it stopped (a few tries).
   */
  async function watch(f, v) {
    const key = `${f.id}:${v.id}`;
    if (fetched.has(key)) return show('video', fetched.get(key), v.name, `${f.name}’s video`, key), renderFriends();
    if (!R.link || (R.loading && R.loading.key !== key)) return;
    R.loading = { key, p: 0, retry: 0 };
    renderFriends();
    const parts = [];
    let have = 0;
    let last = 0;
    let size = v.size || 0;
    try {
      for (let tries = 0; ; tries++) {
        try {
          if (!R.link) {
            R.loading.retry = tries;
            renderFriends();
            await new Promise((r) => setTimeout(r, Math.min(8000, 1000 * 2 ** (tries - 1))));
            if (!m.el.isConnected || !R.loading || R.loading.key !== key) return;
            const link = await connectTo(api, f.id);
            R.link = link;
            watchClose(link, f);
          }
          const got = await R.link.get(v.id, {
            from: have,
            onChunk: (c) => {
              parts.push(c);
              have += c.byteLength;
            },
            onProgress: (p) => {
              if (!R.loading || R.loading.key !== key) return;
              R.loading.p = p;
              R.loading.retry = 0;
              if (p - last > 0.01) {
                last = p;
                if (R.tab === 'friends') renderFriends();
              }
            },
          });
          size = got.size;
          if (got.cancelled) return;
          if (have < size) throw Object.assign(new Error('The video stopped coming'), { code: 'CLOSED' });
          break;
        } catch (err) {
          // a dropped connection (or one that couldn't be made again yet): try again, up to 4 times
          const dropped = err.code === 'CLOSED' || err.code === 'DIRECT' || err.code === 'RELAY' || (R.link && R.link.closed);
          if (!dropped || tries >= 4 || !m.el.isConnected) throw err;
          if (R.link && R.link.closed) R.link = null;
          if (err.code === 'CLOSED') R.link = null;
        }
      }
      const url = URL.createObjectURL(new Blob(parts, { type: 'video/mp4' }));
      remember(key, url);
      R.loading = null;
      if (m.el.isConnected) show('video', url, v.name, `${f.name}’s video`, key);
    } catch (err) {
      toast({ title: 'Couldn’t get that video', message: err.code === 'OFFLINE' ? `${f.name}’s Stagehand stopped answering. You got ${Math.round((have / Math.max(1, size)) * 100)}% of it; try again when they’re back.` : err.message, kind: 'err' });
    } finally {
      if (R.loading && R.loading.key === key) R.loading = null;
      if (!R.link && R.friend && R.friend.id === f.id && !R.err) R.err = Object.assign(new Error(`The connection to ${f.name} closed.`), { code: 'CLOSED' });
      if (R.tab === 'friends') renderFriends();
    }
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
  if (friend && F.st) {
    const f = F.st.friends.find((x) => x.id === friend);
    const x = !f && (F.st.strangers || []).find((y) => y.key === friend);
    if (f) pick(f);
    else if (x) ((R.friend = { id: x.key, name: x.name, code: x.code, stranger: true }), renderFriends());
  }
  return m;
}
