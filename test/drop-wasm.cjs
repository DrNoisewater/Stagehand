// Smoke check the shipped fallback binary, including a half-step and bypass.
const fs = require('node:fs');
const assert = require('node:assert/strict');
const path = require('node:path');
const x = new WebAssembly.Instance(new WebAssembly.Module(fs.readFileSync(path.join(__dirname,'../src/renderer/worklets/rig-dsp.wasm'))),{}).exports;
const need=x.mem_needed(); if(need>x.memory.buffer.byteLength)x.memory.grow(Math.ceil((need-x.memory.buffer.byteLength)/65536));
assert(x.init(48000));x.param(8,1);x.param(10,0);x.param(9,1);
const input=new Float32Array(x.memory.buffer,x.buf_in(),128), out=new Float32Array(x.memory.buffer,x.buf_l(),128);
let peak=0, energy=0, re=0, im=0,count=0;
const target=220*Math.pow(2,-1/12);
for(let o=0;o<48000*3;o+=128){for(let i=0;i<128;i++)input[i]=.2*Math.sin(2*Math.PI*220*(o+i)/48000);x.process(128);
 for(let i=0;i<128;i++){assert(Number.isFinite(out[i]));if(o<48000)continue;peak=Math.max(peak,Math.abs(out[i]));energy+=out[i]**2;const t=2*Math.PI*target*(o+i)/48000;re+=out[i]*Math.cos(t);im+=out[i]*Math.sin(t);count++;}}
assert(peak<.205,`unexpected gain boost ${peak}`);assert(energy/count>.015,'missing shifted audio');
assert(2*Math.hypot(re,im)/count>.15,'half-step component missing');
x.param(9,0);for(let b=0;b<200;b++){input.fill(0);x.process(128);}assert(out.every(v=>Math.abs(v)<1e-8));
console.log('Shipped WASM: half-step component, bounded level, finite output, off/silence PASS');
