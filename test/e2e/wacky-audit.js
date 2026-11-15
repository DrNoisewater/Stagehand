/** 4.20: The Lab's fourteen pedals on the real page. The Gear page's Lab shelf for guitar and bass;
 * each pedal's own picture with every control on it working (knobs, selectors, sliders, faders,
 * switches with their printed words lit, Invader's buttons, Blorp's pad, footswitches held and let
 * go, Boing's lever springing back); its spec sheet; the rig (Create a tone) with the pedal's own
 * ON footswitch; Haunt's Slow/Fast played live without rebuilding the tone; footswitches let go
 * when the window loses focus; the step-by-step Pedals step. Writes lab-*.png.
 *   SH_AUDIT=test/e2e/wacky-audit.js node test/e2e/ui3-chromium.js native/build/stagehand-audio-fake <out>
 */
const path = require('path');
const G = require('../../src/renderer/data/gear2014.json');
const LAB = Object.keys(G).filter((k) => G[k].c === 'The Lab');
const BITS = { Pedal_Quack: 1, Pedal_Croak: 2, Pedal_Caterwaul: 3, Pedal_Blorp: 4, Pedal_Gobble: 5, Pedal_Slug: 6, Pedal_Boing: 7, Pedal_Gremlin: 8, Pedal_Invader: 9, Pedal_Confetti: 10, Pedal_Blender: 11, Pedal_Fossil: 12, Pedal_Charmer: 13, Pedal_Haunt: 14 };

