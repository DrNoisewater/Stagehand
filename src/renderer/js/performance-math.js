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
  for (const tg of targets) for (const nt of tg.notes) nt.chain = nt.parent = nt._tech = undefined; // (safe to run again)
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
