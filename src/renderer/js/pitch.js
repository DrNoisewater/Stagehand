/**
 * Pitch detection for the tuner. YIN on a 4× decimated copy finds the period
 * roughly; the full-rate difference function around it, with parabolic
 * interpolation, pins it to a small fraction of a cent.
 */

function diffAt(x, W, tau) {
  let s = 0;
  for (let i = 0; i < W; i++) {
    const v = x[i] - x[i + tau];
    s += v * v;
  }
  return s;
}

/**
 * @param {Float32Array} buf time-domain samples
 * @param {number} sr sample rate
 * @returns {{hz:number, clarity:number}|null}
 */
export function detectPitch(buf, sr, { minHz = 28, maxHz = 1400, threshold = 0.12 } = {}) {
  const n = buf.length;
  let energy = 0;
  for (let i = 0; i < n; i++) energy += buf[i] * buf[i];
  if (Math.sqrt(energy / n) < 0.004) return null;

  // Coarse: 4× decimation (simple averaging is a good enough low-pass here).
  const D = 4;
  const m = Math.floor(n / D);
  const y = new Float32Array(m);
  for (let i = 0; i < m; i++) {
    let s = 0;
    for (let k = 0; k < D; k++) s += buf[i * D + k];
    y[i] = s / D;
  }
  const fs = sr / D;
  const W = Math.floor(m / 2);
  const maxTau = Math.min(W - 1, Math.floor(fs / minHz));
  const minTau = Math.max(2, Math.floor(fs / maxHz));
  const cm = new Float32Array(maxTau + 2);
  let run = 0;
  cm[0] = 1;
  for (let tau = 1; tau <= maxTau + 1; tau++) {
    const d = diffAt(y, W, tau);
    run += d;
    cm[tau] = run ? (d * tau) / run : 1;
  }
  let tau = -1;
  for (let t = minTau; t <= maxTau; t++) {
    if (cm[t] < threshold) {
      while (t + 1 <= maxTau && cm[t + 1] < cm[t]) t++;
      tau = t;
      break;
    }
  }
  if (tau < 0) {
    // No clear dip under the threshold: take the global minimum if it's decent.
    let best = 1;
    for (let t = minTau; t <= maxTau; t++) {
      if (cm[t] < best) {
        best = cm[t];
        tau = t;
      }
    }
    if (best > 0.3) return null;
  }
  const clarity = 1 - cm[tau];

  // Fine, step 1: full-rate search around the coarse period.
  const refine = (center, reach, Wf) => {
    let bestT = center;
    let bestV = Infinity;
    const vals = new Map();
    for (let t = Math.max(2, center - reach); t <= center + reach; t++) {
      if (t + 1 + Wf >= n) break;
      const v = diffAt(buf, Wf, t);
      vals.set(t, v);
      if (v < bestV) {
        bestV = v;
        bestT = t;
      }
    }
    const a = vals.has(bestT - 1) ? vals.get(bestT - 1) : diffAt(buf, Wf, bestT - 1);
    const c = vals.has(bestT + 1) ? vals.get(bestT + 1) : diffAt(buf, Wf, bestT + 1);
    const den = a - 2 * bestV + c;
    const shift = den > 0 ? (a - c) / (2 * den) : 0;
    return bestT + Math.max(-0.5, Math.min(0.5, shift));
  };
  const W1 = Math.min(n - (tau + 2) * D - 4, Math.max(1024, Math.floor(n / 2)));
  let period = refine(tau * D, D + 2, W1);
  // Step 2: measure across several cycles of a short period; the
  // interpolation error shrinks by that many times.
  const cycles = Math.floor(Math.min(n / 3, 1200) / period);
  if (cycles >= 2) {
    const W2 = Math.min(n - Math.ceil(period * cycles) - 8, Math.max(1024, Math.floor(n / 2)));
    if (W2 >= 512) period = refine(Math.round(period * cycles), 3, W2) / cycles;
  }
  return { hz: sr / period, clarity };
}

/** Steadies the reading: median of recent estimates that agree with each other. */
export class PitchSmoother {
  constructor(size = 7) {
    this.size = size;
    this.hist = [];
  }
  push(hz) {
    if (!hz) {
      this.hist = [];
      return null;
    }
    const last = this.hist[this.hist.length - 1];
    if (last && Math.abs(1200 * Math.log2(hz / last)) > 40) this.hist = [];
    this.hist.push(hz);
    if (this.hist.length > this.size) this.hist.shift();
    const s = [...this.hist].sort((p, q) => p - q);
    return s[Math.floor(s.length / 2)];
  }
}
