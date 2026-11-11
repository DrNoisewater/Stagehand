/**
 * 4.5: album art that doesn't flash. Rows, tiles, the song panel and Progress are rebuilt
 * when a song's data changes (a play count, a new best, stems progress), and each rebuild
 * used to make new <img> elements: even from the cache the picture disappeared for a frame
 * or two, and covers showed their initials until the new image's `load` fired.
 *
 * Now a rebuild hands its loaded images to this pool (`harvest`) and the new markup takes
 * them back (`reuse`): the same decoded element moves over, so nothing reloads or blinks.
 * `seen` remembers which pictures have loaded, so a brand-new cover for a known picture
 * shows the picture straight away instead of the initials.
 */
const pool = new Map(); // src -> loaded <img>, not in the page
const MAX = 400;
export const seen = new Set();

/** Puts the loaded images inside `el` (about to be removed or emptied) into the pool. */
export function harvest(el) {
  if (!el) return;
  const imgs = el.tagName === 'IMG' ? [el] : el.querySelectorAll('img');
  for (const img of imgs) {
    const src = img.getAttribute('src');
    if (!src || !img.complete || !img.naturalWidth) continue;
    seen.add(src);
    pool.delete(src);
    pool.set(src, img);
  }
  while (pool.size > MAX) pool.delete(pool.keys().next().value);
}

/** Swaps each new <img> in `el` for a pooled one with the same picture. Returns how many. */
export function reuse(el) {
  let n = 0;
  for (const img of el.querySelectorAll('img')) {
    const src = img.getAttribute('src');
    const old = src && pool.get(src);
    if (!old || old === img) continue;
    pool.delete(src);
    old.className = img.className;
    old.onload = img.onload;
    old.onerror = img.onerror;
    img.replaceWith(old);
    n++;
  }
  return n;
}

/** An <img> for `src`: the pooled one when there is one, else a new one. */
export function artImg(src, attrs = {}) {
  const old = pool.get(src);
  if (old) {
    pool.delete(src);
    return old;
  }
  const img = document.createElement('img');
  for (const [k, v] of Object.entries(attrs)) img.setAttribute(k, v);
  img.src = src;
  img.addEventListener('load', () => seen.add(src), { once: true });
  return img;
}

/** Removes an element after keeping its pictures. */
export function drop(el) {
  harvest(el);
  el.remove();
}
