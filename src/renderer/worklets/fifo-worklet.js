/* Plays a stream of stereo pieces (interleaved L/R) that arrive from the page,
 * as one smooth signal. Used to record what the native sound engine plays.
 *
 * The pieces arrive unevenly (the page is busy drawing the highway), so it keeps
 * about a tenth of a second in hand and only starts once it has that much. If it
 * ever runs dry it plays silence and waits for a new cushion, instead of
 * stuttering on every late piece. */
const CAP = 1 << 18; // per channel, ~5 s at 48 kHz

class StagehandFifo extends AudioWorkletProcessor {
  constructor(opts) {
    super();
    this.L = new Float32Array(CAP);
    this.R = new Float32Array(CAP);
    this.w = 0;
    this.r = 0;
    this.target = Math.round(((opts && opts.processorOptions && opts.processorOptions.cushion) || 0.1) * sampleRate);
    this.primed = false;
    this.port.onmessage = (e) => {
      const d = e.data && e.data.d;
      if (!d) return;
      const n = d.length >> 1;
      if (this.w - this.r + n > CAP) return; // far behind: drop rather than wrap
      for (let i = 0; i < n; i++) {
        const p = (this.w + i) & (CAP - 1);
        this.L[p] = d[2 * i];
        this.R[p] = d[2 * i + 1];
      }
      this.w += n;
    };
  }

  process(_inputs, outputs) {
    const out = outputs[0];
    const L = out[0];
    const R = out[1] || out[0];
    const n = L.length;
    const fill = this.w - this.r;
    if (!this.primed && fill >= this.target) this.primed = true;
    if (!this.primed || fill < n) {
      if (this.primed) this.primed = false; // ran dry: wait for a new cushion
      L.fill(0);
      if (R !== L) R.fill(0);
      return true;
    }
    for (let i = 0; i < n; i++) {
      const p = (this.r + i) & (CAP - 1);
      L[i] = this.L[p];
      R[i] = this.R[p];
    }
    this.r += n;
    return true;
  }
}

registerProcessor('stagehand-fifo', StagehandFifo);
