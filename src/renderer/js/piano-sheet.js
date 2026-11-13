/**
 * Piano: the sheet music. Turns the piano part (notes on the song's grid of
 * sixteenths) into written music, bar by bar, and draws it as a grand staff
 * that scrolls past a playhead: treble clef for the right hand, bass clef for
 * the left, the key signature, bars, note values, dots, ties, beams, rests,
 * accidentals, chord names above and the words under the tune.
 *
 * notate() is the writing (no drawing, tested on its own); createSheet() draws.
 */
import { TPB, spell, keyAccidentals } from './piano-arrange.js';

// ------------------------------------------------------------ writing --
/** Note values in steps (sixteenths): whole, dotted half, half, dotted quarter, quarter, dotted eighth, eighth, sixteenth. */
const VALUES = [
  [16, 'w', 0],
  [12, 'h', 1],
  [8, 'h', 0],
  [6, 'q', 1],
  [4, 'q', 0],
  [3, 'e', 1],
  [2, 'e', 0],
  [1, 's', 0],
];

/**
 * Splits a stretch (start p within the bar, length n steps) into note values
 * that read well: nothing longer than a beat starts off the beat, an eighth
 * starts on an eighth, nothing crosses the middle of a 4/4 bar except a
 * whole bar's note. Returns [[steps, value, dots]].
 */
export function splitValues(p, n, barLen, rest = false) {
  const out = [];
  while (n > 0) {
    let pick = null;
    for (const v of VALUES) {
      const [len, , dots] = v;
      if (len > n) continue;
      if (rest && dots) continue; // rests are written plain
      if (len === 16 && !(p === 0 && barLen === 16)) continue;
      if (len > TPB && p % TPB) continue; // longer than a beat: on a beat
      if (len === TPB * 2 && barLen === 16 && p % 8) continue; // a half note on beat 1 or 3 in 4/4
      if (len === 12 && (barLen !== 16 || p !== 0) && !(barLen === 12 && p === 0)) continue;
      if (len >= 2 && len <= TPB && p % Math.min(len, 2) && len !== 3) continue; // an eighth on an eighth
      if (len === 3 && p % TPB) continue; // a dotted eighth starts the beat
      if (len === 6 && (p % TPB || (n !== 6 && p % (TPB * 2)))) continue; // a dotted quarter: from beat 1 or 3, or when that's exactly what's left
      if (len <= TPB && Math.floor(p / TPB) !== Math.floor((p + len - 1) / TPB)) continue; // no crossing a beat
      pick = v;
      break;
    }
    if (!pick) pick = VALUES[VALUES.length - 1];
    out.push(pick);
    p += pick[0];
    n -= pick[0];
  }
  return out;
}

/**
 * The written music for one hand: [{ k0, k1, beats, items }] per bar, where an
 * item is { k, len, value, dots, rest, keys: [{ midi, step, acc, show, tie }],
 * beam (group id or -1), up (stem up), word, src (the notes it came from) }.
 */
