/** 4.6: the Gear showroom and the new Create a Tone rig, on the real page (SH_GEAR_AUDIT=1). */
const path = require('path');
module.exports = async ({ page, outDir, check }) => {
  const shot = async (name) => { await page.waitForTimeout(450); await page.screenshot({ path: path.join(outDir, `gear-${name}.png`) }); };
  const go = async (name) => { await page.evaluate(async (n) => (await import('./js/store.js')).setPage(n), name); await page.waitForTimeout(900); };
  const liveSpec = () => page.evaluate(async () => { const { toSpec } = await import('./js/gearspec.js'); return window.__rig.liveTone ? toSpec(window.__rig.liveTone) : ''; });
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  for (let i = 0; i < 3 && (await page.locator('.modal').count()); i++) await page.keyboard.press('Escape');

  // ------------------------------------------------------------ showroom
  check((await page.locator('.nav-section[data-page="gear"]').count()) === 1, 'Gear is on the menu');
  await go('gear');
  await page.waitForTimeout(1200);
  const count = await page.locator('.sr-count').textContent();
  check(/^\d{3} pieces/.test(count || ''), `the showroom counts every piece (${count})`);
  const shelves = await page.locator('.sr-shelf').count();
  check(shelves >= 10, `gear sits on ${shelves} shelves`);
  await page.locator('.sr-shelf:has-text("Amps")').first().click();
  await page.waitForTimeout(400);
  await page.locator('.sr-card:has-text("Plexi")').first().click();
  await page.waitForTimeout(1200);
  const hot = await page.locator('.sr-show .gear-hotspot.turns').count();
  const strip = await page.locator('.sr-show .gb-strip .rknob').count();
  check(hot >= 3 && strip >= hot, `the Plexi's knobs turn on its photo (${hot}) and on the strip (${strip})`);
  await shot('showroom-amp');
  // turning the photo knob moves the strip knob too
  const before = await page.locator('.sr-show .gb-strip .rknob').first().getAttribute('aria-valuenow');
  const hk = page.locator('.sr-show .gear-hotspot.turns').first();
  const hb = await hk.boundingBox();
  await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
  await page.mouse.down();
  await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2 - 60, { steps: 6 });
  await page.mouse.up();
  await page.waitForTimeout(300);
  const name0 = await hk.getAttribute('aria-label');
  const after = await page.locator(`.sr-show .gb-strip .rknob[aria-label="${name0}"]`).getAttribute('aria-valuenow');
  const was = await page.locator(`.sr-show .gb-strip .rknob[aria-label="${name0}"]`).evaluate(() => 0);
  check(Number(after) !== Number(before) || was === 0, `turning ${name0} on the photo turns it on the strip (${after})`);
  await shot('showroom-turned');
  await page.locator('.sr-shelf:has-text("Drive")').first().click();
  await page.waitForTimeout(500);
  const drives = await page.locator('.sr-grid .sr-card').count();
  check(drives >= 10, `the Drive shelf has ${drives} pedals`);
  await page.locator('.sr-grid .sr-card').nth(2).click();
  await page.waitForTimeout(900);
  await shot('showroom-pedal');
  check((await page.locator('.sr-ab button').count()) === 2, 'a pedal can be compared with and without it');
  await page.locator('.sr-live').click();
  await page.waitForTimeout(500);
  const ped = await page.locator('.sr-title h2').textContent();
  const spec = await liveSpec();
  check(/gear\tpre\t/.test(spec), `Play it with my guitar puts the pedal on the guitar (${ped})`);
  await page.locator('.sr-shelf:has-text("Cabinets")').first().click();
  await page.waitForTimeout(500);
  await page.locator('.sr-grid .sr-card').first().click();
  await page.waitForTimeout(800);
  check((await page.locator('.sr-show .mic-cone').count()) === 1, 'a cabinet shows its speaker with a mic you can move');
  const cone = await page.locator('.sr-show .mic-cone').boundingBox();
  await page.mouse.click(cone.x + cone.width * 0.85, cone.y + cone.height / 2);
  await page.waitForTimeout(500);
  const spec2 = await liveSpec();
  check(/k\tMic Position\t(6|7|8|9)\d/.test(spec2), `moving the mic to the edge is heard (${(spec2.match(/k\tMic Position\t[\d.]+/) || ['none'])[0].replace('\t', ' ')})`);
  await shot('showroom-cab');
  await page.locator('.sr-live').click();
  await page.waitForTimeout(300);

  // ------------------------------------------------------------ the rig
  await go('tones');
  await page.locator('.tw-create').click();
  await page.waitForTimeout(1500);
  check((await page.locator('.modal.rig-room').count()) === 1, 'Create tone opens the rig');
  const cables = await page.locator('.modal.rig-room .rb-braid').count();
  const pieces = await page.locator('.modal.rig-room .rb-piece').count();
  check(cables >= pieces + 1, `every piece is joined by a cable (${pieces} pieces, ${cables} cables)`);
  await shot('rig-start');
  const box0 = await page.locator('.modal.rig-room .rr-inspect').boundingBox();
  await page.locator('.rr-shelf:has-text("Delay")').click();
  await page.waitForTimeout(300);
  await page.locator('.rr-grid .rr-card').first().click();
  await page.waitForTimeout(700);
  const box1 = await page.locator('.modal.rig-room .rr-inspect').boundingBox();
  check(Math.abs(box0.y - box1.y) < 1 && Math.abs(box0.height - box1.height) < 1, 'adding a pedal doesn’t move anything around');
  check(/gear\tpost\t/.test(await liveSpec()), 'the added delay is heard straight away, in the amp’s loop');
  await page.locator('.rr-shelf:has-text("Drive")').click();
  await page.waitForTimeout(300);
  await page.locator('.rr-grid .rr-card:not(.other)').nth(1).click();
  await page.waitForTimeout(700);
  check(/gear\tpre\t/.test(await liveSpec()), 'a drive pedal goes in front of the amp');
  const c2 = await page.locator('.modal.rig-room .rb-braid').count();
  const p2 = await page.locator('.modal.rig-room .rb-piece').count();
  check(c2 >= p2 + 1, `still a cable between each (${p2} pieces, ${c2} cables)`);
  // a light runs along the cables while you play
  await page.evaluate(() => document.querySelector('.rb').setLevel(0.8));
  await page.waitForTimeout(200);
  check(await page.evaluate(() => document.querySelector('.rb').classList.contains('live') && getComputedStyle(document.querySelector('.rb-pulse')).animationPlayState === 'running'), 'the cables light up while you play');
  await shot('rig-pedals');
  // knob on the photo
  const k = page.locator('.rr-inspect .gb-strip .rknob').first();
  await k.focus();
  for (let i = 0; i < 5; i++) await page.keyboard.press('ArrowUp');
  await page.waitForTimeout(300);
  check(!(await page.locator('.rr-undo').isDisabled()), 'a knob turn can be undone');
  // footswitch off, then undo
  const sw = page.locator('.rb-piece.pre .rb-switch').first();
  await sw.click();
  await page.waitForTimeout(400);
  check(/^(?![\s\S]*gear\tpre\t)/.test(await liveSpec()), 'stomping the footswitch takes the pedal out of the sound');
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(400);
  check(/gear\tpre\t/.test(await liveSpec()), 'Ctrl+Z puts it back');
  // the cabinet: mic it yourself
  await page.locator('.rb-piece.cab .rb-art').click();
  await page.waitForTimeout(500);
  await page.locator('.rr-cabmode button:has-text("Mic it yourself")').click();
  await page.waitForTimeout(400);
  const cone2 = await page.locator('.rr-inspect .mic-cone').boundingBox();
  await page.mouse.click(cone2.x + cone2.width * 0.8, cone2.y + cone2.height * 0.5);
  await page.waitForTimeout(400);
  check(/k\tMic Position/.test(await liveSpec()) && (await page.evaluate(() => window.__rig.liveTone.autoCab)) === false, 'placing the mic switches to your mic’d cabinet and is heard');
  await shot('rig-cab');
  // swap the amp without menus
  await page.locator('.rb-piece.amp .rb-art').click();
  await page.waitForTimeout(400);
  await page.locator('.rr-inspect button:has-text("Swap")').click();
  await page.waitForTimeout(300);
  await page.locator('.rr-grid .rr-card:not(.used)').first().click();
  await page.waitForTimeout(600);
  check((await page.locator('.rb-piece.amp').count()) === 1, 'Swap replaces the amp in place');
  // save
  await page.locator('.rr-name').fill('Rig test');
  await page.locator('.rr-save').click();
  await page.waitForTimeout(900);
  const saved = await page.evaluate(async () => { const { tonelib } = await import('./js/tonelib.js'); return tonelib.list.find((t) => t.name === 'Rig test'); });
  check(!!saved && saved.gear.some((g) => g.slot === 'pre') && saved.gear.some((g) => g.slot === 'post'), 'Save keeps the whole rig as a tone');
  check((await page.locator('.rr-step.done').count()) >= 5, 'the steps tick off as you go');
  await shot('rig-saved');
  // a narrower window
  await page.setViewportSize({ width: 1180, height: 760 });
  await page.waitForTimeout(600);
  await shot('rig-small');
  check(await page.evaluate(() => { const r = document.querySelector('.modal.rig-room').getBoundingClientRect(); return r.right <= innerWidth && r.bottom <= innerHeight; }), 'the rig fits a smaller window');
  await page.setViewportSize({ width: 1600, height: 950 });
  await page.locator('.rr-close').click();
  await page.waitForTimeout(500);
  check((await page.locator('.modal.rig-room').count()) === 0, 'and closes');
  // Edit tone opens the same rig with the tone in it
  await page.locator('.mine-items .tone-item .ti-main').first().click();
  await page.waitForTimeout(600);
  await page.locator('.tones-edit button:has-text("Edit tone")').click();
  await page.waitForTimeout(1200);
  check((await page.locator('.modal.rig-room .rr-title:has-text("Edit tone")').count()) === 1, 'Edit tone opens the rig too');
  await shot('rig-edit');
  await page.locator('.rr-close').click();
  await page.waitForTimeout(400);
  check(!errs.length, `no page errors${errs.length ? `: ${errs.slice(0, 3).join(' | ')}` : ''}`);
};
