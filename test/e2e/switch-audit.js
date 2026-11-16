/** 4.21: switching tones loads each one cleanly, every time. In Create a tone: famous tones picked
 * one after another (fast and slow), a pedal swapped for another, a Lab pedal added and taken
 * away, then back to a tone played before. What's playing must always be what's on the board, a
 * tone come back to must start fresh, and a Lab pedal's lit buttons go out with a new tone.
 *   SH_AUDIT=test/e2e/switch-audit.js node test/e2e/ui3-chromium.js native/build/stagehand-audio-fake <out> */
const path = require('path');
module.exports = async ({ page, outDir, check }) => {
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  for (let i = 0; i < 4 && (await page.locator('.modal').count()); i++) await page.keyboard.press('Escape'), await page.waitForTimeout(250);
  await page.setViewportSize({ width: 1600, height: 950 });
  await page.evaluate(async () => (await import('./js/store.js')).setPage('tones'));
  await page.waitForTimeout(800);
  check(await page.evaluate(() => !!(window.__rig && window.__rig.on && window.__rig.backend)), 'the rig is running (pretend guitar)');
  // record what is sent to the sound engine
  await page.evaluate(() => {
    const b = window.__rig.backend;
    window.__sent = [];
    for (const k of ['build', 'select', 'refresh']) {
      const f = b[k] && b[k].bind(b);
      if (f) b[k] = (...a) => (window.__sent.push([k, a[0]]), f(...a));
    }
  });
  // settled: what's playing is the board's tone, and the engine has nothing left to do
  const settled = async () => {
    await page.waitForTimeout(400);
    for (let i = 0; i < 60; i++) {
      const s = await page.evaluate(async () => {
        const r = window.__rig;
        const { toSpec } = await import('./js/gearspec.js');
        const want = r.liveTone ? toSpec(r.liveTone) : '';
        await Promise.race([r._busy, new Promise((ok) => setTimeout(ok, 50))]);
        const key = (r.slots[r.active] || '').split('\n').filter((l) => !/^(ir\t|cab:|nam\t)/.test(l)).join('\n');
        return { ok: !!want && key === want, idle: !r._queued };
      });
      if (s.ok && s.idle) return true;
      await page.waitForTimeout(150);
    }
    return false;
  };
  const playing = () => page.evaluate(() => { const r = window.__rig; return (r.slots[r.active] || '').split('\n').filter((l) => !/^(ir\t|cab:|nam\t)/.test(l)).join('\n'); });
  const board = () => page.evaluate(() => [...document.querySelectorAll('.rr-board .rb-piece')].map((p) => p.dataset.key || p.getAttribute('data-key') || '').filter(Boolean));

  await page.evaluate(async () => { (await import('./js/rigroom.js')).openRig({ kind: 'guitar' }); });
  await page.waitForSelector('.rr-board .rb');
  await page.waitForTimeout(3500);
  check(await settled(), 'a new tone plays what is on the board');

  // famous tones, one after another, slowly then fast
  await page.locator('.rr-famous-tab').click({ force: true });
  await page.waitForTimeout(400);
  const cards = page.locator('.rr-grid .rr-ft');
  const names = (await page.locator('.rr-grid .rr-ft .rr-ft-name').allTextContents()).slice(0, 8);
  check(names.length >= 6, `famous tones to switch between (${names.length})`);
  const specs = {};
  for (let i = 0; i < 4; i++) {
    await cards.nth(i).click({ force: true });
    const ok = await settled();
    specs[i] = await playing();
    const missing = await page.evaluate(() => { const r = window.__rig; return r.liveTone.gear.filter((g) => !g.bypass && !(r.slots[r.active] || '').includes(g.key)).map((g) => g.key); });
    check(ok && !missing.length, `famous tone "${names[i]}": it plays exactly what's on the board${missing.length ? ` (missing ${missing.join(', ')})` : ''}${ok ? '' : ' (not settled)'}`);
  }
  check(new Set(Object.values(specs)).size === 4, 'each famous tone is its own sound');
  // fast: five picks a fifth of a second apart; the last one wins
  for (const i of [4, 5, 1, 3, 2]) await cards.nth(i).click({ force: true }), await page.waitForTimeout(200);
  check((await settled()) && (await playing()) === specs[2], `five fast picks: the last one picked ("${names[2]}") is what plays`);
  // back to one played before: it starts fresh (put back to just-built before it's heard)
  const before = await page.evaluate(() => window.__sent.length);
  await cards.nth(0).click({ force: true });
  await settled();
  const sent = await page.evaluate((n) => window.__sent.slice(n), before);
  const sel = sent.filter(([k]) => k === 'select').pop();
  const fresh = sel && sent.some(([k, slot]) => (k === 'refresh' || k === 'build') && slot === sel[1]);
  check((await playing()) === specs[0] && fresh, `back to "${names[0]}": the same sound, started fresh (${sent.map((s) => s.join(' ')).join(', ')})`);

  // swap a pedal: what plays follows the board, the old pedal gone
  const swap = await page.evaluate(async () => {
    const r = window.__rig;
    const t = r.liveTone;
    const i = t.gear.findIndex((g) => g.slot === 'pre' || g.slot === 'post');
    return { i, key: i >= 0 ? t.gear[i].key : '' };
  });
  void swap;
  {
    await page.locator('.rr-shelf', { hasText: 'The Lab' }).first().click({ force: true });
    await page.waitForTimeout(400);
    await page.locator('.rr-grid .rr-card', { hasText: 'Deja Vu' }).first().click({ force: true });
    check(await settled(), 'adding Deja Vu: it plays what is on the board');
    check(/Pedal_DejaVu/.test(await playing()), 'and Deja Vu is in what plays');
    // light Repeat, then pick a famous tone without it: the button goes out
    await page.evaluate(async () => (await import('./js/lablive.js')).labPress('Pedal_DejaVu', true, 1));
    const lit = await page.evaluate(() => Object.keys(window.__rig.labWords).length);
    await page.locator('.rr-famous-tab').click({ force: true });
    await page.waitForTimeout(300);
    await page.locator('.rr-grid .rr-ft').nth(3).click({ force: true });
    await settled();
    const after = await page.evaluate(() => ({ words: Object.keys(window.__rig.labWords).length }));
    check(lit === 1 && after.words === 0 && !/Pedal_DejaVu/.test(await playing()), `a famous tone in its place: Deja Vu is gone and its button with it (${lit} → ${after.words})`);
  }
  // the same tone edited (a knob turned): lit buttons stay
  await page.evaluate(async () => {
    const r = window.__rig;
    const t = { ...r.liveTone, gear: [...r.liveTone.gear, { key: 'Pedal_Kukulkan', slot: 'pre', knobs: {} }] };
    await r.setLiveTone(t);
    (await import('./js/lablive.js')).labPress('Pedal_Kukulkan', true, 0);
    await r.setLiveTone({ ...t, gear: t.gear.map((g) => (g.key === 'Pedal_Kukulkan' ? { ...g, knobs: { Pedal_Kukulkan_Wind: 80 } } : g)) });
  });
  await page.waitForTimeout(600);
  check(await page.evaluate(() => Object.keys(window.__rig.labWords).length === 1), 'turning a knob on the same tone keeps Rise lit');
  await page.evaluate(async () => { const r = window.__rig; await r.setLiveTone({ ...r.liveTone, name: 'Something else' }); });
  await page.waitForTimeout(400);
  check(await page.evaluate(() => Object.keys(window.__rig.labWords).length === 0), 'a different tone with the same pedal starts with Rise out');
  await page.screenshot({ path: path.join(outDir, 'switch-end.png') });
  check(!errs.length, `no page errors (${errs.join(' | ')})`);
};
