'use strict';
const fs=require('fs').promises;
const path=require('path');
const {spawn}=require('child_process');
const {gunzipSync}=require('zlib');
const {createHash}=require('crypto');
const URL='https://github.com/eugeneware/ffmpeg-static/releases/download/b6.1.1/ffmpeg-win32-x64.gz';
let preparing;
function run(exe,args){return new Promise((resolve,reject)=>{const p=spawn(exe,args,{windowsHide:true});/* 4.18: saving a clip waits its turn behind the app and the sound */try{if(p.pid)require('os').setPriority(p.pid,require('os').constants.priority.PRIORITY_BELOW_NORMAL);}catch{}let tail='';p.stdout.resume();p.stderr.on('data',d=>tail=(tail+d).slice(-2500));p.on('error',reject);p.on('close',code=>code===0?resolve():reject(Error('MP4 encoder failed: '+tail)));});}
async function ensureEncoder(tools){
 if(process.platform!=='win32')return 'ffmpeg';
 const exe=path.join(tools.toolsDir,'video','ffmpeg-6.1.1.exe');
 try{await fs.access(exe);return exe;}catch{}
 if(!preparing)preparing=(async()=>{const zip=exe+'.gz';await tools.download(URL,zip);const compressed=await fs.readFile(zip);
 const expected='8883a3dffbd0a16cf4ef95206ea05283f78908dbfb118f73c83f4951dcc06d77';
 if(createHash('sha256').update(compressed).digest('hex')!==expected)throw Error('Video encoder download could not be verified. Please retry.');
 await fs.writeFile(exe+'.part',gunzipSync(compressed));await fs.rename(exe+'.part',exe);await fs.unlink(zip);return exe;})().finally(()=>preparing=null);
 return preparing;
}
/** audio: a WAV of the engine's sound to put under the video (native engine), else the
 *  capture's own sound track. */
function exportArgs(input,output,audio){
 const ins=audio?['-i',input,'-i',audio,'-map','0:v:0','-map','1:a:0']:['-i',input,'-map','0:v:0','-map','0:a:0?'];
 return {common:['-hide_banner','-loglevel','error','-y',...ins,'-vf',"scale='min(1920,iw)':-2:force_original_aspect_ratio=decrease,format=yuv420p"],end:['-c:a','aac','-b:a','256k','-movflags','+faststart',output]};
}
async function exportMp4(exe,input,output,audio){
 const {common,end}=exportArgs(input,output,audio);
 try{await run(exe,[...common,'-c:v','h264_nvenc','-preset','p4','-cq','18','-b:v','16M',...end]);return 'NVIDIA';}
 catch{await run(exe,[...common,'-c:v','libx264','-preset','fast','-crf','18',...end]);return 'CPU';}
}
/** 4.1.2: how loud the saved video's sound is, so a silent video is never a surprise.
 *  → { hasSound, peakDb } (peakDb -91 means digital silence; null when unreadable). */
function soundLevel(exe,file){return new Promise(resolve=>{
 const p=spawn(exe,['-hide_banner','-nostats','-i',file,'-map','0:a:0?','-af','volumedetect','-f','null','-'],{windowsHide:true});
 let err='';p.stdout.resume();p.stderr.on('data',d=>err=(err+d).slice(-20000));
 p.on('error',()=>resolve({hasSound:false,peakDb:null}));
 p.on('close',()=>{const m=/max_volume:\s*(-?[\d.]+|-inf) dB/.exec(err);const hasStream=/Stream #\d+:\d+[^\n]*Audio:/.test(err);
  const peakDb=m?(m[1]==='-inf'?-91:Number(m[1])):null;resolve({hasSound:hasStream&&peakDb!==null&&peakDb>-60,peakDb:hasStream?peakDb:null});});
});}
module.exports={ensureEncoder,exportMp4,exportArgs,soundLevel};
