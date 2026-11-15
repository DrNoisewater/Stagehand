/** 4.20: The Lab's forty-four pedals on the real page, in their seven little sections. The Gear page's Lab shelf for guitar and bass;
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
const KIND = Object.fromEntries(['Annwn', 'Apoptosis', 'Bifrost', 'BluePrince', 'Claude', 'DejaVu', 'Duat', 'EventHorizon', 'Fenrir', 'Inanna', 'Janus', 'Kitsune', 'Kukulkan', 'Long', 'Maui', 'Mimic', 'Molt', 'Nataraja', 'Nothing', 'Olympus', 'Ouroboros', 'Parasite', 'Reliquary', 'Seance', 'Severed', 'Shango', 'Tezcatl', 'Veles', 'WhoAreYou', 'Wukong'].map((n, i) => [`Pedal_${n}`, 15 + i]));
const SECTIONS = ['Voices and mouths', 'Synths and monsters', 'Pitch and harmony', 'Echoes and loops', 'Freezes, slices and slowdowns', 'Rooms and skies', 'Rhythm and shape'];
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
  // is footswitch `bit` of pedal `key` down in the engine? (the thirty that followed have their own slot)
  const down = async (key, bit) => page.evaluate(([k, n, b, old]) => (n ? (window.__rig.labWords[n] | 0) & (1 << b) : window.__rig.lab.labHold & (1 << old)) !== 0, [key, KIND[key] || 0, bit, BITS[key] || 0]);
  const leverAt = (key) => page.evaluate(([n]) => (n ? window.__rig.labLevers[n] || 0 : window.__rig.lab.labLever), [KIND[key] || 0]);
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
  check(LAB.length === 44 && LAB.every((k) => names.includes(G[k].n)) && names.length === 44, `The Lab holds the forty-four pedals (${names.length})`);
  const heads = await page.locator('#page-gear .sr-grid .lab-sec').allTextContents();
  check(heads.join('|') === SECTIONS.join('|'), `The Lab is in seven little sections (${heads.join(', ')})`);
  check(await page.locator('#page-gear .sr-grid').evaluate((g) => [...g.children].every((c, i, a) => !c.classList.contains('lab-sec') || (a[i + 1] && a[i + 1].classList.contains('sr-card')))), 'every section has its pedals under it');
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
    // push buttons that pick one of a few (Invader's voices, Annwn's textures, Tezcatl's arrows …)
    for (const n of Object.keys(photo.buttons || {})) {
      const k = G[key].k.find(([x]) => x.toLowerCase() === n);
      const label = k[0];
      const words = k[5].labels;
      const bs = page.locator(`${R} .gear-pushbtn:not(.onoff)[aria-label^="${label}: "]`);
      const rects = photo.buttons[n];
      let j = 0;
      for (let i = 0; i < rects.length; i++) {
        if (!rects[i]) continue;
        const b = bs.nth(j++);
        if ((await val(strip(R, label))) === i) await b.click(), await page.waitForTimeout(120); // press the lit one again: it stops (Tezcatl)
        await b.click();
        await page.waitForTimeout(150);
        const on = await bs.evaluateAll((els) => els.map((e) => e.classList.contains('on')));
        check((await val(strip(R, label))) === i && on.filter(Boolean).length === 1, `${name}: button ${words[i]} picks it and alone glows`);
      }
      if (photo.unpick && photo.unpick[n] !== undefined) {
        await bs.nth(j - 1).click();
        await page.waitForTimeout(150);
        check((await val(strip(R, label))) === photo.unpick[n], `${name}: pressing the lit ${label} button again goes back to ${words[photo.unpick[n]]}`);
      }
    }
    // buttons that each turn one thing on or off (Kitsune's tails, Nataraja's steps, Wukong's clones)
    for (const n of Object.keys(photo.toggles || {})) {
      const label = G[key].k.find(([x]) => x.toLowerCase() === n)[0];
      const b = page.locator(`${R} .gear-pushbtn.onoff[aria-label="${label}"]`).first();
      const before = await val(strip(R, label));
      await b.click();
      await page.waitForTimeout(150);
      const after = await val(strip(R, label));
      check(after !== before && (await b.evaluate((e) => e.classList.contains('on'))) === after > 0, `${name}: ${label} turns on and off on the picture (${before} → ${after})`);
    }
    // a saved lever or ribbon (Olympus's Thunder, Wukong's staff, Long's Breath)
    for (const [n, vert] of [...Object.keys(photo.fills || {}).map((n) => [n, true]), ...Object.keys(photo.hfills || {}).map((n) => [n, false])]) {
      const k = G[key].k.find(([x]) => x.toLowerCase() === n);
      const f = page.locator(`${R} .gear-fill[aria-label="${k[0]}"]`).first();
      const b = await f.boundingBox();
      await page.mouse.move(b.x + (vert ? b.width / 2 : b.width * 0.9), b.y + (vert ? b.height * 0.1 : b.height / 2));
      await page.mouse.down();
      await page.mouse.up();
      await page.waitForTimeout(200);
      const v = await val(strip(R, k[0]));
      check(v > k[2] + 0.8 * (k[3] - k[2]), `${name}: ${k[0]} set by its ${vert ? 'lever' : 'ribbon'} on the picture (${v})`);
      await f.dblclick();
      await page.waitForTimeout(150);
    }
    // the pad (Blorp's mouth, Annwn's veil, Event Horizon's gravity, Tezcatl's mirror)
    if (photo.pad) {
      const [lx, ly] = [photo.pad[4], photo.pad[5]].map((n) => G[key].k.find(([x]) => x.toLowerCase() === n)[0]);
      const pad = page.locator(`${R} .gear-pad`).first();
      const b = await pad.boundingBox();
      await page.mouse.move(b.x + b.width * 0.3, b.y + b.height * 0.3);
      await page.mouse.down();
      await page.mouse.move(b.x + b.width * 0.85, b.y + b.height * 0.8, { steps: 6 });
      await page.mouse.up();
      await page.waitForTimeout(200);
      const x = await val(strip(R, lx)), y = await val(strip(R, ly));
      check(x > 70 && y < 35, `${name}: dragging the pad sets both ${lx} and ${ly} (${Math.round(x)} across, ${Math.round(y)} up)`);
      await pad.focus();
      await page.keyboard.press('ArrowUp');
      check((await val(strip(R, ly))) > y, `${name}: the arrow keys move it too`);
      await pad.dblclick();
      await page.waitForTimeout(150);
      check((await val(strip(R, lx))) === 50 && (await val(strip(R, ly))) === 50, `${name}: double-click puts it back in the middle`);
    }
    // footswitches and buttons that act at once: held ones play while held, a tap acts on the press,
    // a lit one stays lit until pressed again. The engine hears each one; letting go lets go.
    for (const n of Object.keys(photo.stomps || {}).filter((n) => n !== 'on')) {
      const [mn, type, bit = 0] = (G[key].m || []).find(([x]) => x.toLowerCase() === n);
      const st = page.locator(`${R} .gear-stomp.momentary[aria-label="${mn}"]`).first();
      const b = await st.boundingBox();
      if (type === 'latch') {
        await st.click();
        await page.waitForTimeout(150);
        const lit = (await down(key, bit)) && (await st.evaluate((e) => e.classList.contains('held')));
        await st.click();
        await page.waitForTimeout(150);
        check(lit && !(await down(key, bit)), `${name}: ${mn} lights with a click and goes out with the next`);
        continue;
      }
      await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
      await page.mouse.down();
      await page.waitForTimeout(150);
      const held = await down(key, bit);
      const looks = await st.evaluate((e) => e.classList.contains('held'));
      await page.mouse.up();
      await page.waitForTimeout(150);
      check(held && looks && !(await down(key, bit)), `${name}: ${type === 'tap' ? 'pressing' : 'holding'} ${mn} on the picture plays it, letting go lets go`);
      // and from the keyboard on the strip
      const hb = page.locator(`${R} .rhold[data-moment="${n}"]`).first();
      await hb.focus();
      await page.keyboard.down('Space');
      await page.waitForTimeout(100);
      const k1 = await down(key, bit);
      await page.keyboard.up('Space');
      await page.waitForTimeout(100);
      check(k1 && !(await down(key, bit)), `${name}: ${mn} also works from the keyboard (Space)`);
    }
    // a footswitch in the list that isn't on the picture still works from the strip
    for (const [mn, type, bit = 0] of (G[key].m || []).filter(([x, t]) => t !== 'lever' && !(photo.stomps || {})[x.toLowerCase()])) {
      const hb = page.locator(`${R} .rhold[data-moment="${mn.toLowerCase()}"]`).first();
      if (type === 'latch') {
        await hb.click();
        await page.waitForTimeout(100);
        const lit = await down(key, bit);
        await hb.click();
        await page.waitForTimeout(100);
        check(lit && !(await down(key, bit)), `${name}: ${mn} lights and goes out on the strip`);
      } else {
        await hb.focus();
        await page.keyboard.down('Space');
        await page.waitForTimeout(100);
        const k1 = await down(key, bit);
        await page.keyboard.up('Space');
        await page.waitForTimeout(100);
        check(k1 && !(await down(key, bit)), `${name}: ${mn} works on the strip`);
      }
    }
    // what each control does, in words
    const sheet = await page.evaluate(() => {
      const c = document.querySelector('#page-gear .gear-about');
      return c ? { text: (c.querySelector('.gear-about-text') || {}).textContent || '', dd: [...c.querySelectorAll('dd')].map((d) => d.textContent.trim()) } : null;
    });
    check(!!sheet && sheet.text.length > 60 && sheet.dd.length >= G[key].k.length && sheet.dd.every((t) => t && t !== 'Turn it and listen'), `${name}: the spec sheet says what it and each control does`);
    await shot(name.toLowerCase().replace(/\s+/g, ''), page.locator(`${R} .gear-face`).first());
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
  check(/gear\tpost\tPedal_Confetti/.test(await liveSpec()), 'Play it with my guitar puts Confetti after the amp, like any echo');
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
    check(LAB.every((k) => bn.includes(G[k].n)), `with Bass picked The Lab still has all forty-four (${bn.length})`);
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
    check(cards.length === 44 && cards.every((c) => !c.other), `the rig's Lab shelf: forty-four pedals, none greyed out for ${kind}`);
    check((await page.locator('.rr-grid .lab-sec').allTextContents()).join('|') === SECTIONS.join('|'), `the rig's Lab shelf is in its seven sections (${kind})`);
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
    check((await page.locator('.modal .pb-pick h6.pb-sub').allTextContents()).join('|') === SECTIONS.join('|'), 'and in its seven sections');
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
