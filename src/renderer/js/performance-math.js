/** Deterministic helpers shared by the UI and tests. */
export function bendValue(note, time) {
  const pts = note.bends || [];
  if (!pts.length) return (note.bend || 0) * Math.min(1, Math.max(0, (time-note.t)/Math.max(.08,(note.sus||.3)*.3)));
  // bend times are song times; some charts give them from the note's start. Only the
  // latter can end before the note begins (a point a hair early is just rounding)
  const relative = pts[pts.length-1].t < note.t-.05;
  let t=note.t, v=0;
  for (const p of pts) {
    const next=relative ? note.t+p.t : p.t;
    if(time<=next) return next<=t ? p.step : v+(p.step-v)*Math.max(0,(time-t)/(next-t));
    t=next;v=p.step;
  }
  return v;
}
export function scoreHit(run, hit) {
  run.combo = hit ? run.combo+1 : 0;
  run.multiplier = Math.min(4,1+Math.floor(run.combo/10));
  run.points += hit ? 100*run.multiplier : 0;
  run.bestCombo=Math.max(run.bestCombo,run.combo);
  return run;
}

/** The biggest bend in a note's curve (steps; 2 = a whole tone). */
export function maxBendOf(note) {
  return note.bends && note.bends.length ? Math.max(...note.bends.map((p) => p.step)) : note.bend || 0;
}

/**
 * Links each note held on from the one before (Rocksmith "linkNext": pick once,
 * then bend, slide or shake it) to its parent, so the parent's gem can show
 * everything you'll do while holding it. Sets note.chain = [later notes] on parents.
 * @param {Array<{t:number, notes:object[]}>} targets in time order
 */
export function linkChains(targets) {
  for (const tg of targets) for (const nt of tg.notes) nt.chain = nt.parent = nt._tech = nt._b0 = undefined; // (safe to run again)
  const open = new Map(); // string -> parent still being held
  for (const tg of targets) {
    for (const nt of tg.notes) {
      const par = open.get(nt.s);
      if (nt.linked && par) {
        (par.chain || (par.chain = [])).push(nt);
        nt.parent = par;
        if (!nt.linkNext) open.delete(nt.s);
        continue;
      }
      if (nt.linkNext) open.set(nt.s, nt.parent || nt);
      else open.delete(nt.s);
    }
  }
}

/**
 * Everything a gem should say about how to play it, its held-on notes included:
 * { bend: biggest bend, release: comes back down, pre: already bent when picked,
 *   vibrato, slide: 'up'|'down'|null }.
 */
export function noteTech(note) {
  const all = [note, ...(note.chain || [])];
  let bend = 0;
  let release = false;
  let pre = false;
  for (const n of all) {
    const m = maxBendOf(n);
    if (m > bend) bend = m;
  }
  if (bend > 0) {
    // the whole curve over the held notes, in order
    const pts = [];
    for (const n of all) {
      if (n.bends && n.bends.length) for (const p of n.bends) pts.push(p.step);
      else if (n.bend) pts.push(n.bend);
    }
    const first = note.bends && note.bends.length ? note.bends[0] : null;
    pre = !!first && first.step >= 0.5 && Math.abs(first.t - note.t) < 0.03;
    release = pts.length > 1 && pts[pts.length - 1] <= bend - 0.5;
  }
  const vibrato = all.some((n) => n.vibrato);
  const last = all[all.length - 1];
  const to = last.slideTo !== undefined ? last.slideTo : last.slideUnpitchTo;
  const slide = to === undefined || to === last.f ? null : to > last.f ? 'up' : 'down';
  return { bend, release, pre, vibrato, slide };
}

/**
 * The bend a note starts at. A note held on from the one before (linkNext) starts
 * where that one left off: a bend picked once and then held (often with vibrato on
 * the held part) stays bent, even when the chart doesn't repeat the bend on it.
 */
export function bendStart(note) {
  if (note._b0 !== undefined) return note._b0;
  let v = 0;
  const par = note.parent;
  if (note.linked && par && par.chain) {
    const all = [par, ...par.chain];
    const i = all.indexOf(note);
    const prev = i > 0 ? all[i - 1] : null;
    if (prev) v = heldBend(prev, Math.max(prev.t, note.t - 0.001));
  }
  note._b0 = v;
  return v;
}

/** Like bendValue, but a held-on note carries on from the bend it was left at. */
export function heldBend(note, time) {
  const b0 = note.linked && note.parent ? bendStart(note) : 0;
  const pts = note.bends || [];
  if (!pts.length) {
    if (!note.bend) return b0;
    const k = Math.min(1, Math.max(0, (time - note.t) / Math.max(0.08, (note.sus || 0.3) * 0.3)));
    return b0 + (note.bend - b0) * k;
  }
  const relative = pts[pts.length - 1].t < note.t - 0.05;
  let t = note.t;
  let v = b0;
  for (const p of pts) {
    const next = relative ? note.t + p.t : p.t;
    if (time <= next) return next <= t ? p.step : v + (p.step - v) * Math.max(0, (time - t) / (next - t));
    t = next;
    v = p.step;
  }
  return v;
}

/**
 * Vibrato as what it is: the pitch going up and down a little, about 5.5 times a
 * second, in steps (1 = a half step). On a straight note it bends up to a quarter
 * step and back; on a bent note it eases back down from the bend and up again, so a
 * bend with vibrato reads as one bend that wobbles, never as a sideways squiggle.
 */
export const VIBRATO_HZ = 5.5;
export function vibratoAt(note, time, bend) {
  if (!note.vibrato || note.f === 0) return 0;
  const age = time - note.t;
  if (age <= 0) return 0;
  const k = Math.min(1, age / 0.12); // eases in after the pick
  const w = (1 - Math.cos(age * Math.PI * 2 * VIBRATO_HZ)) / 2; // 0..1..0
  return (bend >= 0.75 ? -0.5 : 0.5) * w * k;
}

/** The pitch bend drawn for a note at a time: its (held) bend plus its vibrato. */
export function drawnBend(note, time) {
  const b = heldBend(note, time);
  return b + vibratoAt(note, time, b);
}