module.exports = async ({ page, outDir, check }) => {
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  const shot = async (name, el) => {
    await page.waitForTimeout(350);
    if (el) await el.screenshot({ path: path.join(outDir, `lab-${name}.png`) });
    else await page.screenshot({ path: path.join(outDir, `lab-${name}.png`) });
  };
  const lab = () => page.evaluate(() => ({ ...window.__rig.lab }));
  const strip = (root, n) => page.locator(`${root} .gb-strip .rknob[aria-label="${n}"]`).first();
  const val = async (loc) => Number(await loc.getAttribute('aria-valuenow'));
  const drag = async (loc, dx, dy) => {
    const b = await loc.boundingBox();
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
    await page.mouse.down();
    await page.mouse.move(b.x + b.width / 2 + dx, b.y + b.height / 2 + dy, { steps: 7 });
    await page.mouse.up();
    await page.waitForTimeout(200);
  };
  for (let i = 0; i < 3 && (await page.locator('.modal').count()); i++) await page.keyboard.press('Escape');
  await page.setViewportSize({ width: 1600, height: 950 });
  await page.evaluate(() => document.querySelectorAll('.toast').forEach((t) => t.remove()));
  await page.locator('#sidebar .nav-section[data-page="gear"]').first().click();
  await page.waitForSelector('#page-gear .sr-card', { timeout: 15000 });

  // ---------------------------------------------------------- the Gear page
  const shelf = page.locator('#page-gear .sr-shelf', { hasText: 'The Lab' }).first();
  check((await shelf.count()) === 1, 'the Gear page has a shelf called The Lab');
  check((await page.locator('#page-gear .sr-shelf', { hasText: 'Wacky' }).count()) === 0, 'nothing is called Wacky any more');
  await shelf.click();
  await page.waitForTimeout(500);
  const names = await page.locator('#page-gear .sr-grid .sr-card .sr-card-name').allTextContents();
  check(LAB.every((k) => names.includes(G[k].n)) && names.length === 14, `The Lab holds the fourteen pedals (${names.join(', ')})`);
  await shot('shelf');
  const R = '#page-gear .sr-show';
  for (const key of LAB) {
    const name = G[key].n;
    const photo = (await page.evaluate(async (k) => (await import('./js/gear-photos.js')).GEAR_PHOTOS[k], key)) || {};
    await page.locator('#page-gear .sr-grid .sr-card', { hasText: name }).first().click();
    await page.waitForTimeout(900);
    const img = await page.evaluate((r) => {
      const i = document.querySelector(`${r} img`);
      return i ? { src: i.getAttribute('src') || '', ok: i.complete && i.naturalWidth > 100 } : null;
    }, R);
    check(!!img && img.ok && img.src.includes(key), `${name}: its own picture (${img && img.src})`);
    const stripNames = await page.locator(`${R} .gb-strip .rknob`).evaluateAll((els) => els.map((e) => e.getAttribute('aria-label')));
    check(G[key].k.every(([n]) => stripNames.includes(n)), `${name}: every control is on the strip (${stripNames.join(', ')})`);
    // knobs and selectors turn on the picture
    for (const n of Object.keys(photo.knobs || {})) {
      const label = G[key].k.find(([x]) => x.toLowerCase() === n)[0];
      const s = strip(R, label), before = await val(s);
      const hk = page.locator(`${R} .gear-hotspot.turns[aria-label="${label}"]`).first();
      const up = before < (G[key].k.find(([x]) => x === label)[3] + G[key].k.find(([x]) => x === label)[2]) / 2;
      await drag(hk, 0, up ? -90 : 90);
      const after = await val(s);
      check(up ? after > before : after < before, `${name}: ${label} turns on the picture (${before} → ${after})`);
      if (photo.stops && photo.stops[n]) {
        const rot = await hk.evaluate((e) => e.querySelector('.ring').style.getPropertyValue('--rot'));
        const lo = G[key].k.find(([x]) => x === label)[2];
        check(rot === `${photo.stops[n][Math.round(after - lo)]}deg`, `${name}: ${label} points at its printed position (${rot})`);
      }
    }
    // sliders and faders
    for (const [n, horiz] of [...Object.keys(photo.sliders || {}).map((n) => [n, false]), ...Object.keys(photo.hsliders || {}).map((n) => [n, true])]) {
      const label = G[key].k.find(([x]) => x.toLowerCase() === n)[0];
      const s = strip(R, label), before = await val(s);
      const sl = page.locator(`${R} .gear-slider[aria-label="${label}"]`).first();
      const k = G[key].k.find(([x]) => x === label);
      const more = before < (k[2] + k[3]) / 2;
      const cap = sl.locator('.photo-slide');
      await drag(cap, horiz ? (more ? 60 : -60) : 0, horiz ? 0 : more ? -40 : 40);
      const after = await val(s);
      check(more ? after > before : after < before, `${name}: the ${label} ${horiz ? 'fader' : 'slider'} moves on the picture (${before} → ${after})`);
    }
    // switches: a click flips it, the strip follows and the printed word for the new position lights up
    for (const n of Object.keys(photo.switches || {})) {
      const label = G[key].k.find(([x]) => x.toLowerCase() === n)[0];
      const s = strip(R, label), before = await val(s);
      const sw = page.locator(`${R} .gear-switch[aria-label="${label}"]`).first();
      await sw.click();
      await page.waitForTimeout(200);
      const after = await val(s);
      check(after !== before, `${name}: ${label} switches on the picture (${before} → ${after})`);
      const marks = await page.locator(`${R} .gear-mark`).evaluateAll((els) => els.map((e) => e.classList.contains('on')));
      if ((photo.marks?.[n] || []).some(Boolean)) check(marks.filter(Boolean).length >= 1, `${name}: the word for ${label}'s position lights up`);
    }
    // push buttons (Invader)
    for (const n of Object.keys(photo.buttons || {})) {
      const label = G[key].k.find(([x]) => x.toLowerCase() === n)[0];
      const bs = page.locator(`${R} .gear-pushbtn`);
      for (let i = 0; i < (await bs.count()); i++) {
        await bs.nth(i).click();
        await page.waitForTimeout(150);
        const on = await bs.evaluateAll((els) => els.map((e) => e.classList.contains('on')));
        check((await val(strip(R, label))) === i && on.filter(Boolean).length === 1 && on[i], `${name}: button ${G[key].k.find(([x]) => x === label)[5].labels[i]} picks that voice and alone glows`);
      }
    }
    // the pad (Blorp)
    if (photo.pad) {
      const pad = page.locator(`${R} .gear-pad`).first();
      const b = await pad.boundingBox();
      await page.mouse.move(b.x + b.width * 0.1, b.y + b.height * 0.1);
      await page.mouse.down();
      await page.mouse.move(b.x + b.width * 0.85, b.y + b.height * 0.8, { steps: 6 });
      await page.mouse.up();
      await page.waitForTimeout(200);
      const x = await val(strip(R, 'Mouth X')), y = await val(strip(R, 'Mouth Y'));
      check(x > 70 && y < 35, `${name}: dragging the mouth pad sets both (${Math.round(x)} across, ${Math.round(y)} up)`);
      await pad.focus();
      await page.keyboard.press('ArrowUp');
      check((await val(strip(R, 'Mouth Y'))) > y, `${name}: the arrow keys move the mouth too`);
      await pad.dblclick();
      await page.waitForTimeout(150);
      check((await val(strip(R, 'Mouth X'))) === 50 && (await val(strip(R, 'Mouth Y'))) === 50, `${name}: double-click puts the mouth back in the middle`);
    }
    // footswitches you hold: the engine hears it while held and lets go after
    for (const n of Object.keys(photo.stomps || {}).filter((n) => n !== 'on')) {
      const st = page.locator(`${R} .gear-stomp.momentary`).first();
      const b = await st.boundingBox();
      await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
      await page.mouse.down();
      await page.waitForTimeout(150);
      const held = (await lab()).labHold;
      const looks = await st.evaluate((e) => e.classList.contains('held'));
      await page.mouse.up();
      await page.waitForTimeout(150);
      const after = (await lab()).labHold;
      check((held & (1 << BITS[key])) && looks && !(after & (1 << BITS[key])), `${name}: holding ${n} on the picture plays it, letting go stops it (${held} then ${after})`);
      // and from the keyboard on the strip
      const hb = page.locator(`${R} .rhold[data-moment="${n}"]`).first();
      await hb.focus();
      await page.keyboard.down('Space');
      await page.waitForTimeout(100);
      const k1 = (await lab()).labHold;
      await page.keyboard.up('Space');
      await page.waitForTimeout(100);
      check((k1 & (1 << BITS[key])) && !((await lab()).labHold & (1 << BITS[key])), `${name}: ${n} also holds from the keyboard (Space)`);
    }
    // the lever (Boing): pulled halfway, then springs back
    for (const n of Object.keys(photo.lever || {})) {
      const lv = page.locator(`${R} .gear-lever`).first();
      const b = await lv.boundingBox();
      await page.mouse.move(b.x + b.width / 2, b.y + 5);
      await page.mouse.down();
      await page.mouse.move(b.x + b.width / 2, b.y + b.height * 0.5, { steps: 5 });
      await page.waitForTimeout(100);
      const mid = (await lab()).labLever;
      await shot(`${name.toLowerCase()}-bend`, page.locator(`${R} .gear-face`).first());
      await page.mouse.up();
      await page.waitForTimeout(200);
      check(mid > 0.35 && mid < 0.65 && (await lab()).labLever === 0, `${name}: pull the ${n} lever halfway (${mid.toFixed(2)}) and it springs back`);
    }
    // what each control does, in words
    const sheet = await page.evaluate(() => {
      const c = document.querySelector('#page-gear .gear-about');
      return c ? { text: (c.querySelector('.gear-about-text') || {}).textContent || '', dd: [...c.querySelectorAll('dd')].map((d) => d.textContent.trim()) } : null;
    });
    check(!!sheet && sheet.text.length > 60 && sheet.dd.length >= G[key].k.length && sheet.dd.every((t) => t && t !== 'Turn it and listen'), `${name}: the spec sheet says what it and each control does`);
    await shot(name.toLowerCase(), page.locator(`${R} .gear-face`).first());
  }
  // a control that does nothing in the mode you're in is dimmed
  await page.locator('#page-gear .sr-grid .sr-card', { hasText: 'Gobble' }).first().click();
  await page.waitForTimeout(700);
  const dimmed = async () => page.locator(`${R} .gear-hotspot[aria-label="Rate"]`).first().evaluate((e) => e.classList.contains('dim'));
  const d0 = await dimmed();
  await page.locator(`${R} .gear-switch[aria-label="Auto/Hold"]`).first().click();
  await page.waitForTimeout(200);
  check(d0 !== (await dimmed()), 'Gobble: Rate goes dim in Hold, where it does nothing');
  // footswitches let go when the window loses focus
  await page.locator('#page-gear .sr-grid .sr-card', { hasText: 'Confetti' }).first().click();
  await page.waitForTimeout(700);
  const cst = page.locator(`${R} .gear-stomp.momentary`).first();
  const cb = await cst.boundingBox();
  await page.mouse.move(cb.x + cb.width / 2, cb.y + cb.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(100);
  const h0 = (await lab()).labHold;
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  await page.waitForTimeout(100);
  check(h0 && !(await lab()).labHold, 'a held footswitch lets go when the window loses focus');
  await page.mouse.up();
  // played with your guitar: in front of the amp
  const liveSpec = () => page.evaluate(async () => { const { toSpec } = await import('./js/gearspec.js'); return window.__rig.liveTone ? toSpec(window.__rig.liveTone) : ''; });
  await page.locator('#page-gear .sr-live').click();
  await page.waitForTimeout(700);
  check(/gear\tpre\tPedal_Confetti/.test(await liveSpec()), 'Play it with my guitar puts Confetti in front of the amp');
  await page.locator('#page-gear .sr-live').click();
  await page.waitForTimeout(300);
  // bass: all fourteen
  const bassB = page.locator('#page-gear .sr-who button', { hasText: 'Bass' }).first();
  if (await bassB.count()) {
    await bassB.click();
    await page.waitForTimeout(400);
    await page.locator('#page-gear .sr-shelf', { hasText: 'The Lab' }).first().click();
    await page.waitForTimeout(400);
    const bn = await page.locator('#page-gear .sr-grid .sr-card .sr-card-name').allTextContents();
    check(LAB.every((k) => bn.includes(G[k].n)), `with Bass picked The Lab still has all fourteen (${bn.length})`);
    const allB = page.locator('#page-gear .sr-who button', { hasText: 'All' }).first();
    if (await allB.count()) await allB.click();
  } else check(false, 'the Gear page has a Bass choice');

  // ---------------------------------------------------------- the rig (Create a tone)
  for (const kind of ['guitar', 'bass']) {
    await page.evaluate(async (k) => (await import('./js/rigroom.js')).openRig({ kind: k }), kind);
    await page.waitForTimeout(1500);
    check((await page.locator('.modal.rig-room').count()) === 1, `Create a tone opens (${kind})`);
    await page.locator('.rr-shelf', { hasText: 'The Lab' }).first().click();
    await page.waitForTimeout(400);
    const cards = await page.locator('.rr-grid .rr-card').evaluateAll((els) => els.map((e) => ({ n: (e.querySelector('.rr-card-name') || {}).textContent, other: e.classList.contains('other') })));
    check(cards.length === 14 && cards.every((c) => !c.other), `the rig's Lab shelf: fourteen pedals, none greyed out for ${kind}`);
    const pick = kind === 'guitar' ? 'Haunt' : 'Gremlin';
    await page.locator('.rr-grid .rr-card', { hasText: pick }).first().click();
    await page.waitForTimeout(900);
    const spec = await liveSpec();
    check(new RegExp(`gear\\tpre\\tPedal_${pick}`).test(spec), `adding ${pick} on ${kind} is heard straight away, in front of the amp`);
    // the pedal's own ON footswitch turns it off and on
    const on = page.locator('.rr-inspect .gear-stomp:not(.momentary)').first();
    if (await on.count()) {
      await on.click();
      await page.waitForTimeout(700);
      const off = !new RegExp(`Pedal_${pick}`).test(await liveSpec());
      await page.locator('.rr-inspect .gear-stomp:not(.momentary)').first().click();
      await page.waitForTimeout(700);
      check(off && new RegExp(`Pedal_${pick}`).test(await liveSpec()), `${pick}'s own ON footswitch bypasses it and brings it back`);
    } else check(false, `${pick}'s ON footswitch works in the rig`);
    if (pick === 'Haunt') {
      // Slow/Fast is played live: the engine is told, the tone is not rebuilt
      const before = await liveSpec();
      await page.locator('.rr-inspect .gear-switch[aria-label="Slow/Fast"]').first().click();
      await page.waitForTimeout(700);
      const l = await lab();
      check(!!(l.labLatch & (1 << BITS.Pedal_Haunt)) && (await liveSpec()) === before, `Haunt: Fast spins the speaker up live, without rebuilding the tone (${l.labLatch})`);
      await shot('rig-haunt', page.locator('.rr-inspect .gear-face').first());
    }
    await shot(`rig-${kind}`);
    if (kind === 'guitar') {
      await page.locator('.rr-name').fill('Lab test');
      await page.locator('.rr-save').click();
      await page.waitForTimeout(900);
      const saved = await page.evaluate(async () => { const { tonelib } = await import('./js/tonelib.js'); return tonelib.list.find((t) => t.name === 'Lab test'); });
      const hg = saved && saved.gear.find((g) => g.key === 'Pedal_Haunt');
      check(!!hg && hg.knobs && Object.values(hg.knobs).some((v) => v === 1), `a tone with Haunt saves with Fast set (${hg ? JSON.stringify(hg.knobs) : 'not saved'})`);
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
    check(groups.some((g) => /The Lab/.test(g)) && LAB.every((k) => choices.includes(k)), `the Pedals step offers all of The Lab on bass (${groups.join(' | ')})`);
    await page.locator('.modal .pb-choice[data-key="Pedal_Boing"]').first().click();
    await page.waitForTimeout(500);
    const knobs = await page.locator('.modal .pb-pedal .rknob').evaluateAll((els) => els.map((e) => e.getAttribute('aria-valuetext')));
    check(knobs.length >= 5 && knobs.includes('+12'), `Boing on the board shows its controls with real values (${knobs.join(', ')})`);
    check((await page.locator('.modal .pb-pedal .rhold').count()) === 2, 'and its Jump footswitch and Bend lever');
    await shot('stepbystep');
  }
  for (let i = 0; i < 3 && (await page.locator('.modal').count()); i++) {
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
  }
  check(!errs.length, `no errors on the page${errs.length ? `: ${errs.slice(0, 3).join(' | ')}` : ''}`);
};
