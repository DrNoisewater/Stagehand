import { ArtDirector } from './art-rotation.mjs';
/** Advance only when the song identity changes; revisiting a part stays in the room. */
export class VenueRotation {
  constructor(options) { this.art = new ArtDirector(options); this.song = null; this.venue = null; }
  forSong(songId, { enabled, eligible, fallback }) {
    if (songId === this.song) return this.venue || fallback;
    this.song = songId;
    this.venue = enabled && eligible.length ? this.art.choose('venues', eligible, { next: true }) : fallback;
    return this.venue;
  }
  use(id) { this.venue = id; }
}
