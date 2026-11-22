/** 4.26: the pointer hides on the highway after a few seconds and returns on a move (never over a menu or
 * dialog, never while a button is held); keys 1-9 switch tones with Settings open (but not while typing).
 *   SH_AUDIT=test/e2e/pointer-tones-audit.js node test/e2e/ui3-chromium.js native/build/stagehand-audio-fake <out> */
module.exports = async ({ page, check }) => {
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  for (let i = 0; i < 4 && (await page.locator('.modal').count()); i++) await page.keyboard.press('Escape'), await page.waitForTimeout(250);
  await page.setViewportSize({ width: 1600, height: 950 });
  const idle = () => page.evaluate(() => ({ cls: document.documentElement.classList.contains('cursor-idle'), cur: getComputedStyle(document.querySelector('.highway:not([hidden])') || document.body).cursor }));

  // ---- the pointer
  check(!(await idle()).cls, 'off the highway the pointer is never hidden');
  await page.evaluate(async () => {
    const { state } = await import('./js/store.js');
    const pick = [...state.songs.values()][0];
    await (await import('./js/actions.js')).playAlong(pick.id).catch(() => {});
  });
  await page.waitForFunction(() => document.querySelector('.highway') && !document.querySelector('.highway').hidden, null, { timeout: 30000 });
  await page.waitForTimeout(500);
  await page.mouse.move(400, 400);
  await page.mouse.move(420, 410);
  await page.waitForTimeout(1500);
  check(!(await idle()).cls, 'the pointer shows before the wait is over');
  await page.waitForTimeout(2400);
  let s = await idle();
  check(s.cls && s.cur === 'none', `the pointer hides after about 3 seconds on the highway (${s.cur})`);
  await page.mouse.move(500, 450);
  await page.waitForTimeout(100);
  s = await idle();
  check(!s.cls && s.cur !== 'none', 'it comes back the moment the mouse moves');

  // held button: no hiding while dragging
  await page.mouse.down();
  await page.waitForTimeout(3800);
  check(!(await idle()).cls, 'the pointer stays while a button is held');
  await page.mouse.up();

  // a menu open: stays
  await page.evaluate(async () => (await import('./js/ui.js')).showMenu(300, 300, [{ label: 'One', onClick() {} }, { label: 'Two', onClick() {} }]));
  await page.waitForTimeout(3800);
  check(!(await idle()).cls, 'the pointer stays over an open menu');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  await page.mouse.move(520, 460);
  await page.waitForTimeout(3600);
  check((await idle()).cls, 'hides again once the menu is closed');
  await page.mouse.move(540, 470);

  // a dialog open: stays
  await page.evaluate(async () => (await import('./js/ui.js')).modal({ title: 'Test', body: document.createElement('div') }));
  await page.waitForTimeout(3800);
  check(!(await idle()).cls, 'the pointer stays over an open dialog');
  await page.evaluate(() => document.querySelector('.modal-backdrop')?.remove());

  // back on the song list: shown
  await page.evaluate(() => window.__shHighway.leave());
  await page.waitForTimeout(3800);
  check(!(await idle()).cls, 'off the highway the pointer stays');

  // ---- tones with Settings open
  for (let i = 0; i < 3 && (await page.locator('.modal').count()); i++) await page.keyboard.press('Escape'), await page.waitForTimeout(250);
  const slots = await page.evaluate(async () => {
    const { tonelib } = await import('./js/tonelib.js');
    return tonelib.list.filter((t) => t.slot && t.slot > 1).map((t) => t.slot).sort();
  });
  check(slots.length >= 2, `tones on keys to switch between (${slots})`);
  const [a, b] = slots;
  const active = () => page.evaluate(() => { const r = window.__rig; return r.toneId; });
  const want = (n) => page.evaluate(async (n) => (await import('./js/tonelib.js')).bySlot(n).id, n);
  await page.evaluate(async () => (await import('./js/dialogs.js')).settings('library'));
  await page.waitForSelector('.settings-modal');
  await page.waitForTimeout(600);
  await page.locator('.settings-modal .nav-item').first().focus();
  await page.keyboard.press(`Digit${a}`);
  await page.waitForTimeout(1500);
  check((await active()) === (await want(a)), `key ${a} switches the tone with Settings open`);
  await page.keyboard.press(`Digit${b}`);
  await page.waitForTimeout(1500);
  check((await active()) === (await want(b)), `key ${b} switches it again`);
  check((await page.locator('.settings-modal').count()) === 1, 'Settings stays open');
  // typing in a box keeps its digits
  await page.evaluate(() => { const i = document.createElement('input'); i.type = 'text'; i.id = 'zz-box'; document.querySelector('.settings-modal .body').append(i); i.focus(); });
  await page.keyboard.press(`Digit${a}`);
  await page.waitForTimeout(800);
  check((await page.inputValue('#zz-box')) === String(a) && (await active()) === (await want(b)), 'typing a number in a box does not switch tones');
  await page.keyboard.press('Escape');
  check(errs.length === 0, `no page errors (${errs.join('; ')})`);
};
