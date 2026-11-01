const fs=require('fs'),os=require('os');
const {spawn}=require('child_process');const assert=require('assert');const path=require('path');
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'stagehand-monitor-'));
const input=Buffer.alloc(44+48000*2);input.write('RIFF');input.writeUInt32LE(input.length-8,4);input.write('WAVEfmt ',8);input.writeUInt32LE(16,16);input.writeUInt16LE(1,20);input.writeUInt16LE(1,22);input.writeUInt32LE(48000,24);input.writeUInt32LE(96000,28);input.writeUInt16LE(2,32);input.writeUInt16LE(16,34);input.write('data',36);input.writeUInt32LE(96000,40);for(let i=0;i<48000;i++)input.writeInt16LE(Math.round(Math.sin(i*2*Math.PI*220/48000)*5000),44+2*i);fs.writeFileSync(path.join(tmp,'in.wav'),input);
const child=spawn(path.join(__dirname,'../native/build/stagehand-audio-fake'),[],{stdio:['pipe','pipe','pipe']});
let bytes=Buffer.alloc(0),events=[],packets={3:[],4:[],5:[]};
child.stdout.on('data',b=>{bytes=Buffer.concat([bytes,b]);while(bytes.length>=8){const t=bytes.readUInt32LE(0),n=bytes.readUInt32LE(4);if(bytes.length<8+n)break;const p=Buffer.from(bytes.subarray(8,8+n));bytes=bytes.subarray(8+n);if(t===1)events.push(JSON.parse(p));else if(packets[t])packets[t].push(p);}});
function send(t,p){const h=Buffer.alloc(8);h.writeUInt32LE(t);h.writeUInt32LE(p.length,4);child.stdin.write(Buffer.concat([h,p]));}
const cmd=x=>send(1,Buffer.from(JSON.stringify(x)));const wait=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{try{
 cmd({cmd:'start',exclusive:1,fakeIn:path.join(tmp,'in.wav')});await wait(100);
 assert(events.some(e=>e.ev==='started'));
 cmd({cmd:'build',slot:0,spec:'kind\tguitar\ngear\tamp\tAmp_TW22\ngear\tcab\tCab_TW112C_57_Cone'});await wait(100);cmd({cmd:'select',slot:0});cmd({cmd:'param',id:8,v:1});
 cmd({cmd:'monitor',on:1});cmd({cmd:'song',on:1,rate:48000});await wait(100);
 const audio=Buffer.alloc(4800*8);for(let i=0;i<4800;i++){audio.writeFloatLE(.1,8*i);audio.writeFloatLE(-.1,8*i+4);}
 for(let i=0;i<8;i++){send(2,audio);await wait(60);}await wait(100);
 const floats=t=>{const b=Buffer.concat(packets[t]);return Array.from(new Float32Array(b.buffer.slice(b.byteOffset,b.byteOffset+b.length)));};
 const {Analyzer}=await import('../src/renderer/js/detect.js');
 const raw=floats(3);const frame=new Analyzer(48000).frame(Float32Array.from(raw.slice(-8192)));assert(Math.abs(frame.midi-57)<.3,'raw input remains A3 while recording monitor runs');
 const mixed=floats(5),processed=floats(4);assert(mixed.length>4000&&processed.length>4000);assert(mixed.every(Number.isFinite));
 assert(mixed.some((x,i)=>i%2===0&&x>.02),'left song channel captured');assert(mixed.some((x,i)=>i%2===1&&x<-.02),'right song channel captured');assert(processed.some(x=>Math.abs(x)>.001),'processed instrument is captured');
 assert(mixed.some((x,i)=>i%2===0&&x-mixed[i+1]>.15),'mixed stream includes stereo song alongside instrument');
 cmd({cmd:'monitor',on:0});await wait(100);const count=packets[5].length;await wait(100);assert.equal(packets[5].length,count,'monitor stops cleanly');
 console.log('PASS native exclusive-mode stereo mixed-output capture, separate processed signal, finite PCM and cleanup');
 }finally{cmd({cmd:'quit'});child.stdin.end();child.on('exit',()=>fs.rmSync(tmp,{recursive:true,force:true}));}})().catch(e=>{console.error(e);child.kill();process.exitCode=1;});
