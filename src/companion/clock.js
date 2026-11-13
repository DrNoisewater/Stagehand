/**
 * The song's clock on the headset (4.16). The PC sends its song clock with the
 * moment it was read (PC time); the headset learns how far its own clock is
 * from the PC's (pings, keeping the fastest round trips: they have the least
 * waiting in them) and runs the song clock smoothly between messages.
 *
 * Pure: the tests run it in Node with made-up network delays.
 */

/** The offset between this clock and the PC's, from ping/pong pairs. */
export class ClockSync {
  constructor({ keep = 16 } = {}) {
    this.keep = keep;
    this.samples = []; // { rtt, offset, at }
    this.offset = 0; // PC time = local time + offset
    this.rtt = Infinity;
    this.ready = false;
  }
  /** c: local time the ping left; s: PC time it was answered; now: local time the answer came. */
  add(c, s, now) {
    const rtt = now - c;
    if (!(rtt >= 0) || rtt > 2000) return;
    this.samples.push({ rtt, offset: s - (c + rtt / 2), at: now });
    if (this.samples.length > this.keep) this.samples.shift();
    // the fastest third, averaged: steady and close to the truth
    const best = this.samples.slice().sort((a, b) => a.rtt - b.rtt).slice(0, Math.max(1, Math.ceil(this.samples.length / 3)));
    this.offset = best.reduce((n, x) => n + x.offset, 0) / best.length;
    this.rtt = best[0].rtt;
    this.ready = this.samples.length >= 3;
  }
  /** PC time now, given local time now. */
  pc(now) {
    return now + this.offset;
  }
}

/**
 * The song clock: set() with each state message, at(now) every frame.
 * Smooth like the PC's highway: it runs on real time and is pulled gently
 * onto what the PC says (no jumps), but a seek, pause or new song snaps.
 */
export class SongClock {
  constructor(sync) {
    this.sync = sync;
    this.st = null;
    this.v = NaN; // the smooth clock
    this.lastNow = NaN;
  }
  set(st) {
    const prev = this.st;
    this.st = st;
    if (!prev || prev.songId !== st.songId || prev.playing !== st.playing) this.v = NaN;
  }
  /** Where the PC's song is now, straight from the last message. */
  target(now) {
    const st = this.st;
    if (!st) return 0;
    if (!st.playing) return st.t;
    return st.t + ((this.sync.pc(now) - st.at) / 1000) * (st.speed || 1);
  }
  /** The song time to draw at local time now (s). */
  at(now) {
    const want = this.target(now);
    const st = this.st;
    const dt = Number.isFinite(this.lastNow) ? Math.min(0.25, (now - this.lastNow) / 1000) : 0;
    this.lastNow = now;
    if (!st || !st.playing || !Number.isFinite(this.v) || Math.abs(want - this.v) > 0.2) this.v = want;
    else {
      this.v += dt * (st.speed || 1);
      this.v += (want - this.v) * Math.min(1, dt * 4);
    }
    return this.v;
  }
}