export function notate(notes, grid, fifths = 0, { clefMid = 34 } = {}) {
  const keySig = keyAccidentals(fifths);
  const bars = grid.bars.map((b) => ({ k0: b.k0, k1: b.k1, beats: b.beats, items: [] }));
  if (!bars.length) return bars;
  // the notes of each bar, split at bar lines (tied over)
  const inBar = bars.map(() => []);
  for (const n of notes) {
    let k = n.k;
    let left = n.len;
    let first = true;
    while (left > 0) {
      const bi = grid.barAt(k);
      const bar = bars[bi];
      if (!bar) break;
      const end = Math.min(bar.k1, k + left);
      if (end <= k) break;
      inBar[bi].push({ k, len: end - k, midi: n.midi, tie: end < k + left, word: first ? n.word : undefined, src: n });
      left -= end - k;
      k = end;
      first = false;
    }
  }
  let beamId = 0;
  bars.forEach((bar, bi) => {
    const barLen = bar.k1 - bar.k0;
    const list = inBar[bi].sort((a, b) => a.k - b.k || a.midi - b.midi);
    // chords: notes that start together
    const groups = [];
    for (const n of list) {
      const g = groups[groups.length - 1];
      if (g && g.k === n.k) g.notes.push(n);
      else groups.push({ k: n.k, notes: [n] });
    }
    const alter = new Map(); // step → alteration in force in this bar
    let at = bar.k0;
    const pushRest = (from, to) => {
      if (to <= from) return;
      if (from === bar.k0 && to === bar.k1) {
        bar.items.push({ k: from, len: to - from, value: 'w', dots: 0, rest: true, whole: true, keys: [] });
        return;
      }
      let p = from - bar.k0;
      for (const [len, value] of splitValues(p, to - from, barLen, true)) {
        bar.items.push({ k: bar.k0 + p, len, value, dots: 0, rest: true, keys: [] });
        p += len;
      }
    };
    groups.forEach((g, gi) => {
      const next = gi + 1 < groups.length ? groups[gi + 1].k : bar.k1;
      pushRest(at, g.k);
      const longest = Math.max(...g.notes.map((n) => n.len));
      const len = Math.max(1, Math.min(longest, next - g.k));
      // a note cut short by the next one isn't tied on
      const tieOn = g.notes.some((n) => n.tie) && longest <= next - g.k;
      const pieces = splitValues(g.k - bar.k0, len, barLen);
      let p = g.k;
      pieces.forEach(([plen, value, dots], pi) => {
        const last = pi === pieces.length - 1;
        const keys = g.notes.map((n) => {
          const sp = spell(n.midi, fifths);
          // an accidental is written when the note differs from the key or from earlier in the bar
          const now = alter.has(sp.step) ? alter.get(sp.step) : keySig[sp.letter];
          const show = pi === 0 && now !== sp.acc ? sp.acc : null;
          if (pi === 0) alter.set(sp.step, sp.acc);
          return { midi: n.midi, step: sp.step, acc: sp.acc, show, tie: !last || (tieOn && n.tie) };
        });
        // no doubled keys in one chord
        const seen = new Set();
        const uniq = keys.filter((x) => (seen.has(x.step) ? false : seen.add(x.step)));
        bar.items.push({ k: p, len: plen, value, dots, rest: false, keys: uniq, word: pi === 0 ? g.notes.find((n) => n.word)?.word : undefined, src: g.notes.map((n) => n.src) });
        p += plen;
      });
      at = g.k + len;
    });
    pushRest(at, bar.k1);
    // beams: eighths and sixteenths together within a beat
    let run = [];
    const flush = () => {
      if (run.length >= 2) {
        beamId++;
        for (const it of run) it.beam = beamId;
      }
      run = [];
    };
    for (const it of bar.items) {
      it.beam = -1;
      const short = !it.rest && (it.value === 'e' || it.value === 's');
      const beat = Math.floor((it.k - bar.k0) / TPB);
      if (!short) {
        flush();
        continue;
      }
      if (run.length && Math.floor((run[0].k - bar.k0) / TPB) !== beat) flush();
      run.push(it);
    }
    flush();
    // stems: up when the notes sit low on the staff (a beamed group decides together)
    const mid = (it) => it.keys.reduce((a, x) => a + x.step, 0) / Math.max(1, it.keys.length);
    const byBeam = new Map();
    for (const it of bar.items) {
      if (it.rest) continue;
      if (it.beam >= 0) {
        if (!byBeam.has(it.beam)) byBeam.set(it.beam, []);
        byBeam.get(it.beam).push(it);
      } else it.up = mid(it) < clefMid;
    }
    for (const g of byBeam.values()) {
      const m = g.reduce((a, it) => a + mid(it), 0) / g.length;
      for (const it of g) it.up = m < clefMid;
    }
  });
  return bars;
}

// ------------------------------------------------------------ drawing --
const INK = '#efe6d2';
const INK_DIM = 'rgba(239, 230, 210, 0.45)';
const LINE = 'rgba(239, 230, 210, 0.55)';
/** Staff positions: the bottom line of each staff as a diatonic step (C4 = 28). */
const TREBLE_BOTTOM = 30; // E4
const BASS_BOTTOM = 18; // G2

