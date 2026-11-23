/* 4.24: what gets torn down and rebuilt (a likely blink) while Stagehand sits still, while you move between
   pages and menus, and while a song is split. Counts removed-and-added elements and pictures that load again.
   SH_AUDIT=test/e2e/flicker-audit.js node test/e2e/ui3-chromium.js native/build/stagehand-audio-fake <outDir> */
const fs = require('fs');
const path = require('path');
module.exports = async ({ page, outDir, check, stemHold }) => {
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
  await highwayWatch({ page, outDir, check, stemHold, take });
};

/* 4.29: the highway itself, (a) as a split finishes under it and (b) as Sound & settings opens over it.
   Watches each picture: the canvas swapped or resized, its picture size changed after it was drawn (that
   frame shows empty), the sharpness stepping, the canvas or the highway hidden, the song's clock jumping. */
async function highwayWatch({ page, outDir, check, stemHold, take }) {
  for (let i = 0; i < 3 && (await page.locator('.modal').count()); i++) await page.keyboard.press('Escape');
  const id = await page.evaluate(async () => { const { state } = await import('./js/store.js'); return [...state.songs.values()].find((s) => !s.hasStems)?.id; });
  check(!!id, 'a song without stems to split');
  if (!id) return;
  const send = (u) => page.evaluate((u) => window.__shEmit('stems:update', u), u);
  await send({ songId: id, state: 'none' });
  stemHold.add(id);
  await page.evaluate(async (id) => (await import('./js/actions.js')).playAlong(id), id);
  await page.waitForFunction(() => { const r = document.querySelector('.highway'); return r && !r.hidden && r.__hw && r.__hw.tab; }, null, { timeout: 30000 });
  await send({ songId: id, state: 'running', progress: 0.5 });
  await page.waitForTimeout(2500);
  await page.evaluate(async () => {
    const { engine } = await import('./js/stage.js');
    const root = document.querySelector('.highway');
    const H = root.__hw;
    const gl = root.querySelector('canvas.hw-gl');
    const R3 = H.r3;
    const W = (window.__hwW = { gl, r3: R3, ev: [], frames: 0, gap: 0, jumps: 0, afterDraw: 0, scale: 0, sizes: 0, hides: 0, rebuilt: 0 });
    // what of the highway itself is torn down (the top bar, the sections, Settings)
    new MutationObserver((list) => {
      for (const m of list) for (const n of m.removedNodes) if (n.nodeType === 1) W.rebuilt += n.querySelectorAll('*').length + 1;
    }).observe(root, { childList: true, subtree: true });
    let drawn = false;
    const render = R3.render;
    R3.render = function (...a) {
      drawn = true;
      setTimeout(() => (drawn = false));
      return render.apply(this, a);
    };
    const resize = R3.resize;
    R3.resize = function (...a) {
      if (drawn) (W.afterDraw++, W.ev.push('picture size changed after it was drawn'));
      W.sizes++;
      return resize.apply(this, a);
    };
    const setScale = R3.setScale;
    R3.setScale = function (s, r) {
      if (s !== R3.scale) (W.scale++, W.ev.push(`sharpness ${R3.scale} → ${s}`));
      return setScale.call(this, s, r);
    };
    new MutationObserver((list) => {
      for (const m of list) {
        const t = m.target;
        if (m.type === 'attributes' && (t === root || t === gl || t.contains(gl))) {
          const st = getComputedStyle(t);
          if (t.hidden || st.display === 'none' || st.visibility === 'hidden' || +st.opacity < 1) (W.hides++, W.ev.push(`hidden: ${t.className || t.tagName}`));
        }
      }
    }).observe(document.documentElement, { attributes: true, subtree: true, attributeFilter: ['hidden', 'style', 'class'] });
    // what the player was told lately (a jump names it)
    W.calls = [];
    for (const k of ['play', 'pause', 'seek']) {
      const e = engine;
      const f = e[k];
      e[k] = function (...a) { W.calls.push(`${k}(${a.map((x) => (typeof x === 'number' ? x.toFixed(2) : '')).join('')}) at ${e.position.toFixed(2)}`); return f.apply(this, a); };
    }
    let last = performance.now();
    let lastClock = null;
    const tick = () => {
      const now = performance.now();
      W.gap = Math.max(W.gap, now - last);
      last = now;
      if (root.hidden) return requestAnimationFrame(tick);
      if (W.gl !== root.querySelector('canvas.hw-gl') || W.r3 !== root.__hw.r3) W.ev.push('the highway canvas or its renderer was replaced');
      const c = H.vclock;
      if (lastClock !== null && Number.isFinite(c) && (c < lastClock - 0.05 || c - lastClock > 0.3)) (W.jumps++, W.ev.push(`clock jumped ${lastClock.toFixed(2)} → ${c.toFixed(2)} (${W.calls.slice(-4).join(', ')})`));
      lastClock = c;
      W.frames++;
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  const look = async (label) => {
    const r = await page.evaluate(() => {
      const W = window.__hwW;
      const o = { rebuilt: W.rebuilt, frames: W.frames, afterDraw: W.afterDraw, scale: W.scale, sizes: W.sizes, hides: W.hides, jumps: W.jumps, gap: Math.round(W.gap), ev: [...new Set(W.ev)].slice(0, 8) };
      Object.assign(W, { ev: [], frames: 0, gap: 0, jumps: 0, afterDraw: 0, scale: 0, sizes: 0, hides: 0, rebuilt: 0 });
      return o;
    });
    const dom = await take(label);
    console.log(`HWFLICK ${label}: ${r.frames} frames, ${r.afterDraw} resized after drawing, ${r.scale} sharpness changes, ${r.hides} hides, ${r.jumps} clock jumps, longest gap ${r.gap} ms, ${r.rebuilt} highway elements rebuilt (${dom.total} in all)${r.ev.length ? '\n   ' + r.ev.join('\n   ') : ''}${dom.top.length ? '\n   ' + dom.top.slice(0, 5).map(([k, n]) => `${n} ${k}`).join('\n   ') : ''}`);
    return { ...r, dom };
  };
  await look('start');
  await page.waitForTimeout(2000);
  const still = await look('highway waiting for the split, sitting still');
  // the sharpness steps down (frames too slow): the new size goes in before a frame is drawn
  await page.evaluate(() => (document.querySelector('.highway').__hw.perfState.want = 1));
  await page.waitForTimeout(300);
  await look('sharpness back up');
  await page.evaluate(() => {
    const P = document.querySelector('.highway').__hw.perfState;
    Object.assign(P, { n: 59, acc: 59 * 40, msAcc: 0, stalls: 0 });
  });
  await page.waitForTimeout(1000);
  const step = await look('the sharpness steps down');
  check(step.scale > 0 && step.afterDraw === 0, `a sharpness step goes in before the frame is drawn (${step.scale} steps, ${step.afterDraw} after drawing)`);
  // (a) the split finishes under the highway
  stemHold.delete(id);
  await send({ songId: id, state: 'ready' });
  await page.waitForTimeout(4000);
  const done = await look('the split finishes (stems load, the song starts)');
  await page.screenshot({ path: path.join(outDir, 'flicker-split-done.png') });
  // (b) Sound & settings opens over the highway while the song plays, then closes
  if (await page.locator('.highway .hw-dock:not(.collapsed)').count()) await page.locator('.highway .hw-set-btn').click();
  await page.waitForTimeout(1500);
  await look('before Settings');
  await page.locator('.highway .hw-set-btn').click();
  await page.waitForTimeout(2000);
  const open = await look('Sound & settings opens');
  await page.screenshot({ path: path.join(outDir, 'flicker-settings.png') });
  // while it is open: a song tone change, mix changes, a split elsewhere moving along
  await page.evaluate(async () => {
    const { engine } = await import('./js/stage.js');
    const { rig } = await import('./js/rig.js');
    for (let i = 0; i < 5; i++) {
      rig.dispatchEvent(new Event('change'));
      engine.dispatchEvent(new Event('mix'));
    }
  });
  const other = await page.evaluate(async (id) => { const { state } = await import('./js/store.js'); return [...state.songs.values()].find((s) => !s.hasStems && s.id !== id)?.id; }, id);
  for (let i = 0; other && i < 5; i++) {
    await send({ songId: other, state: 'running', progress: 0.2 + i * 0.1 });
    await page.waitForTimeout(150);
  }
  await page.waitForTimeout(500);
  const busy = await look('Settings open: tone, mix and another split change');
  check(busy.rebuilt === 0, `nothing on the highway is rebuilt when nothing it shows changed (${busy.rebuilt})`);
  if (other) await send({ songId: other, state: 'none' });
  await page.locator('.highway .hw-set-btn').click();
  await page.waitForTimeout(1500);
  const shut = await look('Sound & settings closes');
  check(done.rebuilt < 200, `the split finishing rebuilds little of the highway (${done.rebuilt})`);
  for (const [r, what] of [[still, 'sitting still'], [done, 'as the split finishes'], [open, 'as Settings opens'], [shut, 'as Settings closes']]) {
    check(r.afterDraw === 0 && r.hides === 0 && !r.ev.some((e) => /replaced/.test(e)), `the highway keeps its picture ${what} (${r.afterDraw} resized after drawing, ${r.hides} hides)`);
    check(r.jumps === 0, `the clock doesn't jump ${what} (${r.jumps})`);
  }
  await page.evaluate(() => window.__shHighway && window.__shHighway.leave());
}
