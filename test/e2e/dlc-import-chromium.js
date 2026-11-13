'use strict';
// Renderer-only harness: real importer dialog with a mock preload bridge.
// PLAYWRIGHT=/absolute/path/to/playwright node test/e2e/dlc-import-chromium.js
const { chromium } = require(process.env.PLAYWRIGHT || 'playwright');
const http = require('http');
const fs = require('fs');
const path = require('path');
const assert = require('assert/strict');
const root = path.resolve(__dirname, '../../src/renderer');
const html = `<!doctype html><link rel="stylesheet" href="/css/app.css"><div id="overlays"></div><script>
const rows=[{id:'k',artist:'3 Doors Down',title:'Kryptonite',arrangements:'Lead',status:'Ready',selectable:true},
{id:'q',artist:'Queen',title:'Killer Queen',arrangements:'Combo (1), Combo (2)',status:'Already in Stagehand',selectable:false},
{id:'d',artist:'DLC',title:'Ordinary',arrangements:'Bass',status:'Ready',selectable:true},
{id:'e',artist:'',title:'Start-Me-Up',arrangements:'',status:'Invalid archive: zero bytes',selectable:false}];
window.calls=[];let notify, finish;
window.stagehand={on:(type,fn)=>{notify=fn;return()=>{notify=null}},library:{get:async()=>({songs:[],setlists:[],folders:[],unreadable:[]})},
dlc:{scan:async()=>rows,importSelected:async(ids)=>{calls.push(ids);notify({phase:'Importing',done:0,total:ids.length,file:'Kryptonite'});return new Promise(r=>finish=()=>r(rows))},cancel:async()=>{calls.push('cancel');finish?.();return true}}};
</script><script type="module">import {openDlcImport} from '/js/dlc-import.js';window.openImporter=openDlcImport;await openDlcImport();</script>`;
(async () => {
  const server = http.createServer((req, res) => {
    if (req.url === '/') { res.setHeader('Content-Type', 'text/html'); return res.end(html); }
    const p = path.join(root, req.url.split('?')[0]);
    if (!p.startsWith(root + path.sep)) { res.statusCode = 403; return res.end(); }
    res.setHeader('Content-Type', p.endsWith('.js') ? 'text/javascript' : p.endsWith('.css') ? 'text/css' : 'application/octet-stream');
    fs.createReadStream(p).on('error', () => { res.statusCode = 404; res.end(); }).pipe(res);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  let browser;
  try {
    browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM || undefined, args: ['--no-sandbox'] });
    const page = await browser.newPage({ viewport: { width: 1024, height: 768 } });
    const errors = []; page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    await page.getByText('Invalid archive: zero bytes', { exact: true }).waitFor();
    assert.equal(await page.getByRole('checkbox').count(), 4);
    assert.equal(await page.getByRole('checkbox', { name: 'Import Queen — Killer Queen' }).isDisabled(), true);
    await page.getByRole('button', { name: 'Select All', exact: true }).click();
    assert.equal(await page.getByRole('checkbox', { checked: true }).count(), 2);
    await page.getByRole('button', { name: 'Deselect All', exact: true }).click();
    assert.equal(await page.getByRole('checkbox', { checked: true }).count(), 0);
    await page.getByRole('textbox').fill('Kryptonite');
    assert.equal(await page.getByRole('checkbox').count(), 1);
    await page.getByRole('checkbox').check();
    await page.getByRole('button', { name: 'Import Selected (1)', exact: true }).click();
    await page.getByText('Importing: 0/1 — Kryptonite', { exact: true }).waitFor();
    assert.equal(await page.getByRole('button', { name: 'Scan again' }).isDisabled(), true);
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    await page.getByRole('button', { name: 'Close', exact: true }).waitFor();
    assert.deepEqual(await page.evaluate(() => calls), [['k'], 'cancel']);
    assert.equal(await page.evaluate(() => document.querySelector('.modal').getBoundingClientRect().right <= innerWidth), true);
    assert.deepEqual(errors, []);
    await page.getByRole('button', { name: 'Close', exact: true }).click();
    assert.equal(await page.getByRole('dialog').count(), 0);
    console.log('PASS renderer: list, errors, duplicate disabled, search, select/deselect, import payload, progress, cancellation, close, 1024px layout');
  } finally { await browser?.close(); server.close(); }
})().catch((e) => { console.error(e); process.exitCode = 1; });
