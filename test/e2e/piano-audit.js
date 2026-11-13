/** 4.15.1: Piano in the real page, and three checks the full visit had out of date.
 *   SH_AUDIT=test/e2e/piano-audit.js node test/e2e/ui3-chromium.js native/build/stagehand-audio-fake <out>
 * - Settings › Guitar & audio › Piano keyboard: a pretend Allegro IV is listed, pressed keys show by name
 * - Piano on the highway with a real song from the library (its real parts and words): the part is written,
 *   the neck steps aside, a pressed key is scored, off brings the neck back and lets the keyboard go
 * - turning a knob on the rig offers Save; the moving scenes draw behind the highway; the song list keeps
 *   no outline box when you use the keys */
const path = require('path');
module.exports = async ({ page, outDir, check }) => {
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  const shot = (n) => page.screenshot({ path: path.join(outDir, `pa-${n}.png`) });
  for (let i = 0; i < 3 && (await page.locator('.modal').count()); i++) await page.keyboard.press('Escape');
  await page.setViewportSize({ width: 1600, height: 950 });
  // a pretend USB keyboard: an Allegro IV
  await page.evaluate(() => {
    const listeners = new Set();
    const input = { id: 'allegro', name: 'Allegro IV', state: 'connected', addEventListener: (k, f) => listeners.add(f), removeEventListener: (k, f) => listeners.delete(f) };
    window.__press = (midi, on) => { const e = { data: new Uint8Array([on ? 0x90 : 0x80, midi, on ? 90 : 0]), timeStamp: performance.now() }; for (const f of listeners) f(e); };
    window.__midiAsked = 0;
    navigator.requestMIDIAccess = async () => (window.__midiAsked++, { inputs: new Map([['allegro', input]]), onstatechange: null });
  });

  // ---- Settings › Guitar & audio › Piano keyboard
  await page.evaluate(async () => (await import('./js/dialogs.js')).settings('guitar'));
  await page.waitForTimeout(900);
  const row = page.locator('.setting', { hasText: 'Piano keyboard' });
  check((await row.count()) === 1, 'Settings › Guitar & audio has the piano keyboard');
  await row.scrollIntoViewIfNeeded();
  await row.locator('button:has-text("Try it")').click();
  await page.waitForTimeout(400);
  const opts = await row.locator('select option').allTextContents();
  check(opts.includes('Allegro IV'), `the keyboard is listed (${opts.join(', ')})`);
  await page.evaluate(() => window.__press(60, true));
  await page.waitForTimeout(150);
  const lit = await row.locator('.kb-check').textContent();
  check(/C4/.test(lit), `a pressed key shows by name (${lit})`);
  await shot('1-settings-keyboard');
  await page.evaluate(() => window.__press(60, false));
  await row.locator('button:has-text("Stop")').click();
  for (let i = 0; i < 3 && (await page.locator('.modal').count()); i++) await page.keyboard.press('Escape');
  await page.waitForTimeout(300);

  // ---- turning a knob on the rig offers Save (the knobs are on the piece's panel, under the rig since 4.6)
  await page.locator('.nav-section[data-page="play"]').click();
  await page.waitForTimeout(900);
  const knob = page.locator('#page-play .rknob:visible').first();
  if (await knob.count()) {
    await knob.scrollIntoViewIfNeeded();
    const kb = await knob.boundingBox();
    await page.mouse.move(kb.x + kb.width / 2, kb.y + kb.height / 2);
    await page.mouse.down();
    await page.mouse.move(kb.x + kb.width / 2, kb.y + kb.height / 2 - 50, { steps: 8 });
    await page.mouse.up();
    await page.waitForTimeout(500);
  }
  const saveN = await page.locator('#page-play .glow-primary:has-text("Save")').count();
  check(saveN > 0, `turning a knob offers Save (${(await knob.count()) ? 'knob found' : 'no knob found'})`);
  await shot('2-knob-save');
  const undo = page.locator('#page-play button:has-text("Undo changes")');
  if (await undo.count()) await undo.first().click();

  // ---- the song list keeps no outline box when you use the keys
  await page.locator('.nav-section:has-text("Songs")').click();
  await page.waitForTimeout(800);
  await page.locator('.row').first().click();
  await page.keyboard.press('ArrowDown');
  await page.waitForTimeout(200);
  const outl = await page.evaluate(() => {
    const el = document.activeElement;
    const sc = document.querySelector('.scroller');
    return { active: el ? `${el.tagName.toLowerCase()}.${[...el.classList].join('.')}` : '', scroller: sc ? getComputedStyle(sc).outlineStyle : 'none', activeOutline: el ? getComputedStyle(el).outlineStyle : 'none', focusVisible: el ? el.matches(':focus-visible') : false };
  });
  check(outl.scroller === 'none' && (outl.activeOutline === 'none' || !/scroller|list|rows/.test(outl.active)), `the song list has no outline box when you use the keys (${JSON.stringify(outl)})`);
  await shot('3-songs-keys');

  // ---- Piano on the highway with a real song from the library
  const song = await page.evaluate(async () => {
    const { state } = await import('./js/store.js');
    const list = [...state.songs.values()];
    const pick = list.find((s) => (s.arrangements || []).some((a) => a.type === 'vocals') && (s.arrangements || []).some((a) => a.type === 'bass')) || list[0];
    const a = await import('./js/actions.js');
    await a.playAlong(pick.id).catch(() => {});
    return { id: pick.id, title: pick.title };
  });
  await page.waitForFunction(() => document.querySelector('.highway') && !document.querySelector('.highway').hidden && document.querySelector('.highway').__hw.tab, null, { timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(800);
  for (let i = 0; i < 3 && (await page.locator('.hw-syncbox:not([hidden]) .btn.ghost').count()); i++) await page.locator('.hw-syncbox:not([hidden]) .btn.ghost').first().click().catch(() => {});
  const chip = page.locator('.hw-keys-chip');
  check((await chip.count()) === 1 && (await chip.isVisible()), `the Piano button is on the highway (${song.title})`);
  await page.evaluate(() => { window.__midiAsked = 0; }); // (Settings asked for it above)
  check(!(await page.evaluate(async () => (await import('./js/midi.js')).keyboard.on)), 'no keyboard is listened to before Piano is pressed');
  await chip.click();
  const ok = await page.waitForFunction(() => { const K = document.querySelector('.highway').__hw.keys.state; return K.arr && K.notes.length > 0; }, null, { timeout: 20000 }).then(() => true).catch(() => false);
  const info = await page.evaluate(() => {
    const H = document.querySelector('.highway').__hw;
    const K = H.keys.state;
    return { ok: !!K.arr, notes: K.notes.length, key: K.arr && K.arr.key.name, sources: K.arr && K.arr.sources, chords: K.arr ? K.arr.chords.filter((c) => c.len >= 4).length : 0, aside: document.querySelector('.highway').classList.contains('hw-keys-on'), view: !document.querySelector('.hw-piano').hidden, badge: document.querySelector('.pk-badge').hidden ? '' : document.querySelector('.pk-badge').textContent };
  });
  check(ok && info.notes > 0, `the piano part is written from the song (${JSON.stringify(info)})`);
  check(info.aside && info.view, 'the neck steps aside for the sheet music and falling notes');
  // play the first note of the part on time
  const scored = await page.evaluate(async () => {
    const H = document.querySelector('.highway').__hw;
    const K = H.keys.state;
    const { engine } = await import('./js/stage.js');
    const n = K.notes.find((x) => x.t > 1) || K.notes[0];
    engine.seek(Math.max(0, n.t - 1.2));
    if (!engine.playing) await engine.play();
    const t0 = performance.now();
    while (performance.now() - t0 < 6000 && K.vis < n.t) await new Promise((r) => setTimeout(r, 5));
    window.__press(n.midi, true);
    await new Promise((r) => setTimeout(r, 150));
    window.__press(n.midi, false);
    await new Promise((r) => setTimeout(r, 300));
    const i = K.notes.indexOf(n);
    return { res: K.judge.result[i], vis: K.vis, at: n.t, playing: engine.playing };
  });
  check(scored.res === 'hit', `a key pressed on time is scored (${JSON.stringify(scored)})`);
  await page.waitForTimeout(1200);
  await shot('4-highway-piano');
  // off: the neck comes back, the keyboard is let go
  await page.evaluate(() => document.querySelector('.highway').__hw.keys.turn(false));
  await page.waitForTimeout(300);
  const off = await page.evaluate(async () => { const { keyboard } = await import('./js/midi.js'); return { kb: keyboard.on, aside: document.querySelector('.highway').classList.contains('hw-keys-on') }; });
  check(!off.kb && !off.aside, `Piano off brings the neck back and lets the keyboard go (${JSON.stringify(off)})`);

  // ---- the moving scenes draw behind the highway (picked the way the app picks a look)
  for (const id of ['nebula', 'swarm', 'mandala', 'strings']) {
    await page.evaluate((v) => window.dispatchEvent(new CustomEvent('stagehand:preview-venue', { detail: v })), id);
    await page.waitForTimeout(2500);
    const drawn = await page.evaluate(() => !!document.querySelector('.highway canvas.hw-visual') && !document.querySelector('.highway iframe.hw-fluid'));
    check(drawn, `${id} draws behind the highway`);
    await shot(`5-highway-${id}`);
  }
  check(!errs.length, `no page errors (${errs.slice(0, 3).join(' | ')})`);
};
