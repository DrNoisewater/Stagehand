/** 4.10: the tidy board (signal order, short cables, drag to nudge / swap), sliders on the EQ photos,
 * and the knob audit (every photo knob sits inside its picture and turns from its real pointer angle).
 *   SH_AUDIT=test/e2e/board-audit.js node test/e2e/ui3-chromium.js native/build/stagehand-audio-fake <out> */
const path = require('path');
module.exports = async ({ page, outDir, check }) => {
  const shot = async (name) => { await page.waitForTimeout(500); await page.screenshot({ path: path.join(outDir, `board-${name}.png`) }); };
  const go = async (name) => { await page.evaluate(async (n) => (await import('./js/store.js')).setPage(n), name); await page.waitForTimeout(900); };
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  for (let i = 0; i < 3 && (await page.locator('.modal').count()); i++) await page.keyboard.press('Escape');
  await page.setViewportSize({ width: 1600, height: 950 });

  // ---------------------------------------------------------------- the knob table
  const table = await page.evaluate(async () => {
    const { GEAR_PHOTOS } = await import('./js/gear-photos.js');
    const { loadGear } = await import('./js/gearspec.js');
    const DB = await loadGear();
    let knobs = 0, sliders = 0, bad = [], total = 0;
    for (const [key, e] of Object.entries(GEAR_PHOTOS)) {
      const names = new Set(((DB[key] || {}).k || []).map((k) => k[0].toLowerCase()));
      total += names.size;
      for (const [n, v] of Object.entries(e.knobs || {})) {
        knobs++;
        const ry = (v[2] * e.width) / e.height;
        if (!names.has(n) || v[0] - v[2] < -1 || v[0] + v[2] > 101 || v[1] - ry < -1 || v[1] + ry > 101 || Math.abs(v[3]) > 180) bad.push(`${key}/${n}`);
      }
      for (const [n, v] of Object.entries(e.sliders || {})) {
        sliders++;
        if (!names.has(n) || !(v[1] < v[2]) || v[3] < v[1] - 1 || v[3] > v[2] + 1 || (e.knobs || {})[n]) bad.push(`${key}/${n}`);
      }
    }
    return { knobs, sliders, bad, total };
  });
  check(table.knobs >= 530 && !table.bad.length, `every photo knob is a real control, inside its picture (${table.knobs} knobs${table.bad.length ? `; wrong: ${table.bad.slice(0, 5).join(', ')}` : ''})`);
  check(table.sliders === 21, `the three graphic EQs have their sliders on the photo (${table.sliders})`);

  // ---------------------------------------------------------------- sliders in the showroom
  await go('gear');
  await page.waitForTimeout(1000);
  await page.locator('.sr-find').fill('8-Band Graphic');
  await page.waitForTimeout(500);
  await page.locator('.sr-grid .sr-card').first().click();
  await page.waitForTimeout(1200);
  const ns = await page.locator('.sr-show .gear-slider').count();
  check(ns === 8, `the 8-band EQ shows 8 sliders you can grab (${ns})`);
  await shot('eq-before');
  const sl = page.locator('.sr-show .gear-slider').nth(2);
  const name = await sl.getAttribute('aria-label');
  const strip = page.locator(`.sr-show .gb-strip .rknob[aria-label="${name}"]`);
  const b = await sl.locator('.photo-slide').boundingBox();
  const lane = await sl.boundingBox();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width / 2, lane.y + 2, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(300);
  const max = Number(await strip.getAttribute('aria-valuemax'));
  check(Number(await strip.getAttribute('aria-valuenow')) === max, `dragging the ${name} slider to the top sets it to +${max} on the strip too`);
  const b2 = await sl.locator('.photo-slide').boundingBox();
  check(b2.y < b.y - 10 && Math.abs(b2.y - lane.y) < 3, 'and the cap on the photo is at the top of its slot');
  // the strip moves the photo
  await strip.focus();
  await page.keyboard.press('Home');
  await page.waitForTimeout(300);
  const b3 = await sl.locator('.photo-slide').boundingBox();
  check(Math.abs(b3.y + b3.height - (lane.y + lane.height)) < 3, 'turning it down on the strip slides the cap to the bottom');
  await shot('eq-moved');

  // a knob whose photo shows it off noon turns from where it really points
  await page.locator('.sr-find').fill('AD200');
  await page.waitForTimeout(500);
  await page.locator('.sr-grid .sr-card').first().click();
  await page.waitForTimeout(1200);
  await page.evaluate(() => { const k = document.querySelector('.sr-show .gear-hotspot.turns'); k.setValue(Number(k.getAttribute('aria-valuemin'))); });
  await page.waitForTimeout(300);
  const rot = await page.evaluate(() => {
    const cap = document.querySelector('.sr-show .gear-hotspot.turns .photo-cap');
    const m = new DOMMatrix(getComputedStyle(cap).transform);
    return { a0: parseFloat(cap.style.getPropertyValue('--a0')), deg: Math.round((Math.atan2(m.b, m.a) * 180) / Math.PI) };
  });
  check(rot.a0 !== 0 && rot.deg === Math.round(-135 - rot.a0), `a knob photographed off-centre starts from its own pointer (${rot.a0}°): all the way down turns the picture ${rot.deg}°`);
  await shot('ad200');
  await page.locator('.sr-find').fill('');

  // ---------------------------------------------------------------- the board
  await go('tones');
  await page.locator('.tw-create').click();
  await page.waitForTimeout(1500);
  const add = async (shelf, n) => {
    await page.locator(`.rr-shelf:has-text("${shelf}")`).click();
    await page.waitForTimeout(300);
    await page.locator('.rr-grid .rr-card:not(.other)').nth(n).click();
    await page.waitForTimeout(600);
  };
  await add('Drive', 1);
  await add('Drive', 3);
  await add('Wah', 0);
  await shot('pre-only');
  await add('Delay', 0);
  await add('Reverb', 1);
  await add('Rack', 0);
  await page.waitForTimeout(600);
  const lay = () => page.evaluate(() => {
    const rb = document.querySelector('.rb');
    const R = rb.getBoundingClientRect();
    const mid = (el) => { const r = el.querySelector('.rb-art, .rb-jack-ico').getBoundingClientRect(); return { x: r.left + r.width / 2 - R.left, b: Math.round(r.bottom - R.top), l: r.left - R.left, r: r.right - R.left, t: r.top - R.top }; };
    const of = (sel) => [...rb.querySelectorAll(sel)].map(mid);
    const paths = [...rb.querySelectorAll('.rb-braid')].map((p) => { const bb = p.getBBox(); return { len: p.getTotalLength(), x0: bb.x, x1: bb.x + bb.width, y0: bb.y, y1: bb.y + bb.height }; });
    return { W: R.width, H: R.height, in: mid(rb.querySelector('.rb-jack.in')), out: mid(rb.querySelector('.rb-jack.out')), pre: of('.rb-piece.pre'), post: of('.rb-piece.post'), rack: of('.rb-piece.rack'), amp: of('.rb-piece.amp')[0], cab: of('.rb-piece.cab')[0], paths };
  });
  let L = await lay();
  const xs = [L.in.x, ...L.pre.map((p) => p.x), L.amp.x, ...L.post.map((p) => p.x), ...L.rack.map((p) => p.x), L.out.x];
  check(xs.every((x, i) => !i || x < xs[i - 1] + 1), 'the rig stands in signal order from your guitar on the right to the speakers on the left');
  const floor = [...L.pre, ...L.post, ...L.rack, L.cab].map((p) => p.b);
  check(Math.max(...floor) - Math.min(...floor) <= 2, 'pedals, cabinet and rack all stand on one floor line');
  check(L.amp.b <= L.cab.t + 4 && Math.abs(L.amp.x - L.cab.x) < 3, 'the amp head sits on its cabinet');
  const all = [...L.pre, ...L.post, ...L.rack];
  const sorted = all.slice().sort((a, b) => a.l - b.l);
  check(sorted.every((p, i) => !i || p.l >= sorted[i - 1].r + 20), 'no two pieces overlap');
  // cables: nothing wanders: none goes above the gear, and the whole lot is not much longer than the rig is wide
  const top = Math.min(L.amp.t, ...all.map((p) => p.t));
  const total = L.paths.reduce((a, p) => a + p.len, 0);
  const span = L.in.x - L.out.x;
  check(L.paths.every((p) => p.y0 >= top - 2 && p.y1 <= L.H), 'no cable strays above the gear or off the board');
  check(L.W <= 1600 && total < span * 2.2, `the cables are short: ${Math.round(total)} px of cable for a rig ${Math.round(span)} px wide`);
  const hops = L.paths.filter((p) => p.y1 < floor[0] + 20);
  check(hops.every((p) => p.len < 380), `patch cables only reach the next piece (longest ${Math.round(Math.max(...hops.map((p) => p.len)))} px)`);
  await shot('full');

  // nudge: a small drag moves the piece a little and the cable ends follow
  const first = page.locator('.rb-piece.pre').first();
  const fb = await first.locator('.rb-art').boundingBox();
  const sel0 = await first.getAttribute('data-i');
  await page.mouse.move(fb.x + fb.width / 2, fb.y + fb.height / 2);
  await page.mouse.down();
  await page.mouse.move(fb.x + fb.width / 2 + 14, fb.y + fb.height / 2 - 20, { steps: 5 });
  await page.mouse.up();
  await page.waitForTimeout(400);
  const fb2 = await page.locator(`.rb-piece[data-i="${sel0}"] .rb-art`).boundingBox();
  check(Math.abs(fb2.x - fb.x - 14) < 3 && Math.abs(fb2.y - fb.y + 20) < 3, 'dragging a pedal a little shifts it and it stays there');
  await shot('nudged');
  // a big drag is held back: things stay in their places
  await page.mouse.move(fb2.x + fb2.width / 2, fb2.y + fb2.height / 2);
  await page.mouse.down();
  await page.mouse.move(fb2.x + fb2.width / 2, fb2.y - 300, { steps: 5 });
  await page.mouse.up();
  await page.waitForTimeout(400);
  const fb3 = await page.locator(`.rb-piece[data-i="${sel0}"] .rb-art`).boundingBox();
  check(fb.y - fb3.y <= 36, 'a piece can only be lifted a little');
  // swap: drag the first pedal past the second
  const order0 = await page.evaluate(() => window.__rig.liveTone.gear.filter((g) => g.slot === 'pre').map((g) => g.key));
  const second = await page.locator('.rb-piece.pre').nth(1).locator('.rb-art').boundingBox();
  await page.mouse.move(fb3.x + fb3.width / 2, fb3.y + fb3.height / 2);
  await page.mouse.down();
  await page.mouse.move(second.x + 6, fb3.y + fb3.height / 2, { steps: 8 });
  await shot('dragging');
  await page.mouse.up();
  await page.waitForTimeout(700);
  const order1 = await page.evaluate(() => window.__rig.liveTone.gear.filter((g) => g.slot === 'pre').map((g) => g.key));
  check(order1[0] === order0[1] && order1[1] === order0[0], 'dragging a pedal past its neighbour swaps their places in the chain');
  L = await lay();
  check(L.pre.every((p, i) => !i || p.x < L.pre[i - 1].x), 'and the board tidies itself back into order');
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(500);
  const order2 = await page.evaluate(() => window.__rig.liveTone.gear.filter((g) => g.slot === 'pre').map((g) => g.key));
  check(order2[0] === order0[0], 'Ctrl+Z undoes the swap');
  // drag a pedal across the amp: it goes into the loop
  const lastPre = page.locator('.rb-piece.pre').last();
  const lp = await lastPre.locator('.rb-art').boundingBox();
  const nPost = L.post.length;
  const ampBox = await page.locator('.rb-piece.amp .rb-art').boundingBox();
  await page.mouse.move(lp.x + lp.width / 2, lp.y + lp.height / 2);
  await page.mouse.down();
  await page.mouse.move(ampBox.x + ampBox.width * 0.2, lp.y + lp.height / 2, { steps: 10 });
  await page.mouse.up();
  await page.waitForTimeout(700);
  check((await page.locator('.rb-piece.post').count()) === nPost + 1, 'dragging a pedal across the amp puts it in the amp’s loop');
  // a click still picks
  await page.locator('.rb-piece.cab .rb-art').click();
  await page.waitForTimeout(400);
  check((await page.locator('.rb-piece.cab.sel').count()) === 1, 'a click still opens the piece');
  // labels on tape
  check((await page.locator('.rb-gaffer').count()) >= 2 && (await page.locator('.rb-tape').count()) >= 6, 'gear and groups are labelled on tape');
  await page.locator('.rr-name').fill('Tidy board');
  await page.waitForTimeout(200);
  check(/Tidy board/i.test(await page.locator('.rb-sticker').textContent()), 'the tone’s name is on the board’s sticker');
  await shot('final');
  await page.setViewportSize({ width: 1180, height: 760 });
  await page.waitForTimeout(700);
  await shot('small');
  L = await lay();
  const fl = [...L.post, ...L.rack, L.cab].map((p) => p.b); // (a pedal in front was lifted on purpose above)
  check(Math.max(...fl) - Math.min(...fl) <= 2 && L.amp.t > 20 && L.W <= 1180, 'the board still fits and lines up in a smaller window');
  await page.setViewportSize({ width: 1600, height: 950 });
  await page.waitForTimeout(500);
  const rk = await page.locator('.rb-piece.rack .rb-art').first().boundingBox();
  await page.mouse.move(rk.x + rk.width / 2, rk.y + rk.height / 2);
  await page.mouse.down();
  await page.mouse.move(rk.x + rk.width / 2 - 12, rk.y + rk.height / 2 - 9, { steps: 4 });
  await page.mouse.up();
  await page.waitForTimeout(400);
  await page.locator('.rr-save').click();
  await page.waitForTimeout(900);
  const saved = await page.evaluate(async () => { const { tonelib } = await import('./js/tonelib.js'); return tonelib.list.find((t) => t.name === 'Tidy board'); });
  check(!!saved && saved.gear.some((g) => g.slot === 'rack' && g.at && g.at[0] === -12 && g.at[1] === -9), `the tone saves, with where you nudged things (${saved && JSON.stringify(saved.gear.map((g) => [g.slot, g.at || 0]))})`);
  await page.locator('.rr-close').click();
  await page.waitForTimeout(400);
  check(!errs.length, `no page errors${errs.length ? `: ${errs.slice(0, 3).join(' | ')}` : ''}`);
};
