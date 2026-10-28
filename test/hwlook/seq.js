// node seq.js <out.mp4> <file.json> <part> <t0> <secs> : renders the highway frame by frame at 15 fps (song clock stepped)
const http=require('http'),fs=require('fs'),path=require('path'),{execSync}=require('child_process');
const HW='/home/claude/src/stagehand/test/hwlook', R='/home/claude/src/stagehand/src/renderer';
const STUBS=['api.js','rig.js','tab.js','tonelib.js','captures.js','realamps.js'];
const types={'.js':'text/javascript','.css':'text/css','.html':'text/html','.json':'application/json'};
const srv=http.createServer((req,res)=>{let u=decodeURIComponent(req.url.split('?')[0]);let f;if(u==='/')f=path.join(HW,'index.html');else if(u==='/harness.js'||u.endsWith('.json')&&!u.startsWith('/data/'))f=path.join(HW,path.basename(u));else if(u.startsWith('/js/')&&STUBS.includes(path.basename(u)))f=path.join(HW,'stubs',path.basename(u));else f=path.join(R,u);fs.readFile(f,(e,d)=>{if(e){res.writeHead(404);return res.end()}res.writeHead(200,{'content-type':types[path.extname(f)]||'application/octet-stream'});res.end(d)})});
const { chromium } = require('/opt/npm-tools/node_modules/playwright');
const [out,file,part,t0s,secs]=process.argv.slice(2); const t0=+t0s, FPS=15;
(async()=>{
 await new Promise(r=>srv.listen(8767,r));
 const b=await chromium.launch({args:['--single-process','--no-zygote','--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
 const p=await b.newPage({viewport:{width:1280,height:720}});
 await p.goto(`http://localhost:8767/?scene=R&t=${t0}&play=0&file=${file}&part=${part}`);
 await p.waitForFunction(()=>window.__hwReady,null,{timeout:60000});
 const dir=out+'.frames'; fs.rmSync(dir,{recursive:true,force:true}); fs.mkdirSync(dir);
 await p.evaluate(()=>{const H=document.querySelector('.highway').__hw;H.perfState.noGlow=true;H.perfState.n=-1e9;document.querySelectorAll('.hw-top,.hw-bottom,.hw-sections,.hw-dock').forEach(e=>e.style.display='none');});
 for(let i=0;i<FPS*secs;i++){
  await p.evaluate(async([t])=>{const H=document.querySelector('.highway').__hw;window.__stage.engine.position=t;H.last=performance.now()-1000/15;await new Promise(r=>requestAnimationFrame(()=>r()));},[t0+i/FPS]);
  await p.screenshot({path:`${dir}/${String(i).padStart(4,'0')}.jpg`,quality:80});
 }
 await b.close(); srv.close();
 execSync(`ffmpeg -v error -y -framerate ${FPS} -i ${dir}/%04d.jpg -pix_fmt yuv420p ${out}`);
})().catch(e=>{console.error(e);process.exit(1)});
