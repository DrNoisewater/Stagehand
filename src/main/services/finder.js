'use strict';
/**
 * 4.12: the song finder. CustomsForge in a Stagehand window, with a bar on top
 * that shows the wanted song you're looking for.
 *
 * You sign in, pick the song and press download yourself; Stagehand only:
 *  - types the song you asked for into the site's search box when you press
 *    Find (once per press, the same as typing it; 4.25: it waits for the box when
 *    the site draws it late);
 *  - 4.25: reads the results page you are looking at, once it settles, to say whether
 *    the song is there, not there, or official DLC (one simpler second search when the
 *    first finds nothing); and the Updated CDLC list when it is on screen. It never
 *    crawls the site and never downloads by itself;
 *  - takes what you download (.psarc or .zip) straight into your library;
 *  - keeps the window to CustomsForge and the file sites songs are shared on.
 *    4.25: pop-ups to other sites are dropped (never sent to your browser); a link you
 *    click to another site is offered as "Open in my browser"; ads are stopped.
 */
const path = require('path');
const fs = require('fs');
const fsp = fs.promises;
const { isAdHost, AD_CSS } = require('../finder/adblock');
const { readPage, clickText, verdict, simplerSearch } = require('../finder/results');

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
  'pixeldrain.com', // 4.25: file hosts songs are shared on (their links used to open in the browser)
  'gofile.io',
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
const hostOf = (url) => {
  try {
    return new URL(url).hostname;
  } catch (_) {
    return '';
  }
};

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

