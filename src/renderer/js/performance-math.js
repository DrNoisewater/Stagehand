/** Deterministic helpers shared by the UI and tests. */
export function bendValue(note, time) {
  const pts = note.bends || [];
  if (!pts.length) return (note.bend || 0) * Math.min(1, Math.max(0, (time-note.t)/Math.max(.08,(note.sus||.3)*.3)));
  const relative = pts[0].t < note.t-.01;
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
