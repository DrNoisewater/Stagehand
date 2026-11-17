/**
 * 4.23: Display (Settings › Display). For TVs and small or highly scaled screens:
 * - what screen Stagehand is on (its size, Windows' scale, how often it refreshes);
 * - the app's size (Auto, or 80–150%): Auto shrinks Stagehand to fit a screen narrower than it
 *   was made for (a 1280×720 TV at 150% is only 853×480 to Windows), instead of running off it;
 * - a TV safe area: a black border of 0–10% so a TV that crops the edges (overscan) shows everything;
 * - window sizes, windowed or full screen (the page offers to undo a change that went wrong).
 * Each screen remembers its own size and safe area. A window saved on a screen that's gone comes
 * back on the main screen. Nothing here changes Windows' own display settings.
 *
 * Plain functions over Electron's screen and the main window, so they can be tested with fakes.
 */
const DESIGN_W = 1060; // the window's smallest size before 4.23: the app is laid out for at least this
const DESIGN_H = 680;

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const keyOf = (d) => (d ? `${d.size.width}x${d.size.height}@${Math.round((d.scaleFactor || 1) * 100)}` : 'none');

/** The window's saved place, kept only if it's still on a screen that exists (more than a corner of it). */
function validBounds(bounds, displays) {
  if (!bounds) return null;
  for (const d of displays) {
    const a = d.workArea;
    const w = Math.min(bounds.x + bounds.width, a.x + a.width) - Math.max(bounds.x, a.x);
    const h = Math.min(bounds.y + bounds.height, a.y + a.height) - Math.max(bounds.y, a.y);
    if (w >= 200 && h >= 120) {
      // a saved size bigger than the screen now is brought inside it
      const width = Math.min(bounds.width, a.width);
      const height = Math.min(bounds.height, a.height);
      return { x: clamp(bounds.x, a.x, a.x + a.width - width), y: clamp(bounds.y, a.y, a.y + a.height - height), width, height };
    }
  }
  return null;
}

/** The smallest window that still fits on this screen. */
function minSize(display) {
  const a = display ? display.workArea : { width: DESIGN_W, height: DESIGN_H };
  return { width: Math.min(DESIGN_W, a.width), height: Math.min(DESIGN_H, a.height) };
}

/** The app's size on a screen: the chosen one, or Auto (100%, or smaller on a screen too small for the app). */
function zoomFor(pref, display) {
  const v = pref && pref.scale;
  if (typeof v === 'number' && Number.isFinite(v)) return clamp(v, 0.8, 1.5);
  const a = display ? display.workArea : { width: 1920, height: 1080 };
  return clamp(Math.min(a.width / DESIGN_W, a.height / DESIGN_H, 1), 0.67, 1);
}

function describe(d, primaryId, currentId) {
  return {
    id: d.id,
    key: keyOf(d),
    label: d.label || '',
    width: d.size.width,
    height: d.size.height,
    pixelsWide: Math.round(d.size.width * (d.scaleFactor || 1)),
    pixelsHigh: Math.round(d.size.height * (d.scaleFactor || 1)),
    scale: Math.round((d.scaleFactor || 1) * 100),
    refresh: d.displayFrequency || null,
    workArea: d.workArea,
    primary: d.id === primaryId,
    current: d.id === currentId,
  };
}

const SIZES = [
  [1280, 720],
  [1366, 768],
  [1600, 900],
  [1920, 1080],
  [2560, 1440],
];

