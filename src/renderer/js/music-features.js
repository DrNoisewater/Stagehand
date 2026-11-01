/**
 * What the backgrounds listen to (3.12): one reading per frame of the song as
 * you hear it (after the mix faders, so muted stems don't count) and of your
 * guitar. Every visual (Fluid and the GPU scenes) reads the same numbers, so
 * they all move to the same beat.
 *
 *   bands     sub, bass, low-mid, mid, high: 0–1, auto-levelled per song
 *   energy    overall loudness, 0–1, auto-levelled
 *   kick      0–1, jumps to 1 on a low-end hit and fades (~150 ms)
 *   snap      same for a hit in the mids/highs (snare, strum, pick attack)
 *   spec      64 log-spaced bands, 30 Hz – 14 kHz, 0–1 (for the shaders)
 *   wave      512 samples of the mix, -1–1
 *   phase     a clock that runs faster when the music is louder (smooth motion)
 *   guitar    { level, attack, hue, midi } of what you play (hue = note, C = 0)
 *   events    notes the highway landed or you hit: { string, fret, hit, at }
 */
const NB = 64;
const LO = 30;
const HI = 14000;
const BANDS = [[20, 60], [60, 250], [250, 1000], [1000, 4000], [4000, 12000]];

export function createFeatures() {
  const F = {
    bands: new Float32Array(5),
    energy: 0,
    drive: 0,
    kick: 0,
    snap: 0,
    beats: 0, // counts kicks: scenes use it to change something every hit
    spec: new Float32Array(NB),
    wave: new Float32Array(512),
    phase: 0,
    t: 0,
    guitar: { level: 0, attack: 0, hue: 0, midi: 0, on: false },
    events: [],
  };
  const peak = new Float32Array(5).fill(0.05);
  const prevBand = new Float32Array(5);
  let ePeak = 0.05;
  let fluxLo = 0.01;
  let fluxHi = 0.01;
  let lastKick = 0;
  let lastSnap = 0;
  let last = 0;
  let gPrev = 0;
  let gPeak = 0.05;
  let pitchAt = 0;
  let lastAttack = 0;
  const raw = new Float32Array(NB);

  /** Reads the song (engine) and your guitar (rig). `now` in ms. */
  F.update = (engine, rig, now) => {
    const dt = last ? Math.min(0.1, (now - last) / 1000) : 1 / 60;
    last = now;
    F.t += dt;
    const spec = engine && engine.spectrum ? engine.spectrum() : null;
    const rate = (engine && engine.ctx && engine.ctx.sampleRate) || 48000;
    const playing = !!(engine && engine.playing);
    if (spec && playing) {
      const binHz = rate / 2 / spec.length;
      // 64 log bands for the shaders
      for (let i = 0; i < NB; i++) {
        const f0 = LO * (HI / LO) ** (i / NB);
        const f1 = LO * (HI / LO) ** ((i + 1) / NB);
        const a = Math.max(1, Math.floor(f0 / binHz));
        const b = Math.max(a + 1, Math.ceil(f1 / binHz));
        let m = 0;
        for (let k = a; k < b && k < spec.length; k++) m = Math.max(m, spec[k]);
        raw[i] = m / 255;
      }
      // five bands: power, auto-levelled to the loudest of the last few seconds
      for (let j = 0; j < 5; j++) {
        const [f0, f1] = BANDS[j];
        const a = Math.max(1, Math.floor(f0 / binHz));
        const b = Math.min(spec.length, Math.ceil(f1 / binHz));
        let s = 0;
        for (let k = a; k < b; k++) s += (spec[k] / 255) ** 2;
        s /= Math.max(1, b - a);
        peak[j] = Math.max(s, peak[j] * (1 - dt * 0.25), 0.004);
        const v = Math.min(1, s / peak[j]);
        F.bands[j] += (v - F.bands[j]) * Math.min(1, dt * (v > F.bands[j] ? 30 : 8));
      }
      // hits: a band jumping up faster than it usually does
      const lo = Math.max(0, F.bands[0] - prevBand[0]) + Math.max(0, F.bands[1] - prevBand[1]);
      const hi = Math.max(0, F.bands[3] - prevBand[3]) + Math.max(0, F.bands[4] - prevBand[4]) * 0.7 + Math.max(0, F.bands[2] - prevBand[2]) * 0.5;
      fluxLo += (lo - fluxLo) * dt * 2;
      fluxHi += (hi - fluxHi) * dt * 2;
      const t = now / 1000;
      if (lo > fluxLo * 2.2 + 0.06 && t - lastKick > 0.2) {
        lastKick = t;
        F.kick = Math.min(1, 0.55 + lo * 2);
        F.beats++;
      }
      if (hi > fluxHi * 2.2 + 0.05 && t - lastSnap > 0.12) {
        lastSnap = t;
        F.snap = Math.min(1, 0.5 + hi * 2);
      }
      prevBand.set(F.bands);
      const level = engine.masterLevel ? engine.masterLevel() : 0;
      ePeak = Math.max(level, ePeak * (1 - dt * 0.2), 0.01);
      const e = Math.min(1, level / ePeak);
      F.energy += (e - F.energy) * Math.min(1, dt * 6);
      if (engine.waveform) engine.waveform(F.wave);
    } else {
      for (let j = 0; j < 5; j++) F.bands[j] *= 1 - Math.min(1, dt * 3);
      raw.fill(0);
      F.energy *= 1 - Math.min(1, dt * 3);
      F.wave.fill(0);
    }
    for (let i = 0; i < NB; i++) F.spec[i] += (raw[i] - F.spec[i]) * Math.min(1, dt * (raw[i] > F.spec[i] ? 40 : 10));
    F.kick *= Math.exp(-dt * 6.5);
    F.snap *= Math.exp(-dt * 9);

    // your guitar: its own level, a hit on each pick, and the note's colour
    const g = F.guitar;
    g.on = !!(rig && rig.on && !rig.muted);
    let lv = 0;
    if (g.on) {
      const l = rig.levels();
      lv = Math.sqrt(Math.max(0, l.output || l.input || 0));
    }
    gPeak = Math.max(lv, gPeak * (1 - dt * 0.15), 0.05);
    const gl = Math.min(1, lv / gPeak);
    const t = now / 1000;
    if (gl > gPrev * 1.35 + 0.12 && t - lastAttack > 0.07) {
      lastAttack = t;
      g.attack = 1;
      F.snap = Math.max(F.snap, 0.7); // your picks hit the pictures like a snare
    }
    gPrev = gl;
    g.level += (gl - g.level) * Math.min(1, dt * 12);
    g.attack *= Math.exp(-dt * 7);
    if (g.on && gl > 0.15 && now - pitchAt > 70) {
      pitchAt = now;
      const p = rig.pitch();
      if (p) {
        g.midi = p.midi;
        g.hue = (((p.midi % 12) + 12) % 12) / 12;
      }
    }

    // the clock: slow drift when quiet, faster with the music and your playing
    F.phase += dt * (0.25 + F.energy * 0.9 + F.kick * 0.8 + g.level * 0.4);
    // what drives the brightness: the song, or your guitar when you play alone
    F.drive = Math.max(F.energy, g.on ? g.level * 0.85 : 0);
    F.events = F.events.filter((e) => now - e.at < 1500);
    return F;
  };

  /** The highway tells us a note landed (or you hit it). */
  F.note = (string, fret, hit, now = performance.now()) => {
    F.events.push({ string, fret, hit, at: now });
    if (F.events.length > 24) F.events.shift();
  };
  return F;
}

/** Rocksmith string colours (low E first), shared with the highway. */
export const STRING_RGB = [
  [1, 0.29, 0.33],
  [1, 0.89, 0.1],
  [0.24, 0.65, 1],
  [1, 0.45, 0.09],
  [0.27, 0.82, 0.49],
  [0.71, 0.49, 1],
];
