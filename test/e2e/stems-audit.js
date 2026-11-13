/** 4.12: a song waiting to be split says which song goes first and how far it has got,
 * and a split moving along doesn't rebuild the left menu or the song panel (it flickered).
 *   SH_AUDIT=test/e2e/stems-audit.js node test/e2e/ui3-chromium.js native/build/stagehand-audio-fake <out>
 */
const path = require('path');
module.exports = async ({ page, outDir, check, stemHold }) => {
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  for (let i = 0; i < 3 && (await page.locator('.modal').count()); i++) await page.keyboard.press('Escape');
  await page.setViewportSize({ width: 1500, height: 900 });
  await page.locator('#sidebar .nav-section[data-page="songs"]').first().click();
  await page.waitForTimeout(800);
  const [a, b] = await page.evaluate(async () => {
    const { state } = await import('./js/store.js');
    return [...state.songs.values()].filter((s) => !s.hasStems).slice(0, 2).map((s) => ({ id: s.id, title: s.title }));
  });
  check(!!(a && b), 'two songs without stems to split');
  if (!a || !b) return;
  await page.locator(`[data-id="${b.id}"]`).first().click();
  await page.waitForTimeout(500);
  const send = (u) => page.evaluate((u) => window.__shEmit('stems:update', u), u);
  await send({ songId: a.id, state: 'running', progress: 0.4 });
  await send({ songId: b.id, state: 'queued', progress: 0, message: 'Waiting' });
  await page.waitForTimeout(300);
  // mark what's on screen now: rebuilt parts lose the mark
  await page.evaluate(() => {
    document.querySelector('#sidebar .nav-sections').__mark = 1;
    document.querySelector('[data-stem-btn]').__mark = 1;
  });
  const note1 = await page.locator('[data-stem-note]').textContent();
  check(note1.includes(a.title) && /40%/.test(note1), `a song in line says which song goes first: “${note1}”`);
  check(/In line/.test(await page.locator('[data-stem-btn]').textContent()), 'its button says it is in line');
  await send({ songId: a.id, state: 'running', progress: 0.65 });
  await page.waitForTimeout(300);
  const note2 = await page.locator('[data-stem-note]').textContent();
  check(/65%/.test(note2), `and follows that split: “${note2}”`);
  await page.screenshot({ path: path.join(outDir, 'stems-in-line.png') });
  // another song joins the line (as picking songs does): nothing gets rebuilt
  const c = await page.evaluate(async (skip) => {
    const { state } = await import('./js/store.js');
    const s = [...state.songs.values()].find((x) => !x.hasStems && !skip.includes(x.id));
    return s && s.id;
  }, [a.id, b.id]);
  if (c) await send({ songId: c, state: 'queued', progress: 0 });
  await page.waitForTimeout(400);
  const kept = await page.evaluate(() => ({
    menu: document.querySelector('#sidebar .nav-sections').__mark === 1,
    panel: (document.querySelector('[data-stem-btn]') || {}).__mark === 1,
  }));
  check(kept.menu && kept.panel, `a split moving along leaves the left menu and the song panel in place (${JSON.stringify(kept)})`);
  // the first one finishes: this one starts, with its own progress
  await send({ songId: a.id, state: 'ready' });
  await send({ songId: b.id, state: 'running', progress: 0.1 });
  await page.waitForTimeout(400);
  const now = await page.evaluate(() => ({ btn: document.querySelector('[data-stem-btn]').textContent, note: document.querySelector('[data-stem-note]').hidden }));
  check(/10%/.test(now.btn) && now.note, `then it shows its own progress (${JSON.stringify(now)})`);
  await send({ songId: b.id, state: 'ready' });
  await page.waitForTimeout(300);
  check(/Stems ready/.test(await page.locator('[data-stem-btn]').textContent()), 'and says when its stems are ready');
  if (c) await send({ songId: c, state: 'none' });
  // on the highway, Sound & settings follows the split too (it stalled at its first number)
  await send({ songId: a.id, state: 'none' });
  stemHold.add(a.id);
  await page.evaluate(async (id) => (await import('./js/actions.js')).playAlong(id), a.id);
  await page.waitForFunction(() => { const r = document.querySelector('.highway'); return r && !r.hidden; }, null, { timeout: 30000 });
  await page.waitForTimeout(1500);
  await send({ songId: a.id, state: 'running', progress: 0.3 });
  await page.waitForTimeout(200);
  if (!(await page.locator('.highway .hw-mix-note[data-split]').count())) await page.locator('.highway .hw-dock-tab').click();
  await page.waitForTimeout(500);
  const m1 = await page.evaluate(() => { const n = document.querySelector('.highway .hw-mix-note[data-split]'); if (n) n.__mark = 1; return n ? n.textContent : ''; });
  check(/30%/.test(m1), `the highway's Sound & settings shows the split: “${m1}”`);
  await send({ songId: a.id, state: 'running', progress: 0.55 });
  await page.waitForTimeout(400);
  const m2 = await page.evaluate(() => { const n = document.querySelector('.highway .hw-mix-note[data-split]'); return { text: n ? n.textContent : '', same: !!(n && n.__mark), bar: n && n.nextElementSibling ? n.nextElementSibling.firstChild.style.width : '' }; });
  check(/55%/.test(m2.text) && m2.same && m2.bar === '55%', `and moves with it, in place (${JSON.stringify(m2)})`);
  await page.screenshot({ path: path.join(outDir, 'stems-highway-mix.png') });
  stemHold.delete(a.id);
  await send({ songId: a.id, state: 'ready' });
  let rows = 0;
  for (let i = 0; i < 40 && !rows; i++) {
    await page.waitForTimeout(250);
    rows = await page.locator('.highway .hw-mix-row').count();
  }
  check(rows > 0 && !(await page.locator('.highway .hw-mix-note[data-split]').count()), `when it finishes, the stems show up there (${rows} rows)`);
  check(!errs.length, `no errors on the page (${errs.join('; ')})`);
};
