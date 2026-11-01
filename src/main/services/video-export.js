'use strict';
const fs=require('fs').promises;
const path=require('path');
const {spawn}=require('child_process');
const {gunzipSync}=require('zlib');
const {createHash}=require('crypto');
const URL='https://github.com/eugeneware/ffmpeg-static/releases/download/b6.1.1/ffmpeg-win32-x64.gz';
let preparing;
function run(exe,args){return new Promise((resolve,reject)=>{const p=spawn(exe,args,{windowsHide:true});let tail='';p.stdout.resume();p.stderr.on('data',d=>tail=(tail+d).slice(-2500));p.on('error',reject);p.on('close',code=>code===0?resolve():reject(Error('MP4 encoder failed: '+tail)));});}
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
async function exportMp4(exe,input,output){
 const common=['-hide_banner','-loglevel','error','-y','-i',input,'-map','0:v:0','-map','0:a:0','-vf',"scale='min(1920,iw)':-2:force_original_aspect_ratio=decrease,format=yuv420p"];
 const end=['-c:a','aac','-b:a','256k','-movflags','+faststart',output];
 try{await run(exe,[...common,'-c:v','h264_nvenc','-preset','p4','-cq','18','-b:v','16M',...end]);return 'NVIDIA';}
 catch{await run(exe,[...common,'-c:v','libx264','-preset','fast','-crf','18',...end]);return 'CPU';}
}
module.exports={ensureEncoder,exportMp4};
