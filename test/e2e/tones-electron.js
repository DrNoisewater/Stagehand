/**
 * Tones in the real app (Electron), 4.0.8–4.0.9:
 *  - a song using one tone for guitar and bass is listed twice: clicking each row must
 *    pick that row only (both used to light up, and clicking the second picked the first);
 *  - an empty key (3) must look like a key, not cover the whole window.
 *
 *   ELECTRON=<electron 44> xvfb-run -a node test/e2e/tones-electron.js <outDir>
 */
const path=require('path'),fs=require('fs'),os=require('os');
const {_electron}=require(process.env.PLAYWRIGHT||'playwright');
const ROOT=path.resolve(__dirname,'..','..');
const out=process.argv[2]||os.tmpdir();fs.mkdirSync(out,{recursive:true});
let bad=0;const check=(ok,msg)=>{console.log(`${ok?'ok  ':'FAIL'} ${msg}`);if(!ok)bad++;};
(async()=>{
  const home=fs.mkdtempSync(path.join(os.tmpdir(),'sh-twins-'));
  const app=await _electron.launch({executablePath:process.env.ELECTRON,args:['--no-sandbox',ROOT],env:{...process.env,STAGEHAND_HOME:home}});
  const page=await app.firstWindow();
  page.on('pageerror',e=>console.log('PAGEERR',e.message));
  await page.waitForTimeout(4000);
  await page.evaluate(async()=>{const t=await import('./js/tonelib.js');
    const gear=[{slot:'amp',key:'Amp_MarshallJCM800',knobs:{}},{slot:'cab',key:'Cab_MarshallJCM800_412_57_Cone',knobs:{}}];
    t.tonelib.library=[{songId:'s1',title:'Almost Easy',artist:'Avenged Sevenfold',tones:[
      {key:'AlmostEasy_Dist',name:'AlmostEasy Distorsion',kind:'guitar',gear},
      {key:'AlmostEasy_Bass',name:'AlmostEasy Bass',kind:'bass',gear},
      {key:'AlmostEasy_Dist',name:'AlmostEasy Distorsion',kind:'bass',gear}]}];});
  await page.locator('text=Tones').first().click();await page.waitForTimeout(800);
  await page.locator('.tones-tabs button:has-text("From my songs")').click();await page.waitForTimeout(1000);
  const rows=page.locator('.tone-item .ti-main');
  const res=[];
  for (const i of [0,2,0,2]) { await rows.nth(i).click(); await page.waitForTimeout(500);
    res.push(await page.evaluate(()=>[...document.querySelectorAll('.tone-item')].map((r,i)=>r.classList.contains('on')?i:null).filter(x=>x!==null).join(','))); }
  check(res.join('|')==='0|2|0|2',`each click picks that row only (${res.join(' | ')})`);
  const subs=await page.evaluate(()=>[...document.querySelectorAll('.tone-item .ti-main span')].map(s=>s.textContent));
  check(/^Guitar · /.test(subs[0])&&/^Bass · /.test(subs[2])&&!/^(Guitar|Bass) · /.test(subs[1]),'the twin rows say Guitar and Bass');
  await page.screenshot({path:path.join(out,'tones-twins.png')});
  // key 3 empty
  await page.locator('.tones-tabs button:has-text("My tones")').click();await page.waitForTimeout(600);
  await page.evaluate(async()=>{const t=await import('./js/tonelib.js');const x=t.bySlot(3);if(x)await t.removeTone(x.id);});
  await page.waitForTimeout(600);
  await page.locator('.tone-item .ti-main').first().click();await page.waitForTimeout(800);
  const r=await page.evaluate(()=>{const b=[...document.querySelectorAll('.ts-key')].find(x=>x.querySelector('b').textContent==='3');const q=b&&b.getBoundingClientRect();return q&&{w:q.width,h:q.height,W:innerWidth,H:innerHeight};});
  check(r&&r.w<r.W/2&&r.h<r.H/4,`an empty key 3 is key sized (${r&&Math.round(r.w)}×${r&&Math.round(r.h)})`);
  await page.screenshot({path:path.join(out,'tones-empty-key.png')});
  await app.close();
  fs.rmSync(home,{recursive:true,force:true});
  console.log(bad?'some failed':'all passed');process.exit(bad?1:0);
})().catch(e=>{console.error(e);process.exit(1)});
