/**
 * 4.16: the headset's idea of the PC's clock and of where the song is.
 * The PC answers pings with its own time; the fastest answers of the last few say best how far
 * apart the two clocks are (a slow answer was held up on the way, so it's ignored).
 * Pure: no page, no network (test/companion.test.mjs runs it in Node).
 */
export class PcClock {
  constructor({ keep = 12, now = () => performance.timeOrigin + performance.now() } = {}) {
    this.keep = keep;
    this.now = now;
    this.samples = [];
    this.offset = null; // PC time minus ours, in ms
    this.rtt = null; // the fastest round trip lately, in ms
  }

  /** A ping sent at t0 (our clock) came back at t1 (our clock) carrying the PC's time `pc`. */
  add(t0, t1, pc) {
    const rtt = t1 - t0;
    if (!(rtt >= 0) || !Number.isFinite(pc)) return;
    this.samples.push({ rtt, offset: pc - (t0 + t1) / 2 });
    if (this.samples.length > this.keep) this.samples.shift();
    const best = this.samples.reduce((a, b) => (b.rtt < a.rtt ? b : a));
    // move towards the best guess gently, so the song never jumps for a hiccup on the network
    const target = best.offset;
    this.offset = this.offset == null || Math.abs(target - this.offset) > 50 ? target : this.offset + (target - this.offset) * 0.3;
    this.rtt = best.rtt;
  }

  get ready() {
    return this.offset != null;
  }

  /** The PC's clock now, in ms. */
  pcNow() {
    return this.now() + (this.offset || 0);
  }
}

/** Where the song is now (seconds), from the PC's last report. */
export function songPos(state, pcNow) {
  if (!state) return 0;
  if (!state.playing) return state.pos;
  const p = state.pos + (Math.max(-200, pcNow - state.at) / 1000) * (state.speed || 1);
  const len = state.song && state.song.length;
  return len ? Math.min(p, len) : p;
}
