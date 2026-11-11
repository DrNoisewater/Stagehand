/** Decorative menu images only. No audio, gear or highway dependencies. */
import { state, on } from './store.js';
import { h } from './ui.js';
import { ART, PLACEMENTS } from './identity-art.js';
import { ArtDirector, MenuArtVisits } from './art-rotation.mjs';
export const storage = kind => { try { return window[kind]; } catch { return undefined; } };
export const director = new ArtDirector({ storage: storage('localStorage'), session: storage('sessionStorage') });
export const APPEARANCE_KEY = 'stagehand.appearance.v1';
const saved = director.read(storage('localStorage'), APPEARANCE_KEY, {});
export const appearancePrefs = saved && typeof saved === 'object' && !Array.isArray(saved) ? saved : {};
const visits = new MenuArtVisits(director);
const enter = () => visits.enter(state.page, PLACEMENTS, { rotate: appearancePrefs.rotateMenus !== false });
on('page', enter); enter();
export function decorativeImage(pool, className = 'menu-spot-art', { next = false } = {}) {
  const id = director.choose(pool, PLACEMENTS[pool] || [], { next: next && appearancePrefs.rotateMenus !== false });
  const item = ART.find(a => a.id === id);
  const img = h(`img.${className}`, { alt:'', 'aria-hidden':'true', decoding:'async', loading:'lazy' });
  img.dataset.menuPool = pool;
  if (item) { img.src = `art/${item.file}`; img.dataset.art = id; }
  else img.hidden = true;
  img.onerror = () => { img.hidden = true; };
  return img;
}

export function advancePageArt(page) {
  for (const slot of [page, `sidebar-${page}`, `empty-${page}`]) {
    if (PLACEMENTS[slot]) director.choose(slot, PLACEMENTS[slot], {next:true});
  }
  refreshDecorations();
}
export function refreshDecorations() {
  for (const img of document.querySelectorAll('img[data-menu-pool]')) {
    const id = director.choose(img.dataset.menuPool, PLACEMENTS[img.dataset.menuPool] || []);
    const item = ART.find(a => a.id === id);
    if (item) { img.src = `art/${item.file}`; img.dataset.art = id; img.hidden = false; }
  }
}
