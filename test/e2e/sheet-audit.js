/** 4.22: what every control does, written under the controls: the Gear page, Create a tone, the
 * Tones page and step by step's Pedals. Each sheet says what the piece does, how to hear it working
 * (The Lab), and lists every knob, switch, footswitch and lever with its own words; turning a knob
 * or pressing a footswitch lights its line. Writes sheet-*.png.
 *   SH_AUDIT=test/e2e/sheet-audit.js node test/e2e/ui3-chromium.js native/build/stagehand-audio-fake <out>
 */
const path = require('path');
const G = require('../../src/renderer/data/gear2014.json');

module.exports = async ({ page, outDir, check }) => {
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  const shot = async (name, el) => {
    await page.waitForTimeout(400);
    await (el || page).screenshot({ path: path.join(outDir, `sheet-${name}.png`) });
  };
  const rows = (root) => page.locator(`${root} .gear-about .gear-about-knobs dt`).evaluateAll((els) => els.map((e) => e.dataset.ctl));
  const lit = (root) => page.locator(`${root} .gear-about .lit`).evaluateAll((els) => [...new Set(els.map((e) => e.dataset.ctl))]);
  const want = (key) => [...(G[key].k || []).map((k) => k[0].toLowerCase()), ...(G[key].m || []).map((m) => m[0].toLowerCase())];
  const drag = async (loc) => {
    await loc.scrollIntoViewIfNeeded();
    const b = await loc.boundingBox();
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
    await page.mouse.down();
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2 - 30, { steps: 5 });
    await page.mouse.up();
    await page.waitForTimeout(150);
  };
  for (let i = 0; i < 3 && (await page.locator('.modal').count()); i++) await page.keyboard.press('Escape');
  await page.setViewportSize({ width: 1600, height: 950 });
  await page.evaluate(() => document.querySelectorAll('.toast').forEach((t) => t.remove()));

  // ---------------------------------------------------------- the Gear page
  await page.locator('#sidebar .nav-section[data-page="gear"]').first().click();
  await page.waitForSelector('#page-gear .sr-card', { timeout: 15000 });
  // 4.24: the sheet starts folded into one line; open, it stays open for every piece
  check(await page.evaluate(() => { const d = document.querySelector('#page-gear .gear-sheet'); return !!d && !d.open; }), 'the sheet starts folded under the gear');
  await page.locator('#page-gear .gear-sheet > summary').first().click();
  await page.waitForTimeout(200);
  check(await page.evaluate(() => localStorage.getItem('stagehand.sheetOpen') === '1'), 'opening it is remembered');
  await page.locator('#page-gear .sr-shelf', { hasText: 'The Lab' }).first().click();
  await page.waitForTimeout(400);
  await page.locator('#page-gear .sr-grid .sr-card', { hasText: 'Fossil' }).first().click();
  await page.waitForTimeout(700);
  const GP = '#page-gear .sr-show';
  const tryText = await page.locator(`${GP} .gear-about-try p`).textContent().catch(() => '');
  check(/^Nothing happens until you use Capture/.test(tryText || ''), `the Gear page: Fossil says how to hear it working ("${(tryText || '').slice(0, 50)}…")`);
  check(JSON.stringify(await rows(GP)) === JSON.stringify(want('Pedal_Fossil')), `the Gear page: Fossil's sheet lists every knob and its Capture footswitch (${(await rows(GP)).join(', ')})`);
  check((await page.locator(`${GP} .gear-about-knobs dt[data-ctl="hold/latch"] small`).textContent()) === 'Switch' && /HOLD · LATCH/.test(await page.locator(`${GP} .gear-about-knobs dd[data-ctl="hold/latch"]`).textContent()), 'and says Hold/Latch is a switch, with its positions');
  await shot('gear-fossil', page.locator(`${GP} .gear-about`).first());

  // ---------------------------------------------------------- Create a tone
  await page.evaluate(async () => (await import('./js/rigroom.js')).openRig({ kind: 'guitar' }));
  await page.waitForTimeout(1500);
  await page.locator('.rr-shelf', { hasText: 'The Lab' }).first().click();
  await page.waitForTimeout(400);
  for (const [name, key] of [['Quack', 'Pedal_Quack'], ['Deja Vu', 'Pedal_DejaVu']]) {
    await page.locator('.rr-grid .rr-card', { hasText: name }).first().click();
    await page.waitForTimeout(1000);
    const R = '.rr-inspect';
    check((await page.locator(`${R} .gear-about`).count()) === 1, `Create a tone: ${name} has its sheet under the controls`);
    check(JSON.stringify(await rows(R)) === JSON.stringify(want(key)), `Create a tone: ${name}'s sheet lists all its controls (${(await rows(R)).join(', ')})`);
    const help = await page.locator(`${R} .gear-about-knobs dd`).allTextContents();
    check(help.every((t) => t.length > 12 && !/^Turn it and listen|^Hold to use|^Press to use|^Click to turn/.test(t)), `Create a tone: every line of ${name}'s sheet says what it does`);
    // turning a knob lights its line; pressing a footswitch lights its line
    const first = (G[key].k || [])[0][0];
    const kn = page.locator(`${R} .gb-strip .rknob[aria-label="${first}"]`).first();
    if (await kn.count()) {
      await drag(kn);
      check((await lit(R)).includes(first.toLowerCase()), `Create a tone: turning ${first} lights its line (${(await lit(R)).join(', ')})`);
    } else check(false, `Create a tone: ${name}'s ${first} is on the strip`);
    const m = (G[key].m || [])[0];
    if (m) {
      const fs = page.locator(`${R} .rhold[data-moment="${m[0].toLowerCase()}"]`).first();
      await fs.scrollIntoViewIfNeeded();
      const b = await fs.boundingBox();
      await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
      await page.mouse.down();
      await page.waitForTimeout(150);
      const l = await lit(R);
      await page.mouse.up();
      check(l.includes(m[0].toLowerCase()), `Create a tone: pressing ${m[0]} lights its line (${l.join(', ')})`);
    }
    await page.locator(`${R} .gear-about`).first().scrollIntoViewIfNeeded();
    await shot(`rig-${key.slice(6).toLowerCase()}`, page.locator('.modal.rig-room').first());
  }
  await page.locator('.rr-close').click();
  await page.waitForTimeout(500);
  for (let i = 0; i < 2 && (await page.locator('.modal').count()); i++) {
    const discard = page.locator('.modal button', { hasText: /Discard|Close without|Don.t save|Leave/ }).first();
    if (await discard.count()) await discard.click();
    else await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
  }

  // ---------------------------------------------------------- step by step: the Pedals step
  await page.evaluate(async () => (await import('./js/tonewizard.js')).openStepByStep({ kind: 'guitar' }));
  await page.waitForTimeout(1200);
  for (let i = 0; i < 4; i++) {
    await page.locator('.modal button.btn.primary', { hasText: 'Next' }).first().click();
    await page.waitForTimeout(500);
  }
  const add = page.locator('.modal .pb-add').first();
  if (await add.count()) {
    await add.click();
    await page.waitForTimeout(400);
    await page.locator('.modal .pb-choice[data-key="Pedal_Seance"]').first().click();
    await page.waitForTimeout(500);
    const more = page.locator('.modal .pb-pedal[data-key="Pedal_Seance"] details.pb-about').first();
    check((await more.count()) === 1, 'step by step: a Lab pedal on the board has "What does what?" under its knobs');
    if (await more.count()) {
      await more.locator('summary').click();
      await page.waitForTimeout(300);
      check(JSON.stringify(await rows('.modal .pb-pedal[data-key="Pedal_Seance"]')) === JSON.stringify(want('Pedal_Seance')), 'and it opens to every control of Seance');
      await shot('stepbystep', more);
    }
  } else check(false, 'step by step reaches Your pedals');
  for (let i = 0; i < 3 && (await page.locator('.modal').count()); i++) {
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
  }
  check(!errs.length, `no errors on the page${errs.length ? `: ${errs.slice(0, 3).join(' | ')}` : ''}`);
};
