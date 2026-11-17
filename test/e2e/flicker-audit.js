/* 4.24: what gets torn down and rebuilt (a likely blink) while Stagehand sits still, while you move between
   pages and menus, and while a song is split. Counts removed-and-added elements and pictures that load again.
   SH_AUDIT=test/e2e/flicker-audit.js node test/e2e/ui3-chromium.js native/build/stagehand-audio-fake <outDir> */
const fs = require('fs');
const path = require('path');
module.exports = async ({ page, outDir, check }) => {
  await page.evaluate(() => {
    const W = (window.__flick = { removed: new Map(), imgs: 0, styleOps: 0 });
    const tag = (n) => {
      if (n.nodeType !== 1) return null;
      let p = n;
      const parts = [];
      for (let i = 0; i < 3 && p && p.nodeType === 1; i++, p = p.parentElement) parts.unshift(p.id ? `#${p.id}` : `${p.tagName.toLowerCase()}${p.classList[0] ? '.' + p.classList[0] : ''}`);
      return parts.join(' > ');
    };
    new MutationObserver((list) => {
      for (const m of list) {
        if (m.type !== 'childList') continue;
        for (const n of m.removedNodes) {
          if (n.nodeType !== 1 || !n.isConnected === false) continue;
          const big = n.getBoundingClientRect ? 1 : 0;
          const k = tag(m.target) + ' ⟶ ' + (n.className && typeof n.className === 'string' ? n.tagName.toLowerCase() + '.' + n.className.split(' ')[0] : n.tagName.toLowerCase());
          const sz = n.querySelectorAll ? n.querySelectorAll('*').length + 1 : 1;
          W.removed.set(k, (W.removed.get(k) || 0) + sz);
        }
      }
    }).observe(document.body, { childList: true, subtree: true });
    document.addEventListener('load', (e) => { if (e.target && e.target.tagName === 'IMG') W.imgs++; }, true);
  });
  const take = async (label) => {
    const r = await page.evaluate(() => {
      const W = window.__flick;
      const top = [...W.removed.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12);
      const out = { total: [...W.removed.values()].reduce((a, b) => a + b, 0), imgs: W.imgs, top };
      W.removed.clear();
      W.imgs = 0;
      return out;
    });
    return { label, ...r };
  };
  const out = [];
  await take('start');
  await page.waitForTimeout(8000);
  out.push(await take('8 s sitting still on Songs'));
  for (const p of ['tones', 'gear', 'progress', 'discover', 'greenroom', 'songs', 'play', 'songs']) {
    await page.evaluate(async (p) => (await import('./js/store.js')).setPage(p), p);
    await page.waitForTimeout(1200);
    out.push(await take(`go to ${p}`));
  }
  await page.waitForTimeout(6000);
  out.push(await take('6 s still on Songs again'));
  // a split moving along: progress every 300 ms for 6 s
  const id = await page.evaluate(async () => { const { state } = await import('./js/store.js'); return [...state.songs.values()].find((s) => !s.hasStems)?.id; });
  for (let i = 0; i < 20; i++) {
    await page.evaluate(([id, p]) => window.__shEmit('stems:update', { songId: id, state: 'running', progress: p, message: 'Separating' }), [id, 0.1 + i * 0.04]);
    await page.waitForTimeout(300);
  }
  out.push(await take('a split moving along (20 updates)'));
  // menus: the song menu, the library's More, hovering the sidebar
  const row = page.locator('#library .row').first();
  await row.click({ button: 'right' });
  await page.waitForTimeout(500);
  await page.mouse.move(400, 300);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);
  for (const s of await page.locator('#sidebar .nav-section').all()) await s.hover().catch(() => {});
  await page.waitForTimeout(500);
  out.push(await take('a menu, and the mouse over the left menu'));
  fs.writeFileSync(path.join(outDir, 'flicker.json'), JSON.stringify(out, null, 1));
  for (const o of out) console.log(`FLICK ${o.label}: ${o.total} elements rebuilt, ${o.imgs} pictures loaded${o.top.length ? '\n   ' + o.top.slice(0, 6).map(([k, n]) => `${n} ${k}`).join('\n   ') : ''}`);
  check(true, 'measured');
};
