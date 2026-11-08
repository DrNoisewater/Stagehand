export const TONES = [{ id: 'clean', name: 'Clean', kind: 'guitar' }];
class R extends EventTarget { constructor(){super(); this.on = true; this.muted=false; this.knobs={volume:0.7}; this.latencyMs=0; this.sampleRate=48000; this.mode='preset'; this.toneId='clean'; this.drop={on:false,st:2,match:false};}
  setDrop(p){Object.assign(this.drop,p||{});this.dispatchEvent(new Event('drop'))} setSongTuning(){}
  samples(){return null} levels(){return {}} prepareTones(){} setSongTone(){} setTone(){} findTone(){return null} dropAmount(){return 0} setSink(){} async start(){return true} setMuted(m){this.muted=m} }
export const rig = new R();

export const TUNINGS=[{id:"e-std",name:"E Standard",o:[0,0,0,0,0,0]}];
export const noteName=m=>["C","C♯","D","D♯","E","F","F♯","G","G♯","A","A♯","B"][m%12];
rig.pitch=()=>null;
export const P = { input: 0, volume: 1, gain: 2, bass: 3, mid: 4, treble: 5, fx: 6, gate: 7, bypass: 8, drop: 9, room: 10 };
export function openStrings(tab) { const bass = tab && tab.type === 'bass'; const base = bass ? [28, 33, 38, 43] : [40, 45, 50, 55, 59, 64]; const tun = (tab && tab.tuning) || []; const capo = (tab && tab.capo) || 0; return base.map((m, i) => m + (Number(tun[i]) || 0) + capo); }
