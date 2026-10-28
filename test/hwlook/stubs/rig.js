export const TONES = [{ id: 'clean', name: 'Clean', kind: 'guitar' }];
class R extends EventTarget { constructor(){super(); this.on = true; this.muted=false; this.knobs={volume:0.7}; this.latencyMs=0; this.sampleRate=48000; this.mode='preset'; this.toneId='clean';}
  samples(){return null} levels(){return {}} prepareTones(){} setSongTone(){} setTone(){} findTone(){return null} dropAmount(){return 0} setSink(){} async start(){return true} setMuted(m){this.muted=m} }
export const rig = new R();
