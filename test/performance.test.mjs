import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
import {bendValue,scoreHit,linkChains,noteTech,heldBend,drawnBend,vibratoAt} from '../src/renderer/js/performance-math.js';
const require=createRequire(import.meta.url);
const {Stats}=require('../src/main/services/stats.js');
const {ensureCab}=require('../src/main/services/cabinets.js');
const n={t:10,sus:2,bends:[{t:10,step:0},{t:10.5,step:2},{t:11,step:2},{t:12,step:0}]};
assert.equal(bendValue(n,10.25),1);assert.equal(bendValue(n,10.8),2);assert.equal(bendValue(n,11.5),1);assert.equal(bendValue(n,12),0);
assert.equal(bendValue({...n,bends:n.bends.map(p=>({...p,t:p.t-10}))},11.5),1);
// a bend point a hair before the note (rounding) is still song time, not time from the note's start
assert.equal(bendValue({t:10,sus:2,bends:[{t:9.995,step:0},{t:10.5,step:3}]},10.5),3);
// bend + vibrato on one note: both show; a bend on a note held on from it (linkNext) shows on the picked gem
const v1={t:5,s:2,f:14,sus:1,vibrato:true,bends:[{t:5.2,step:3},{t:5.8,step:3}]};
assert.deepEqual(noteTech(v1),{bend:3,release:false,pre:false,vibrato:true,slide:null});
const par={t:20,s:1,f:13,sus:0.5,vibrato:true,linkNext:true},kid={t:20.5,s:1,f:13,sus:1,linked:true,bends:[{t:20.6,step:2},{t:21.2,step:0}]};
const tgs=[{t:20,notes:[par]},{t:20.5,notes:[kid]}];linkChains(tgs);linkChains(tgs);
assert.equal(par.chain.length,1);assert.deepEqual(noteTech(par),{bend:2,release:true,pre:false,vibrato:true,slide:null});
// 4.0.6: a bend picked once, then held on with vibrato and no bend of its own in the chart:
// the held part stays bent and wobbles under the bend (down a quarter step and back), the
// same every time it comes round; a straight note's vibrato goes up a quarter step and back
{
  const up={t:30,s:2,f:14,sus:0.5,linkNext:true,bends:[{t:30,step:0},{t:30.3,step:2}]};
  const held={t:30.5,s:2,f:14,sus:1,linked:true,vibrato:true};
  const ts=[{t:30,notes:[up]},{t:30.5,notes:[held]}];linkChains(ts);
  assert.equal(heldBend(held,30.6),2,'held part keeps the bend');
  const ys=[];for(let k=0;k<=100;k++)ys.push(drawnBend(held,30.5+k/100));
  assert.ok(Math.max(...ys)<=2+1e-9&&Math.min(...ys)>=1.5-1e-9,'wobbles between the bend and a quarter step under it');
  assert.ok(Math.min(...ys)<1.6,'it really wobbles');
  // the bent and the held part join up: no drop at the join
  assert.ok(Math.abs(heldBend(up,30.5)-drawnBend(held,30.5))<1e-9);
  // played again later: the same
  const up2={...up,t:40,bends:[{t:40,step:0},{t:40.3,step:2}]},held2={...held,t:40.5};
  const ts2=[{t:40,notes:[up2]},{t:40.5,notes:[held2]}];linkChains(ts2);
  assert.equal(drawnBend(held2,40.6),drawnBend(held,30.6));
  // a straight note: up to a quarter step and back, never below
  const plain={t:50,s:3,f:7,sus:1,vibrato:true};
  const ps=[];for(let k=0;k<=100;k++)ps.push(drawnBend(plain,50+k/100));
  assert.ok(Math.min(...ps)>=0&&Math.max(...ps)<=0.5+1e-9&&Math.max(...ps)>0.45);
  assert.equal(vibratoAt({...plain,f:0},50.2,0),0,'open strings have no vibrato drawn');
}
assert.equal(noteTech({t:1,s:0,f:7,bends:[{t:1,step:2},{t:1.5,step:0}]}).pre,true);
let r={combo:0,multiplier:1,points:0,bestCombo:0};for(let i=0;i<40;i++)scoreHit(r,true);assert.equal(r.multiplier,4);const before=r.points;scoreHit(r,false);assert.equal(r.points,before);assert.equal(r.multiplier,1);assert.equal(r.combo,0);

const now=new Date(2026,9,29,12).getTime();const st=new Stats('/tmp/unused-stagehand-stat-test');
st.data.sessions=Array.from({length:5},(_,i)=>({songId:'s'+i,notes:100,accuracy:.95,speed:1,at:now,sections:[['Chorus',20,20]]}));
assert.equal(st.goals(now,7)[0].value,5);assert.equal(st.goals(now,7)[1].value,7);assert.equal(st.goals(now,7)[2].value,1);
assert.equal(st.goals(new Date(2026,10,1).getTime(),7)[0].value,0);
st.data.sessions[0].sections=[['Tiny',1,1]];st.data.sessions.slice(1).forEach(x=>x.sections=[]);assert.equal(st.goals(now,0)[2].value,0);
const dir=await fs.mkdtemp(path.join(os.tmpdir(),'stagehand-cabs-'));
let requests=0;const offline=async()=>{requests++;throw Error('offline');};
const [a,b]=await Promise.all([ensureCab(dir,'4x12_slant',offline),ensureCab(dir,'4x12_slant',offline)]);assert.equal(a,b);assert.equal(requests,0);assert.ok((await fs.readFile(a)).subarray(0,4).equals(Buffer.from('RIFF')));
await ensureCab(dir,'4x12_slant',offline);assert.equal(requests,0);
await fs.writeFile(a,'corrupt');await ensureCab(dir,'4x12_slant',offline);assert.equal(requests,0);
await assert.rejects(ensureCab(dir,'../../bad',offline));await fs.rm(dir,{recursive:true});
console.log('PASS bend/release curves, bend+vibrato and held-on bends on the gem, multiplier resets, calendar goals, cabinet integrity/cache/offline recovery');
