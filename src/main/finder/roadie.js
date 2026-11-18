'use strict';
/**
 * 4.25: the Roadie in the song finder's bar (docs/roadie/). Only a picture: it shows what the
 * finder is really doing and never drives it.
 *
 *  - The finder sends its real state with a job id and a counter: { state, job, seq }. An older or
 *    repeated one is ignored. States: idle, searching, found, downloading, importing, imported, failed.
 *  - "actual" is that real state; "visual" is what the Roadie is playing. They differ only while the
 *    success clip finishes (about 3 s) after a new search has already started: then it resets and
 *    searches. A newer download, import or failure cuts the celebration short.
 *  - Success only ever plays for "imported", which the finder sends once the library said the song is in.
 *  - Two <video>s take turns: the next clip loads in the hidden one and is swapped in on its first
 *    frame, so the last picture stays up while it loads. Only the visible one plays; the hidden one
 *    holds the likely next clip, paused. Holds loop.
 *  - Failure, reduced motion, a clip that can't play: a still picture of the real state.
 *  - Hidden or minimised window: paused. No sound, nothing from the network.
 */
(function () {
  const BASE = 'roadie/';
  // the clips' first pictures (manifest.json "poster")
  const POSTER = { 'search-loop': 0, found: 4, 'found-hold': 5, 'download-enter': 6, 'download-loop': 8, 'import-enter': 9, 'import-loop': 10, success: 11, 'success-hold': 14, reset: 15, idle: 15 };
  // the still for each real state (reduced motion, failure, a clip that won't play)
  const STILL = { idle: 15, searching: 0, found: 5, downloading: 8, importing: 10, imported: 14, failed: 15 };
  // each state: its entry clip, then the clip it holds on (looping)
  const PLAN = {
    idle: [['idle', true]],
    searching: [['search-loop', true]],
    found: [['found', false], ['found-hold', true]],
    downloading: [['download-enter', false], ['download-loop', true]],
    importing: [['import-enter', false], ['import-loop', true]],
    imported: [['success', false], ['success-hold', true]],
  };
  // what is likely to come next while a hold loops (loaded, paused, in the hidden video)
  const NEXT = { idle: 'search-loop', 'search-loop': 'download-enter', 'found-hold': 'download-enter', 'download-loop': 'import-enter', 'import-loop': 'success', 'success-hold': 'reset' };
  const STATES = Object.keys(STILL);
  const pad = (n) => String(n).padStart(2, '0');
  const still = (n) => `${BASE}art/keyframe-${pad(n)}.png`;

  class RoadiePlayer {
    constructor(host) {
      this.host = host;
      this.actual = 'idle';
      this.visual = null;
      this.job = '';
      this.seq = -1;
      this.pending = null; // a search (or idle, or found) waiting for the celebration to end
      this.celebrating = false;
      this.token = 0;
      this.broken = false; // a clip couldn't play: stills from now on
      this.history = []; // (tests: what showed, and when)
      this.frames = { presented: 0, start: 0, last: 0, clips: {} };
      this.img = document.createElement('img');
      this.img.alt = '';
      this.img.className = 'still';
      this.img.src = still(15);
      this.vids = [0, 1].map(() => {
        const v = document.createElement('video');
        v.muted = true;
        v.defaultMuted = true;
        v.playsInline = true;
        v.disablePictureInPicture = true;
        v.preload = 'auto';
        v.setAttribute('aria-hidden', 'true');
        v.setAttribute('muted', '');
        v.addEventListener('error', () => this.fail(v));
        return v;
      });
      this.front = this.vids[0];
      this.back = this.vids[1];
      host.replaceChildren(this.img, ...this.vids);
      this.motion = window.matchMedia('(prefers-reduced-motion: reduce)');
      this.onVis = () => this.visibility();
      this.onMotion = () => this.render(this.visual || this.actual);
      document.addEventListener('visibilitychange', this.onVis);
      if (this.motion.addEventListener) this.motion.addEventListener('change', this.onMotion);
      this.render('idle');
    }

    /** The finder's real state. Ignores older and repeated news. */
    set(view) {
      if (!view || !STATES.includes(view.state)) return;
      const seq = Number(view.seq);
      if (Number.isFinite(seq) && seq <= this.seq) return;
      if (Number.isFinite(seq)) this.seq = seq;
      const job = String(view.job || '');
      if (view.state === this.actual && job === this.job) return;
      this.actual = view.state;
      this.job = job;
      this.note('actual', view.state);
      // the celebration plays to its end before a new search (or rest) shows
      if (this.celebrating && (view.state === 'searching' || view.state === 'idle' || view.state === 'found')) {
        this.pending = view.state;
        return;
      }
      // already celebrating (the run ended right after a song went in): let it go on
      if (view.state === 'imported' && this.visual === 'imported') {
        this.pending = null;
        return;
      }
      this.pending = null;
      this.render(view.state);
    }

    note(kind, what) {
      this.history.push({ t: Math.round(performance.now()), kind, what, actual: this.actual });
      if (this.history.length > 400) this.history.shift();
    }

    render(state) {
      this.visual = state;
      this.celebrating = false;
      const t = ++this.token;
      if (state === 'failed' || this.broken || this.motion.matches || !PLAN[state]) return this.showStill(STILL[state] ?? 15);
      const [[first, loop1], second] = PLAN[state];
      if (state === 'imported') this.celebrating = true;
      const after = () => {
        if (t !== this.token) return;
        if (state === 'imported') {
          this.celebrating = false;
          const p = this.pending;
          this.pending = null;
          if (p) {
            // a new search started meanwhile: tidy up, then show it
            const t2 = ++this.token;
            this.visual = p;
            return this.play('reset', false, () => t2 === this.token && this.render(p));
          }
        }
        if (second) this.play(second[0], second[1], null, t);
      };
      this.play(first, loop1, second || state === 'imported' ? after : null, t);
    }

    showStill(n) {
      this.token++;
      this.img.src = still(n);
      for (const v of this.vids) {
        v.pause();
        v.classList.remove('on');
      }
      this.note('still', n);
    }

    /** Plays a clip in the hidden video and swaps it in on its first frame. */
    play(clip, loop, onEnded, t = this.token) {
      if (t !== this.token) return;
      const v = this.back;
      const src = `${BASE}clips/${clip}.mp4`;
      v.loop = !!loop;
      v.onended = () => {
        if (t === this.token && onEnded) onEnded();
      };
      if (v.dataset.clip !== clip) {
        v.dataset.clip = clip;
        v.poster = still(POSTER[clip]);
        v.src = src;
        v.load();
      } else if (v.currentTime > 0) v.currentTime = 0;
      this.img.src = still(POSTER[clip]); // (under the videos: shows if a clip is slow to start)
      const swap = () => {
        if (t !== this.token || v !== this.back) return;
        const old = this.front;
        this.front = v;
        this.back = old;
        v.classList.add('on');
        old.classList.remove('on');
        old.pause();
        old.onended = null;
        this.note('clip', clip);
        this.count(v, clip);
        // the likely next clip waits, loaded and paused, in the hidden one
        const next = loop ? NEXT[clip] : null;
        if (next && old.dataset.clip !== next) {
          old.dataset.clip = next;
          old.src = `${BASE}clips/${next}.mp4`;
          old.load();
        }
      };
      if (document.visibilityState === 'hidden') {
        // nothing plays out of sight: show it (first frame) and start it when the window shows again
        v.addEventListener('loadeddata', swap, { once: true });
        if (v.readyState >= 2) swap();
        return;
      }
      const go = v.play();
      if (go && go.catch) go.catch(() => {});
      if (v.requestVideoFrameCallback) v.requestVideoFrameCallback(() => swap());
      else v.addEventListener('playing', () => requestAnimationFrame(swap), { once: true });
    }

    /** Counts the frames the visible clip really shows (requestVideoFrameCallback). */
    count(v, clip) {
      if (!v.requestVideoFrameCallback) return;
      let last = null;
      const tick = (now, meta) => {
        if (v !== this.front || v.dataset.clip !== clip) return;
        const f = this.frames;
        if (last != null && meta.presentedFrames > last) {
          f.presented += meta.presentedFrames - last;
          (f.clips[clip] = f.clips[clip] || { frames: 0 }).frames += meta.presentedFrames - last;
        }
        if (!f.start) f.start = now;
        f.last = now;
        last = meta.presentedFrames;
        v.requestVideoFrameCallback(tick);
      };
      v.requestVideoFrameCallback(tick);
    }

    /** Frames shown per second since counting started (and the browser's dropped-frame count). */
    stats() {
      const f = this.frames;
      const secs = f.last && f.start ? (f.last - f.start) / 1000 : 0;
      const q = this.front.getVideoPlaybackQuality ? this.front.getVideoPlaybackQuality() : {};
      return { frames: f.presented, seconds: Math.round(secs * 100) / 100, fps: secs ? Math.round((f.presented / secs) * 10) / 10 : 0, dropped: q.droppedVideoFrames || 0, total: q.totalVideoFrames || 0, clips: f.clips };
    }
    resetStats() {
      this.frames = { presented: 0, start: 0, last: 0, clips: {} };
    }

    fail(v) {
      // a clip that won't play: the stills from now on (the real state still shows in words)
      if (!v.getAttribute('src')) return;
      this.broken = true;
      this.note('error', v.dataset.clip || '');
      this.render(this.visual || this.actual);
    }

    visibility() {
      if (document.visibilityState === 'hidden') {
        for (const v of this.vids) v.pause();
      } else if (this.front.classList.contains('on') && !this.motion.matches) {
        const p = this.front.play();
        if (p && p.catch) p.catch(() => {});
      }
    }

    dispose() {
      this.token++;
      document.removeEventListener('visibilitychange', this.onVis);
      if (this.motion.removeEventListener) this.motion.removeEventListener('change', this.onMotion);
      for (const v of this.vids) {
        v.pause();
        v.removeAttribute('src');
        v.load();
      }
      this.host.replaceChildren();
    }
  }
  window.RoadiePlayer = RoadiePlayer;
})();
