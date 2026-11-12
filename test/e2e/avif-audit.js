/** 4.9.1: every picture is AVIF now. Loads each one the app names (art list, gear photos, the Drop,
 *  CSS backgrounds, the splash) in the real page, then shoots the Gear page with a piece open.
 *  Run: SH_AUDIT=test/e2e/avif-audit.js node test/e2e/ui3-chromium.js native/build/stagehand-audio-fake <outDir>  */
const path = require('path');
const fs = require('fs');
module.exports = async ({ page, outDir, check }) => {
  const root = path.join(__dirname, '../../src/renderer');
  // CSS and the splash name some pictures directly
  const fromText = [];
  for (const f of ['css', 'splash'].flatMap((d) => fs.readdirSync(path.join(root, d)).map((x) => path.join(d, x)))) {
    const s = fs.readFileSync(path.join(root, f), 'utf8');
    for (const m of s.matchAll(/(?:\.\.\/)?art\/[A-Za-z0-9_/.-]+\.avif/g)) fromText.push(m[0].replace(/^\.\.\//, ''));
    for (const m of s.matchAll(/\$\{roadshowArt\}([A-Za-z0-9_-]+\.avif)/g)) fromText.push(`art/roadshow/${m[1]}`);
  }
  const res = await page.evaluate(async (fromText) => {
    const { ART } = await import('./js/identity-art.js');
    const { GEAR_PHOTOS } = await import('./js/gear-photos.js');
    const urls = new Set([...ART.map((a) => `art/${a.file}`), ...Object.values(GEAR_PHOTOS).map((g) => `art/gear/${g.file}`),
      'art/gear/full/digitech-drop.avif', ...fromText, ...(await fetch('art/manifest.json').then((r) => r.json())).assets.map((a) => `art/${a.file}`)]);
    const bad = [];
    let avif = 0;
    await Promise.all([...urls].map((u) => new Promise((ok) => {
      if (u.endsWith('.avif')) avif++;
      const i = new Image();
      i.onload = () => { if (!i.naturalWidth) bad.push(u); ok(); };
      i.onerror = () => { bad.push(u); ok(); };
      i.src = u;
    })));
    return { n: urls.size, avif, bad };
  }, fromText);
  check(res.bad.length === 0 && res.avif > 300, `all ${res.n} pictures load (${res.avif} AVIF) ${res.bad.slice(0, 10).join(' ')}`);
  // the Gear page with a piece open: the big photo and its turning knobs
  await page.setViewportSize({ width: 1600, height: 950 });
  await page.evaluate(async () => (await import('./js/store.js')).setPage('gear'));
  await page.waitForTimeout(1500);
  const tile = page.locator('#page-gear img').first();
  if (await tile.count()) await tile.click().catch(() => {});
  await page.waitForTimeout(1500);
  const shown = await page.evaluate(() => [...document.querySelectorAll('#page-gear img')].filter((i) => i.complete && i.src.endsWith('.avif')).map((i) => [i.naturalWidth, i.src.split('/').pop()]));
  check(shown.length > 0 && shown.every(([w]) => w > 0), `Gear page shows its photos (${shown.length} big photos on screen)`);
  await page.screenshot({ path: path.join(outDir, 'avif-gear.png') });
  await page.evaluate(async () => (await import('./js/store.js')).setPage('play'));
  await page.waitForTimeout(1500);
  await page.screenshot({ path: path.join(outDir, 'avif-jam.png') });
};
