/**
 * Recording your guitar: the looper (record, overdub, clear; locks to the
 * drum beat when it runs) and takes (Record take in Now playing).
 *
 * What's recorded is the dry guitar from the cable; it's then run through
 * the tone you were playing (the same amp engine, off the live path), so the
 * result sounds like what you heard and the live sound isn't touched.
 */
import { did } from './rewards.js';
import { api } from './api.js';
import { rig } from './rig.js';
import { engine } from './stage.js';
import { drums } from './drums.js';

import { toast } from './ui.js';

/** Collects the dry guitar while it runs. */
export class DiRecorder {
  constructor() {
    this.chunks = [];
    this.n = 0;
    this.on = false;
    this.fn = (d) => {
      if (!this.on) return;
      this.chunks.push(d.slice ? d.slice() : new Float32Array(d));
      this.n += d.length;
    };
  }
  start() {
    this.chunks = [];
    this.n = 0;
    this.on = true;
    rig.addInputTap(this.fn);
  }
  stop() {
    this.on = false;
    rig.removeInputTap(this.fn);
    const out = new Float32Array(this.n);
    let p = 0;
    for (const c of this.chunks) {
      out.set(c, p);
      p += c.length;
    }
    this.chunks = [];
    return out;
  }
  get seconds() {
    return this.n / (rig.sampleRate || 48000);
  }
}

