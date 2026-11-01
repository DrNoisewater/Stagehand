const bridge=()=>import('./api.js').then(m=>m.api);
export function cabinetFor(tone,capture){
  if(capture?.fullRig||tone.autoCab===false)return null;
  const amp=tone.gear?.find(g=>g.slot==='amp')?.key||'';
  if(tone.kind==='bass'||/^Bass_/i.test(amp)){
    const cab=tone.gear?.find(g=>g.slot==='cab')?.key||'';
    if(/Orange/i.test(amp))return 'bass-orange';
    if(/115|B15/i.test(cab))return 'bass-115';
    if(/215|Sunn/i.test(cab))return 'bass-215';
    if(/410/i.test(cab))return 'bass-410';
    return 'bass-810';
  }
  if(/TW|Tweed|Deluxe|Champ|Princeton/i.test(amp))return '1x12_open';
  if(/AT120|Vox|AC30|Twin/i.test(amp))return '2x12_closed';
  if(/Marshall|Plexi|JCM/i.test(amp))return '4x12_slant';
  return '4x12_straight';
}
const cache=new Map();
export function prepareCab(id){if(!cache.has(id))cache.set(id,bridge().then(api=>api.cabs.ensure(id)).catch(e=>{cache.delete(id);throw e;}));return cache.get(id);}
export async function cabSamples(id,rate){
  const bytes=await (await bridge()).cabs.bytes(id),ctx=new OfflineAudioContext(1,1,rate);
  const b=await ctx.decodeAudioData(new Uint8Array(bytes).buffer),out=new Float32Array(Math.min(8192,b.length));
  // Match the native loader's first-channel and energy normalization policy.
  out.set(b.getChannelData(0).subarray(0,out.length));
  const energy=out.reduce((sum,v)=>sum+v*v,0),gain=energy>0?.35/Math.sqrt(energy):1;
  for(let i=0;i<out.length;i++)out[i]*=gain;return out;
}
