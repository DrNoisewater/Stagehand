/**
 * Record clip's sound track (4.1.2). Collects the sound engine's mix as 16-bit stereo
 * and keeps it on the recording's clock: if the sound stops for a while (the engine
 * restarted, the cable was bumped, the PC hiccuped), the gap is filled with silence,
 * so everything after it stays in step with the picture and the sound is never shorter
 * than the video. No imports: test/clip-sound.test.mjs runs it in Node.
 */
const GAP_MS = 200; // a pause in delivery longer than this is a gap, not normal jitter
const SLACK_S = 0.1; // pipeline delay that is normal and isn't padded

export function createSoundTrack(rate = 48000) {
  const t = {
    rate,
    parts: [],
    queued: 0, // frames waiting to be taken
    written: 0, // frames already taken
    padded: 0, // frames of silence put in for gaps
    startAt: null,
    lastAt: 0, // when sound last arrived (ms)
    received: 0, // frames that came from the engine since begin()
    /** Sound has arrived at least once (also before begin(): the start check uses it). */
    seen: false,
    begin(now) {
      t.startAt = now;
      t.lastAt = now;
    },
    get total() {
      return t.written + t.queued;
    },
    /** frames the recording should have by `now` */
    due(now) {
      return t.startAt === null ? 0 : Math.round(((now - t.startAt) / 1000) * t.rate);
    },
    _silence(frames) {
      if (frames <= 0) return;
      t.parts.push(new Int16Array(frames * 2));
      t.queued += frames;
      t.padded += frames;
    },
    /** d: Float32Array, interleaved L/R from the engine */
    feed(d, rate, now) {
      t.seen = true;
      if (rate && rate !== t.rate && t.total === 0 && t.received === 0) t.rate = rate;
      if (t.startAt === null) return;
      const frames = d.length >> 1;
      // after a gap: silence first, so this piece lands where it belongs in time
      if (now - t.lastAt > GAP_MS) t._silence(t.due(now) - frames - t.total - Math.round(SLACK_S * t.rate));
      const q = new Int16Array(frames * 2);
      for (let i = 0; i < q.length; i++) {
        const x = d[i];
        q[i] = x >= 1 ? 32767 : x <= -1 ? -32768 : Math.round(x * 32767);
      }
      t.parts.push(q);
      t.queued += frames;
      t.received += frames;
      t.lastAt = now;
    },
    /** Sound is not arriving right now. */
    gap(now) {
      return t.startAt !== null && now - t.lastAt > GAP_MS;
    },
    /** Everything collected so far, as one piece (null if nothing). During a gap, or at
     *  the end, it is topped up with silence to the recording's length. */
    take(now, { end = false } = {}) {
      if (t.startAt !== null && (end || t.gap(now))) t._silence(t.due(now) - t.total - (end ? 0 : Math.round(SLACK_S * t.rate)));
      if (!t.queued) return null;
      const all = new Int16Array(t.queued * 2);
      let o = 0;
      for (const q of t.parts) {
        all.set(q, o);
        o += q.length;
      }
      t.parts = [];
      t.written += t.queued;
      t.queued = 0;
      return all;
    },
  };
  return t;
}