/** Capture the exact processed stereo stream, not an offline approximation. */
export class ProcessedRecorder {
  constructor(){this.on=false;this.n=0;this.chunks=[];this.rate=48000;this.generation=0;}
  async start(){const generation=++this.generation;this.chunks=[];this.n=0;this.on=true;
    const handle=await rig.captureProcessed((d,rate)=>{if(!this.on||generation!==this.generation)return;this.rate=rate;if(this.n<rate*2*180){this.chunks.push(d.slice());this.n+=d.length;}});
    if(generation!==this.generation||!this.on){handle.close();return;}this.handle=handle;this.rate=handle.rate;
  }
  stop(){this.on=false;this.generation++;this.handle?.close();this.handle=null;const L=new Float32Array(this.n/2),R=new Float32Array(this.n/2);let n=0;for(const d of this.chunks)for(let i=0;i<d.length;i+=2){L[n]=d[i];R[n++]=d[i+1];}this.chunks=[];return {L,R,rate:this.rate};}
  get seconds(){return this.n/2/this.rate;}
}
export async function saveTake({name,songId=null,L,R,rate,bpm=null}){
 const pcm=new Float32Array(L.length*2);for(let i=0;i<L.length;i++){pcm[i*2]=L[i];pcm[i*2+1]=R[i];}
 return api.takes.save({name,songId,seconds:L.length/rate,bpm,rate,channels:2,pcm:new Uint8Array(pcm.buffer)});
}
const wait=ms=>new Promise(r=>setTimeout(r,Math.max(0,ms)));
function fit(L,R,n){const a=new Float32Array(n),b=new Float32Array(n);a.set(L.subarray(0,n));b.set(R.subarray(0,n));return {L:a,R:b};}
class Looper extends EventTarget {
 constructor(){super();this.state='empty';this.L=this.R=this.buffer=this.src=this.ctx=this.gain=null;this.rate=48000;this.layers=0;this.bpm=null;this.loopStart=0;this.generation=0;this.rec=new ProcessedRecorder();
  engine.addEventListener('context',()=>{if(this.rec.on||this.state==='armed'||this.state==='overdub'){this.clear();toast({title:'Loop stopped',message:'The audio device changed. Record again on the new device.',kind:'info'});}else if(this.L){this._stopSource();this.ctx=null;this._play();}});
 }
 _set(s){this.state=s;this.dispatchEvent(new Event('change'));}
 get length(){return this.L?this.L.length/this.rate:0;}
 position(){if(!this.src||!this.ctx||!this.length)return null;return Math.max(0,(this.ctx.currentTime-(this.ctx.outputLatency||0)-(engine.extraLatency||0)-this.loopStart)%this.length)/this.length;}
 async _out(){const {ctx,node}=await engine.extraOut();if(this.ctx!==ctx){this.ctx=ctx;this.gain=ctx.createGain();this.gain.gain.value=1;this.gain.connect(node);}return ctx;}
 _stopSource(when){if(this.src){try{this.src.stop(when);}catch{}this.src=null;}}
 async _play(at){const generation=this.generation,ctx=await this._out();if(generation!==this.generation||!this.L)return;const b=ctx.createBuffer(2,this.L.length,this.rate);b.copyToChannel(this.L,0);b.copyToChannel(this.R,1);this.buffer=b;const when=at??ctx.currentTime+.03;this._stopSource(when);const s=ctx.createBufferSource();s.buffer=b;s.loop=true;s.connect(this.gain);s.start(when);this.src=s;if(at===undefined||!this.loopStart)this.loopStart=when;}
 async record(){
  if(!rig.on)return toast({title:'Connect your instrument first',kind:'info'});
  if(this.state==='recording'||this.state==='armed')return this.stopRecording();
  this.clear();const generation=this.generation;const ctx=await this._out();if(generation!==this.generation)return;
  this.bpm=drums.on?drums.bpm:null;drums.tempoLock=this.bpm;
  this.recStartAt=drums.on?drums.nextBarTime(ctx.currentTime+.05):ctx.currentTime;
  this._set('armed');await wait((this.recStartAt-ctx.currentTime)*1000);
  if(generation!==this.generation)return;
  try{await this.rec.start();if(generation===this.generation){this._set('recording');this.limit=setTimeout(()=>this.stopRecording(),180000);}}catch(e){this.clear();toast({title:'Recording failed',message:e.message,kind:'err'});}
 }
 async stopRecording(){
  if(!['recording','armed'].includes(this.state)||this.stopping)return;
  if(this.state==='armed'){this.clear();return;}
  this.stopping=true;clearTimeout(this.limit);const generation=this.generation;
  let bars=null;if(this.bpm&&drums.on){const bar=240/this.bpm;bars=Math.max(1,Math.ceil((this.ctx.currentTime-this.recStartAt)/bar-.1));await wait((this.recStartAt+bars*bar-this.ctx.currentTime)*1000);}
  if(generation!==this.generation)return;
  const data=this.rec.stop();this.stopping=false;this.rate=data.rate;
  if(data.L.length<this.rate*.3){this.clear();return toast({title:'Play a little longer before stopping',kind:'info'});}
  const fixed=bars?fit(data.L,data.R,Math.round(bars*240/this.bpm*this.rate)):data;this.L=fixed.L;this.R=fixed.R;this.layers=1;this.loopStart=0;this._set('busy');
  try{await this._play(this.bpm&&drums.on?drums.nextBarTime(this.ctx.currentTime+.02):undefined);if(generation===this.generation){this._set('playing');did('looper');}}catch(e){this.clear();toast({title:'Loop playback failed',message:e.message,kind:'err'});}
 }
 async overdub(){
  if(this.state!=='playing'||!this.src||!rig.on)return;
  const generation=this.generation,len=this.length,at=this.loopStart+Math.ceil((this.ctx.currentTime+.05-this.loopStart)/len)*len;this._set('overdub');
  await wait((at-this.ctx.currentTime)*1000);if(generation!==this.generation)return;
  try{await this.rec.start();await wait(len*1000);if(generation!==this.generation)return;const data=this.rec.stop();const {L,R}=fit(data.L,data.R,this.L.length);
   let peak=1;for(let i=0;i<L.length;i++){this.L[i]+=L[i];this.R[i]+=R[i];peak=Math.max(peak,Math.abs(this.L[i]),Math.abs(this.R[i]));}
   // Linear attenuation only when the summed overdub needs headroom.
   if(peak>1)for(let i=0;i<L.length;i++){this.L[i]/=peak;this.R[i]/=peak;}
   this.layers++;const next=this.loopStart+Math.ceil((this.ctx.currentTime+.05-this.loopStart)/len)*len;await this._play(next);if(generation===this.generation)this._set('playing');
  }catch(e){this.rec.stop();if(generation===this.generation)this._set('playing');toast({title:'Overdub failed',message:e.message,kind:'err'});}
 }
 clear(){this.generation++;this.stopping=false;clearTimeout(this.limit);drums.tempoLock=null;if(this.rec.on)this.rec.stop();this._stopSource();this.L=this.R=this.buffer=null;this.layers=0;this.loopStart=0;this._set('empty');}
 async saveAsTake(){if(!this.L)return;const t=await saveTake({name:`Loop${this.bpm?' at '+this.bpm+' BPM':''}`,L:this.L,R:this.R,rate:this.rate,bpm:this.bpm});toast({title:'Loop saved to your takes',kind:'ok'});return t;}
}
export const looper=new Looper();