class Display {
  constructor({ screen, settings, getWin, send = () => {} }) {
    this.screen = screen;
    this.settings = settings;
    this.getWin = getWin;
    this.send = send;
    this.lastKey = null;
  }
  prefs() {
    return (this.settings.get().display || {}).screens || {};
  }
  current() {
    const win = this.getWin();
    if (!win || win.isDestroyed()) return this.screen.getPrimaryDisplay();
    return this.screen.getDisplayMatching(win.getBounds());
  }
  prefFor(d) {
    return this.prefs()[keyOf(d)] || {};
  }
  /** Options for the main window before it's made: a place on a screen that exists, a size that fits. */
  windowOptions(saved) {
    const displays = this.screen.getAllDisplays();
    const bounds = validBounds(saved, displays);
    const d = bounds ? this.screen.getDisplayMatching(bounds) : this.screen.getPrimaryDisplay();
    const min = minSize(d);
    const out = { minWidth: min.width, minHeight: min.height };
    if (bounds) Object.assign(out, bounds);
    else {
      const a = d.workArea;
      out.width = Math.min(1440, a.width);
      out.height = Math.min(900, a.height);
      out.x = Math.round(a.x + (a.width - out.width) / 2);
      out.y = Math.round(a.y + (a.height - out.height) / 2);
    }
    return out;
  }
  /** The app's size and safe area for the screen the window is on now (again when it moves screens). */
  apply() {
    const win = this.getWin();
    if (!win || win.isDestroyed()) return null;
    const d = this.current();
    const p = this.prefFor(d);
    const zoom = zoomFor(p, d);
    try {
      win.webContents.setZoomFactor(zoom);
    } catch (_) {}
    const min = minSize(d);
    try {
      win.setMinimumSize(min.width, min.height);
    } catch (_) {}
    const safe = clamp(Number(p.safe) || 0, 0, 10);
    this.lastKey = keyOf(d);
    this.send('display:changed', { zoom, safe, key: this.lastKey });
    return { zoom, safe };
  }
  /** Called when the window moves: a different screen gets its own settings. */
  moved() {
    const k = keyOf(this.current());
    if (k !== this.lastKey) this.apply();
  }
  info() {
    const win = this.getWin();
    const d = this.current();
    const primary = this.screen.getPrimaryDisplay();
    const p = this.prefFor(d);
    return {
      displays: this.screen.getAllDisplays().map((x) => describe(x, primary.id, d.id)),
      current: describe(d, primary.id, d.id),
      scale: typeof p.scale === 'number' ? p.scale : 'auto',
      zoom: zoomFor(p, d),
      safe: clamp(Number(p.safe) || 0, 0, 10),
      mode: !win || win.isDestroyed() ? 'windowed' : win.isFullScreen() ? 'fullscreen' : win.isMaximized() ? 'maximized' : 'windowed',
      bounds: win && !win.isDestroyed() ? win.getBounds() : null,
      sizes: SIZES.filter(([w, h]) => w <= d.workArea.width && h <= d.workArea.height).map(([w, h]) => ({ width: w, height: h })),
    };
  }
  /** Size and safe area for the screen the window is on ({ scale: 'auto' | 0.8–1.5, safe: 0–10 }). */
  set(patch) {
    const d = this.current();
    const k = keyOf(d);
    const cur = { ...this.prefFor(d) };
    if ('scale' in patch) {
      if (patch.scale === 'auto' || patch.scale === null) delete cur.scale;
      else if (Number.isFinite(Number(patch.scale))) cur.scale = clamp(Number(patch.scale), 0.8, 1.5);
    }
    if ('safe' in patch) cur.safe = clamp(Math.round(Number(patch.safe) * 2) / 2 || 0, 0, 10);
    const screens = { ...this.prefs(), [k]: cur };
    this.settings.set({ display: { screens } });
    this.apply();
    return this.info();
  }
  /** Back to how it was for this screen: Auto size, no border, a window that fits. */
  reset() {
    const d = this.current();
    const screens = { ...this.prefs(), [keyOf(d)]: {} }; // (settings merge: an emptied entry, not a missing one)
    this.settings.set({ display: { screens } });
    this.apply();
    return this.info();
  }
  /** windowed | maximized | fullscreen, and an optional window size (centred on the screen it's on). */
  window({ mode, width, height } = {}) {
    const win = this.getWin();
    if (!win || win.isDestroyed()) return null;
    const before = { mode: this.info().mode, bounds: win.getBounds() };
    if (mode === 'fullscreen') win.setFullScreen(true);
    else {
      if (win.isFullScreen()) win.setFullScreen(false);
      if (mode === 'maximized') win.maximize();
      else if (mode === 'windowed' || width) {
        if (win.isMaximized()) win.unmaximize();
        if (width && height) {
          const a = this.current().workArea;
          const w = Math.min(Number(width), a.width);
          const h = Math.min(Number(height), a.height);
          win.setBounds({ x: Math.round(a.x + (a.width - w) / 2), y: Math.round(a.y + (a.height - h) / 2), width: w, height: h });
        }
      }
    }
    return { before, now: this.info() };
  }
  /** Undo a window change (the page's "Keep this?" ran out, or Undo was pressed). */
  restore(before) {
    const win = this.getWin();
    if (!win || win.isDestroyed() || !before) return null;
    if (before.mode === 'fullscreen') win.setFullScreen(true);
    else {
      if (win.isFullScreen()) win.setFullScreen(false);
      if (before.mode === 'maximized') win.maximize();
      else {
        if (win.isMaximized()) win.unmaximize();
        const b = validBounds(before.bounds, this.screen.getAllDisplays());
        if (b) win.setBounds(b);
      }
    }
    return this.info();
  }
}

module.exports = { Display, validBounds, minSize, zoomFor, keyOf, DESIGN_W, DESIGN_H };
