const http=require('http'),fs=require('fs'),path=require('path'),assert=require('assert');
const {chromium}=require(process.env.PLAYWRIGHT||'playwright');
const root=path.join(__dirname,'../../src/renderer');
const html=`<div id="app"></div><div id="toasts"></div><script type="module">
import {createPerformanceTools} from '/js/performance-tools.js';import {rig} from '/js/rig.js';
const ctx=new AudioContext();await ctx.resume();
function signal(freq){const osc=ctx.createOscillator(),g=ctx.createGain();osc.frequency.value=freq;g.gain.value=.1;osc.connect(g);osc.start();return g;}
const ref=signal(1400),played=signal(220),quiet=ctx.createGain();quiet.gain.value=0;ref.connect(quiet);played.connect(quiet);quiet.connect(ctx.destination);
rig.knobs={bass:.5,mid:.5,treble:.5};rig.setKnob=(k,v)=>rig.knobs[k]=Math.max(0,Math.min(1,v));rig.resetKnob=k=>delete rig.knobs[k];rig.monitorProcessed=async()=>({ctx,node:played,close(){}});
const engine=Object.assign(new EventTarget(),{ctx,node:ref,playing:true,speed:1,position:0,tracks:[{loaded:true,name:'guitar'}]});
const stage={engine,trackIndex:()=>0,getLoop:()=>null};const H={open:true,song:{id:'tone-test'},tab:{id:'lead'},targets:[]};
createPerformanceTools({root:document.body,stage,H,rig});window.result=()=>({...rig.knobs});window.ready=true;
</script>`;
const srv=http.createServer((req,res)=>{if(req.url==='/'){res.setHeader('content-type','text/html');return res.end(html);}let p=req.url==='/js/rig.js'?path.join(__dirname,'../hwlook/stubs/rig.js'):req.url==='/js/api.js'?path.join(__dirname,'../hwlook/stubs/api.js'):path.join(root,req.url);fs.readFile(p,(err,b)=>{if(err){res.writeHead(404);return res.end();}res.setHeader('content-type','text/javascript');res.end(b);});});
(async()=>{await new Promise(r=>srv.listen(0,r));const b=await chromium.launch({executablePath:process.env.CHROMIUM,args:['--no-sandbox','--single-process','--no-zygote','--autoplay-policy=no-user-gesture-required']});try{const page=await b.newPage();page.on('pageerror',e=>console.log('PAGEERROR',e.message));await page.goto('http://localhost:'+srv.address().port);await page.waitForFunction(()=>window.ready);await page.getByRole('button',{name:'Tone match · β',exact:true}).click();await page.getByRole('button',{name:'Listen for 8 seconds'}).click();await page.waitForFunction(()=>!document.querySelector('.perf-panel button').disabled,null,{timeout:30000});const text=await page.locator('.perf-panel').first().textContent();assert.match(text,/Matched gently/);const knobs=await page.evaluate(()=>window.result());assert(knobs.bass<.5&&knobs.mid>.5);await page.getByRole('button',{name:'Undo match'}).click();assert.deepEqual(await page.evaluate(()=>window.result()),{bass:.5,mid:.5,treble:.5});console.log('PASS real Web Audio spectral analysis, bounded EQ/gain adjustment and exact undo');}finally{await b.close();srv.close();}})().catch(e=>{console.error(e);process.exit(1);});
