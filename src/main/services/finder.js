'use strict';
/**
 * 4.12: the song finder. CustomsForge in a Stagehand window, with a bar on top
 * that shows the wanted song you're looking for.
 *
 * You sign in, pick the song and press download yourself; Stagehand only:
 *  - types the song you asked for into the site's search box when you press
 *    Find (once per press, the same as typing it; it never reads results or
 *    clicks anything on the site);
 *  - takes what you download (.psarc or .zip) straight into your library;
 *  - keeps the window to CustomsForge and the file sites songs are shared on
 *    (other links open in your own browser).
 */
const path = require('path');
const fs = require('fs');
const fsp = fs.promises;

const HOME = 'https://ignition4.customsforge.com/';
/** Sites a song can be on or downloaded from (and the sign-ins they use). */
const HOSTS = [
  'customsforge.com',
  'google.com', // drive.google.com, drive.usercontent.google.com, docs.google.com, accounts.google.com
  'googleusercontent.com',
  'dropbox.com',
  'dropboxusercontent.com',
  'mediafire.com',
  'mega.nz',
  'mega.io',
  'onedrive.live.com',
  'live.com',
  '1drv.ms',
  'sharepoint.com',
  'box.com',
  'github.com',
  'githubusercontent.com',
  'discordapp.com',
  'discordapp.net',
  'patreon.com',
];
const SONG_FILE = /\.(psarc|zip)$/i;

/** Is this address one the finder may show? (extra: hosts allowed for tests) */
function allowed(url, extra = []) {
  let u;
  try {
    u = new URL(url);
  } catch (_) {
    return false;
  }
  if (u.protocol === 'about:') return true;
  const host = u.hostname.toLowerCase();
  if (extra.includes(u.host) || extra.includes(host)) return true;
  if (u.protocol !== 'https:') return false;
  return HOSTS.some((h) => host === h || host.endsWith(`.${h}`));
}

/**
 * Run in the page: puts the text in its search box (the first one you can see), as
 * typing would, and leaves the box focused for Enter. Returns whether one was found.
 */
const fillBox = (text) => `((text) => {
  const seen = (el) => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 20 && r.height > 8 && s.visibility !== 'hidden' && s.display !== 'none' && !el.disabled && !el.readOnly; };
  const picks = ['input[type=search]', 'input[placeholder*="search" i]', 'input[aria-label*="search" i]', 'input[name*="search" i]', 'input[id*="search" i]', 'input[name=q]'];
  for (const sel of picks) {
    for (const el of document.querySelectorAll(sel)) {
      if (!seen(el)) continue;
      el.scrollIntoView({ block: 'center' });
      el.focus();
      const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      set.call(el, text);
      el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      el.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: text.slice(-1) }));
      return true;
    }
  }
  return false;
})(${JSON.stringify(text)})`;

/**
 * @param {{ parent: () => any, icon?: string, stagingDir: string, downloadsDir: () => string,
 *   importFiles: (paths: string[]) => Promise<any>, onEvent: (e: object) => void, log?: (s: string) => void,
 *   home?: string, extraHosts?: string[], openExternal: (url: string) => void, clipboard: { writeText: (s: string) => void } }} o
 */