// The clefs, drawn as paths in staff spaces (y up, 0 = bottom line)
function trebleClef(g, x, yb, s) {
  // y up in staff spaces from the bottom line; the curl sits on the G line (1)
  const P = (px, py) => [x + px * s, yb - py * s];
  g.save();
  g.lineCap = 'round';
  g.lineJoin = 'round';
  g.beginPath();
  let [a, b] = P(0.62, 1.95);
  g.moveTo(a, b);
  const c = (x1, y1, x2, y2, x3, y3) => {
    const p1 = P(x1, y1);
    const p2 = P(x2, y2);
    const p3 = P(x3, y3);
    g.bezierCurveTo(p1[0], p1[1], p2[0], p2[1], p3[0], p3[1]);
  };
  // the curl round the G line, opening into the big loop
  c(0.2, 2.1, -0.1, 1.5, 0.15, 1.05);
  c(0.4, 0.7, 1.05, 0.75, 1.1, 1.3);
  c(1.15, 2.0, 0.45, 2.45, -0.05, 2.15);
  c(-0.75, 1.75, -0.6, 0.3, 0.2, -0.1);
  c(1.0, -0.45, 1.6, 0.6, 1.45, 1.55);
  c(1.3, 2.6, 0.55, 3.2, 0.45, 4.3);
  // up to the top loop and down the stem
  c(0.4, 5.0, 0.9, 5.6, 1.05, 5.2);
  c(1.2, 4.7, 0.8, 4.0, 0.55, 3.7);
  c(0.35, 3.4, 0.6, 0.2, 0.75, -1.4);
  // the hook at the bottom
  c(0.8, -2.0, 0.3, -2.25, 0.0, -2.0);
  g.lineWidth = s * 0.2;
  g.stroke();
  [a, b] = P(0.08, -1.75);
  g.beginPath();
  g.arc(a, b, s * 0.32, 0, Math.PI * 2);
  g.fill();
  g.restore();
}
function bassClef(g, x, yb, s) {
  const P = (px, py) => [x + px * s, yb - py * s];
  g.save();
  g.lineCap = 'round';
  let [a, b] = P(0.2, 3);
  g.beginPath();
  g.arc(a, b, s * 0.36, 0, Math.PI * 2);
  g.fill();
  g.beginPath();
  g.moveTo(...P(-0.1, 3.05));
  const c = (x1, y1, x2, y2, x3, y3) => {
    const p1 = P(x1, y1);
    const p2 = P(x2, y2);
    const p3 = P(x3, y3);
    g.bezierCurveTo(p1[0], p1[1], p2[0], p2[1], p3[0], p3[1]);
  };
  c(0.0, 4.1, 1.75, 4.25, 1.85, 3.0);
  c(1.95, 1.7, 1.0, 0.7, -0.1, 0.05);
  g.lineWidth = s * 0.24;
  g.stroke();
  for (const y of [3.5, 2.5]) {
    [a, b] = P(2.4, y);
    g.beginPath();
    g.arc(a, b, s * 0.17, 0, Math.PI * 2);
    g.fill();
  }
  g.restore();
}

