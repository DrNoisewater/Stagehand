/**
 * Updates (4.1.4): when GitHub has a newer Stagehand, an "Update to X" button
 * appears at the top of the menu (and a note once per version). The update window
 * says what's new; Update now downloads the new Setup (checked), then Stagehand
 * closes and Setup opens the new version by itself, in a few seconds.
 * The work happens in the main process (services/updates.js).
 */
import { api } from './api.js';
import { state, emit } from './store.js';
import { h, icon, esc, modal, toast } from './ui.js';

export const U = { st: null };

function changed(st) {
  if (!st) return;
  const was = U.st;
  U.st = st;
  emit('updates');
  // a note once per new version (the button stays until you update)
  if (st.available && (!was || was.latest !== st.latest)) {
    let told = null;
    try {
      told = localStorage.getItem('stagehand.updateTold');
    } catch (_) {}
    if (told !== st.latest) {
      try {
        localStorage.setItem('stagehand.updateTold', st.latest);
      } catch (_) {}
      toast({ title: `Stagehand ${st.latest} is out`, message: 'Update in a few seconds, without leaving Stagehand.', kind: 'info', timeout: 12000, actions: [{ label: 'See what’s new', onClick: () => openUpdate() }] });
    }
  }
}

export function initUpdates() {
  api.on('updates:change', changed);
  api.updates.state().then(changed).catch(() => {});
}

/** The update window: what's new, then Update now → downloading → closing and reopening. */
export function openUpdate() {
  const st = U.st;
  if (!st) return;
  const body = h('div.up-body');
  const go = h('button.btn.primary', { type: 'button', html: `${icon('download')}<span>Update now</span>` });
  const later = h('button.btn.ghost', { type: 'button', text: 'Later' });
  const m = modal({ title: st.available ? `Stagehand ${st.latest} is ready` : 'Stagehand is up to date', body, footer: [later, go] });
  later.onclick = () => m.close();
  const draw = (phase, extra = {}) => {
    body.innerHTML = '';
    if (phase === 'ready') {
      body.append(h('p', { text: `You have ${st.current}. The update takes a few seconds: Stagehand closes, updates, and opens again by itself. Your songs, tones, recordings and settings stay as they are.` }));
      if (st.notes && st.notes.length) body.append(h('div.up-new', null, h('b', { text: 'What’s new' }), h('ul', null, ...st.notes.map((n) => h('li', { text: n })))));
      if (!st.canInstall) body.append(h('p.np-fine', { text: 'On this computer, download the new Setup from the release page and run it.' }));
      go.hidden = !st.available;
      go.querySelector('span').textContent = st.canInstall ? 'Update now' : 'Open the release page';
    } else if (phase === 'download') {
      const pct = Math.round((extra.p || 0) * 100);
      body.append(h('p', { text: `Downloading Stagehand ${st.latest}…` }), h('div.up-bar', null, h('i', { style: { width: `${pct}%` } })), h('p.np-fine', { text: extra.total ? `${(extra.got / 1048576).toFixed(1)} of ${(extra.total / 1048576).toFixed(1)} MB` : 'Starting…' }));
      go.disabled = true;
      later.disabled = false;
    } else if (phase === 'install') {
      body.append(h('div.up-closing', null, h('span.up-spin'), h('div', null, h('b', { text: 'Updating…' }), h('p', { text: 'Stagehand closes now and opens again by itself in a few seconds, on the new version.' }))));
      go.disabled = true;
      later.disabled = true;
    } else if (phase === 'error') {
      body.append(h('p', { text: extra.message }), h('p.np-fine', { html: `If it keeps happening, download the new Setup from <a href="#" class="up-page">the release page</a> and run it.` }));
      const a = body.querySelector('.up-page');
      if (a) a.onclick = (e) => (e.preventDefault(), api.shell.openExternal(st.page));
      go.disabled = false;
      go.querySelector('span').textContent = 'Try again';
    }
  };
  draw('ready');
  const off = api.on('updates:progress', (p) => draw('download', p));
  const close = m.close;
  m.close = () => {
    off && off();
    close();
  };
  later.onclick = () => m.close();
  go.onclick = async () => {
    if (!st.canInstall) return api.shell.openExternal(st.page);
    try {
      draw('download', { p: 0 });
      await api.updates.download();
      draw('install');
      await api.updates.install();
    } catch (err) {
      draw('error', { message: err.message || 'The update didn’t work.' });
    }
  };
  return m;
}

/** Settings › About: the version, check now, and checking by itself on or off. */
export async function aboutRows(setting, toggleCtl, saveSettings) {
  const status = h('span.np-fine');
  const check = h('button.btn.small', { type: 'button', text: 'Check now' });
  const say = (st) => {
    if (!st) return;
    status.textContent = st.error ? st.error : st.available ? `Stagehand ${st.latest} is out.` : st.latest ? `You have the newest version (${st.current}).` : '';
    if (st.available) {
      status.append(' ');
      const b = h('button.btn.small.primary', { type: 'button', text: 'Update' });
      b.onclick = () => openUpdate();
      status.append(b);
    }
  };
  check.onclick = async () => {
    check.disabled = true;
    status.textContent = 'Checking…';
    const st = await api.updates.check().catch((e) => ({ error: e.message }));
    if (st && !st.error) changed(st);
    say(st && st.error ? st : U.st);
    check.disabled = false;
  };
  say(U.st);
  const auto = (state.settings.updates || {}).check !== false;
  return [
    setting('Updates', 'Stagehand looks for a newer version on GitHub when it starts (and every few hours), and offers it. Nothing installs until you press Update.', check, toggleCtl(auto, (v) => saveSettings({ updates: { check: v } }), 'Look for updates by itself')),
    h('div.up-status', null, status),
  ];
}

export const updateLabel = () => (U.st && U.st.available ? `Update to ${esc(U.st.latest)}` : null);
