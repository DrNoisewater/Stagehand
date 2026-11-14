const bridge=()=>import('./api.js').then(m=>m.api);
export function cabinetFor(tone,capture){
  if(capture?.fullRig||tone.autoCab===false)return null;
  // 4.1.7: a cabinet picked in Create tone
  if(tone.cabId)return tone.cabId;
  const amp=tone.gear?.find(g=>g.slot==='amp')?.key||'';
  if(tone.kind==='bass'||/^Bass_/i.test(amp)){
    const cab=tone.gear?.find(g=>g.slot==='cab')?.key||'';
    if(/Orange/i.test(amp))return 'bass-orange';
    if(/115|B15/i.test(cab))return 'bass-115';
    if(/215|Sunn/i.test(cab))return 'bass-215';
    if(/410/i.test(cab))return 'bass-410';
    return 'bass-810';
  }
  // 4.18: the song's own cabinet says how many speakers it has (…112…, …212…, …412…): go by that
  // first, and by the amp only when it doesn't say
  const cabKey=(tone.gear?.find(g=>g.slot==='cab')?.key||'').replace(/^Cab_/,'');
  const size=/(?:^|[A-Za-z_0])([1248])(10|12|15)(?!\d)/.exec(cabKey);
  if(size&&size[2]==='12'){
    if(size[1]==='1')return '1x12_open';
    if(size[1]==='2')return '2x12_closed';
    if(size[1]==='4')return /Marshall|Plexi|JCM|GB/i.test(amp+' '+cabKey)?'4x12_slant':'4x12_straight';
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