function sharp(g, x, y, s) {
  g.save();
  g.lineWidth = s * 0.12;
  g.beginPath();
  g.moveTo(x - s * 0.18, y - s * 1.3);
  g.lineTo(x - s * 0.18, y + s * 1.4);
  g.moveTo(x + s * 0.18, y - s * 1.4);
  g.lineTo(x + s * 0.18, y + s * 1.3);
  g.stroke();
  g.lineWidth = s * 0.3;
  g.beginPath();
  g.moveTo(x - s * 0.45, y - s * 0.3);
  g.lineTo(x + s * 0.45, y - s * 0.55);
  g.moveTo(x - s * 0.45, y + s * 0.55);
  g.lineTo(x + s * 0.45, y + s * 0.3);
  g.stroke();
  g.restore();
}
function flat(g, x, y, s) {
  g.save();
  g.lineWidth = s * 0.13;
  g.beginPath();
  g.moveTo(x - s * 0.3, y - s * 1.9);
  g.lineTo(x - s * 0.3, y + s * 0.5);
  g.bezierCurveTo(x + s * 0.2, y + s * 0.1, x + s * 0.7, y - s * 0.4, x + s * 0.25, y - s * 0.55);
  g.bezierCurveTo(x, y - s * 0.62, x - s * 0.2, y - s * 0.3, x - s * 0.3, y - s * 0.2);
  g.stroke();
  g.restore();
}
function natural(g, x, y, s) {
  g.save();
  g.lineWidth = s * 0.12;
  g.beginPath();
  g.moveTo(x - s * 0.25, y - s * 1.35);
  g.lineTo(x - s * 0.25, y + s * 0.6);
  g.moveTo(x + s * 0.25, y + s * 1.35);
  g.lineTo(x + s * 0.25, y - s * 0.6);
  g.stroke();
  g.lineWidth = s * 0.28;
  g.beginPath();
  g.moveTo(x - s * 0.25, y - s * 0.35);
  g.lineTo(x + s * 0.25, y - s * 0.6);
  g.moveTo(x - s * 0.25, y + s * 0.6);
  g.lineTo(x + s * 0.25, y + s * 0.35);
  g.stroke();
  g.restore();
}
const ACC = { 1: sharp, '-1': flat, 0: natural };

function rest(g, it, x, top, s) {
  // top: the staff's top line
  g.save();
  if (it.value === 'w') g.fillRect(x - s * 0.6, top + s, s * 1.2, s * 0.5); // hangs from the 4th line
  else if (it.value === 'h') g.fillRect(x - s * 0.6, top + s * 1.5, s * 1.2, s * 0.5); // sits on the middle line
  else if (it.value === 'q') {
    g.lineWidth = s * 0.28;
    g.lineJoin = 'miter';
    g.beginPath();
    g.moveTo(x - s * 0.25, top + s * 0.6);
    g.lineTo(x + s * 0.35, top + s * 1.4);
    g.lineTo(x - s * 0.15, top + s * 2.0);
    g.lineTo(x + s * 0.35, top + s * 2.75);
    g.stroke();
    g.lineWidth = s * 0.22;
    g.beginPath();
    g.moveTo(x + s * 0.35, top + s * 2.75);
    g.bezierCurveTo(x - s * 0.2, top + s * 2.5, x - s * 0.45, top + s * 3.1, x + s * 0.05, top + s * 3.5);
    g.stroke();
  } else {
    const flags = it.value === 's' ? 2 : 1;
    g.lineWidth = s * 0.14;
    for (let i = 0; i < flags; i++) {
      const y = top + s * (1.4 + i);
      g.beginPath();
      g.arc(x - s * 0.15, y, s * 0.24, 0, Math.PI * 2);
      g.fill();
      g.beginPath();
      g.moveTo(x - s * 0.15, y + s * 0.15);
      g.quadraticCurveTo(x + s * 0.2, y + s * 0.15, x + s * 0.45, y - s * 0.35);
      g.stroke();
    }
    g.beginPath();
    g.moveTo(x + s * 0.45, top + s * 1.05);
    g.lineTo(x - s * 0.1, top + s * (2.9 + (flags - 1)));
    g.stroke();
  }
  g.restore();
}

/**
 * The sheet music on a canvas. sheet.draw(t, opts) each frame; sheet.set(...)
 * when the part changes. Colours: the hands' own colours for notes being
 * played now, ink for the rest.
 */
