import { rig } from './rig.js';
import { hueRGB } from './fluidbg.js';
/** Uses the post-fader song bus, so mute/solo/volume are already respected. */
export function musicEnergy(engine) {
  const song = engine.masterLevel ? engine.masterLevel() : 0;
  const guitar = rig.on && !rig.muted ? (rig.levels().output ?? rig.levels().input ?? 0) : 0;
  return Math.min(1,Math.sqrt(Math.max(0,song+guitar))*1.8);
}
const motion=new WeakMap();
export function audioSplats(engine,t) {
  const e=musicEnergy(engine);if(e<.015)return [];
  const spec=engine.spectrum?.();
  const st=motion.get(engine)||{level:0};const onset=Math.max(0,e-st.level*1.25);st.level=st.level*.65+e*.35;motion.set(engine,st);
  const ranges=[[4,28],[28,160],[160,500]];
  const splats=ranges.map(([lo,hi],i)=>{
    let band=0;if(spec){for(let k=lo;k<Math.min(hi,spec.length);k++)band+=spec[k]/255;band/=hi-lo;}
    const power=e*(.3+band)+onset;
    return {x:.15+i*.33,y:.25+band*.4,dx:Math.cos(t+i)*(300+onset*1800)*power,dy:(350+i*180+onset*1200)*power,radius:.25+power*.75,...hueRGB((i*.22+band*.3+t*.015)%1,power*.2)};
  });
  if(onset>.08)for(let i=0;i<6;i++){const a=i/6*Math.PI*2+t*.2;splats.push({x:.5+Math.cos(a)*.25,y:.48+Math.sin(a)*.24,dx:Math.cos(a)*onset*2200,dy:Math.sin(a)*onset*2200,radius:.3+onset,...hueRGB((t*.04+i/8)%1,onset*.5)});}
  return splats;
}
