/** 4.16.3: the Setup window's header art, cut from the app's own page banner (the Rehearsal Room look), so
 *  Setup looks like the app. Run in the real page (dev time; the pictures are committed):
 *    SH_AUDIT=windows/setup/make-art.js node test/e2e/ui3-chromium.js native/build/stagehand-audio-fake <out>
 *  Writes windows/setup/art/header-setup.png and header-remove.png (twice the window's size, for sharp text);
 *  then `python3 windows/setup/make-art.py` packs them for the build. */
const fs = require('fs');
const path = require('path');
const OUT = path.join(__dirname, 'art');
const W = 700; // the Setup window's width
const PAD = 34; // the banner is made wider and its left edge left out (the menu shows through there)
const H = 172; // the header's height

module.exports = async ({ page, check }) => {
  for (let i = 0; i < 3 && (await page.locator('.modal').count()); i++) await page.keyboard.press('Escape');
  await page.evaluate(async () => (await import('./js/store.js')).setPage('play'));
  await page.waitForTimeout(800);
  const cdp = await page.context().newCDPSession(page);
  const shoot = async (file, kicker, line, sticker, mascot) => {
    // size the window so the banner is exactly as wide as Setup's window
    let vw = 960;
    for (let i = 0; i < 5; i++) {
      await cdp.send('Emulation.setDeviceMetricsOverride', { width: vw, height: 760, deviceScaleFactor: 2, mobile: false });
      await page.waitForTimeout(500);
      const bw = await page.evaluate(() => document.getElementById('identity-banner').getBoundingClientRect().width);
      if (Math.abs(bw - (W + PAD)) < 1) break;
      vw = Math.round(vw - (bw - (W + PAD)));
    }
    await page.evaluate(async ({ kicker, line, sticker, mascot, H }) => {
      document.documentElement.dataset.calm = 'true';
      const b = document.getElementById('identity-banner');
      b.dataset.paper = 'kraft';
      b.dataset.mark = 'highlight';
      b.dataset.tape = 'masking';
      b.dataset.wall = 'none';
      b.style.height = `${H}px`;
      b.querySelector('.identity-kicker').textContent = kicker;
      const t = b.querySelector('.identity-title');
      t.textContent = 'STAGEHAND';
      t.dataset.text = 'STAGEHAND';
      b.querySelector('.identity-line').textContent = line;
      const st = b.querySelector('.opera-sticker');
      st.hidden = !sticker;
      st.textContent = sticker;
      st.style.setProperty('--tilt', '-3deg');
      b.querySelector('.opera-sticker-img').hidden = true;
      for (const el of b.querySelectorAll('.identity-art-wrap, .identity-options, .banner-corner, .opera-fx .tape')) el.style.display = 'none';
      for (const el of b.querySelectorAll('*')) el.style.animation = 'none';
      let m = b.querySelector('.setup-mascot');
      if (!m) {
        m = document.createElement('div');
        m.className = 'setup-mascot';
        m.style.cssText = 'position:absolute;right:16px;bottom:4px;width:170px;height:158px;z-index:60;background:center bottom/contain no-repeat;filter:drop-shadow(3px 4px 0 #000a);transform:rotate(4deg);pointer-events:none';
        b.append(m);
      }
      m.style.backgroundImage = `url('${mascot}')`;
      const img = new Image();
      img.src = mascot;
      return img.decode().catch(() => {});
    }, { kicker, line, sticker, mascot, H });
    await page.waitForTimeout(1500);
    const r = await page.evaluate(() => {
      const x = document.getElementById('identity-banner').getBoundingClientRect();
      return { x: x.left, y: x.top, w: x.width, h: x.height };
    });
    // straight from the browser (Playwright's own screenshot doesn't know about the 2× set above)
    const shot = await cdp.send('Page.captureScreenshot', { format: 'png', clip: { x: r.x + PAD, y: r.y, width: W, height: H, scale: 1 }, captureBeyondViewport: false });
    fs.writeFileSync(path.join(OUT, file), Buffer.from(shot.data, 'base64'));
    check(Math.abs(r.w - W - PAD) < 2, `${file}: banner ${Math.round(r.w)}×${Math.round(r.h)}`);
  };
  await shoot('header-setup.png', 'SETUP', 'Plug in, tune up, play along.', '', 'art/rehearsal/amp-imp.avif');
  await shoot('header-remove.png', 'UNINSTALL', 'Your songs and their files stay where they are.', '', 'art/rehearsal/tech-roadie.avif');
  console.log('wrote', fs.readdirSync(OUT).join(', '));
};