const nap = (ms) => new Promise((r) => setTimeout(r, ms));
const BOX_WAIT = 20000; // the site can draw its search box late: look for it this long
const SETTLE_MAX = 15000; // results: read them once they stop changing, at most this long after Enter
const CLOSE_AFTER = 3500; // the run is over: the window closes this long after (the Roadie's celebration)

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
  const BAR_H = 68; // 4.25: taller, for the Roadie
  // 4.23: the window opens on most of the screen and remembers its size per screen; the site can be
  // zoomed out to fit its wide table without scrolling sideways (o.prefs: get/set, kept in settings)
  const prefs = o.prefs || { get: () => ({}), set: () => {} };
  const ZOOMS = [0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25];
  let zoom = Number(prefs.get().zoom) || 1;
  let win = null;
  let bar = null;
  let site = null;
  let want = null; // { id, artist, title, mode }
  let loaded = false; // the site has shown a page (so its search box can be looked for)
  let needFind = false; // the last Find found no search box: try again when the next page shows
  let searchSeq = 0; // each search (and each wait for the box) has its own number; a newer one stops older ones
  let jobSeq = 0; // each download has its own job id
  let closeTimer = null;
  let ownKeysUntil = 0; // (the Enter Stagehand presses after typing a search isn't the player's)
  const st = {
    message: '',
    kind: '',
    downloads: [],
    focus: null, // the job id of the download the bar follows (the latest one)
    view: { state: 'idle', job: '', seq: 0 }, // what the Roadie shows: the real state, its job, a counter
    offer: null, // { url, host }: a link the player clicked to another site
    done: null, // { title, text }: the Wanted run is over
    added: 0, // songs added since the window opened
  };
  const stats = { ads: {}, blocked: [], offered: [] }; // (tests and the log)

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
      focus: st.focus,
      view: st.view,
      offer: st.offer ? { host: st.offer.host } : null,
      done: st.done,
      zoom,
    });
  }
  function say(message, kind = '') {
    st.message = message;
    st.kind = kind;
    tell();
  }
  /** The Roadie's real state (idle, searching, found, downloading, importing, imported, failed) and whose it is. */
  function setView(state, job) {
    if (st.view.state === state && st.view.job === job) return;
    st.view = { state, job: String(job || ''), seq: st.view.seq + 1 };
    tell();
  }

  function layout() {
    if (!win || win.isDestroyed()) return;
    const { width, height } = win.getContentBounds();
    bar.setBounds({ x: 0, y: 0, width, height: BAR_H });
    site.setBounds({ x: 0, y: BAR_H, width, height: Math.max(0, height - BAR_H) });
  }

  /** Runs a page reader; gives up (null) rather than hang on a page that is still loading. */
  // (only typing and clicking a tab act as the player; reading never does, so the page gets no pop-up rights from it)
  async function inPage(js, ms = 4000, asPlayer = false) {
    if (!site || site.webContents.isDestroyed()) return null;
    try {
      return await Promise.race([site.webContents.executeJavaScript(js, asPlayer), nap(ms).then(() => null)]);
    } catch (_) {
      return null;
    }
  }

  // a wait for the search box wakes up early when the site changes its page (it draws late)
  let wake = null;
  const poke = () => {
    if (wake) wake();
  };
  const napOrPoke = (ms) => new Promise((r) => {
    const t = setTimeout(done, ms);
    function done() {
      clearTimeout(t);
      if (wake === done) wake = null;
      r();
    }
    wake = done;
  });

  /**
   * Types the wanted song into the site's search box and presses Enter (one search, as you would).
   * 4.25: waits for the box (up to 20 s), then reads the results once they settle.
   */
  async function find({ query, second = false } = {}) {
    const t = query || text();
    if (!t || !site) return false;
    const my = ++searchSeq;
    const job = `s${my}`;
    if (!second) o.clipboard.writeText(t); // (also ready for Ctrl+V)
    setView('searching', job);
    if (!second) say(`Looking for “${t}”…`);
    const start = Date.now();
    let found = false;
    let told = false;
    while (my === searchSeq && site && Date.now() - start < BOX_WAIT) {
      if (loaded) found = !!(await inPage(fillBox(t), 4000, true));
      if (my !== searchSeq) return false;
      if (found) break;
      if (!told && Date.now() - start > 1500) {
        told = true;
        say(`Waiting for the site’s search box…`);
      }
      await napOrPoke(300);
    }
    if (my !== searchSeq || !site) return false;
    if (!found) {
      needFind = true;
      say(`No search box on this page. Sign in or go to the song list, then press Find. (“${t}” is copied too.)`, 'warn');
      if (st.view.job === job) setView('idle', job);
      return false;
    }
    needFind = false;
    const before = await inPage(readPage('results'), 2000);
    if (my !== searchSeq || !site) return false;
    site.webContents.focus();
    ownKeysUntil = Date.now() + 150;
    for (const type of ['keyDown', 'char', 'keyUp']) site.webContents.sendInputEvent({ type, keyCode: type === 'char' ? '\r' : 'Return' });
    say(second ? `Nothing for that. Searched for “${t}” instead…` : `Searched for “${t}”. Pick the song and press its download button.`);
    o.onEvent({ type: 'searched', want, text: t });
    watchResults(my, t, before && before.sig, second).catch((err) => log(`Finder: reading results: ${err.message}`));
    return true;
  }

  /** Reads the results the player is looking at, once they settle; one simpler search when there are none. */
  async function watchResults(my, t, before, second) {
    const start = Date.now();
    const job = `s${my}`;
    let last = null;
    let lastSig = null;
    let since = start;
    while (my === searchSeq && site && Date.now() - start < SETTLE_MAX) {
      await nap(300);
      const r = await inPage(readPage('results'), 2000);
      if (my !== searchSeq) return;
      if (!r) continue;
      last = r;
      if (r.sig !== lastSig) {
        lastSig = r.sig;
        since = Date.now();
        continue;
      }
      const still = Date.now() - since;
      const changed = r.sig !== before;
      // settled: new results that stayed put for a second, the empty message, or nothing moving for 3 s
      if ((changed && still >= 1000) || (r.empty && still >= 600) || (still >= 3000 && Date.now() - start >= 3000)) break;
    }
    if (my !== searchSeq || !site || !last) return;
    const rows = last.empty && !last.rows.length ? [] : last.rows;
    if (!second) {
      const nothing = verdict(want, rows) === 'none';
      const simpler = nothing && simplerSearch(want, t);
      if (simpler) {
        say(`Nothing for “${t}”. Trying “${simpler}”…`);
        await nap(400); // (at a person's pace)
        if (my === searchSeq) await find({ query: simpler, second: true });
        return;
      }
    }
    const v = verdict(want, rows, second);
    o.onEvent({ type: 'results', want, verdict: v, rows: rows.slice(0, 40).map((r) => ({ artist: r.artist, title: r.title, official: !!r.official })) });
    log(`Finder: “${t}”: ${v} (${rows.length} rows)`);
    // the Roadie follows the search only while nothing newer (a download) has taken over
    const mine = st.view.job === job;
    const name = want ? want.title || want.artist : t;
    if (v === 'none') {
      say(`Not on CustomsForge: nothing for “${name}”.`, 'warn');
      if (mine) setView('failed', job);
    } else if (v === 'official') {
      say(`“${name}” is official DLC (sold in the Rocksmith store): it can’t be downloaded here.`, 'warn');
      if (mine) setView('failed', job);
    } else if (v === 'match') {
      say(`Found “${name}”. Press its download button.`, 'good');
      if (mine) setView('found', job);
    } else if (mine) {
      say(`Searched for “${t}”. Pick the song and press its download button.`);
    }
  }

  // 4.25: the Updated CDLC list, read whenever it is the page on screen (rows sent when they change)
  let updatesSig = null;
  let updatesTimer = null;
  async function checkUpdates() {
    if (!site || !loaded || site.webContents.isLoading()) return;
    const r = await inPage(readPage('updates'), 2000);
    if (!r || !r.on) return;
    const sig = r.sig;
    if (sig === updatesSig) return;
    // the list can still be drawing: read it again in a moment, send it when it holds still
    await nap(700);
    const again = await inPage(readPage('updates'), 2000);
    if (!again || !again.on || again.sig !== sig || sig === updatesSig) return;
    updatesSig = sig;
    const rows = again.rows.slice(0, 500).map((x) => ({ artist: x.artist, title: x.title, version: x.version || '', updated: x.updated || '' }));
    log(`Finder: Updated CDLC shows ${rows.length} songs`);
    o.onEvent({ type: 'updates', rows });
    say(rows.length ? `${rows.length === 1 ? '1 song has' : `${rows.length} songs have`} a newer version. They’re listed in Stagehand too.` : 'No updates for your songs right now.', 'good');
  }

  /** Opens the Updated CDLC tab (clicks it by its words once the page is ready). */
  async function showUpdates() {
    const my = ++searchSeq; // (a search waiting for its box stops: this is what the player asked for now)
    setView('idle', `u${my}`);
    say('Opening Updated CDLC…');
    const start = Date.now();
    let triedLibrary = false;
    while (my === searchSeq && site && Date.now() - start < BOX_WAIT) {
      if (loaded && (await inPage(clickText('Updated CDLC'), 4000, true))) {
        setTimeout(() => checkUpdates().catch(() => {}), 1200);
        return true;
      }
      // the tab may sit inside My Library
      if (loaded && !triedLibrary && Date.now() - start > 2500 && (await inPage(clickText('My Library'), 4000, true))) triedLibrary = true;
      await napOrPoke(300);
    }
    if (my === searchSeq && site) say('Sign in to CustomsForge, then open My Library › Updated CDLC.', 'warn');
    return false;
  }

  // 4.18: a file host's own page (Drive's "No preview available" and the like) is a dead end once the
  // download has started from it: when the song is in, step back to the last page of the song site.
  const FILE_HOST = /(^|\.)(drive\.google\.com|docs\.google\.com|drive\.usercontent\.google\.com|mediafire\.com|dropbox\.com|mega\.nz|mega\.io|1drv\.ms|onedrive\.live\.com|pixeldrain\.com|gofile\.io)$/i;
  const onFileHost = (url) => {
    try {
      const u = new URL(url);
      if (extra.includes(u.host) && /^\/(host|warn)\b/.test(u.pathname)) return true; // (tests: a pretend file host)
      return FILE_HOST.test(u.hostname);
    } catch (_) {
      return false;
    }
  };
  /** The song site's own pages (where ads are hidden). */
  const onSongSite = (url) => {
    try {
      const u = new URL(url);
      return extra.includes(u.host) || /(^|\.)customsforge\.com$/i.test(u.hostname);
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

  /** 4.25: a pop-up or a move to another site that nobody asked for: stopped, and noted. */
  function blocked(url, why) {
    const host = hostOf(url) || String(url).slice(0, 60);
    stats.blocked.push({ host, why, at: Date.now() });
    if (stats.blocked.length > 50) stats.blocked.shift();
    log(`Finder: stopped ${why} to ${host}`);
    o.onEvent({ type: 'blocked', host });
  }

  // 4.18: a file host often starts its download in a new, empty window (Drive's Download button does).
  // That window is let open, out of sight, so the download is taken; it shows only if a song site's page
  // loads in it (Drive's "can't scan this file" page, with its own button), and closes once the file is in.
  // 4.25: one that ends up anywhere else (an ad) is closed unseen.
  const pops = new Set();
  function popup(child) {
    pops.add(child);
    child.setMenuBarVisibility(false);
    guard(child.webContents, true);
    child.webContents.on('did-finish-load', () => {
      if (child.isDestroyed() || child.__took) return;
      const u = child.webContents.getURL();
      if (!u || u.startsWith('about:')) return;
      if (allowed(u, extra)) child.show();
      else {
        blocked(u, 'a pop-up');
        child.close();
      }
    });
    child.on('closed', () => pops.delete(child));
    // an empty window nothing came of
    setTimeout(() => {
      if (!child.isDestroyed() && !child.isVisible() && !child.__took) child.close();
    }, 20000);
  }

  function onDownload(_e, item, from) {
    const pop = [...pops].find((w) => !w.isDestroyed() && w.webContents === from);
    if (pop) {
      pop.__took = true;
      pop.hide();
      item.once('done', () => !pop.isDestroyed() && pop.close()); // (closed after: closing it now could stop the download)
    }
    const name = item.getFilename() || 'song';
    const song = SONG_FILE.test(name);
    const dir = song ? path.join(o.stagingDir, 'Finder', String(Date.now())) : o.downloadsDir();
    try {
      fs.mkdirSync(dir, { recursive: true });
    } catch (_) {}
    const file = path.join(dir, name);
    item.setSavePath(file);
    // 4.25: each download has a job id (in the events too); the bar and the Roadie follow the latest one
    const job = `d${++jobSeq}`;
    const d = { job, name, pct: 0, known: false, state: 'going', at: Date.now() };
    st.downloads.push(d);
    if (st.downloads.length > 20) st.downloads.shift();
    st.focus = job;
    st.done = null;
    st.message = `Downloading ${name}…`;
    st.kind = '';
    setView('downloading', job);
    tell();
    const mine = () => st.focus === job;
    // 4.24: each step also goes to the main window (Activity, the Wanted page), at most 4 times a second
    let sentAt = 0;
    const step = (state, more = {}) => o.onEvent({ type: 'download', job, name, state, pct: d.pct, want, ...more });
    step('going');
    let resumed = false;
    item.on('updated', (_ev, state) => {
      // 4.25: a download cut off on the way is "interrupted" (and may never finish): one try to carry
      // on where it stopped, then it counts as failed (the bar says so; the download button works again)
      if (state === 'interrupted') {
        if (d.state !== 'going') return;
        if (!resumed && item.canResume()) {
          resumed = true;
          setTimeout(() => {
            try {
              item.resume();
            } catch (_) {}
          }, 1000);
          return;
        }
        try {
          item.cancel(); // ('done' follows, as cancelled)
        } catch (_) {}
        return;
      }
      const total = item.getTotalBytes();
      d.known = total > 0;
      d.pct = total ? Math.min(100, Math.round((item.getReceivedBytes() / total) * 100)) : 0;
      tell();
      if (Date.now() - sentAt > 250) {
        sentAt = Date.now();
        step('going');
      }
    });
    item.once('done', async (_ev, state) => {
      if (state !== 'completed') {
        d.state = 'failed';
        if (mine()) {
          say(`${name} didn’t finish downloading. Try its download button again.`, 'warn');
          setView('failed', job);
        } else tell();
        step('failed', { why: 'It didn’t finish downloading' });
        return;
      }
      d.pct = 100;
      if (!song) {
        d.state = 'saved';
        if (mine()) {
          say(`${name} is in your Downloads. Stagehand can’t open this kind of file: unpack it there, then drop the song on Stagehand.`, 'warn');
          setView('failed', job);
        } else tell();
        o.onEvent({ type: 'saved', job, name, file });
        step('failed', { why: 'Not a song file Stagehand can open (left in Downloads)' });
        return;
      }
      d.state = 'adding';
      if (mine()) {
        say(`Importing ${name}: checking it and adding it to your library…`);
        setView('importing', job);
      } else tell();
      step('adding');
      try {
        const results = (await o.importFiles([file])) || [];
        const good = results.filter((r) => r.status === 'imported' || r.status === 'updated');
        const songs = good.flatMap((r) => r.songs || []);
        const had = results.some((r) => r.status === 'duplicate');
        const why = (results.find((r) => r.reason) || {}).reason;
        d.state = good.length || had ? 'added' : 'failed';
        if (good.length || had) st.added++;
        if (mine()) {
          if (good.length) say(`${songs.length > 1 ? `${songs.length} songs` : name} ${songs.length > 1 ? 'are' : 'is'} in your library.`, 'good');
          else if (had) say(`You already have ${name}.`, 'good');
          else say(`${name} couldn’t be added${why ? `: ${why}` : '.'}`, 'warn');
          // only now, with the library's answer in, may the Roadie celebrate
          setView(good.length || had ? 'imported' : 'failed', job);
        } else tell();
        o.onEvent({ type: 'downloaded', job, name, file, want, added: good.length > 0 || had });
        step(good.length ? 'added' : had ? 'had' : 'failed', { why, songs: songs.length });
        if (good.length || had) leaveFileHost();
      } catch (err) {
        d.state = 'failed';
        log(`Finder: import of ${name} failed: ${err.message}`);
        if (mine()) {
          say(`${name} couldn’t be added: ${err.message}`, 'warn');
          setView('failed', job);
        } else tell();
        step('failed', { why: err.message });
      } finally {
        fsp.rm(dir, { recursive: true, force: true }).catch(() => {}); // (the song was copied in)
      }
    });
  }

  function guard(wc, isPop) {
    // 4.25: when did the player last click or press a key here? A move to another site right after
    // is theirs (offered as "Open in my browser"); any other is the page's own doing (stopped)
    let inputAt = 0;
    wc.on('input-event', (_e, ie) => {
      if (Date.now() < ownKeysUntil) return;
      if (ie && /^(mouseDown|mouseUp|keyDown|rawKeyDown|char|gestureTap|touchStart|touchEnd)$/.test(ie.type)) inputAt = Date.now();
    });
    const theirs = () => Date.now() - inputAt < 1500;
    const away = (e, url, what) => {
      if (allowed(url, extra)) return;
      e.preventDefault();
      if (!isPop && theirs() && /^https?:/.test(url)) {
        st.offer = { url, host: hostOf(url) };
        stats.offered.push(st.offer.host);
        say(`That link goes to ${st.offer.host}, outside the song sites. It opens in your own browser if you want it.`);
      } else blocked(url, what);
    };
    // this window stays on song sites; never to the player's browser by itself
    wc.on('will-navigate', (e, legacyUrl) => away(e, (e && e.url) || legacyUrl, 'a page move'));
    wc.on('will-redirect', (e, legacyUrl) => {
      const url = (e && e.url) || legacyUrl;
      if (e && e.isMainFrame === false) return;
      away(e, url, 'a redirect');
    });
    wc.setWindowOpenHandler(({ url }) => {
      if (!url || url.startsWith('about:')) {
        return {
          action: 'allow',
          overrideBrowserWindowOptions: {
            show: false,
            width: 820,
            height: 600,
            title: 'Download · Stagehand',
            backgroundColor: '#14110d',
            autoHideMenuBar: true,
            icon: o.icon && fs.existsSync(o.icon) ? o.icon : undefined,
            webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false },
          },
        };
      }
      if (allowed(url, extra)) setImmediate(() => !wc.isDestroyed() && wc.loadURL(url).catch(() => {}));
      else blocked(url, 'a pop-up'); // 4.25: dropped quietly (these were the ads opening in the browser)
      return { action: 'deny' };
    });
    wc.on('did-create-window', (child) => popup(child));
    if (isPop) return;
    wc.on('did-navigate', () => {
      st.offer = null; // (an offer is for the page it was made on)
      tell();
      poke();
    });
    wc.on('did-navigate-in-page', (_e, _url, isMain) => {
      if (isMain !== false) st.offer = null;
      tell();
      poke();
      setTimeout(() => checkUpdates().catch(() => {}), 800);
    });
    wc.on('dom-ready', () => {
      // 4.25: hide the boxes ads sit in on the song site's pages
      if (onSongSite(wc.getURL())) wc.insertCSS(AD_CSS).catch(() => {});
    });
    wc.on('did-finish-load', () => {
      const first = !loaded;
      loaded = true;
      tell();
      poke();
      // the first page, or the next one after a Find found no box (signed in now): look for the song
      if ((first || needFind) && want) {
        needFind = false;
        setTimeout(() => find().catch(() => {}), 600);
      }
      setTimeout(() => checkUpdates().catch(() => {}), 1000);
    });
  }

  function build() {
    const ses = session.fromPartition('persist:customsforge');
    // the site sees a normal Chrome (the app's own name in it can trip sign-in checks)
    ses.setUserAgent(ses.getUserAgent().replace(/ (Electron|stagehand)\/\S+/gi, ''));
    ses.removeAllListeners('will-download');
    ses.on('will-download', onDownload);
    // 4.25: ads and trackers never load in the finder (the song site, sign-ins and file sites are never on the list)
    ses.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*', 'ws://*/*', 'wss://*/*'] }, (d, cb) => {
      const host = hostOf(d.url);
      if (host && isAdHost(host)) {
        stats.ads[host] = (stats.ads[host] || 0) + 1;
        return cb({ cancel: true });
      }
      cb({});
    });
    const parent = o.parent();
    const scr = electron.screen;
    const pb = parent && !parent.isDestroyed() ? parent.getBounds() : null;
    const disp = scr ? (pb ? scr.getDisplayMatching(pb) : scr.getPrimaryDisplay()) : null;
    const area = disp ? disp.workArea : { x: 0, y: 0, width: 1180, height: 860 };
    const dkey = disp ? `${disp.size.width}x${disp.size.height}@${Math.round((disp.scaleFactor || 1) * 100)}` : 'none';
    const saved = (prefs.get().bounds || {})[dkey];
    const fits = saved && saved.width <= area.width && saved.height <= area.height && saved.x >= area.x - 8 && saved.y >= area.y - 8 && saved.x + saved.width <= area.x + area.width + 8 && saved.y + saved.height <= area.y + area.height + 8;
    const ww = fits ? saved.width : Math.round(Math.min(area.width, Math.max(1180, area.width * 0.9)));
    const wh = fits ? saved.height : Math.round(Math.min(area.height, Math.max(760, area.height * 0.9)));
    win = new BaseWindow({
      width: ww,
      height: wh,
      x: fits ? saved.x : Math.round(area.x + (area.width - ww) / 2),
      y: fits ? saved.y : Math.round(area.y + (area.height - wh) / 2),
      minWidth: Math.min(760, area.width),
      minHeight: Math.min(520, area.height),
      title: 'Find songs · Stagehand',
      backgroundColor: '#14110d',
      autoHideMenuBar: true,
      icon: o.icon && fs.existsSync(o.icon) ? o.icon : undefined,
    });
    const keep = () => {
      if (!win || win.isDestroyed() || win.isMaximized() || win.isMinimized() || win.isFullScreen()) return;
      prefs.set({ bounds: { ...(prefs.get().bounds || {}), [dkey]: win.getBounds() } });
    };
    win.on('resized', keep);
    win.on('moved', keep);
    bar = new WebContentsView({ webPreferences: { preload: path.join(__dirname, '..', 'finder', 'bar-preload.js'), contextIsolation: true, sandbox: true, nodeIntegration: false } });
    site = new WebContentsView({ webPreferences: { session: ses, contextIsolation: true, sandbox: true, nodeIntegration: false, spellcheck: true } });
    win.contentView.addChildView(site);
    win.contentView.addChildView(bar);
    bar.webContents.loadFile(path.join(__dirname, '..', 'finder', 'bar.html')).catch(() => {});
    bar.webContents.on('did-finish-load', tell);
    bar.webContents.on('will-navigate', (e) => e.preventDefault());
    bar.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    guard(site.webContents);
    layout();
    win.on('resize', layout);
    win.on('closed', () => {
      win = bar = site = null;
      loaded = false;
      needFind = false;
      searchSeq++; // (any search still waiting stops)
      clearTimeout(closeTimer);
      clearInterval(updatesTimer);
      for (const w of pops) if (!w.isDestroyed()) w.close();
      st.downloads = [];
      st.focus = null;
      st.offer = null;
      st.done = null;
      st.added = 0;
      st.view = { state: 'idle', job: '', seq: st.view.seq + 1 };
      updatesSig = null;
      o.onEvent({ type: 'closed' });
      // 4.25: back to Stagehand's own window
      const p = o.parent();
      if (p && !p.isDestroyed()) {
        if (p.isMinimized()) p.restore();
        p.show();
        p.focus();
      }
    });
    loaded = false;
    site.webContents.on('did-finish-load', () => site && site.webContents.setZoomFactor(zoom));
    site.webContents.loadURL(home).catch(() => {});
    // the Updated CDLC tab can be opened without the address changing: look now and then (a light check)
    updatesTimer = setInterval(() => checkUpdates().catch(() => {}), 2500);
  }

  /** The site's zoom: smaller fits more of its wide table; Fit picks the size that fits the window. */
  function setZoom(z) {
    zoom = Math.max(0.5, Math.min(1.5, Math.round(z * 100) / 100));
    prefs.set({ zoom });
    if (site) site.webContents.setZoomFactor(zoom);
    tell();
  }
  const zoomStep = (d) => {
    const i = ZOOMS.findIndex((z) => z >= zoom - 0.001);
    setZoom(ZOOMS[Math.max(0, Math.min(ZOOMS.length - 1, (i < 0 ? ZOOMS.length - 1 : i) + d))]);
  };

  const acts = {
    find: () => find(),
    back: () => site && site.webContents.navigationHistory.canGoBack() && site.webContents.navigationHistory.goBack(),
    forward: () => site && site.webContents.navigationHistory.canGoForward() && site.webContents.navigationHistory.goForward(),
    reload: () => site && site.webContents.reload(),
    home: () => site && site.webContents.loadURL(home).catch(() => {}),
    browser: () => site && o.openExternal(site.webContents.getURL() || home),
    // 4.25: the link the player clicked to another site, opened in their browser when they press for it
    openOffer: () => {
      if (!st.offer) return;
      o.openExternal(st.offer.url);
      st.offer = null;
      say('Opened in your browser.');
    },
    skip: () => o.onEvent({ type: 'skip', want }),
    stop: () => o.onEvent({ type: 'stop', want }),
    close: () => win && win.close(),
    zoomOut: () => zoomStep(-1),
    zoomIn: () => zoomStep(1),
    // the site's song table needs about 1400 px; fit it in the window (never above 100%)
    zoomFit: () => win && setZoom(Math.max(0.67, Math.min(1, win.getContentBounds().width / 1400))),
    maximize: () => win && (win.isMaximized() ? win.unmaximize() : win.maximize()),
  };
  ipcMain.on('finder-bar:act', (e, name) => {
    if (!bar || e.sender !== bar.webContents) return;
    if (Object.prototype.hasOwnProperty.call(acts, name)) Promise.resolve(acts[name]()).catch(() => {});
  });

  return {
    /** Opens the window (or brings it up) looking for this song; searches for it once the site shows. */
    async open(item) {
      want = item && (item.artist || item.title) ? { id: item.id || null, artist: String(item.artist || '').slice(0, 200), title: String(item.title || '').slice(0, 200), left: Number(item.left) || 0, mode: item.mode === 'update' ? 'update' : 'want' } : null;
      st.message = '';
      st.done = null;
      clearTimeout(closeTimer); // (a new song: the window stays)
      if (!want) setView('idle', `o${searchSeq}`);
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
    /** 4.25: the Wanted run is over: the bar says so, the Roadie celebrates, the window closes a moment later. */
    done(summary) {
      if (!win || win.isDestroyed()) return { open: false };
      const s = summary || {};
      st.done = { title: String(s.title || 'All done').slice(0, 120), text: String(s.text || '').slice(0, 300) };
      searchSeq++; // (nothing more to look for)
      want = null;
      // a celebration only when songs really went in this time (it never shows before an import)
      if (st.view.state !== 'imported') setView(st.added ? 'imported' : 'idle', st.added ? `done${st.view.seq}` : 'done');
      say(st.done.text || st.done.title, 'good');
      clearTimeout(closeTimer);
      closeTimer = setTimeout(() => win && !win.isDestroyed() && win.close(), CLOSE_AFTER);
      return { open: true, closesIn: CLOSE_AFTER };
    },
    /** 4.25: opens the finder on the site's Updated CDLC tab. */
    async updates() {
      clearTimeout(closeTimer);
      st.done = null;
      if (!win || win.isDestroyed()) {
        want = null;
        build();
      } else {
        if (win.isMinimized()) win.restore();
        win.show();
        win.focus();
      }
      tell();
      showUpdates().catch(() => {});
      return { open: true };
    },
    close() {
      if (win && !win.isDestroyed()) win.close();
    },
    get isOpen() {
      return !!(win && !win.isDestroyed());
    },
    /** For tests: the site's page, and what was stopped. */
    siteContents: () => site && site.webContents,
    barContents: () => bar && bar.webContents,
    window: () => win,
    stats: () => JSON.parse(JSON.stringify(stats)),
  };
}

module.exports = { createFinder, allowed, HOSTS, HOME };
