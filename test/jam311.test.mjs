import assert from 'node:assert/strict';
import {Analyzer,Judge} from '../src/renderer/js/detect.js';
import {createRequire} from 'node:module';
import fs from 'node:fs/promises';import os from 'node:os';import path from 'node:path';
const require=createRequire(import.meta.url),{ToneStore}=require('../src/main/services/tones.js');
const dir=await fs.mkdtemp(path.join(os.tmpdir(),'stagehand311-'));
const file=path.join(dir,'tones.json');await fs.writeFile(file,JSON.stringify({seeded:true,tones:[{id:'old',name:'Keep me',slot:1,gear:[{slot:'amp',key:'Amp_TW22'}]}]}));
const store=new ToneStore(file);await store.load();assert.equal(store.get().tones[0].slot,null);assert.equal(store.get().tones[0].name,'Keep me');assert.throws(()=>store.setSlot('old',1),/reserved/);await store.flush();await fs.rm(dir,{recursive:true});
const target={id:0,t:.5,notes:[{midi:57,s:0,f:0}],kind:'note'};
function check(extra,wrong=false){const judge=new Judge([target]),an=new Analyzer(48000);for(let t=0;t<1;t+=.01){const b=new Float32Array(8192);for(let i=0;i<b.length;i++){const time=t-(b.length-1-i)/48000;let hz=0,at=0;if(time>=.46&&time<.59){hz=wrong?246.94:220;at=time-.46;}else if(extra&&time>=.62&&time<.8){hz=329.63;at=time-.62;}if(hz){const env=Math.min(1,at/.004)*Math.exp(-at*3);for(let h=1;h<=8;h++)b[i]+=Math.sin(2*Math.PI*hz*h*at)*.2/h*env;}}const f=an.frame(b);judge.push(t,f,Math.abs(t-.46)<.005||extra&&Math.abs(t-.62)<.005?'pluck':null);}return judge;}
assert.equal(check(false).hits,1,'expected note hits');assert.equal(check(true).hits,1,'extra later note cannot revoke a correct target');assert.equal(check(false,true).hits,0,'wrong note is not credited');assert.equal(check(true).judged,1,'extras do not add missed targets');
console.log('PASS slot 1 migration/protection, correct note, extra-note immunity, wrong-note rejection');
