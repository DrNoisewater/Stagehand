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
export function matchDelta(reference, played) {
  const total=a=>a.reduce((s,x)=>s+x,0);
  const r=total(reference),p=total(played);
  if(r<1e-10||p<1e-10) return null;
  return reference.map((v,i)=>Math.max(-.15,Math.min(.15,10*Math.log10((v/r+1e-8)/(played[i]/p+1e-8))/40)));
}
