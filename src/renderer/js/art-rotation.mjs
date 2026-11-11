/** Decorative art only. Never use this for album covers, status or identity. */
export class ArtDirector {
  constructor({ storage, session, random = Math.random } = {}) {
    this.storage = storage; this.session = session; this.random = random;
    this.memory = new Map(); this.history = new Map();
  }
  read(store, key, fallback) {
    try { const value = store?.getItem(key); return value ? JSON.parse(value) : fallback; } catch { return fallback; }
  }
  write(store, key, value) { try { store?.setItem(key, JSON.stringify(value)); } catch { /* private/full storage: memory still works */ } }
  choose(placement, ids, { next = false } = {}) {
    if (!ids.length) return null;
    const key = `stagehand.art.v1:${placement}`;
    const pin = this.read(this.storage, key + ':pin', null);
    if (ids.includes(pin)) return pin;
    const current = this.memory.get(key) || this.read(this.session, key, null);
    if (!next && ids.includes(current)) { this.memory.set(key, current); return current; }
    const saved = this.history.get(key) || this.read(this.storage, key, {});
    const previous = saved && typeof saved === 'object' ? saved : {};
    let bag = Array.isArray(previous.bag) ? [...new Set(previous.bag)].filter(id => ids.includes(id)) : [];
    if (!bag.length) {
      bag = [...ids];
      for (let i = bag.length - 1; i > 0; i--) { const j = Math.floor(this.random() * (i + 1)); [bag[i], bag[j]] = [bag[j], bag[i]]; }
    }
    const last = current || previous.last;
    if (bag.length > 1 && bag[0] === last) [bag[0], bag[1]] = [bag[1], bag[0]];
    const id = bag.shift();
    this.memory.set(key, id); this.history.set(key, { bag, last: id });
    this.write(this.session, key, id); this.write(this.storage, key, { bag, last: id });
    return id;
  }
  pin(placement, id) { this.write(this.storage, `stagehand.art.v1:${placement}:pin`, id || null); }
  pinned(placement) { return this.read(this.storage, `stagehand.art.v1:${placement}:pin`, null); }
}

/** Advances only at navigation boundaries; never during rendering or playback. */
export class MenuArtVisits {
  constructor(director) { this.director = director; this.active = null; this.visited = new Set(); }
  enter(page, placements, { rotate = true } = {}) {
    if (page === this.active) return;
    this.active = page;
    if (!placements[page]) return; // Highway and unknown routes have no artwork pools.
    const next = rotate && this.visited.has(page);
    for (const slot of [page, `sidebar-${page}`, `empty-${page}`]) {
      if (placements[slot]) this.director.choose(slot, placements[slot], { next });
    }
    this.visited.add(page);
  }
}
