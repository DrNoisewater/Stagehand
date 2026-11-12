/** 4.9 art: banner scraps on every page (both looks), the cameos on the level-up, milestone,
 *  legendary and trophy cards, the Getting started marker ring, the tone-saved stamp, and
 *  that "Less decoration" hides them.
 *  Run: SH_AUDIT=test/e2e/cameo-audit.js node test/e2e/ui3-chromium.js native/build/stagehand-audio-fake <outDir>
 *  CAMEO_VISITS=3 (banner visits per page)  */
const path = require('path');
module.exports = async ({ page, outDir, check }) => {
  const shot = (n, clip) => page.screenshot({ path: path.join(outDir, `cameo-${n}.png`), clip });
  const go = async (n) => { await page.evaluate(async (n) => (await import('./js/store.js')).setPage(n), n); await page.waitForTimeout(1200); };
  const closeModals = async () => { for (let i = 0; i < 3 && await page.locator('.modal').count(); i++) await page.keyboard.press('Escape'); };
  const brokenImages = () => page.evaluate(() => [...document.images].filter((i) => i.complete && i.src && !i.naturalWidth && getComputedStyle(i).display !== 'none').map((i) => i.src));
  await page.setViewportSize({ width: 1600, height: 950 });
  await closeModals();
  const look = (l) => page.evaluate((l) => {
    const k = 'stagehand.appearance.v1';
    const p = JSON.parse(localStorage.getItem(k) || '{}'); p.look = l; p.reduced = false;
    localStorage.setItem(k, JSON.stringify(p));
    document.documentElement.dataset.look = l === 'roadshow' ? 'roadshow' : 'opera';
    document.documentElement.dataset.decoration = 'full';
  }, l);
  await look('opera');
  const visits = Number(process.env.CAMEO_VISITS || 3);
  const seen = { marks: new Set(), tapes: new Set(), papers: new Set(), notes: new Set(), art: new Set() };
  for (const p of ['play', 'songs', 'tones', 'gear', 'discover', 'progress', 'greenroom']) {
    for (let v = 0; v < visits; v++) {
      await go(v % 2 ? 'songs' : 'play'); await go(p);
      if (p === 'play' || p === 'songs') { await go(p === 'play' ? 'tones' : 'progress'); await go(p); }
      const st = await page.evaluate(() => {
        const b = document.querySelector('.identity-banner');
        const n = document.querySelector('.opera-sticker-img.note:not([hidden])');
        return { mark: b.dataset.mark, tape: b.dataset.tape, paper: b.dataset.paper, note: n && n.getAttribute('src'), art: document.querySelector('.identity-art')?.dataset.art };
      });
      seen.marks.add(st.mark); seen.tapes.add(st.tape); seen.papers.add(st.paper); if (st.note) seen.notes.add(st.note); seen.art.add(st.art);
      await page.waitForTimeout(900);
      await shot(`banner-${p}-${v}`, { x: 0, y: 0, width: 1600, height: 260 });
    }
  }
  check(seen.marks.size >= 3 && seen.tapes.size >= 2 && seen.papers.size >= 3, 'banner: marks, tapes, papers vary ' + JSON.stringify({ marks: [...seen.marks], tapes: [...seen.tapes], papers: [...seen.papers] }));
  check(seen.notes.size >= 2, 'banner: page notes show up' + ' ' + ([...seen.notes].join(' ')));
  check([...seen.art].some((a) => a && !/^(temple-of-jam|creation-of-riff|lute-serenade|jazz-oracle|crossroads-duel|valkyrie-bassist|glass-cherub)$/.test(a)), 'banner: new mythology art is in the rotation' + ' ' + ([...seen.art].join(' ')));
  check((await brokenImages()).length === 0, 'no broken pictures' + ' ' + ((await brokenImages()).join(' ')));

  // the cards with their characters
  const card = async (name, fn, wait = 1300) => {
    await page.evaluate(fn);
    await page.waitForTimeout(wait);
    const has = await page.evaluate(() => { const c = document.querySelector('.lvup .cameo'); return !!(c && c.naturalWidth && getComputedStyle(c).display !== 'none'); });
    await shot(name);
    check(has, `${name}: character shown`);
    // close it the way a click does, so the next card in line comes up
    await page.evaluate(() => document.querySelectorAll('.lvup button').forEach((b) => b.click()));
    await page.waitForTimeout(700);
  };
  await go('progress');
  const st = '({ level: 7, tier: { id: "garage", name: "Garage band" }, venues: [], trophies: [{ id: "streak", name: "Streak master" }], titles: [] })';
  await card('levelup', `(async () => { const r = await import('./js/rewards.js'); const st = ${st}; r.levelUp({ ...st, level: 6 }, st); })()`);
  await card('milestone', `(async () => { const r = await import('./js/rewards.js'); const st = ${st}; r.levelUp({ ...st, level: 9 }, { ...st, level: 10, tier: { id: 'headliner', name: 'Headliner' } }); })()`);
  await card('legendary', `(async () => { const r = await import('./js/rewards.js'); const st = ${st}; r.levelUp({ ...st, level: 99 }, { ...st, level: 100, tier: { id: 'hof', name: 'Hall of Fame' } }); })()`);
  await card('trophy', `(async () => { const r = await import('./js/rewards.js'); const st = ${st}; r.trophyCard({ key: 't:streak:2', xp: 50 }, st); })()`);

  // Getting started: the marker ring and the chalk arrow
  let found = false;
  for (let i = 3; i < 16 && !found; i++) {
    await closeModals();
    await page.evaluate(async (i) => (await import('./js/guide.js')).openGuide({ step: i }), i);
    await page.waitForTimeout(400);
    const btn = page.locator('.modal button', { hasText: 'Show me' }).first();
    if (await btn.count()) { await btn.click(); found = true; }
  }
  await page.waitForTimeout(1500);
  const ring = await page.evaluate(() => { const r = document.querySelector('.gs-ring.marker'); const a = document.querySelector('.gs-tip .gs-arrow'); return { ring: !!r && !r.hidden, arrow: !!(a && a.naturalWidth), side: document.querySelector('.gs-tip')?.dataset.side }; });
  await shot('guide-ring');
  check(found && ring.ring && ring.arrow, 'guide: marker ring and chalk arrow' + ' ' + (JSON.stringify(ring)));
  await page.keyboard.press('Escape'); await page.waitForTimeout(300);
  await page.evaluate(() => document.querySelectorAll('.gs-ring,.gs-tip').forEach((x) => x.remove()));
  await closeModals();

  // Create a Tone: save, and the inspection sticker lands on the board
  await go('tones');
  await page.evaluate(async () => (await import('./js/rigroom.js')).openRig({ kind: 'guitar' }));
  await page.waitForTimeout(2500);
  const name = page.locator('.rr-name input, input.rr-name, .rr-top input[type=text]').first();
  if (await name.count()) await name.fill('Cameo test tone');
  await page.keyboard.press('Control+s');
  await page.waitForTimeout(700);
  const stamped = await page.evaluate(() => !!document.querySelector('.rr-board .saved-stamp'));
  await shot('rig-saved');
  check(stamped, 'Create a Tone: saved stamp on the board');
  await closeModals(); await page.keyboard.press('Escape'); await page.waitForTimeout(400); await closeModals();

  // Roadshow look keeps its own banner (no tape, no flyer marks)
  await look('roadshow');
  await go('songs'); await go('play');
  await shot('roadshow-play', { x: 0, y: 0, width: 1600, height: 260 });
  check(await page.evaluate(() => getComputedStyle(document.querySelector('.opera-tape')).display === 'none'), 'roadshow: no Rehearsal Room tape');

  // Less decoration hides every cameo
  await look('opera');
  await page.evaluate(() => { document.documentElement.dataset.decoration = 'reduced'; });
  await page.evaluate(async () => { const r = await import('./js/rewards.js'); r.levelUp({ level: 3, tier: { id: 'a', name: 'A' }, venues: [] }, { level: 4, tier: { id: 'a', name: 'A' }, venues: [] }); });
  await page.waitForTimeout(900);
  check(await page.evaluate(() => [...document.querySelectorAll('.cameo')].every((c) => getComputedStyle(c).display === 'none')), 'Less decoration hides cameos');
  await shot('reduced-levelup');
  await page.evaluate(() => { document.documentElement.dataset.decoration = 'full'; document.querySelectorAll('.lvup').forEach((x) => x.remove()); });
};
