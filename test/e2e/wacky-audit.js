/** 4.20: the wacky pedals (Quack, Croak, Caterwaul, Blorp) on the real page: the Gear page's Wacky
 * shelf for guitar and bass, each pedal's photo with its three knobs turning, its spec sheet, playing
 * it, the rig (Create a tone) and the step-by-step Pedals step. Writes wacky-*.png.
 *   SH_AUDIT=test/e2e/wacky-audit.js node test/e2e/ui3-chromium.js native/build/stagehand-audio-fake <out>
 */
const path = require('path');
const PEDALS = [
  ['Quack', 'Pedal_Quack', ['Beak', 'Wobble', 'Blend']],
  ['Croak', 'Pedal_Croak', ['Throat', 'Hop', 'Blend']],
  ['Caterwaul', 'Pedal_Caterwaul', ['Meow', 'Hiss', 'Blend']],
  ['Blorp', 'Pedal_Blorp', ['Vowel', 'Orbit', 'Blend']],
];
module.exports = async ({ page, outDir, check }) => {
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  const shot = async (name) => {
    await page.waitForTimeout(400);
    await page.screenshot({ path: path.join(outDir, `wacky-${name}.png`) });
  };
  const liveSpec = () => page.evaluate(async () => { const { toSpec } = await import('./js/gearspec.js'); return window.__rig.liveTone ? toSpec(window.__rig.liveTone) : ''; });
  for (let i = 0; i < 3 && (await page.locator('.modal').count()); i++) await page.keyboard.press('Escape');
  await page.setViewportSize({ width: 1600, height: 950 });
  await page.evaluate(() => document.querySelectorAll('.toast').forEach((t) => t.remove()));
  await page.locator('#sidebar .nav-section[data-page="gear"]').first().click();
  await page.waitForSelector('#page-gear .sr-card', { timeout: 15000 });

  // ---------------------------------------------------------- the Gear page
  const shelf = page.locator('#page-gear .sr-shelf', { hasText: 'Wacky' }).first();
  check((await shelf.count()) === 1, 'the Gear page has a Wacky shelf');
  await shelf.click();
  await page.waitForTimeout(500);
  const names = await page.locator('#page-gear .sr-grid .sr-card .sr-card-name').allTextContents();
  check(PEDALS.every(([n]) => names.includes(n)) && names.length === 4, `the Wacky shelf holds the four pedals (${names.join(', ')})`);
  await shot('shelf');
  for (const [name, key, knobs] of PEDALS) {
    await page.locator('#page-gear .sr-grid .sr-card', { hasText: name }).first().click();
    await page.waitForTimeout(1000);
    const photo = await page.evaluate(() => {
      const img = document.querySelector('#page-gear .sr-show img');
      return img ? { src: img.getAttribute('src') || '', ok: img.complete && img.naturalWidth > 100 } : null;
    });
    check(!!photo && photo.ok && photo.src.includes(key), `${name}: its own photo is shown (${photo && photo.src})`);
    const hot = await page.locator('#page-gear .sr-show .gear-hotspot.turns').evaluateAll((els) => els.map((e) => e.getAttribute('aria-label')));
    const strip = await page.locator('#page-gear .sr-show .gb-strip .rknob').evaluateAll((els) => els.map((e) => e.getAttribute('aria-label')));
    check(knobs.every((k) => hot.includes(k)), `${name}: ${knobs.join(', ')} turn on the photo (${hot.join(', ')})`);
    check(knobs.every((k) => strip.includes(k)), `${name}: and on the strip beside it (${strip.join(', ')})`);
    // every knob on the photo moves, and the strip follows
    for (const k of knobs) {
      const s = page.locator(`#page-gear .sr-show .gb-strip .rknob[aria-label="${k}"]`).first();
      const before = Number(await s.getAttribute('aria-valuenow'));
      const hk = page.locator(`#page-gear .sr-show .gear-hotspot.turns[aria-label="${k}"]`).first();
      const b = await hk.boundingBox();
      const up = before < 80;
      await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
      await page.mouse.down();
      await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2 + (up ? -70 : 70), { steps: 7 });
      await page.mouse.up();
      await page.waitForTimeout(250);
      const after = Number(await s.getAttribute('aria-valuenow'));
      check(up ? after > before : after < before, `${name}: turning ${k} on the photo moves it (${before} to ${after})`);
    }
    const sheet = await page.evaluate(() => {
      const c = document.querySelector('#page-gear .gear-about');
      return c ? { text: (c.querySelector('.gear-about-text') || {}).textContent || '', dt: [...c.querySelectorAll('dt')].map((d) => d.textContent.trim()) } : null;
    });
    check(!!sheet && sheet.text.length > 40, `${name}: a spec sheet says what it does (${sheet && sheet.text.slice(0, 60)}…)`);
    check(!!sheet && knobs.every((k) => sheet.dt.some((d) => d.toLowerCase().includes(k.toLowerCase()))), `${name}: and what each knob does (${sheet && sheet.dt.join(', ')})`);
    const help = await page.evaluate(() => [...document.querySelectorAll('#page-gear .gear-about dd')].map((d) => d.textContent.trim()));
    check(help.length >= 3 && help.every((t) => t && t !== 'Turn it and listen'), `${name}: each knob has its own words`);
    await shot(name.toLowerCase());
  }
  // played with your guitar: the pedal is heard in front of the amp
  await page.locator('#page-gear .sr-grid .sr-card', { hasText: 'Quack' }).first().click();
  await page.waitForTimeout(800);
  await page.locator('#page-gear .sr-live').click();
  await page.waitForTimeout(700);
  check(/gear\tpre\tPedal_Quack/.test(await liveSpec()), 'Play it with my guitar puts Quack in front of the amp');
  await page.locator('#page-gear .sr-live').click();
  await page.waitForTimeout(300);
  // bass: the same four are there, not marked as guitar only
  const bassB = page.locator('#page-gear .sr-who button', { hasText: 'Bass' }).first();
  if (await bassB.count()) {
    await bassB.click();
    await page.waitForTimeout(400);
    await page.locator('#page-gear .sr-shelf', { hasText: 'Wacky' }).first().click();
    await page.waitForTimeout(400);
    const bn = await page.locator('#page-gear .sr-grid .sr-card .sr-card-name').allTextContents();
    check(PEDALS.every(([n]) => bn.includes(n)), `with Bass picked the Wacky shelf still has all four (${bn.join(', ')})`);
    await shot('shelf-bass');
    const allB = page.locator('#page-gear .sr-who button', { hasText: 'All' }).first();
    if (await allB.count()) await allB.click();
  } else check(false, 'the Gear page has a Bass choice');

  // ---------------------------------------------------------- the rig (Create a tone)
  for (const kind of ['guitar', 'bass']) {
    await page.evaluate(async (k) => (await import('./js/rigroom.js')).openRig({ kind: k }), kind);
    await page.waitForTimeout(1500);
    check((await page.locator('.modal.rig-room').count()) === 1, `Create a tone opens (${kind})`);
    await page.locator('.rr-shelf', { hasText: 'Wacky' }).first().click();
    await page.waitForTimeout(400);
    const cards = await page.locator('.rr-grid .rr-card').evaluateAll((els) => els.map((e) => ({ n: (e.querySelector('.rr-card-name') || {}).textContent, other: e.classList.contains('other') })));
    check(cards.length === 4 && cards.every((c) => !c.other), `the rig's Wacky shelf: four pedals, none greyed out for ${kind} (${cards.map((c) => c.n + (c.other ? ' (other)' : '')).join(', ')})`);
    const pick = kind === 'guitar' ? 'Croak' : 'Blorp';
    await page.locator('.rr-grid .rr-card', { hasText: pick }).first().click();
    await page.waitForTimeout(800);
    const spec = await liveSpec();
    check(new RegExp(`gear\\tpre\\tPedal_${pick}`).test(spec), `adding ${pick} on ${kind} is heard straight away, in front of the amp`);
    const rk = await page.locator('.rr-inspect .gb-strip .rknob').evaluateAll((els) => els.map((e) => e.getAttribute('aria-label')));
    check(rk.length >= 3, `${pick}'s knobs are in the rig (${rk.join(', ')})`);
    const hk = page.locator('.rr-inspect .gear-hotspot.turns').first();
    if (await hk.count()) {
      const label = await hk.getAttribute('aria-label');
      const s = page.locator(`.rr-inspect .gb-strip .rknob[aria-label="${label}"]`).first();
      const before = Number(await s.getAttribute('aria-valuenow'));
      const b = await hk.boundingBox();
      await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
      await page.mouse.down();
      await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2 - 60, { steps: 6 });
      await page.mouse.up();
      await page.waitForTimeout(400);
      const after = Number(await s.getAttribute('aria-valuenow'));
      const v = (spec.match(new RegExp(`k\\t${label}\\t([\\d.]+)`)) || [])[1];
      const v2 = ((await liveSpec()).match(new RegExp(`k\\t${label}\\t([\\d.]+)`)) || [])[1];
      check(after > before && v2 !== v, `turning ${label} on ${pick}'s photo in the rig is heard (${v} to ${v2})`);
    } else check(false, `${pick}'s photo knobs turn in the rig`);
    await shot(`rig-${kind}`);
    if (kind === 'guitar') {
      await page.locator('.rr-name').fill('Wacky test');
      await page.locator('.rr-save').click();
      await page.waitForTimeout(900);
      const saved = await page.evaluate(async () => { const { tonelib } = await import('./js/tonelib.js'); return tonelib.list.find((t) => t.name === 'Wacky test'); });
      const cg = saved && saved.gear.find((g) => g.key === 'Pedal_Croak');
      check(!!cg && cg.knobs && Object.keys(cg.knobs).length >= 1, `a tone with Croak saves with it and its knobs (${cg ? JSON.stringify(cg.knobs) : saved ? saved.gear.map((g) => g.key).join(', ') : 'not saved'})`);
    }
    await page.locator('.rr-close').click();
    await page.waitForTimeout(500);
    for (let i = 0; i < 2 && (await page.locator('.modal').count()); i++) {
      const discard = page.locator('.modal button', { hasText: /Discard|Close without|Don.t save|Leave/ }).first();
      if (await discard.count()) await discard.click();
      else await page.keyboard.press('Escape');
      await page.waitForTimeout(300);
    }
  }

  // ---------------------------------------------------------- step by step: the Pedals step
  await page.evaluate(async () => (await import('./js/tonewizard.js')).openStepByStep({ kind: 'bass' }));
  await page.waitForTimeout(1200);
  for (let i = 0; i < 4; i++) {
    await page.locator('.modal button.btn.primary', { hasText: 'Next' }).first().click();
    await page.waitForTimeout(500);
  }
  const add = page.locator('.modal .pb-add').first();
  check((await add.count()) === 1, 'step by step reaches Your pedals');
  if (await add.count()) {
    await add.click();
    await page.waitForTimeout(400);
    const groups = await page.locator('.modal .pb-pick h5').allTextContents();
    const choices = await page.locator('.modal .pb-pick .pb-choice').evaluateAll((els) => els.map((e) => e.getAttribute('data-key')));
    check(groups.some((g) => /Wacky/.test(g)) && PEDALS.every(([, k]) => choices.includes(k)), `the Pedals step offers the Wacky four on bass (${groups.join(' | ')})`);
    await page.locator('.modal .pb-choice[data-key="Pedal_Caterwaul"]').first().click();
    await page.waitForTimeout(500);
    const knobs = await page.locator('.modal .pb-pedal .rknob, .modal .pb-pedal [role=slider]').count();
    check(knobs >= 3, `Caterwaul on the board shows its knobs (${knobs})`);
    await shot('stepbystep');
  }
  for (let i = 0; i < 3 && (await page.locator('.modal').count()); i++) {
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
  }
  check(!errs.length, `no errors on the page${errs.length ? `: ${errs.slice(0, 3).join(' | ')}` : ''}`);
};