export function createSheet(canvas) {
  const g = canvas.getContext('2d');
  const S = { bars: { R: [], L: [] }, chords: [], grid: null, key: null, pps: 160, judgeOf: null };

  function set({ notes, grid, key, chords, feel, words }) {
    S.grid = grid;
    S.words = words || []; // words with no notes of their own (shown under the treble on their own)
    S.feel = feel || 'straight';
    S.key = key;
    S.chords = (chords || []).filter((c) => c.len >= TPB);
    S.bars = { R: notate(notes.filter((n) => n.hand === 'R'), grid, key.fifths, { clefMid: 34 }), L: notate(notes.filter((n) => n.hand === 'L'), grid, key.fifths, { clefMid: 22 }) };
    // how wide a sixteenth is: wide enough to read at this song's tempo
    const beats = [];
    for (let i = 0; i < Math.min(grid.bars.length, 200); i++) {
      const b = grid.bars[i];
      beats.push((grid.timeOf(b.k1) - grid.timeOf(b.k0)) / Math.max(1, b.beats));
    }
    beats.sort((a, b) => a - b);
    const beat = beats.length ? beats[Math.floor(beats.length / 2)] : 0.5;
    S.pps = Math.max(110, Math.min(340, 30 / (beat / TPB)));
    S.index = new Map(notes.map((n, i) => [n, i]));
  }

  /** Draws the grand staff at song time t. state(i) → 'hit' | 'miss' | null for note i; now(n) → being played. */
  function draw(t, { W, H, colors, state = () => null }) {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    if (canvas.width !== Math.round(W * dpr) || canvas.height !== Math.round(H * dpr)) {
      canvas.width = Math.round(W * dpr);
      canvas.height = Math.round(H * dpr);
    }
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, W, H);
    if (!S.grid) return;
    const s = Math.max(6, Math.min(10.5, H / 27)); // a staff space
    // the grand staff, centred: chord names above, room for ledger lines below
    const trebleTop = Math.round((H - 16 * s) / 2 + 3.2 * s);
    const trebleBot = trebleTop + 4 * s;
    const bassTop = trebleBot + s * 8; // room between the staves for the words and notes under the tune
    const bassBot = bassTop + 4 * s;
    const fifths = S.key.fifths;
    const ks = Math.abs(fifths);
    const head = Math.round(s * 4.2 + ks * s * 1.05 + s * 4.2); // clef, key, time, room
    const playX = head + Math.round((W - head) * 0.18);
    const X = (time) => playX + (time - t) * S.pps;
    const tAt = (k) => S.grid.timeOf(k);
    const yOf = (step, bottomStep, bottomY) => bottomY - ((step - bottomStep) * s) / 2;
    /** A time signature (beats over 4) on both staves at x. */
    const timeSig = (x, beats) => {
      g.save();
      g.fillStyle = INK;
      g.font = `900 ${Math.round(s * 2.3)}px 'DejaVu Serif', Georgia, 'Times New Roman', serif`;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      for (const top of [trebleTop, bassTop]) {
        g.fillText(String(beats), x, top + s * 1.02);
        g.fillText('4', x, top + s * 3.02);
      }
      g.restore();
    };

    // the staves
    g.strokeStyle = LINE;
    g.lineWidth = 1;
    for (const top of [trebleTop, bassTop]) {
      for (let i = 0; i < 5; i++) {
        const y = Math.round(top + i * s) + 0.5;
        g.beginPath();
        g.moveTo(8, y);
        g.lineTo(W - 8, y);
        g.stroke();
      }
    }

    // the music, clipped to the right of the header
    g.save();
    g.beginPath();
    g.rect(head - 4, 0, W - head + 4, H);
    g.clip();
    const tFrom = t - (playX - head) / S.pps - 0.5;
    const tTo = t + (W - playX) / S.pps + 0.5;
    // bar lines and numbers
    const bars = S.grid.bars;
    g.font = `600 ${Math.round(s * 1.05)}px 'Archivo', 'Segoe UI', sans-serif`;
    for (let bi = 0; bi < bars.length; bi++) {
      const t0 = tAt(bars[bi].k0);
      if (t0 > tTo) break;
      if (t0 < tFrom - 4) continue;
      const x = Math.round(X(t0) - s * 0.9) + 0.5;
      g.strokeStyle = LINE;
      g.lineWidth = 1.2;
      g.beginPath();
      g.moveTo(x, trebleTop);
      g.lineTo(x, bassBot);
      g.stroke();
      g.fillStyle = INK_DIM;
      g.fillText(String(bi + 1), x + 3, trebleTop - s * 0.8);
      // a change of time signature is written where it happens
      if (bi > 0 && bars[bi].beats !== bars[bi - 1].beats && bi < bars.length - 1) {
        timeSig(x + s * 0.9, bars[bi].beats);
        g.font = `600 ${Math.round(s * 1.05)}px 'Archivo', 'Segoe UI', sans-serif`;
      }
    }
    // chord names above the treble
    g.font = `800 ${Math.round(s * 1.7)}px 'Archivo', 'Segoe UI', sans-serif`;
    g.fillStyle = '#f1ce68';
    for (const c of S.chords) {
      const x = X(c.t);
      if (x < head - 80 || x > W + 20) continue;
      g.fillText(c.name, x - s * 0.5, trebleTop - s * 2.4);
    }
    // words that have no notes of their own sit under the treble at their time
    if (S.words.length) {
      g.font = `600 ${Math.round(s * 1.35)}px 'Archivo', 'Segoe UI', sans-serif`;
      let right = -Infinity;
      for (const w of S.words) {
        const x = X(tAt(w.k));
        if (x > W + 10) break;
        if (x < head - 120) continue;
        const wx = Math.max(x, right + 6);
        g.fillStyle = t >= tAt(w.k) && t < tAt(w.k) + 0.4 ? '#f1ce68' : 'rgba(239, 230, 210, 0.8)';
        g.fillText(w.text, wx, trebleBot + s * 4.7);
        right = wx + g.measureText(w.text).width;
      }
    }
    // the notes
    for (const [hand, bottomStep, top, bottom] of [['R', TREBLE_BOTTOM, trebleTop, trebleBot], ['L', BASS_BOTTOM, bassTop, bassBot]]) {
      const list = S.bars[hand];
      const col = colors[hand];
      const stemTips = new Map(); // beam → [{x, y, up, value}]
      for (const bar of list) {
        const tb0 = tAt(bar.k0);
        const tb1 = tAt(bar.k1);
        if (tb1 < tFrom || tb0 > tTo) continue;
        for (const it of bar.items) {
          const x = X(tAt(it.k));
          if (it.rest) {
            g.fillStyle = INK_DIM;
            g.strokeStyle = INK_DIM;
            rest(g, it, it.whole ? X((tb0 + tb1) / 2) : x, top, s);
            continue;
          }
          // what's being played, played right, or missed
          const idx = it.src.map((n) => S.index.get(n));
          const st = idx.map((i) => state(i));
          const sounding = t >= tAt(it.k) - 0.02 && t < tAt(it.k + it.len);
          const hit = st.some((v) => v === 'hit');
          const color = sounding ? col : hit ? col : st.every((v) => v === 'miss') ? 'rgba(239, 230, 210, 0.35)' : INK;
          g.fillStyle = color;
          g.strokeStyle = color;
          if (sounding) {
            g.shadowColor = col;
            g.shadowBlur = 12;
          }
          const ys = it.keys.map((k) => yOf(k.step, bottomStep, bottom));
          const hw = s * 0.62;
          // ledger lines
          g.lineWidth = 1.2;
          for (const k of it.keys) {
            const off = k.step - bottomStep;
            for (let l = -2; l >= off; l -= 2) {
              const y = Math.round(bottom - (l * s) / 2) + 0.5;
              g.beginPath();
              g.moveTo(x - hw * 1.7, y);
              g.lineTo(x + hw * 1.7, y);
              g.stroke();
            }
            for (let l = 10; l <= off; l += 2) {
              const y = Math.round(bottom - (l * s) / 2) + 0.5;
              g.beginPath();
              g.moveTo(x - hw * 1.7, y);
              g.lineTo(x + hw * 1.7, y);
              g.stroke();
            }
          }
          // heads: neighbours a step apart sit either side of the stem
          const order = it.keys.map((k, i) => ({ k, y: ys[i] })).sort((a, b) => a.k.step - b.k.step);
          let prevStep = -99;
          let flip = false;
          for (const o of order) {
            flip = o.k.step - prevStep === 1 ? !flip : false;
            prevStep = o.k.step;
            const hx = x + (flip ? (it.up ? hw * 2 : -hw * 2) : 0);
            g.beginPath();
            g.ellipse(hx, o.y, hw, s * 0.44, -0.35, 0, Math.PI * 2);
            if (it.value === 'w' || it.value === 'h') {
              g.lineWidth = s * 0.2;
              g.stroke();
            } else g.fill();
            if (it.dots) {
              const dy = (o.k.step - bottomStep) % 2 === 0 ? -s / 2 : 0; // a dot on a line moves up into the space
              g.beginPath();
              g.arc(hx + hw * 1.9, o.y + dy, s * 0.15, 0, Math.PI * 2);
              g.fill();
            }
            if (o.k.show !== null && o.k.show !== undefined) ACC[String(o.k.show)](g, x - hw * 2.4, o.y, s * 0.8);
            if (o.k.tie) {
              g.lineWidth = s * 0.14;
              g.beginPath();
              const tx0 = hx + hw;
              const tx1 = X(tAt(it.k + it.len)) - hw;
              const dir = it.up ? 1 : -1;
              g.moveTo(tx0, o.y + dir * s * 0.5);
              g.quadraticCurveTo((tx0 + tx1) / 2, o.y + dir * s * 1.4, tx1, o.y + dir * s * 0.5);
              g.stroke();
            }
          }
          g.shadowBlur = 0;
          // stems, flags (beams are drawn after the bar's notes)
          if (it.value !== 'w') {
            const lo = Math.max(...ys);
            const hi = Math.min(...ys);
            const sx = it.up ? x + hw * 0.92 : x - hw * 0.92;
            const tip = it.up ? hi - s * 3.4 : lo + s * 3.4;
            g.lineWidth = Math.max(1.2, s * 0.12);
            g.beginPath();
            g.moveTo(sx, it.up ? lo : hi);
            g.lineTo(sx, tip);
            g.stroke();
            if (it.beam >= 0) {
              if (!stemTips.has(it.beam)) stemTips.set(it.beam, []);
              stemTips.get(it.beam).push({ x: sx, tip, up: it.up, value: it.value, color, base: it.up ? lo : hi });
            } else if (it.value === 'e' || it.value === 's') {
              for (let f = 0; f < (it.value === 's' ? 2 : 1); f++) {
                const fy = tip + (it.up ? 1 : -1) * f * s * 0.9;
                g.lineWidth = s * 0.22;
                g.beginPath();
                g.moveTo(sx, fy);
                g.bezierCurveTo(sx + s * 0.2, fy + (it.up ? 1 : -1) * s * 1.1, sx + s * 1.3, fy + (it.up ? 1 : -1) * s * 1.4, sx + s * 0.9, fy + (it.up ? 1 : -1) * s * 2.6);
                g.stroke();
              }
            }
          }
          // the words, under the tune
          if (it.word && hand === 'R') {
            g.font = `600 ${Math.round(s * 1.35)}px 'Archivo', 'Segoe UI', sans-serif`;
            g.fillStyle = sounding ? col : 'rgba(239, 230, 210, 0.8)';
            g.fillText(it.word, x - hw, trebleBot + s * 4.7);
          }
        }
      }
      // beams: a straight beam from the first stem to the last, at the outermost tip
      for (const tips of stemTips.values()) {
        const up = tips[0].up;
        const y = up ? Math.min(...tips.map((p) => p.tip)) : Math.max(...tips.map((p) => p.tip));
        g.fillStyle = tips[0].color;
        g.strokeStyle = tips[0].color;
        const bw = s * 0.48;
        const x0 = tips[0].x;
        const x1 = tips[tips.length - 1].x;
        g.fillRect(Math.min(x0, x1), up ? y : y - bw, Math.abs(x1 - x0) + 1, bw);
        // the stems reach the beam
        g.lineWidth = Math.max(1.2, s * 0.12);
        for (const p of tips) {
          g.beginPath();
          g.moveTo(p.x, p.tip);
          g.lineTo(p.x, y + (up ? bw / 2 : -bw / 2));
          g.stroke();
        }
        // a second beam over neighbouring sixteenths
        for (let i = 0; i < tips.length; i++) {
          if (tips[i].value !== 's') continue;
          const nb = tips[i + 1] && tips[i + 1].value === 's' ? tips[i + 1] : null;
          const y2 = up ? y + bw * 1.6 : y - bw * 2.6;
          if (nb) g.fillRect(tips[i].x, y2, nb.x - tips[i].x + 1, bw);
          else if (!(tips[i - 1] && tips[i - 1].value === 's')) g.fillRect(i ? tips[i].x - s : tips[i].x, y2, s, bw);
        }
      }
    }
    g.restore();

    // the playhead
    const ph = g.createLinearGradient(playX - 14, 0, playX + 14, 0);
    ph.addColorStop(0, 'rgba(241, 206, 104, 0)');
    ph.addColorStop(0.5, 'rgba(241, 206, 104, 0.16)');
    ph.addColorStop(1, 'rgba(241, 206, 104, 0)');
    g.fillStyle = ph;
    g.fillRect(playX - 14, trebleTop - s * 2, 28, bassBot - trebleTop + s * 4);
    g.fillStyle = 'rgba(241, 206, 104, 0.7)';
    g.fillRect(playX - 0.75, trebleTop - s * 1.5, 1.5, bassBot - trebleTop + s * 3);

    // the header: brace, clefs, key signature (it stays while the music moves)
    g.fillStyle = INK;
    g.strokeStyle = INK;
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(8.5, trebleTop);
    g.lineTo(8.5, bassBot);
    g.stroke();
    g.lineWidth = 3;
    g.beginPath();
    g.moveTo(4, trebleTop - 2);
    g.bezierCurveTo(-4, (trebleTop + bassBot) / 2 - 10, 6, (trebleTop + bassBot) / 2 - 4, -2, (trebleTop + bassBot) / 2);
    g.bezierCurveTo(6, (trebleTop + bassBot) / 2 + 4, -4, (trebleTop + bassBot) / 2 + 10, 4, bassBot + 2);
    g.stroke();
    trebleClef(g, 12 + s * 0.8, trebleBot, s);
    bassClef(g, 12 + s * 0.6, bassBot, s);
    const sharps = [[38, 24], [35, 21], [39, 25], [36, 22], [33, 19], [37, 23], [34, 20]]; // F C G D A E B (treble, bass steps)
    const flats = [[34, 20], [37, 23], [33, 19], [36, 22], [32, 18], [35, 21], [31, 17]]; // B E A D G C F
    for (let i = 0; i < ks; i++) {
      const [tr, bs] = (fifths > 0 ? sharps : flats)[i];
      const x = 12 + s * 4.3 + i * s * 1.05;
      (fifths > 0 ? sharp : flat)(g, x, yOf(tr, TREBLE_BOTTOM, trebleBot), s * 0.8);
      (fifths > 0 ? sharp : flat)(g, x, yOf(bs, BASS_BOTTOM, bassBot), s * 0.8);
    }
    // the time signature of the bar under the playhead, and the feel
    const here = S.grid.bars[S.grid.barAt(Math.max(0, Math.floor(S.grid.stepOf(t))))] || S.grid.bars[0];
    const mainBeats = (S.grid.bars[1] || here).beats;
    timeSig(12 + s * 4.3 + ks * s * 1.05 + s * 1.2, here && !here.pickup ? here.beats : mainBeats);
    if (S.feel === 'swing') {
      g.save();
      g.fillStyle = INK;
      g.font = `italic 700 ${Math.round(s * 1.35)}px 'DejaVu Serif', Georgia, serif`;
      g.fillText('Swing', head + 6, trebleTop - s * 2.6);
      g.restore();
    }
    // a soft edge where the music slides under the header
    const fade = g.createLinearGradient(head - 4, 0, head + 30, 0);
    fade.addColorStop(0, 'rgba(14, 12, 10, 0.95)');
    fade.addColorStop(1, 'rgba(14, 12, 10, 0)');
    g.fillStyle = fade;
    g.fillRect(head - 4, trebleTop - s * 4, 34, bassBot - trebleTop + s * 8);
    g.strokeStyle = LINE;
    g.lineWidth = 1;
    for (const top of [trebleTop, bassTop]) {
      for (let i = 0; i < 5; i++) {
        const y = Math.round(top + i * s) + 0.5;
        g.beginPath();
        g.moveTo(head - 4, y);
        g.lineTo(head + 30, y);
        g.stroke();
      }
    }
  }

  return { set, draw, state: S };
}