function createFinder(o) {
  const electron = require('electron');
  const { BaseWindow, WebContentsView, session, ipcMain } = electron;
  const log = o.log || (() => {});
  const home = o.home || HOME;
  const extra = o.extraHosts || [];
  const BAR_H = 56;
  let win = null;
  let bar = null;
  let site = null;
  let want = null; // { id, artist, title }
  let loaded = false; // the site has shown a page (so its search box can be looked for)
  const st = { message: '', kind: '', downloads: [] };

  const text = () => (want ? `${want.artist || ''} ${want.title || ''}`.trim() : '');

  function tell() {
    if (!bar || bar.webContents.isDestroyed()) return;
    bar.webContents.send('finder-bar:state', {
      want,
      message: st.message,
      kind: st.kind,
      canBack: !!(site && site.webContents.navigationHistory.canGoBack()),
      canForward: !!(site && site.webContents.navigationHistory.canGoForward()),
      downloads: st.downloads.slice(-3),
    });
  }
  function say(message, kind = '') {
    st.message = message;
    st.kind = kind;
    tell();
  }

  function layout() {
    if (!win || win.isDestroyed()) return;
    const { width, height } = win.getContentBounds();
    bar.setBounds({ x: 0, y: 0, width, height: BAR_H });
    site.setBounds({ x: 0, y: BAR_H, width, height: Math.max(0, height - BAR_H) });
  }

  /** Types the wanted song into the site's search box and presses Enter (one search, as you would). */
  async function find() {
    const t = text();
    if (!t || !site) return false;
    o.clipboard.writeText(t); // (also ready for Ctrl+V)
    let found = false;
    try {
      found = loaded && (await site.webContents.executeJavaScript(fillBox(t), true));
    } catch (_) {
      found = false;
    }
    if (!found) {
      say(`No search box on this page. Sign in or go to the song list, then press Find. (“${t}” is copied too.)`, 'warn');
      return false;
    }
    site.webContents.focus();
    for (const type of ['keyDown', 'char', 'keyUp']) site.webContents.sendInputEvent({ type, keyCode: type === 'char' ? '\r' : 'Return' });
    say(`Searched for “${t}”. Pick the song and press its download button.`);
    return true;
  }

  // 4.18: a file host's own page (Drive's "No preview available" and the like) is a dead end once the
  // download has started from it: when the song is in, step back to the last page of the song site.
  const FILE_HOST = /(^|\.)(drive\.google\.com|docs\.google\.com|drive\.usercontent\.google\.com|mediafire\.com|dropbox\.com|mega\.nz|mega\.io|1drv\.ms|onedrive\.live\.com|pixeldrain\.com|gofile\.io)$/i;
  const onFileHost = (url) => {
    try {
      return FILE_HOST.test(new URL(url).hostname);
    } catch (_) {
      return false;
    }
  };
  function leaveFileHost() {
    if (!site || site.webContents.isDestroyed()) return false;
    const nav = site.webContents.navigationHistory;
    if (!onFileHost(site.webContents.getURL())) return false;
    try {
      const all = nav.getAllEntries();
      for (let i = nav.getActiveIndex() - 1; i >= 0; i--) {
        if (!onFileHost(all[i].url)) {
          nav.goToIndex(i);
          return true;
        }
      }
    } catch (_) {
      if (nav.canGoBack()) {
        nav.goBack();
        return true;
      }
    }
    return false;
  }

  function onDownload(_e, item) {
    const name = item.getFilename() || 'song';
    const song = SONG_FILE.test(name);
    const dir = song ? path.join(o.stagingDir, 'Finder', String(Date.now())) : o.downloadsDir();
    try {
      fs.mkdirSync(dir, { recursive: true });
    } catch (_) {}
    const file = path.join(dir, name);
    item.setSavePath(file);
    const d = { name, pct: 0, state: 'going' };
    st.downloads.push(d);
    say(`Downloading ${name}…`);
    item.on('updated', () => {
      const total = item.getTotalBytes();
      d.pct = total ? Math.round((item.getReceivedBytes() / total) * 100) : 0;
      tell();
    });
    item.once('done', async (_ev, state) => {
      if (state !== 'completed') {
        d.state = 'failed';
        say(`${name} didn’t finish downloading. Try its download button again.`, 'warn');
        return;
      }
      d.pct = 100;
      if (!song) {
        d.state = 'saved';
        say(`${name} is in your Downloads. Stagehand can’t open this kind of file: unpack it there, then drop the song on Stagehand.`, 'warn');
        o.onEvent({ type: 'saved', name, file });
        return;
      }
      d.state = 'adding';
      say(`Adding ${name} to your library…`);
      try {
        const results = (await o.importFiles([file])) || [];
        const good = results.filter((r) => r.status === 'imported' || r.status === 'updated');
        const songs = good.flatMap((r) => r.songs || []);
        const had = results.some((r) => r.status === 'duplicate');
        const why = (results.find((r) => r.reason) || {}).reason;
        d.state = good.length || had ? 'added' : 'failed';
        if (good.length) say(`${songs.length > 1 ? `${songs.length} songs` : name} ${songs.length > 1 ? 'are' : 'is'} in your library.`, 'good');
        else if (had) say(`You already have ${name}.`, 'good');
        else say(`${name} couldn’t be added${why ? `: ${why}` : '.'}`, 'warn');
        o.onEvent({ type: 'downloaded', name, file, want, added: good.length > 0 || had });
        if (good.length || had) leaveFileHost();
      } catch (err) {
        d.state = 'failed';
        log(`Finder: import of ${name} failed: ${err.message}`);
        say(`${name} couldn’t be added: ${err.message}`, 'warn');
      } finally {
        fsp.rm(dir, { recursive: true, force: true }).catch(() => {}); // (the song was copied in)
      }
    });
  }

  function guard(wc) {
    // links to other sites open in your browser; this window stays on song sites
    wc.on('will-navigate', (e, url) => {
      if (allowed(url, extra)) return;
      e.preventDefault();
      if (/^https?:/.test(url)) o.openExternal(url);
    });
    wc.setWindowOpenHandler(({ url }) => {
      if (allowed(url, extra)) setImmediate(() => wc.loadURL(url).catch(() => {}));
      else if (/^https?:/.test(url)) o.openExternal(url);
      return { action: 'deny' };
    });
    wc.on('did-navigate', tell);
    wc.on('did-navigate-in-page', tell);
    wc.on('did-finish-load', () => {
      const first = !loaded;
      loaded = true;
      tell();
      if (first && want) setTimeout(() => find().catch(() => {}), 600);
    });
  }

  function build() {
    const ses = session.fromPartition('persist:customsforge');
    // the site sees a normal Chrome (the app's own name in it can trip sign-in checks)
    ses.setUserAgent(ses.getUserAgent().replace(/ (Electron|stagehand)\/\S+/gi, ''));
    ses.removeAllListeners('will-download');
    ses.on('will-download', onDownload);
    const parent = o.parent();
    win = new BaseWindow({
      width: 1180,
      height: 860,
      minWidth: 760,
      minHeight: 520,
      title: 'Find songs · Stagehand',
      backgroundColor: '#14110d',
      autoHideMenuBar: true,
      icon: o.icon && fs.existsSync(o.icon) ? o.icon : undefined,
    });
    if (parent && !parent.isDestroyed()) {
      const b = parent.getBounds();
      win.setPosition(Math.round(b.x + Math.max(0, (b.width - 1180) / 2)), Math.round(b.y + Math.max(0, (b.height - 860) / 2)));
    }
    bar = new WebContentsView({ webPreferences: { preload: path.join(__dirname, '..', 'finder', 'bar-preload.js'), contextIsolation: true, sandbox: true, nodeIntegration: false } });
    site = new WebContentsView({ webPreferences: { session: ses, contextIsolation: true, sandbox: true, nodeIntegration: false, spellcheck: true } });
    win.contentView.addChildView(site);
    win.contentView.addChildView(bar);
    bar.webContents.loadFile(path.join(__dirname, '..', 'finder', 'bar.html')).catch(() => {});
    bar.webContents.on('did-finish-load', tell);
    bar.webContents.on('will-navigate', (e) => e.preventDefault());
    guard(site.webContents);
    layout();
    win.on('resize', layout);
    win.on('closed', () => {
      win = bar = site = null;
      loaded = false;
      st.downloads = [];
      o.onEvent({ type: 'closed' });
    });
    loaded = false;
    site.webContents.loadURL(home).catch(() => {});
  }

  const acts = {
    find: () => find(),
    back: () => site && site.webContents.navigationHistory.canGoBack() && site.webContents.navigationHistory.goBack(),
    forward: () => site && site.webContents.navigationHistory.canGoForward() && site.webContents.navigationHistory.goForward(),
    reload: () => site && site.webContents.reload(),
    home: () => site && site.webContents.loadURL(home).catch(() => {}),
    browser: () => site && o.openExternal(site.webContents.getURL() || home),
    skip: () => o.onEvent({ type: 'skip', want }),
    stop: () => o.onEvent({ type: 'stop', want }),
    close: () => win && win.close(),
  };
  ipcMain.on('finder-bar:act', (e, name) => {
    if (!bar || e.sender !== bar.webContents) return;
    if (Object.prototype.hasOwnProperty.call(acts, name)) Promise.resolve(acts[name]()).catch(() => {});
  });

  return {
    /** Opens the window (or brings it up) looking for this song; searches for it once the site shows. */
    async open(item) {
      want = item && (item.artist || item.title) ? { id: item.id || null, artist: String(item.artist || '').slice(0, 200), title: String(item.title || '').slice(0, 200), left: Number(item.left) || 0 } : null;
      st.message = '';
      if (!win || win.isDestroyed()) build();
      else {
        if (win.isMinimized()) win.restore();
        win.show();
        win.focus();
        if (want) await find().catch(() => false);
      }
      if (want) o.clipboard.writeText(text());
      tell();
      return { open: true, want };
    },
    close() {
      if (win && !win.isDestroyed()) win.close();
    },
    get isOpen() {
      return !!(win && !win.isDestroyed());
    },
    /** For tests: the site's page. */
    siteContents: () => site && site.webContents,
  };
}

module.exports = { createFinder, allowed, HOSTS, HOME };
