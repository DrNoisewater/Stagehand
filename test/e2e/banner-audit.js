/** The page banner's picture rises into the top bar's empty middle without covering any control.
 *  Run: SH_AUDIT=test/e2e/banner-audit.js node test/e2e/ui3-chromium.js native/build/stagehand-audio-fake <outDir>
 *  BANNER_LOOKS=roadshow,opera  BANNER_SIZES=1920x1080,1280x800  BANNER_PAGES=play,songs,...  */
const path = require('path');
module.exports = async ({ page, outDir, check }) => {
  const looks = (process.env.BANNER_LOOKS || 'roadshow,opera').split(',');
  const sizes = (process.env.BANNER_SIZES || '1920x1080,1600x950,1280x800,1024x768').split(',').map(s => s.split('x').map(Number));
  const pages = (process.env.BANNER_PAGES || 'play,songs,discover,progress,tones,greenroom').split(',');
  const shots = new Set((process.env.BANNER_SHOTS || '1920x1080,1280x800').split(','));
  const go = async n => { await page.evaluate(async n => (await import('./js/store.js')).setPage(n), n); await page.waitForTimeout(900); };
  const closeModals = async () => { for (let i = 0; i < 3 && await page.locator('.modal').count(); i++) await page.keyboard.press('Escape'); };
  const measure = () => page.evaluate(() => {
    const r = el => { if (!el) return null; const b = el.getBoundingClientRect(); return b.width && b.height ? { x: b.left, y: b.top, r: b.right, b: b.bottom, w: b.width, h: b.height } : null; };
    const art = document.querySelector('.identity-banner .identity-art');
    const vis = art && !art.hidden && getComputedStyle(art).display !== 'none' && getComputedStyle(art).visibility !== 'hidden' && art.naturalWidth > 0;
    // the drawn picture inside the img box (object-fit: contain, anchored at the bottom)
    let drawn = null;
    if (vis) {
      const b = art.getBoundingClientRect(), cs = getComputedStyle(art);
      const bw = parseFloat(cs.width), bh = parseFloat(cs.height);
      const s = Math.min(bw / art.naturalWidth, bh / art.naturalHeight), w = art.naturalWidth * s, h = art.naturalHeight * s;
      const [px, py] = cs.objectPosition.split(' ').map(v => parseFloat(v) / 100);
      // ignores the small tilt; the bounding box of the tilted element covers it anyway
      drawn = { x: b.left + (b.width - bw) / 2 + (bw - w) * px, y: b.top + (b.height - bh) / 2 + (bh - h) * py, w, h };
      drawn.r = drawn.x + w; drawn.b = drawn.y + h;
    }
    return {
      art: vis ? r(art) : null, drawn, id: art && art.dataset.art, rise: document.querySelector('.identity-banner')?.dataset.rise,
      title: r(document.querySelector('.titlebar')), search: r(document.querySelector('.titlebar .search')),
      actions: r(document.querySelector('.titlebar-actions')), win: r(document.querySelector('.win-ctl')),
      options: r(document.querySelector('.identity-options')), banner: r(document.querySelector('.identity-banner')),
      // what sits on top at points across the search box and the buttons
      blocked: [...document.querySelectorAll('.titlebar .search, .titlebar-actions button:not([hidden]), .win-ctl button, .identity-options')].filter(el => {
        const b = el.getBoundingClientRect(); if (!b.width) return false;
        for (const [fx, fy] of [[.1, .5], [.5, .5], [.9, .5], [.5, .15], [.5, .85]]) {
          const top = document.elementFromPoint(b.left + b.width * fx, b.top + b.height * fy);
          if (top && !el.contains(top) && top !== el) return true;
        }
        return false;
      }).map(el => el.className || el.tagName),
    };
  });
  const snap = async n => { for (let i = 0; i < 3; i++) { try { return await page.screenshot({ path: path.join(outDir, n + '.png'), timeout: 20000 }); } catch (e) { console.log('screenshot retry', n, e.message.split('\n')[0]); } } };
  const hit = (a, b) => a && b && a.x < b.r && a.r > b.x && a.y < b.b && a.b > b.y;
  for (const look of looks) {
    await page.evaluate(look => {
      const k = 'stagehand.appearance.v1'; let p = {}; try { p = JSON.parse(localStorage.getItem(k)) || {}; } catch {}
      p.look = look; p.reduced = false; p.calm = false; localStorage.setItem(k, JSON.stringify(p));
    }, look);
    await page.reload(); await page.waitForTimeout(3000); await closeModals();
    check(await page.evaluate(look => document.documentElement.dataset.look === look, look), `${look}: look switched`);
    for (const [w, hgt] of sizes) {
      await page.setViewportSize({ width: w, height: hgt });
      for (const name of pages) {
        await go(name);
        const m = await measure();
        const tag = `${look} ${name} ${w}x${hgt}`;
        console.log('BANNER', tag, JSON.stringify({ id: m.id, rise: m.rise, art: m.art, drawn: m.drawn, title: m.title && m.title.b, search: m.search && m.search.r, actions: m.actions && m.actions.x }));
        check(m.blocked.length === 0, `${tag}: search, top-bar buttons and options stay clickable` + (m.blocked.length ? ' (' + m.blocked.join(', ') + ')' : ''));
        if (m.art) {
          for (const k of ['search', 'actions', 'win', 'options']) check(!hit(m.art, m[k]), `${tag}: picture clear of ${k}`);
          // tall pictures rise into the top bar; wide ones stay in the banner (one size budget for all art)
          check(m.drawn.w <= 382 && m.drawn.h <= 202 && m.drawn.w * m.drawn.h <= 190 * 190 * 1.08, `${tag}: picture stays within its size budget (${Math.round(m.drawn.w)}x${Math.round(m.drawn.h)})`);
          if (m.rise === 'rise') check(m.drawn.y < m.title.b - 8, `${tag}: picture rises into the top bar (${Math.round(m.drawn.y)} < ${Math.round(m.title.b)})`);
          else check(m.rise === 'inside' && m.drawn.y >= m.banner.y - 1, `${tag}: no room to rise, the picture sits in the banner`);
        }
        if (shots.has(`${w}x${hgt}`)) await snap(`${look}-${name}-${w}`);
      }
    }
    await page.setViewportSize({ width: 1600, height: 950 });
  }
  // less decoration hides the picture, calm and reduced motion stop the entrance
  await page.evaluate(() => { const k = 'stagehand.appearance.v1'; const p = JSON.parse(localStorage.getItem(k) || '{}'); p.reduced = true; localStorage.setItem(k, JSON.stringify(p)); });
  await page.reload(); await page.waitForTimeout(2500); await closeModals(); await go('play');
  check(!(await measure()).art, 'less decoration hides the picture');
  await page.evaluate(() => { const k = 'stagehand.appearance.v1'; const p = JSON.parse(localStorage.getItem(k) || '{}'); p.reduced = false; p.look = 'roadshow'; localStorage.setItem(k, JSON.stringify(p)); });
  await page.emulateMedia({ reducedMotion: 'reduce' }); await page.reload(); await page.waitForTimeout(2500); await closeModals(); await go('songs');
  check(await page.evaluate(() => getComputedStyle(document.querySelector('.identity-art')).animationName === 'none'), 'reduced motion: the picture does not animate');
  await page.emulateMedia({ reducedMotion: 'no-preference' });
};
