// node shoot.js outDir scene:t[:play][:hits] ...
const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require(process.env.PLAYWRIGHT || '/opt/npm-tools/node_modules/playwright');
const R = path.join(__dirname, '..', '..', 'src', 'renderer');
const PORT = Number(process.env.PORT || 8765);
const STUBS = ['api.js', 'rig.js', 'tab.js', 'tonelib.js', 'captures.js', 'realamps.js', 'drums.js'];
const types = { '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.ttf': 'font/ttf', '.json': 'application/json', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.avif': 'image/avif' };
const srv = http.createServer((req, res) => {
  let u = decodeURIComponent(req.url.split('?')[0]);
  let f;
  if (u === '/' || u === '/index.html') f = path.join(__dirname, 'index.html');
  else if (u === '/harness.js' || u.endsWith('.json') && !u.startsWith('/data/')) f = path.join(__dirname, path.basename(u));
  else if (u.startsWith('/js/') && STUBS.includes(path.basename(u))) f = path.join(__dirname, 'stubs', path.basename(u));
  else f = path.join(R, u);
  fs.readFile(f, (e, d) => {
    if (e) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'content-type': types[path.extname(f)] || 'application/octet-stream' });
    res.end(d);
  });
});
// ===== GFXCHECK=1 (begin): do the highway's style and graphics settings really change the picture? =====
// One still of a busy moment (notes on screen, a hit with its effect) per setting value, everything else fixed,
// measured against a baseline: share of pixels changed noticeably, mean colour difference, the same over the
// highway area only, and the busiest 1/8 x 1/8 patch of the picture. 4.31 settings only: per style Brightness
// (both ends) and Effects (Calm, Off) against Full; graphics presets Low/Medium/Ultra against High on a couple
// of styles; the style's own room against a photo venue; and every style against every other.
// Graphics use the fixed High preset (not Auto, so its budget stepping can't change a shot). Time is frozen in
// the page so hit effects and pulses are the same every shot. Writes <out>/gfxcheck.json, gfxcheck-sheet.png, gfxcheck/*.png
// Exit code 1 when a setting that should show moves under 0.5% of the pixels (a style with no hit effect or no
// room movement is expected to show nothing for the Effects it doesn't have). Style pairs under 9/255 on the
// highway area are listed as FLAGGED PAIRS but don't fail the run. About 90 shots: ~20 min on the software GPU.
//   GFXCHECK=1 PLAYWRIGHT=playwright node test/hwlook/shoot.js <outDir> C:7.0     (1280x720 unless VW/VH are set)
//   GFXCHECK_ONLY=noise,classic,neon   only these: parts (noise bright fx presets room styles) and/or style ids
//     (style ids alone run bright and fx for them; presets and room run on their own few styles unless ids are given)
const GFXCHECK_NOTICE = 12; // a pixel counts as changed when any colour moves by at least this much (of 255)
const GFXCHECK_PAIR_MIN = 9; // two styles closer than this (mean colour difference of 255, highway area) are flagged
async function gfxCheck(browser, page, out, scene, t) {
  const dir = path.join(out, 'gfxcheck');
  fs.mkdirSync(dir, { recursive: true });
  const clock = Number(t);
  await page.evaluate((clock) => {
    const H = document.querySelector('.highway').__hw;
    if (H.perfState) H.perfState.n = -1e9;
    performance.now = () => 100000; // hit effects, pulses and Auto's timing stand still
    window.__stage.engine.position = clock;
    window.__gx = { frozen: 100000, shots: {} };
  }, clock);
  const styles = await page.evaluate(async () => (await import('/js/hwlooks.js')).THEMES.map((x) => ({ id: x.id, name: x.name, hit: x.def.hit, amb: x.sig.amb })));
  const ids = styles.map((s) => s.id);
  const parts = ['noise', 'bright', 'fx', 'presets', 'room', 'styles'];
  const only = (process.env.GFXCHECK_ONLY || '').split(/[\s,]+/).filter(Boolean);
  const onlyParts = only.filter((x) => parts.includes(x)), onlyIds = only.filter((x) => ids.includes(x));
  const bad = only.filter((x) => !parts.includes(x) && !ids.includes(x));
  if (bad.length) throw new Error('GFXCHECK_ONLY: unknown ' + bad.join(', ') + ' (parts: ' + parts.join(' ') + '; styles: ' + ids.join(' ') + ')');
  const runs = (p) => !only.length || onlyParts.includes(p) || (!onlyParts.length && onlyIds.length > 0 && (p === 'bright' || p === 'fx'));
  const pick = (dflt) => (onlyIds.length ? onlyIds : dflt);
  const sty = (id) => styles.find((s) => s.id === id);
  // a style (bg: its own room or the venue), its settings, and the graphics: a preset (default High) with the frame rate cap off
  const setLook = (theme, per, preset, bg) => page.evaluate(async ([theme, per, preset, bg]) => {
    const m = await import('/js/hwlooks.js');
    m.saveLooks({ ...m.loadLooks(), theme, bg, per: { [theme]: per }, gfx: { preset, fpsCap: 0 } });
    const H = document.querySelector('.highway').__hw;
    // a pretend dead-on hit, 0.12 s ago, on the notes just played
    H.hits = [];
    H.bursts = [];
    const pos = window.__stage.engine.position;
    H.targets.forEach((tg, id) => {
      if (tg.t > pos || tg.t < pos - 0.7) return;
      const at = window.__gx.frozen - 120;
      H.hits.push({ id, at, chord: tg.notes.length > 1, until: tg.t + (tg.sus || 0), offset: 0 });
      for (const nt of tg.notes) H.bursts.push({ s: nt.s, f: nt.f, at, until: tg.t + (tg.sus || 0) });
    });
    return { style: H.look.id, own: H.look.own, bloom: !!H.look.bloom, refl: H.look.refl, hit: H.look.hit, amb: H.look.amb, res: H.look.res, hits: H.hits.length };
  }, [theme, per, preset, bg]);
  const have = new Set();
  const take = async (key, theme, per = {}, preset = 'high', bg = 'own') => {
    if (have.has(key)) return;
    have.add(key);
    const info = await setLook(theme, per, preset, bg);
    await page.waitForTimeout(900);
    // 4.34: a style with its own graphics builds them first
    await page.evaluate(() => { const hx = document.querySelector('.highway').__hw.hx; return hx && Promise.race([hx.whenReady(), new Promise((r) => setTimeout(r, 20000))]); });
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
    const buf = await page.screenshot({ timeout: 90000 });
    fs.writeFileSync(path.join(dir, key.replace(/[^a-z0-9.-]+/gi, '_') + '.png'), buf);
    await page.evaluate(async ([key, b64]) => {
      const bmp = await createImageBitmap(await (await fetch('data:image/png;base64,' + b64)).blob());
      const c = new OffscreenCanvas(bmp.width, bmp.height);
      const x = c.getContext('2d');
      x.drawImage(bmp, 0, 0);
      window.__gx.shots[key] = x.getImageData(0, 0, bmp.width, bmp.height);
    }, [key, buf.toString('base64')]);
    console.log('  shot', key, JSON.stringify(info));
  };
  const diff = (a, b) => page.evaluate(([a, b, thr]) => {
    const A = window.__gx.shots[a], B = window.__gx.shots[b];
    const W = A.width, Hh = A.height;
    const x0 = Math.floor(W * 0.2), x1 = Math.floor(W * 0.8), y0 = Math.floor(Hh * 0.4), y1 = Math.floor(Hh * 0.95); // the highway area
    let n = 0, ch = 0, sum = 0, rn = 0, rch = 0, rsum = 0;
    const cell = new Array(64).fill(0), cellN = new Array(64).fill(0);
    for (let y = 0; y < Hh; y++) for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      const d0 = Math.abs(A.data[i] - B.data[i]), d1 = Math.abs(A.data[i + 1] - B.data[i + 1]), d2 = Math.abs(A.data[i + 2] - B.data[i + 2]);
      const hit = Math.max(d0, d1, d2) >= thr ? 1 : 0;
      const m = (d0 + d1 + d2) / 3;
      const ci = Math.min(7, Math.floor((y * 8) / Hh)) * 8 + Math.min(7, Math.floor((x * 8) / W));
      n++; ch += hit; sum += m; cell[ci] += hit; cellN[ci]++;
      if (x >= x0 && x < x1 && y >= y0 && y < y1) { rn++; rch += hit; rsum += m; }
    }
    return { pct: (ch / n) * 100, mean: sum / n, rpct: (rch / rn) * 100, rmean: rsum / rn, local: Math.max(...cell.map((c, i) => (c / cellN[i]) * 100)) };
  }, [a, b, GFXCHECK_NOTICE]);

  const rows = [];
  // expect: false when this setting is meant to show nothing on this style (it has no such effect)
  const cmp = async (group, label, baseKey, key, note = '', expect = true) => {
    const d = await diff(baseKey, key);
    rows.push({ group, setting: label, vs: baseKey, shot: key, pct: +d.pct.toFixed(3), mean: +d.mean.toFixed(3), regionPct: +d.rpct.toFixed(3), regionMean: +d.rmean.toFixed(3), localMaxPct: +d.local.toFixed(2), expect, note });
  };
  console.log('GFXCHECK scene', scene, 't', clock, only.length ? 'only ' + only.join(',') : 'everything');
  const base = (id) => take(id + '-base', id);

  // ---- the noise floor: the same picture twice
  if (runs('noise')) {
    await take('neon-base', 'neon');
    await take('neon-base2', 'neon');
    await cmp('noise', 'same picture twice', 'neon-base', 'neon-base2', '', false);
  }

  // ---- per style: Brightness at both ends, Effects Calm and Off, against the style's own starting settings
  for (const id of pick(ids)) {
    const s = sty(id), hasAmb = s.amb !== 'none', hasHit = s.hit !== 'none';
    if (runs('bright')) {
      await base(id);
      for (const b of [0.6, 1.3]) { const k = `${id}-bright-${b}`; await take(k, id, { bright: b }); await cmp('brightness', `${id} ${b}`, id + '-base', k); }
    }
    if (runs('fx')) {
      await base(id);
      await take(id + '-fx-calm', id, { fx: 'calm' });
      await cmp('effects', `${id} calm`, id + '-base', id + '-fx-calm', hasAmb ? '' : 'no movement in this style\'s room: same as Full', hasAmb);
      await take(id + '-fx-off', id, { fx: 'off' });
      await cmp('effects', `${id} off`, id + '-base', id + '-fx-off', hasHit || hasAmb ? '' : 'no hit effect and no movement in this style: same as Full', hasHit || hasAmb);
    }
  }

  // ---- graphics presets against High, on a couple of styles (one with a lot going on, one plain)
  if (runs('presets')) {
    for (const id of pick(['classic', 'inferno'])) {
      await base(id);
      for (const p of ['low', 'medium', 'ultra']) { const k = `${id}-preset-${p}`; await take(k, id, {}, p); await cmp('graphics', `${id} ${p} vs high`, id + '-base', k); }
    }
  }

  // ---- the style's own room against a photo venue (the page's venue behind the highway)
  if (runs('room')) {
    for (const id of pick(['classic', 'neon', 'synthwave', 'inferno'])) {
      await base(id);
      const k = id + '-venue';
      await take(k, id, {}, 'high', 'venue');
      await cmp('background', `${id} venue vs own room`, id + '-base', k, id === 'classic' ? 'Classic\'s own room is nearly the venue\'s dark: expect little' : '');
    }
  }

  // ---- how different the styles are from each other (each at its own starting settings, High graphics, own room)
  const pairs = [];
  if (runs('styles')) {
    const use = onlyIds.length ? onlyIds : ids;
    for (const id of use) await base(id);
    for (let i = 0; i < use.length; i++) for (let j = i + 1; j < use.length; j++) {
      const d = await diff(use[i] + '-base', use[j] + '-base');
      pairs.push({ a: use[i], b: use[j], pct: +d.pct.toFixed(2), mean: +d.mean.toFixed(2), regionPct: +d.rpct.toFixed(2), regionMean: +d.rmean.toFixed(2), flagged: d.rmean < GFXCHECK_PAIR_MIN });
    }
    pairs.sort((x, y) => x.regionMean - y.regionMean);
  }

  // ---- verdicts and the table
  for (const r of rows) r.verdict = r.group === 'noise' ? 'noise floor' : r.pct >= 2 ? 'works' : r.pct >= 0.5 ? 'weak' : !r.expect ? 'none expected' : r.localMaxPct >= 20 ? 'small area only' : 'no visible effect';
  console.log('\n' + 'setting'.padEnd(52) + 'pct%'.padStart(8) + 'mean'.padStart(8) + 'hwy%'.padStart(8) + 'hwy-mean'.padStart(10) + 'local%'.padStart(8) + '  verdict');
  for (const r of rows) console.log(`${(r.group + ' | ' + r.setting).padEnd(51)} ${String(r.pct).padStart(8)}${String(r.mean).padStart(8)}${String(r.regionPct).padStart(8)}${String(r.regionMean).padStart(10)}${String(r.localMaxPct).padStart(8)}  ${r.verdict}${r.note ? '  (' + r.note + ')' : ''}`);
  const flaggedPairs = pairs.filter((p) => p.flagged);
  if (pairs.length) {
    console.log(`\nStyles against each other, most alike first (highway area: mean colour difference of 255, pixels changed; under ${GFXCHECK_PAIR_MIN} flagged):`);
    for (const p of pairs.slice(0, 20)) console.log(`${(p.a + ' / ' + p.b).padEnd(22)} mean ${String(p.regionMean).padStart(6)}  highway pixels changed ${String(p.regionPct).padStart(6)}%  whole picture ${String(p.pct).padStart(6)}%${p.flagged ? '  FLAGGED' : ''}`);
    console.log(`FLAGGED PAIRS (${flaggedPairs.length}): ` + (flaggedPairs.map((p) => `${p.a}/${p.b} ${p.regionMean}`).join('; ') || 'none'));
  }
  const failed = rows.filter((r) => ['no visible effect', 'small area only'].includes(r.verdict));
  const weak = rows.filter((r) => r.verdict === 'weak');
  console.log(`\nNO VISIBLE EFFECT (${failed.length}): ` + failed.map((r) => `${r.group} ${r.setting} [${r.pct}%]`).join('; '));
  console.log(`WEAK (${weak.length}): ` + weak.map((r) => `${r.group} ${r.setting} [${r.pct}%]`).join('; '));
  const noise = rows.find((r) => r.group === 'noise') || { pct: null, mean: null };
  fs.writeFileSync(path.join(out, 'gfxcheck.json'), JSON.stringify({ scene, t: clock, viewport: page.viewportSize(), threshold: { noticeable: GFXCHECK_NOTICE, noEffectPct: 0.5, weakPct: 2, pairMin: GFXCHECK_PAIR_MIN }, noise: { pct: noise.pct, mean: noise.mean }, rows, stylePairs: pairs }, null, 1));

  // ---- the contact sheet: every shot with its numbers
  const cap = {};
  for (const r of rows) cap[r.shot] = `${r.setting}: ${r.pct}% ${r.verdict}`;
  // (pictures are linked from the files, not packed into the page: dozens of inline pictures made the browser drop the page)
  const esc = (x) => x.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  const figs = fs.readdirSync(dir).filter((f) => f.endsWith('.png')).sort().map((f) => `<figure style="margin:0"><img style="width:100%;display:block" src="file://${path.join(dir, f)}"><figcaption style="padding:1px">${esc(cap[f.replace(/\.png$/, '')] || f.replace(/\.png$/, ''))}</figcaption></figure>`);
  const sheetFile = path.join(out, 'gfxcheck-sheet.html');
  fs.writeFileSync(sheetFile, `<!doctype html><body style="margin:0;background:#111;color:#eee;font:600 13px sans-serif"><div style="display:grid;grid-template-columns:repeat(6,1fr);gap:4px;padding:4px">${figs.join('')}</div></body>`);
  const sheet = page; // (the browser runs as one process: no second page; the highway is done with)
  await sheet.setViewportSize({ width: 1920, height: 1000 });
  await sheet.goto('file://' + sheetFile, { waitUntil: 'load' });
  await sheet.screenshot({ path: path.join(out, 'gfxcheck-sheet.png'), fullPage: true, timeout: 120000 });
  console.log(`DONE gfxcheck: ${rows.length} comparisons, ${failed.length} with no visible effect, ${weak.length} weak, ${flaggedPairs.length} style pairs flagged; wrote gfxcheck.json and gfxcheck-sheet.png`);
  if (failed.length) process.exitCode = 1;
}
// ===== GFXCHECK=1 (end) =====
// ===== STUTTER=1 (begin): what stops the highway's picture for a moment while a song plays? =====
// Plays STUTTER_SECS (default 20) seconds from a song start with pretend dead-on hits on every note,
// in the style, graphics and background given (HWTHEME, HWGFX, HWBG, VENUE as above), and reports the
// longest waits between pictures, long tasks, and what the graphics card was asked to do in those frames:
// shader programs built (on Windows each one can take 50-200 ms), textures uploaded, buffers (re)made,
// render buffers resized. One-time costs (a program, a big upload) show here even on the software GPU;
// absolute times are slow, so compare spikes to the median frame.
//   STUTTER=1 HWTHEME=ember HWGFX=ultra VW=960 VH=540 PLAYWRIGHT=playwright node test/hwlook/shoot.js <outDir> A:0
// Writes <out>/stutter-<scene>.json. STUTTER_HITS=0 leaves out the pretend hits.
const STUTTER_INIT = () => {
  const st = (window.__st = { frames: [], gl: [], longs: [], cur: null, t0: 0 });
  const now = () => performance.now();
  const newFrame = () => ({ gl: 0, prog: 0, tex: 0, texBytes: 0, buf: 0, bufBytes: 0, rb: 0, made: 0, madeBytes: 0, what: {} });
  st.cur = newFrame();
  const tick = (ts) => {
    const f = st.cur;
    f.ts = ts;
    st.frames.push(f);
    st.cur = newFrame();
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  try {
    new PerformanceObserver((l) => { for (const e of l.getEntries()) st.longs.push({ at: e.startTime, ms: e.duration }); }).observe({ type: 'longtask', buffered: true });
  } catch (_) {}
  const wrap = (proto, name, kind, size) => {
    const orig = proto[name];
    if (!orig) return;
    proto[name] = function (...a) {
      const t = now();
      const r = orig.apply(this, a);
      const ms = now() - t;
      const f = st.cur;
      f.gl += ms;
      if (kind) f[kind]++;
      f.what[name] = (f.what[name] || 0) + ms;
      let b = 0;
      if (size) { b = size(a); if (kind === 'tex') f.texBytes += b; else if (kind === 'made') f.madeBytes += b; else f.bufBytes += b; }
      if (ms > 2) st.gl.push({ at: t, name, ms: +ms.toFixed(1), info: b || undefined });
      return r;
    };
  };
  const P = WebGL2RenderingContext.prototype;
  for (const n of ['compileShader', 'getShaderParameter', 'getUniformLocation', 'useProgram', 'drawElements', 'drawArrays', 'clear', 'blitFramebuffer', 'framebufferTexture2D', 'readPixels', 'finish', 'getError']) wrap(P, n);
  wrap(P, 'linkProgram', 'prog');
  wrap(P, 'getProgramParameter');
  const texSize = (a) => { const s = a[a.length - 1]; return s && s.width ? s.width * s.height * 4 : (a[3] * a[4] * 4) || 0; };
  const subSize = (a) => (a.length >= 9 ? a[4] * a[5] * 4 : texSize(a)); // texSubImage2D(target, level, x, y, w, h, format, type, source): the box sent
  wrap(P, 'texImage2D', 'tex', texSize);
  wrap(P, 'texSubImage2D', 'tex', subSize);
  wrap(P, 'texStorage2D', 'tex', (a) => a[3] * a[4] * 8);
  wrap(P, 'generateMipmap', 'tex', () => 0);
  wrap(P, 'bufferData', 'made', (a) => (a[1] && a[1].byteLength) || (typeof a[1] === 'number' ? a[1] : 0));
  wrap(P, 'bufferSubData', 'buf', (a) => (a[2] ? (a[4] ? a[4] * a[2].BYTES_PER_ELEMENT : a[2].byteLength) : 0));
  wrap(P, 'renderbufferStorageMultisample', 'rb');
  wrap(P, 'renderbufferStorage', 'rb');
};
async function stutterRun(browser, page, out, scene, t) {
  const secs = Number(process.env.STUTTER_SECS || 20);
  const hits = process.env.STUTTER_HITS !== '0';
  // a fresh start: at the song's start, Auto allowed to work, then Play
  await page.evaluate(([t0, hits, whole]) => {
    const H = document.querySelector('.highway').__hw;
    if (H.perfState) H.perfState.n = 0;
    if (whole) H.r3.text.sendWhole = true; // STUTTER_WHOLE=1: the old way (the whole label picture sent each time)
    const st = window.__st;
    st.frames.length = 0; st.gl.length = 0; st.longs.length = 0;
    window.__stage.engine.position = t0;
    st.t0 = performance.now();
    window.__stage.engine.play();
    // pretend dead-on hits: each note lights the moment it reaches the neck
    let next = 0;
    const T = H.targets;
    const go = () => {
      if (!H.open) return;
      const pos = window.__stage.engine.position;
      while (next < T.length && T[next].t <= pos) {
        const tg = T[next];
        if (hits && pos - tg.t < 0.2) {
          const at = performance.now();
          H.hits.push({ id: next, at, chord: tg.notes.length > 1, until: tg.t + (tg.sus || 0), offset: 0 });
          for (const nt of tg.notes) H.bursts.push({ s: nt.s, f: nt.f, at, until: tg.t + (tg.sus || 0) });
        }
        next++;
      }
      requestAnimationFrame(go);
    };
    requestAnimationFrame(go);
  }, [Number(t), hits, !!process.env.STUTTER_WHOLE]);
  // STUTTER_HEAP=1: what the page makes and throws away while playing (each throw-away is cleaned up later:
  // a pause), sampled, by the function that made it
  const cdp = process.env.STUTTER_HEAP && (await page.context().newCDPSession(page));
  // STUTTER_GC=1: how long each clean-up of thrown-away things stopped the page
  if (process.env.STUTTER_GC) await browser.startTracing(page, { categories: ['v8', 'disabled-by-default-v8.gc'] });
  if (cdp) await cdp.send('HeapProfiler.startSampling', { samplingInterval: 4096, includeObjectsCollectedByMajorGC: true, includeObjectsCollectedByMinorGC: true });
  await page.waitForTimeout(secs * 1000);
  if (process.env.STUTTER_GC) {
    const tr = JSON.parse((await browser.stopTracing()).toString());
    const ev = (tr.traceEvents || tr).filter((e) => e.ph === 'X' && /^(V8\.GC_|MinorGC|MajorGC|V8\.GCScavenger$|V8\.GCFinalizeMC$|V8\.GCCompactor$)/.test(e.name) && e.dur);
    const by = new Map();
    for (const e of ev) { const b = by.get(e.name) || { n: 0, ms: 0, most: 0 }; b.n++; b.ms += e.dur / 1000; b.most = Math.max(b.most, e.dur / 1000); by.set(e.name, b); }
    console.log('  clean-ups (GC) while playing:');
    for (const [k, b] of [...by.entries()].sort((x, y) => y[1].most - x[1].most).slice(0, 10)) console.log(`    ${k}: ${b.n} times, ${b.ms.toFixed(1)} ms in all, longest ${b.most.toFixed(1)} ms`);
  }
  if (cdp) {
    const { profile } = await cdp.send('HeapProfiler.stopSampling');
    const by = new Map();
    let all = 0;
    const walk = (n) => {
      const f = n.callFrame;
      const k = `${f.functionName || '(anon)'} ${(f.url || '').split('/').pop()}:${f.lineNumber + 1}`;
      by.set(k, (by.get(k) || 0) + n.selfSize);
      all += n.selfSize;
      for (const c of n.children || []) walk(c);
    };
    walk(profile.head);
    console.log(`  made while playing: ${(all / secs / 1024).toFixed(0)} KB a second; most by:`);
    for (const [k, v] of [...by.entries()].sort((a, b) => b[1] - a[1]).slice(0, 14)) console.log(`    ${(v / secs / 1024).toFixed(1)} KB/s  ${k}`);
  }
  const r = await page.evaluate(() => {
    const st = window.__st;
    const H = document.querySelector('.highway').__hw;
    const F = st.frames.filter((f) => f.ts >= st.t0);
    const rows = [];
    for (let i = 1; i < F.length; i++) {
      const f = F[i];
      rows.push({ at: +((f.ts - st.t0) / 1000).toFixed(2), gap: +(f.ts - F[i - 1].ts).toFixed(1), gl: +f.gl.toFixed(1), prog: f.prog, tex: f.tex, texKB: Math.round(f.texBytes / 1024), buf: f.buf, bufKB: Math.round(f.bufBytes / 1024), rb: f.rb, top: Object.entries(f.what).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k, v]) => `${k} ${v.toFixed(1)}`).join(', ') });
    }
    const gaps = rows.map((x) => x.gap).sort((a, b) => a - b);
    const med = gaps[Math.floor(gaps.length / 2)] || 0;
    return {
      frames: rows.length, median: med, p95: gaps[Math.floor(gaps.length * 0.95)] || 0,
      worst: rows.slice().sort((a, b) => b.gap - a.gap).slice(0, 15),
      progs: rows.filter((x) => x.prog).map((x) => `${x.at}s x${x.prog}`),
      rbs: rows.filter((x) => x.rb).map((x) => `${x.at}s x${x.rb}`),
      made: F.slice(1).filter((f) => f.made).map((f) => `${((f.ts - st.t0) / 1000).toFixed(2)}s x${f.made} ${Math.round(f.madeBytes / 1024)} KB`),
      bigTex: rows.filter((x) => x.texKB > 256).map((x) => `${x.at}s ${x.texKB} KB`),
      texSent: rows.filter((x) => x.texKB > 0).map((x) => `${x.at}s ${x.texKB} KB`), texKB: rows.reduce((a, x) => a + x.texKB, 0),
      bigBuf: rows.filter((x) => x.bufKB > 1024).map((x) => `${x.at}s ${x.bufKB} KB`),
      longs: st.longs.filter((l) => l.at >= st.t0).map((l) => `${((l.at - st.t0) / 1000).toFixed(2)}s ${Math.round(l.ms)}ms`),
      slowGl: st.gl.filter((g) => g.at >= st.t0).sort((a, b) => b.ms - a.ms).slice(0, 12).map((g) => `${((g.at - st.t0) / 1000).toFixed(2)}s ${g.name} ${g.ms}ms${g.info ? ' ' + g.info + 'B' : ''}`),
      look: H.look && { id: H.look.id, res: H.look.res, aa: H.look.aa, bloom: !!H.look.bloom, refl: H.look.refl },
      scale: H.r3 && H.r3.scale, budget: H.lookBudget && H.lookBudget(),
    };
  });
  fs.writeFileSync(path.join(out, `stutter-${scene}.json`), JSON.stringify(r, null, 1));
  console.log(`STUTTER ${scene} ${JSON.stringify(r.look)} scale ${r.scale} budget ${r.budget}: ${r.frames} frames, median ${r.median} ms, p95 ${r.p95} ms`);
  console.log('  programs built:', r.progs.join(' | ') || 'none');
  console.log('  render buffers (re)made:', r.rbs.join(' | ') || 'none');
  console.log('  vertex buffers (re)made:', r.made.join(' | ') || 'none');
  console.log('  big texture uploads:', r.bigTex.join(' | ') || 'none');
  console.log(`  pictures sent to the card: ${r.texKB} KB in all:`, r.texSent.slice(0, 12).join(' | ') || 'none');
  console.log('  big buffer uploads:', r.bigBuf.join(' | ') || 'none');
  console.log('  long tasks:', r.longs.join(' | ') || 'none');
  console.log('  slowest GL calls:', r.slowGl.join(' | ') || 'none');
  console.log('  worst frames:');
  for (const w of r.worst) console.log(`    ${w.at}s gap ${w.gap} ms  gl ${w.gl} ms  prog ${w.prog} tex ${w.tex} (${w.texKB} KB) buf ${w.buf} (${w.bufKB} KB) rb ${w.rb}  ${w.top}`);
}
// ===== STUTTER=1 (end) =====
// ===== FLICKER=1 (begin): do the notes flicker from one frame to the next? =====
// The clock stands still; the song moves on FLICKER_DT ms (default 2) a frame for FLICKER_N frames (default 24),
// so the notes slide a pixel or less each time. A note drawn steadily changes smoothly; one that flickers has
// pixels that jump and jump back (frame b far from both a and c, the same way). Counted on the notes only (an
// HD style's own notes: the pixels that change when they are hidden) or the whole picture (Classic). The same
// time drawn twice must be identical. Exits 1 when more than FLICKER_MAX (default 0.5) % of the note pixels jump
// by 48/255 or more. A scene ending in :H holds the notes just played (a hit flare at the neck while they ring).
//   FLICKER=1 HWGFX=high HWTHEME=neon VW=960 VH=540 PLAYWRIGHT=playwright node test/hwlook/shoot.js <outDir> T:17.2
async function flickerRun(page, out, scene, t, hits) {
  const N = Number(process.env.FLICKER_N || 24);
  const dt = Number(process.env.FLICKER_DT || 2) / 1000;
  const JUMP = 48;
  const frames = (n) => page.evaluate((n) => new Promise((r) => { const f = () => (--n ? requestAnimationFrame(f) : r()); requestAnimationFrame(f); }), n);
  const info = await page.evaluate(([t0, hold]) => {
    const H = document.querySelector('.highway').__hw;
    const T = 100000;
    performance.now = () => T;
    window.__stage.engine.position = t0;
    H.hits = []; H.bursts = [];
    if (hold) H.targets.forEach((tg, id) => {
      if (tg.t > t0 || tg.t < t0 - 0.15) return;
      H.hits.push({ id, at: T - 100, chord: tg.notes.length > 1, until: tg.t + Math.max(0.6, tg.sus || 0), offset: 0 });
    });
    let gem = null;
    H.r3.scene.traverse((o) => { if (o.material && /hdGem\(HDGem/.test(o.material.fragmentShader || '')) gem = o; });
    window.__fl = { gem, shots: [], mask: null };
    return { style: H.look.id, hd: !!gem, hits: H.hits.length };
  }, [Number(t), hits === 'H']);
  await frames(60); // the camera settles
  const grab = async (keep) => {
    await frames(3);
    const buf = await page.screenshot({ timeout: 90000 });
    return page.evaluate(async ([b64, keep]) => {
      const bmp = await createImageBitmap(await (await fetch('data:image/png;base64,' + b64)).blob());
      const c = new OffscreenCanvas(bmp.width, bmp.height);
      const x = c.getContext('2d');
      x.drawImage(bmp, 0, 0);
      const d = x.getImageData(0, 0, bmp.width, bmp.height);
      if (keep) window.__fl.shots.push(d);
      return d;
    }, [buf.toString('base64'), keep]).then(() => buf);
  };
  // the note pixels: what changes when the style's notes are hidden (first, middle and last time)
  const maskAt = async (pos) => {
    await page.evaluate((pos) => { window.__stage.engine.position = pos; }, pos);
    if (!info.hd) return;
    await grab(true);
    await page.evaluate(() => { window.__fl.gem.material.visible = false; });
    await grab(true);
    await page.evaluate(() => {
      const F = window.__fl;
      F.gem.material.visible = true;
      const [A, B] = F.shots.splice(-2);
      if (!F.mask) F.mask = new Uint8Array(A.width * A.height);
      for (let i = 0; i < F.mask.length; i++) {
        const j = i * 4;
        if (Math.max(Math.abs(A.data[j] - B.data[j]), Math.abs(A.data[j + 1] - B.data[j + 1]), Math.abs(A.data[j + 2] - B.data[j + 2])) > 8) F.mask[i] = 1;
      }
    });
  };
  const t0 = Number(t);
  for (const k of [0, Math.floor(N / 2), N - 1]) await maskAt(t0 + k * dt);
  // the frames, and the first one again
  for (let k = 0; k < N; k++) {
    await page.evaluate((pos) => { window.__stage.engine.position = pos; }, t0 + k * dt);
    const buf = await grab(true);
    if (k === 0 || k === N >> 1) fs.writeFileSync(path.join(out, `flicker-${scene}-${info.style}-${k}.png`), buf);
  }
  await page.evaluate((pos) => { window.__stage.engine.position = pos; }, t0);
  await grab(true);
  const r = await page.evaluate(([JUMP]) => {
    const F = window.__fl;
    const S = F.shots;
    const again = S.pop();
    const W = S[0].width, Hh = S[0].height;
    const mask = F.mask || new Uint8Array(W * Hh).fill(1);
    let area = 0;
    for (let i = 0; i < mask.length; i++) area += mask[i];
    let same = 0;
    for (let i = 0; i < S[0].data.length; i++) if (S[0].data[i] !== again.data[i]) same++;
    let jumps = 0, most = 0, sum = 0;
    const per = [];
    const where = new Uint32Array(64);
    for (let k = 1; k < S.length - 1; k++) {
      const a = S[k - 1].data, b = S[k].data, c = S[k + 1].data;
      let n = 0;
      for (let i = 0; i < mask.length; i++) {
        if (!mask[i]) continue;
        const j = i * 4;
        let sp = 0;
        for (let ch = 0; ch < 3; ch++) {
          const da = b[j + ch] - a[j + ch], dc = b[j + ch] - c[j + ch];
          if ((da > 0 && dc > 0) || (da < 0 && dc < 0)) sp = Math.max(sp, Math.min(Math.abs(da), Math.abs(dc)));
        }
        sum += sp;
        if (sp >= JUMP) { n++; where[Math.min(7, Math.floor(((i / W) | 0) * 8 / Hh)) * 8 + Math.min(7, Math.floor((i % W) * 8 / W))]++; }
        most = Math.max(most, sp);
      }
      jumps += n;
      per.push(n);
    }
    const frames = S.length - 2;
    let wi = 0;
    for (let i = 1; i < 64; i++) if (where[i] > where[wi]) wi = i;
    return { area, frames, jumpPct: (jumps / Math.max(1, area * frames)) * 100, meanSpike: sum / Math.max(1, area * frames), most, perFrame: per, again: same, hot: { row: wi >> 3, col: wi & 7, n: where[wi] } };
  }, [JUMP]);
  const max = Number(process.env.FLICKER_MAX || 0.5);
  console.log(`FLICKER ${scene}:${t} ${info.style}${info.hits ? ' (held ' + info.hits + ')' : ''}: ${info.hd ? 'note' : 'picture'} pixels ${r.area}, ${r.frames} frames ${dt * 1000} ms apart; ` +
    `pixels that jump and jump back by ${JUMP}/255 or more: ${r.jumpPct.toFixed(3)}% (mean jump ${r.meanSpike.toFixed(2)}, biggest ${r.most}); per frame ${r.perFrame.join(' ')}; busiest eighth row ${r.hot.row} col ${r.hot.col} (${r.hot.n}); same time twice: ${r.again} values differ`);
  fs.writeFileSync(path.join(out, `flicker-${scene}-${info.style}.json`), JSON.stringify({ scene, t, ...info, ...r }, null, 1));
  if (r.again || r.jumpPct > max) { console.log(`FAIL notes flicker (limit ${max}%)`); process.exitCode = 1; }
  else console.log('PASS the notes are steady');
}
// ===== FLICKER=1 (end) =====
(async () => {
  await new Promise((r) => srv.listen(PORT, r));
  const out = process.argv[2];
  fs.mkdirSync(out, { recursive: true });
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined, args: ['--single-process', '--no-zygote', '--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'] });
  const page = await browser.newPage({ viewport: { width: Number(process.env.VW || (process.env.GFXCHECK ? 1280 : 1920)), height: Number(process.env.VH || (process.env.GFXCHECK ? 720 : 1080)) }, ...(process.env.VIDEO ? { recordVideo: { dir: out, size: { width: 1280, height: 720 } } } : {}) });
  if (process.env.STUTTER) await page.addInitScript(STUTTER_INIT);
  page.on('pageerror', (e) => console.log('PAGEERR', e.message, (e.stack || '').split('\n').slice(1, 3).join(' ')));
  page.on('console', (m) => m.type() === 'error' && console.log('CONSOLE', m.text()));
  for (const spec of process.argv.slice(3)) {
    const [scene, t, play, hits, file, part] = spec.split(':');
    await page.goto(`http://localhost:${PORT}/?scene=${scene}&t=${t}&play=${play === 'p' ? 1 : 0}&file=${file || ''}&part=${part || ''}${process.env.SING ? `&sing=${process.env.SING}` : ''}${process.env.PIANO ? `&piano=${process.env.PIANO}` : ''}${process.env.NONOTES ? '&nonotes=1' : ''}${process.env.TOPBAR || process.env.MODES ? '&piano=tune&sing=1' : ''}`);
    await page.waitForFunction(() => window.__hwReady, null, { timeout: Number(process.env.HWWAIT || 15000) });
    if (process.env.VENUE) {
      await page.evaluate((v) => { const p = JSON.parse(localStorage.getItem('stagehand.highway') || '{}'); p.venue = v; p.v = 36; localStorage.setItem('stagehand.highway', JSON.stringify(p)); localStorage.setItem('stagehand.fluidDye', '256'); }, process.env.VENUE);
      await page.reload();
      await page.waitForFunction(() => window.__hwReady, null, { timeout: Number(process.env.HWWAIT || 15000) });
    }
    if (process.env.GFXCHECK) { await gfxCheck(browser, page, out, scene, t); continue; } // GFXCHECK=1: see the block above
    // HWTHEME=<look> (and HWGFX=<preset>): the highway in that look (hwlooks.js), set before the page loads
    if (process.env.HWTHEME || process.env.HWGFX) {
      await page.evaluate(([t, g]) => { localStorage.setItem('stagehand.hwlook.v1', JSON.stringify({ theme: t || 'classic', gfx: { preset: g || 'auto', ...(g && g !== 'auto' ? {} : {}) } })); }, [process.env.HWTHEME, process.env.HWGFX]);
      if (process.env.HWGFX) await page.evaluate(async (g) => { const m = await import('/js/hwlooks.js'); m._reset(); const st = m.loadLooks(); m.saveLooks({ ...st, gfx: m.applyPreset(st.gfx, g) }); }, process.env.HWGFX);
      await page.reload();
      await page.waitForFunction(() => window.__hwReady, null, { timeout: Number(process.env.HWWAIT || 15000) });
    }
    // HWBG=own|venue (4.31): the style's own room, or the venue (VENUE=…) behind the highway
    if (process.env.HWBG) {
      await page.evaluate(async (b) => { const m = await import('/js/hwlooks.js'); m.saveLooks({ ...m.loadLooks(), bg: b }); }, process.env.HWBG);
      await page.reload();
      await page.waitForFunction(() => window.__hwReady, null, { timeout: Number(process.env.HWWAIT || 15000) });
    }
    // SKIN=<theme>: the song screen in that Appearance theme (its bars and menus; the notes keep their look)
    if (process.env.SKIN) {
      await page.evaluate((k) => { document.documentElement.dataset.look = 'opera'; document.documentElement.dataset.skin = k; const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = 'css/themes-stage.css'; document.head.append(l); }, process.env.SKIN);
      await page.waitForTimeout(400);
    }
    // 4.34: a style with its own graphics: wait until they are built and compiled
    await page.waitForTimeout(300);
    await page.evaluate(() => { const H = document.querySelector('.highway').__hw; return H.hx ? Promise.race([H.hx.whenReady(), new Promise((r) => setTimeout(r, 20000))]) : true; });
    // software rendering here is slow: keep the glow on for stills (the app turns it off on slow PCs)
    await page.evaluate(() => { const H = document.querySelector('.highway').__hw; if (H.perfState) H.perfState.n = -1e9; });
    if (process.env.STUTTER) { await stutterRun(browser, page, out, scene, t); continue; } // STUTTER=1: see the block above
    if (process.env.FLICKER) { await flickerRun(page, out, scene, t, hits); continue; } // FLICKER=1: see the block above
    // ATLAS=1 (4.32.1): labels that first show mid-song are sent to the graphics card on their own (only
    // their box of the label picture); the picture must be the same as when the whole label picture is sent
    // (a few colour values may round one step apart).
    // Draws every label again from nothing (sent on their own), then sends the whole picture, and compares the
    // label picture on the graphics card both ways.
    if (process.env.ATLAS) {
      const frames = (n) => page.evaluate((n) => new Promise((r) => { const f = () => (--n ? requestAnimationFrame(f) : r()); requestAnimationFrame(f); }), n);
      await page.evaluate((b) => { performance.now = () => 100000; window.__atlasBreak = b; }, !!process.env.ATLAS_BREAK);
      await frames(60); // the camera settles
      // the labels drawn again from nothing, one box at a time, each sent on its own
      const before = await page.evaluate(() => {
        const T = document.querySelector('.highway').__hw.r3.text;
        const n = T.items.size;
        T.items.clear();
        T.actx.clearRect(14, 0, T.size - 14, T.size);
        T.actx.clearRect(0, 14, T.size, T.size - 14);
        Object.assign(T.shelf, { x: 14, y: 2, h: 10 });
        // the card's copy painted over in magenta, so only what is sent now can make the labels show
        const gl = T.renderer.getContext();
        const fb = gl.createFramebuffer();
        gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, T.renderer.properties.get(T.tex).__webglTexture, 0);
        gl.clearColor(1, 0, 1, 1);
        gl.clear(gl.COLOR_BUFFER_BIT);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        gl.deleteFramebuffer(fb);
        T.renderer.resetState();
        // ATLAS_BREAK=1: nothing sent on its own (the check must then fail)
        if (window.__atlasBreak) T.renderer.copyTextureToTexture = () => {};
        return n;
      });
      await frames(4);
      // the label picture as the graphics card holds it
      const grab = () => page.evaluate(() => {
        const T = document.querySelector('.highway').__hw.r3.text;
        const gl = T.renderer.getContext();
        const fb = gl.createFramebuffer();
        gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, T.renderer.properties.get(T.tex).__webglTexture, 0);
        const px = new Uint8Array(T.size * T.size * 4);
        gl.readPixels(0, 0, T.size, T.size, gl.RGBA, gl.UNSIGNED_BYTE, px);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        gl.deleteFramebuffer(fb);
        T.renderer.resetState();
        (window.__atlas = window.__atlas || []).push(px);
        return T.items.size;
      });
      const after = await grab();
      await page.evaluate(() => { const T = document.querySelector('.highway').__hw.r3.text; T.sendWhole = true; T.dirty = true; });
      await frames(4);
      await grab();
      // compared where the labels are (outside them the card still holds the old labels the test wiped)
      const diff = await page.evaluate(() => {
        const T = document.querySelector('.highway').__hw.r3.text;
        const [A, B] = window.__atlas.splice(0);
        const S = T.size;
        let n = 0, most = 0, where = '', seen = 0;
        for (const it of T.items.values()) {
          const x0 = Math.round(it.u0 * S), x1 = Math.round(it.u1 * S), y0 = S - Math.round(it.v1 * S), y1 = S - Math.round(it.v0 * S);
          for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) for (let c = 0; c < 4; c++) {
            const i = (y * S + x) * 4 + c;
            seen++;
            if (A[i] === B[i]) continue;
            n++;
            most = Math.max(most, Math.abs(A[i] - B[i]));
            if (n < 4) where += ` (${x},${y}) ${A[i]}/${B[i]}`;
          }
        }
        return { n, most, where, seen };
      });
      await page.screenshot({ path: path.join(out, `atlas-${scene}.png`) });
      // a colour value may round one step apart (the two ways in do their own rounding)
      if (diff.most > 1 || !after || after !== before) throw new Error(`labels sent on their own differ from the whole picture: ${diff.n} values differ, by up to ${diff.most}${diff.where} (${before} labels, then ${after})`);
      console.log(`PASS labels sent on their own (${after}) are the same as the whole label picture sent (${diff.n} of ${diff.seen} colour values one step apart${diff.where})`);
      continue;
    }
    if (process.env.PLAYCAL) {
      // the timing check: its training song on the highway, scored like any song, with a pretend
      // guitar playing the part (real plucked notes at the chart's pitches) PLAYCAL ms late
      const late = Number(process.env.PLAYCAL) / 1000;
      const r = await page.evaluate(async (late) => {
        const { rig } = await import('/js/rig.js');
        const { renderPart } = await import('/js/training-song.js');
        const H = document.querySelector('.highway').__hw;
        const eng = window.__stage.engine;
        rig.latencyMs = 0;
        rig.sampleRate = 48000;
        let part = null;
        let partOf = null;
        rig.samples = (buf) => {
          buf.fill(0);
          const tr = H.training;
          if (!tr || !eng.playing) return buf;
          if (partOf !== tr.tab) { partOf = tr.tab; part = renderPart(tr.tab, 48000, late); }
          const end = Math.round(eng.position * 48000);
          for (let i = 0; i < buf.length; i++) { const k = end - buf.length + 1 + i; if (k >= 0 && k < part.length) buf[i] = part[k]; }
          return buf;
        };
        rig.on = true;
        window.__before = { song: H.song && H.song.id, duration: eng.duration, at: eng.position };
        document.querySelector('.highway').__openSync?.();
        return 'started';
      }, late);
      if (r !== 'started') throw new Error(r);
      await page.waitForFunction(() => document.querySelector('.hw-syncbox:not([hidden]) .btn.primary'), null, { timeout: 10000 });
      const intro = await page.evaluate(() => document.querySelector('.hw-syncbox').textContent);
      if (/space|tap|click/i.test(intro)) throw new Error('the intro still talks about tapping: ' + intro);
      await page.screenshot({ path: path.join(out, 'playcal-intro.png') }).catch(() => {});
      await page.click('.hw-syncbox .btn.primary');
      await page.waitForFunction(() => { const H = document.querySelector('.highway').__hw; return H.training && window.__stage.engine.playing; }, null, { timeout: Number(process.env.HWWAIT || 15000) });
      const song = await page.evaluate(() => { const H = document.querySelector('.highway').__hw; const e = window.__stage.engine; H.judge.debug = []; window.__fps0 = [performance.now(), e.position]; return { title: H.song.title, notes: H.targets.length, duration: e.duration, loaded: e.loaded && e.loaded.bytes, strings: [...new Set(H.tab.notes.map((n) => n.s))].sort() }; });
      console.log('PLAYCAL training song', JSON.stringify(song));
      if (!(song.duration > 24 && song.duration < 30) || !song.loaded || song.notes < 16) throw new Error('the training song did not load');
      await page.waitForFunction(() => window.__stage.engine.position > 11.3, null, { timeout: 30000 });
      await page.screenshot({ path: path.join(out, 'playcal-song.png') }).catch(() => {});
      await page.waitForFunction(() => document.querySelector('.hw-sync-big') || /Not enough/.test(document.querySelector('.hw-syncbox').textContent), null, { timeout: 60000 });
      const res = await page.evaluate(() => ({ big: (document.querySelector('.hw-sync-big') || {}).textContent, text: document.querySelector('.hw-syncbox').textContent, played: document.querySelector('.highway').__hw.syncPlay.played.length, result: document.querySelector('.highway').__hw.syncResult, framesPerSecond: Math.round((document.querySelector('.highway').__hw.judge.debug || []).length / (window.__stage.engine.position - window.__fps0[1])) }));
      console.log('PLAYCAL', JSON.stringify(res));
      await page.screenshot({ path: path.join(out, 'playcal.png') }).catch(() => {});
      // scoring takes (latency 20 ms + 30 ms) off what it hears; this pretend guitar has no latency
      const got = parseInt(res.big, 10);
      const want = Number(process.env.PLAYCAL) - 50;
      if (!(Math.abs(got - want) <= 25)) throw new Error(`timing check measured ${got} ms, expected about ${want}`);
      const N = res.result.notes;
      // scoring needs a few frames after each pick: software drawing here can run too slowly for that
      if (!(res.result.hits >= N - 4)) {
        if (res.framesPerSecond >= 15) throw new Error(`only ${res.result.hits} of ${N} notes hit`);
        console.log(`NOTE only ${res.result.hits} of ${N} notes hit, at ${res.framesPerSecond} frames a second (too slow here to judge that)`);
      }
      console.log(`PASS the timing check measures a guitar ${process.env.PLAYCAL} ms late as ${got} ms (expected ${want} ± 25), ${res.result.hits} of ${N} notes hit`);
      // Use: the setting is saved and your song comes back where you were
      await page.click('.hw-syncbox .btn.primary');
      const after = await page.evaluate(() => { const H = document.querySelector('.highway').__hw; const e = window.__stage.engine; return { song: H.song && H.song.id, duration: e.duration, at: e.position, training: !!H.training, box: document.querySelector('.hw-syncbox').hidden, offset: JSON.parse(localStorage.getItem('stagehand.highway') || '{}').offsetMs, before: window.__before }; });
      console.log('PLAYCAL after', JSON.stringify(after));
      if (after.training || !after.box || after.song !== after.before.song || after.duration !== after.before.duration || Math.abs(after.at - after.before.at) > 0.01) throw new Error('the song did not come back after the timing check');
      if (after.offset !== got) throw new Error(`offset saved as ${after.offset}, wanted ${got}`);
      console.log('PASS back at the song after the timing check, offset saved');
    }
    if (process.env.LOSE_CONTEXT) {
      // the graphics card takes the moving background away: it must come back by itself, not stay black
      const r = await page.evaluate(async () => {
        const wait = (ms) => new Promise((res) => setTimeout(res, ms));
        await wait(1500);
        const old = document.querySelector('canvas.hw-visual');
        if (!old) return 'no moving background to test (set VENUE to a scene)';
        old.getContext('webgl2').getExtension('WEBGL_lose_context').loseContext();
        await wait(2500);
        const now = document.querySelector('canvas.hw-visual');
        return now && now !== old && !now.getContext('webgl2').isContextLost() ? 'ok' : 'still lost';
      });
      if (r !== 'ok') throw new Error(`background after a lost picture: ${r}`);
      console.log('PASS the moving background rebuilds itself after the graphics card drops it');
    }
    if (process.env.VERIFY) {
      const checks = await page.evaluate(async () => {
        const H = document.querySelector('.highway').__hw;
        const eng = window.__stage.engine;
        const frame = () => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
        const failures = [];
        for (const speed of [1, .5, .85]) {
          eng.speed = speed;
          for (const t of [4, 4.016, 5.2, 2, 40, 40.01]) {
            eng.position = t;
            await frame();
            if (Math.abs(H.clock - t) > .000001) failures.push('clock at ' + t);
            for (let str = 0; str < H.tab.strings; str++) {
              const a = H.projection.point(7, str, t), b = H.projection.neck(7, str);
              if (Math.hypot(a[0]-b[0],a[1]-b[1]) > .001) failures.push('strike-plane mismatch');
            }
          }
        }
        const judged = H.judge?.judged;
        await frame();
        if (H.judge?.judged !== judged) failures.push('paused scoring changed');
        eng.speed = 1; eng.position = Number(new URLSearchParams(location.search).get('t'));
        await frame();
        return failures;
      });
      if (checks.length) throw new Error(checks.join(', '));
      console.log('PASS speaker clock, seeks, three speeds, all string strike planes, paused scoring:', spec);
      await page.getByRole('button', { name: 'Highway options', exact: true }).click();
      await page.locator('.hw-seg button', { hasText: '4 s' }).click();
      if (!await page.evaluate(() => JSON.parse(localStorage.getItem('stagehand.highway')).ahead === 4)) throw new Error('Look-ahead not saved');
      await page.locator('.hw-seg button', { hasText: '3 s' }).click();
      console.log('PASS options panel saves look-ahead');

    }
    if (hits) {
      await page.evaluate((mode) => {
        const H = document.querySelector('.highway').__hw;
        const T = H.targets;
        let next = 0;
        const j = { state: new Map(), events: [], streak: 0, hits: 0, judged: 0, accuracy: null,
          push() {}, reset() {}, rewind() {}, setPace() {},
          tick(t) {
            while (next < T.length && T[next].t <= t) {
              const tg = T[next++];
              if (t - tg.t > 0.3) continue;
              const hit = mode === 'h' ? true : next % 3 !== 0;
              const offset = Math.round((Math.random() - 0.5) * 200);
              this.state.set(tg.id, { result: hit ? 'hit' : 'miss', at: t, offset });
              this.events.push({ id: tg.id, hit });
              this.judged++; if (hit) { this.hits++; this.streak++; } else this.streak = 0;
              this.accuracy = this.hits / this.judged;
            }
          } };
        const t0 = window.__stage.engine.position;
        next = T.findIndex((x) => x.t > t0); if (next < 0) next = T.length;
        H.judge = j;
      }, hits);
    }
    if (process.env.VIDEO) {
      const fps = await page.evaluate(() => new Promise((r) => { let n = 0; const t0 = performance.now(); const f = () => { n++; if (performance.now() - t0 < 2000) requestAnimationFrame(f); else r(n / 2); }; requestAnimationFrame(f); }));
      console.log('fps', fps);
      await page.waitForTimeout(Number(process.env.VIDEO) * 1000);
      continue;
    }
    if (process.env.SEQ) {
      const [n, every] = process.env.SEQ.split(',').map(Number);
      for (let i = 0; i < n; i++) {
        await page.waitForTimeout(every);
        await page.evaluate(() => { const H = document.querySelector('.highway').__hw; H.open = false; cancelAnimationFrame(H.raf); });
    await page.screenshot({ timeout: 60000, path: path.join(out, `seq_${String(i).padStart(3, '0')}.jpg`), quality: 70 });
      }
      continue;
    }
    if (process.env.MODES) {
      // one song, four ways to play it, from the top bar: the Sing, Karaoke and Piano chips never move or
      // vanish, side menus open under the mouse and stay put, ticks change in place, the tuning card waits
      // for the guitar, and the bar doesn't fade right after a menu
      const fail = (m) => { throw new Error('modes: ' + m); };
      await page.evaluate(() => {
        navigator.requestMIDIAccess = async () => ({ inputs: new Map(), onstatechange: null });
        const ac = new AudioContext();
        const dest = ac.createMediaStreamDestination();
        navigator.mediaDevices.getUserMedia = async () => dest.stream;
        navigator.mediaDevices.enumerateDevices = async () => [{ kind: 'audioinput', deviceId: 'default', label: 'Default' }];
        localStorage.removeItem('stagehand.keys');
        localStorage.removeItem('stagehand.myTuning');
      });
      const snap = () => page.evaluate(() => {
        const root = document.querySelector('.highway');
        const H = root.__hw;
        const box = (q) => { const e = document.querySelector(q); if (!e || !e.offsetParent) return null; const b = e.getBoundingClientRect(); return [Math.round(b.left), Math.round(b.width)]; };
        const pressed = (q) => document.querySelector(q).getAttribute('aria-pressed') === 'true';
        return { sing: box('.hw-sing-chip'), karaoke: box('.hw-karaoke-chip'), piano: box('.hw-keys-chip'), go: box('.hw-go'), on: { sing: pressed('.hw-sing-chip'), karaoke: pressed('.hw-karaoke-chip'), piano: pressed('.hw-keys-chip'), part: [...document.querySelectorAll('.hw-parts button')].filter((b) => b.getAttribute('aria-pressed') === 'true').map((b) => b.dataset.id).join() }, view: !document.querySelector('.hw-piano').hidden, kar: root.classList.contains('hw-karaoke'), tab: H.tab && H.tab.id, card: !!document.querySelector('.tcheck') };
      });
      const same = (a, b, what) => { for (const k of ['sing', 'karaoke', 'piano', 'go']) { if (!a[k] || !b[k]) fail(`${what}: the ${k} button is gone ${JSON.stringify(b)}`); if (Math.abs(a[k][0] - b[k][0]) > 1 || Math.abs(a[k][1] - b[k][1]) > 1) fail(`${what}: the ${k} button moved ${a[k]} -> ${b[k]}`); } };
      const s0 = await snap();
      if (s0.on.sing || s0.on.karaoke || s0.on.piano || !s0.on.part) fail('at the start: ' + JSON.stringify(s0));
      // piano
      await page.click('.hw-keys-chip');
      await page.waitForFunction(() => document.querySelector('.highway').__hw.keys.state.arr && !document.querySelector('.hw-piano').hidden, null, { timeout: Number(process.env.HWWAIT || 15000) });
      const s1 = await snap();
      same(s0, s1, 'piano on');
      if (!s1.on.piano || s1.on.part || s1.on.sing) fail('piano on: ' + JSON.stringify(s1.on));
      const range = () => page.evaluate(() => { const K = document.querySelector('.highway').__hw.keys.state; return [...K.range]; });
      const r88 = await range();
      if (!(r88[0] <= 21 && r88[1] >= 108)) fail('88 keys: ' + r88);
      await page.screenshot({ path: path.join(out, 'modes-1-piano.png') });
      // its menu: side menus open under the mouse, the first menu stays the same one
      await page.click('.hw-keys-chip');
      await page.waitForSelector('.menu');
      await page.evaluate(() => { window.__m0 = document.querySelector('.menu'); window.__m0.dataset.mark = '1'; });
      const row = (text, nth = 0) => page.locator('.menu').nth(nth).locator('button', { hasText: text }).first();
      await row('Look').hover();
      await page.waitForFunction(() => document.querySelectorAll('.menu').length === 2, null, { timeout: 3000 }).catch(() => fail('the Look side menu did not open under the mouse'));
      await page.locator('.menu').nth(1).locator('button', { hasText: 'Rainbow' }).click();
      const m1 = await page.evaluate(() => ({ kept: document.querySelector('.menu') === window.__m0 && document.querySelectorAll('.menu').length === 2, colours: JSON.parse(localStorage.getItem('stagehand.keys')).colours, anim: getComputedStyle(document.querySelector('.menu')).animationName }));
      if (!m1.kept || m1.colours !== 'rainbow' || m1.anim !== 'none') fail('picking a colour: ' + JSON.stringify(m1));
      await page.waitForTimeout(500);
      await page.screenshot({ path: path.join(out, 'modes-2-menu.png') });
      await row('Piano size').hover();
      await page.waitForFunction(() => { const m = document.querySelectorAll('.menu'); return m.length === 2 && /61 keys/.test(m[1].textContent); }, null, { timeout: 3000 }).catch(() => fail('the Piano size side menu did not take over'));
      await page.locator('.menu').nth(1).locator('button', { hasText: '61 keys' }).click();
      const r61 = await range();
      if (r61[0] !== 36 || r61[1] !== 96) fail('61 keys: ' + r61);
      await page.locator('.menu').nth(1).locator('button', { hasText: '88 keys' }).click();
      await page.keyboard.press('Escape');
      await page.keyboard.press('Escape');
      await page.waitForTimeout(400);
      const m2 = await page.evaluate(() => ({ menus: document.querySelectorAll('.menu').length, quiet: document.querySelector('.highway').classList.contains('hw-quiet') }));
      if (m2.menus || m2.quiet) fail('after closing the menu: ' + JSON.stringify(m2));
      // the song wants Drop D: nothing about tuning while the guitar is aside
      await page.evaluate(() => { const H = document.querySelector('.highway').__hw; H.tab.tuning = [-2, 0, 0, 0, 0, 0]; });
      await page.click('.hw-karaoke-chip');
      await page.waitForTimeout(600);
      const s2 = await snap();
      same(s0, s2, 'karaoke');
      if (!s2.on.karaoke || s2.on.piano || s2.view || !s2.kar || s2.card) fail('karaoke: ' + JSON.stringify(s2));
      await page.screenshot({ path: path.join(out, 'modes-3-karaoke.png') });
      await page.click('.hw-sing-chip');
      await page.waitForTimeout(600);
      const s3 = await snap();
      same(s0, s3, 'sing');
      if (!s3.on.sing || s3.on.karaoke || s3.kar || !s3.on.part) fail('sing with the part: ' + JSON.stringify(s3));
      if (!s3.card) fail('back on the guitar in a Drop D song: no tuning card');
      await page.screenshot({ path: path.join(out, 'modes-4-sing.png') });
      await page.click('text=Skip, keep going');
      await page.waitForFunction(() => !document.querySelector('.tcheck'), null, { timeout: 4000 }).catch(() => fail('the tuning card did not close'));
      await page.evaluate(() => { const H = document.querySelector('.highway').__hw; H.tab.tuning = [0, 0, 0, 0, 0, 0]; });
      // another part, then the go-anywhere menu
      await page.click('.hw-parts button[data-id="bass"]');
      await page.waitForFunction(() => document.querySelector('.highway').__hw.tab.id === 'bass', null, { timeout: 8000 }).catch(() => fail('the Bass button did not load the bass part'));
      same(s0, await snap(), 'bass');
      await page.click('.hw-go');
      await page.waitForSelector('.menu');
      const go = await page.evaluate(() => [...document.querySelectorAll('.menu button')].map((b) => b.textContent.trim()));
      for (const w of ['Songs', 'Karaoke', 'Tones', 'Settings']) if (!go.some((x) => x.startsWith(w))) fail('the go menu has no ' + w + ': ' + go.join(' | '));
      await page.screenshot({ path: path.join(out, 'modes-5-go.png') });
      await page.keyboard.press('Escape');
      console.log('PASS modes: Sing, Karaoke and Piano stay put in every mode, side menus open under the mouse and ticks change in place, 61 and 88 keys, the tuning card waits for the guitar, any part and any page from the top bar');
      continue;
    }
    if (process.env.TOPBAR) {
      // the top bar fits at this window size, with Piano off and on: nothing off the edges, the title readable
      const fail = (m) => { throw new Error('top bar: ' + m); };
      for (const mode of ['off', 'piano']) {
        if (mode === 'piano') {
          await page.evaluate(() => { navigator.requestMIDIAccess = async () => ({ inputs: new Map(), onstatechange: null }); document.querySelector('.highway').__hw.keys.turn(true); });
          await page.waitForTimeout(900);
        }
        const r = await page.evaluate(() => {
          const top = document.querySelector('.hw-top');
          document.querySelector('.highway').classList.remove('hw-quiet');
          const vw = innerWidth;
          const out = [...top.querySelectorAll('button')].filter((e) => e.offsetParent).filter((e) => { const b = e.getBoundingClientRect(); return b.right > vw + 1 || b.left < -1; }).map((e) => e.textContent.trim().slice(0, 20) || e.className);
          const title = top.querySelector('.hw-title, .hw-titlebox, [class*=title]');
          const b = title && title.querySelector('b');
          return { out, title: title ? Math.round(title.getBoundingClientRect().width) : -1, titleShown: b ? b.clientWidth >= Math.min(b.scrollWidth, 90) : false, settingsRight: Math.round(document.querySelector('.hw-set-btn').getBoundingClientRect().right), vw };
        });
        console.log('TOPBAR', mode, JSON.stringify(r));
        await page.screenshot({ path: path.join(out, `topbar-${process.env.VW || 1920}-${mode}.png`), clip: { x: 0, y: 0, width: Number(process.env.VW || 1920), height: 110 } });
        if (r.out.length || r.settingsRight > r.vw || !r.titleShown) fail(JSON.stringify(r));
      }
      console.log(`PASS the top bar fits at ${process.env.VW || 1920} wide, Piano off and on`);
      continue;
    }
    if (process.env.PIANO) {
      // Piano: a pretend USB keyboard (an Allegro IV) and a pretend pianist who plays the part Stagehand
      // wrote, a little early or late, holding each note, leaving bar 4 out and hitting a wrong key now and then.
      const fail = (m) => { throw new Error('piano: ' + m); };
      const level = process.env.PIANO_LEVEL || 'hard';
      await page.evaluate((level) => {
        localStorage.setItem('stagehand.keys', JSON.stringify({ level, hands: 'both', look: 'both' }));
        const listeners = new Set();
        const input = { id: 'allegro', name: 'Allegro IV', state: 'connected', addEventListener: (k, f) => listeners.add(f), removeEventListener: (k, f) => listeners.delete(f) };
        window.__press = (midi, on) => { const e = { data: new Uint8Array([on ? 0x90 : 0x80, midi, on ? 90 : 0]), timeStamp: performance.now() }; for (const f of listeners) f(e); };
        window.__midiAsked = 0;
        navigator.requestMIDIAccess = async () => (window.__midiAsked++, { inputs: new Map([['allegro', input]]), onstatechange: null });
      }, level);
      const st0 = await page.evaluate(() => ({ chip: !document.querySelector('.hw-keys-chip').hidden, view: !document.querySelector('.hw-piano').hidden, asked: window.__midiAsked }));
      if (!st0.chip || st0.view || st0.asked) fail('before pressing Piano: ' + JSON.stringify(st0));
      await page.screenshot({ path: path.join(out, 'piano-0-off.png') });
      await page.click('.hw-keys-chip');
      await page.waitForFunction(() => document.querySelector('.highway').__hw.keys.state.arr && !document.querySelector('.hw-piano').hidden, null, { timeout: Number(process.env.HWWAIT || 15000) });
      const info = await page.evaluate(() => { const K = document.querySelector('.highway').__hw.keys.state; return { key: K.arr.key.name, chords: K.arr.chords.filter((c) => c.len >= 4).slice(0, 12).map((c) => c.name), notes: K.notes.length, sources: K.arr.sources, neck: document.querySelector('.highway').classList.contains('hw-keys-on') }; });
      console.log('PIANO', JSON.stringify(info));
      if (!info.notes || !info.neck) fail('no part: ' + JSON.stringify(info));
      await page.evaluate(() => {
        const H = document.querySelector('.highway').__hw;
        const K = H.keys.state;
        const bar4 = K.arr.grid.bars[3];
        const skip = (n) => n.k >= bar4.k0 && n.k < bar4.k1;
        const down = new Map();
        let wrongs = 0;
        window.__pianist = setInterval(() => {
          if (!window.__stage.engine.playing) return;
          // (the song's time now: the picture's clock plus the time since it was drawn)
          const t = K.vis + (K.clockAt ? Math.min(250, performance.now() - K.clockAt) / 1000 : 0);
          K.notes.forEach((n, i) => {
            const jit = ((i * 37) % 11) / 11 * 0.08 - 0.04;
            if (!down.has(i) && !skip(n) && t >= n.t + jit && t < n.t + 0.1) { window.__press(n.midi, true); down.set(i, n); }
          });
          for (const [i, n] of down) if (t >= n.t + n.d * 0.92) { window.__press(n.midi, false); down.delete(i); }
          if (t > 6 && wrongs < 3 && Math.random() < 0.002) { wrongs++; window.__press(61, true); setTimeout(() => window.__press(61, false), 120); }
        }, 4);
        const e = window.__stage.engine; e.position = 0; e.dispatchEvent(new Event('seek')); e.play();
        window.__pf = { n: 0, long: 0, last: performance.now() }; const fr = () => { const now = performance.now(); window.__pf.n++; if (now - window.__pf.last > 100) window.__pf.long++; window.__pf.last = now; requestAnimationFrame(fr); }; fr();
      });
      const until = (t) => page.waitForFunction((t) => window.__stage.engine.position > t, t, { timeout: 90000 });
      const shots = (process.env.PIANO_SHOTS || '5,9,13').split(',').map(Number);
      for (const [i, at] of shots.entries()) { await until(at); await page.screenshot({ path: path.join(out, `piano-${i + 1}.png`) }); }
      const end = Number(process.env.PIANO_END || 22);
      await until(end);
      const r = await page.evaluate(async () => {
        const H = document.querySelector('.highway').__hw;
        const j = H.keys.state.judge;
        const live = { hits: j.hits, judged: j.judged, acc: j.accuracy, wrong: j.wrong.length, frames: window.__pf.n, longFrames: window.__pf.long };
        clearInterval(window.__pianist);
        const e = window.__stage.engine;
        e.pause();
        e.dispatchEvent(new Event('ended'));
        await new Promise((x) => setTimeout(x, 300));
        const card = document.querySelector('.hw-card');
        return { ...live, card: !card.hidden, cardText: card.textContent, logs: (window.__statsLogs || []).filter((x) => x.part === 'keys') };
      });
      console.log('PIANO RUN', JSON.stringify({ ...r, cardText: r.cardText.slice(0, 160) }));
      await page.screenshot({ path: path.join(out, 'piano-card.png') });
      if (!(r.acc > 0.6 && r.acc < 0.99)) fail('accuracy ' + r.acc + ' (bar 4 left out, the rest played)');
      if (!r.card || !/Piano/.test(r.cardText) || /notes hit/.test(r.cardText)) fail('the card: ' + r.cardText);
      if (!r.logs.length || !r.logs[0].full) fail('stats: ' + JSON.stringify(r.logs));
      const off = await page.evaluate(async () => { document.querySelector('.highway').__hw.keys.turn(false); const { keyboard } = await import('/js/midi.js'); return { kb: keyboard.on, view: !document.querySelector('.hw-piano').hidden, neck: document.querySelector('.highway').classList.contains('hw-keys-on') }; });
      if (off.kb || off.view || off.neck) fail('switching off: ' + JSON.stringify(off));
      console.log('PASS piano: off until pressed, a part written from the song, a pretend pianist scored note by note (bar 4 left out), the card and the stats get it, off lets the keyboard go and the neck comes back');
      continue;
    }
    if (process.env.SING) {
      // Sing along: a pretend microphone (a tone that follows the song's notes) sings the made-up song.
      // Lines 1 and 2 are sung right (an octave down), line 3 is left out, line 4 is sung right.
      const fail = (m) => { throw new Error('sing: ' + m); };
      if (process.env.SING_WOBBLE) await page.evaluate(() => { window.__SING_WOBBLE = 1; });
      const st0 = await page.evaluate(() => {
        const H = document.querySelector('.highway').__hw;
        window.__micAsked = 0;
        const ac = new AudioContext();
        const osc = ac.createOscillator();
        osc.type = 'sawtooth';
        const gain = ac.createGain();
        gain.gain.value = 0;
        const dest = ac.createMediaStreamDestination();
        osc.connect(gain).connect(dest);
        osc.start();
        navigator.mediaDevices.getUserMedia = async () => { window.__micAsked++; return dest.stream; };
        navigator.mediaDevices.enumerateDevices = async () => [{ kind: 'audioinput', deviceId: 'default', label: 'Default' }, { kind: 'audioinput', deviceId: 'usb1', label: 'USB Microphone' }, { kind: 'audioinput', deviceId: 'rs1', label: 'Rocksmith Guitar Adapter' }];
        const ly = window.__tab.lyrics;
        const lineOf = [];
        let ln = 0;
        for (const w of ly) { lineOf.push(ln); if (w.w.endsWith('+')) ln++; }
        window.__skipLine = 2;
        window.__wobble = !!window.__SING_WOBBLE;
        setInterval(() => {
          const t = window.__stage.engine.position;
          const i = ly.findIndex((x) => t >= x.t && t < x.t + x.d);
          const on = i >= 0 && lineOf[i] !== window.__skipLine && window.__stage.engine.playing;
          // SING_WOBBLE: a real, unsteady voice: vibrato, drift, a slide into each note, a crack up an
          // octave now and then, and short breaths where the microphone hears nothing
          if (window.__wobble && on) {
            const W = window.__wob || (window.__wob = { drift: 0, crack: 0, gap: 0, i: -1, at: 0 });
            if (W.i !== i) { W.i = i; W.at = t; W.drift = (Math.random() - 0.5) * 0.5; }
            W.drift += (Math.random() - 0.5) * 0.06 - W.drift * 0.02;
            if (W.crack > 0) W.crack--; else if (Math.random() < 0.004) W.crack = 6;
            if (W.gap > 0) W.gap--; else if (Math.random() < 0.003) W.gap = 12;
            const slide = Math.max(0, 1 - (t - W.at) / 0.12) * -1.2;
            const m = window.__singTune[i] - 12 + 0.35 * Math.sin(t * 2 * Math.PI * 5.5) + W.drift + slide + (W.crack ? 12 : 0) + (Math.random() - 0.5) * 0.5;
            gain.gain.value = W.gap ? 0 : 0.3;
            osc.frequency.value = 440 * 2 ** ((m - 69) / 12);
            return;
          }
          gain.gain.value = on ? 0.3 : 0;
          // TUNE: the pretend singer is 40 cents flat (auto-tune must put that right)
          if (on) osc.frequency.value = 440 * 2 ** ((window.__singTune[i] - 12 - (window.__flat || 0) + (window.__singBend ? window.__singBend(i, t) : 0) - 69) / 12);
          window.__sungNow = on ? window.__singTune[i] - 12 : null;
        }, 4);
        const chip = document.querySelector('.hw-sing-chip');
        return { chip: !!chip && !chip.hidden, pressed: chip && chip.getAttribute('aria-pressed'), lane: !document.querySelector('.hw-sing').hidden, lyrics: !!document.querySelector('.hw-lyrics'), ctx: ac.state };
      });
      if (!st0.chip || st0.pressed !== 'false' || st0.lane) fail('before pressing Sing: ' + JSON.stringify(st0));
      await page.waitForTimeout(600);
      if (await page.evaluate(() => window.__micAsked)) fail('the microphone was opened before Sing was pressed');
      await page.screenshot({ path: path.join(out, 'sing-0-off.png') });
      const kar = process.env.SING === 'karaoke';
      // TUNE=robot|pop|natural: auto-tune on. What goes to the speakers is listened to all the way through.
      const tuneStyle = process.env.TUNE || '';
      if (tuneStyle) {
        await page.evaluate(async (style) => {
          const { autotune } = await import('/js/autotune.js');
          const { detectPitch } = await import('/js/pitch.js');
          window.__flat = 0.4;
          autotune.setStyle(style);
          autotune.setNotes('song');
          window.__tuned = [];
          let an = null;
          let node = null;
          const buf = new Float32Array(2048);
          setInterval(() => {
            if (!autotune.node) return;
            if (node !== autotune.node) {
              node = autotune.node;
              an = node.context.createAnalyser();
              an.fftSize = 2048;
              node.connect(an);
            }
            const want = window.__sungNow;
            an.getFloatTimeDomainData(buf);
            const r = detectPitch(buf, node.context.sampleRate, { minHz: 70, maxHz: 1100 });
            if (want === null || !r || r.clarity < 0.6) return;
            window.__tuned.push(Math.round((69 + 12 * Math.log2(r.hz / 440) - want) * 100));
          }, 50);
        }, tuneStyle);
      }
      // the Sing button is singing beside the guitar part; karaoke is asked for by the Karaoke page
      // 4.19: on a PC that can split, opening Sing on a split song asks about a cleaner singer
      if (process.env.SING === 'check') await page.evaluate(async () => ((await import('/js/store.js')).state.engine = { installed: true, device: 'cuda' }));
      if (kar) await page.evaluate(() => document.querySelector('.highway').__hw.sing.setKaraoke(true));
      else await page.click('.hw-sing-chip');
      await page.waitForFunction(() => !document.querySelector('.hw-sing').hidden && document.querySelector('.highway').__hw.sing.active, null, { timeout: 8000 });
      const words = process.env.SING === 'words';
      // the song starts once the microphone is open and hearing (opening it takes a moment)
      await page.evaluate(async () => { const { mic } = await import('/js/mic.js'); for (let i = 0; i < 100 && !mic.on; i++) await new Promise((x) => setTimeout(x, 100)); await new Promise((x) => setTimeout(x, 400)); });
      const fromStem = process.env.SING === 'stem' || process.env.SING === 'check';
      if (fromStem) await page.waitForFunction(() => document.querySelector('.highway').__hw.sing.state.mode === 'stem', null, { timeout: 30000 });
      if (process.env.SING === 'check') {
        // 4.19: the chart is made up in two lines of four: those notes come from the singer, the real
        // lines agree (the made-up note, 61, happens to be right for a few words too), the last word of each line is a line (a slide), and the mark says how far it went
        const c = await page.evaluate(() => {
          const S = document.querySelector('.highway').__hw.sing.state;
          const tune = window.__singTune;
          return { check: S.check, lines: S.cur.syl.filter((x) => x.c).length, worst: Math.max(...S.cur.syl.map((x, i) => (x.p === null ? 99 : Math.abs(x.p - (tune[i] + 12))))), src: S.cur.syl.map((x) => (x.src || '_')[0]).join(''), badge: document.querySelector('.sw-badge').textContent, stored: JSON.parse(localStorage.getItem('stagehand.singCheck') || '{}') };
        });
        console.log('CHECK', JSON.stringify(c));
        if (!c.check || c.check.heard !== c.check.notes || c.check.blank || c.check.kept) fail('every note should be heard on the singer: ' + JSON.stringify(c.check));
        if (c.check.fixed < 5 || c.check.agreed < 12) fail('made-up lines put right, real lines agreed: ' + JSON.stringify(c.check));
        if (c.worst > 1.6) fail('a note is off the singer by ' + c.worst);
        if (c.lines < 4) fail('the slides were not drawn as lines: ' + c.lines);
        if (!/checked against the singer: 100%/.test(c.badge)) fail('the mark: ' + c.badge);
        if (!Object.keys(c.stored).length) fail('the mark was not kept for the song');
        // the question about a cleaner singer: asked once, Yes starts it, the song carries on
        const asks = await page.evaluate(() => [...document.querySelectorAll('.toast')].filter((t) => /Make the singer cleaner for this song\?/.test(t.textContent)).length);
        if (asks !== 1) fail('the cleaner-singer question should show once: ' + asks);
        await page.evaluate(() => [...document.querySelectorAll('.toast')].find((t) => /Make the singer cleaner/.test(t.textContent)).querySelector('.act-row button').click());
        await page.waitForFunction(() => window.__upgrade && [...document.querySelectorAll('.toast')].some((t) => /Making the singer cleaner/.test(t.textContent)), null, { timeout: 4000 }).catch(() => fail('Yes did not start the cleaner singer'));
      }
      // a run-up of 2.5 s before the first word: this machine draws slowly for a moment once the song starts
      await page.evaluate(() => { const e = window.__stage.engine; e.position = 0; e.dispatchEvent(new Event('seek')); e.play(); });
      const until = (t) => page.waitForFunction((t) => window.__stage.engine.position > t, t, { timeout: 60000 });
      await page.evaluate(() => { window.__frames = 0; const f = () => { window.__frames++; requestAnimationFrame(f); }; f(); });
      await until(4.6);
      if (kar) {
        const k = await page.evaluate(() => ({ cls: document.querySelector('.highway').classList.contains('hw-karaoke'), big: document.querySelector('.hw-sing').dataset.k, muted: window.__vocals.muted, chip: document.querySelector('.hw-karaoke-chip').getAttribute('aria-pressed') === 'true' ? 'Karaoke' : '', guitar: window.__shHighway.judge() }));
        if (!k.cls || k.big !== '1' || !k.muted || !/Karaoke/.test(k.chip) || k.guitar) fail('karaoke on: ' + JSON.stringify(k));
      }
      await page.screenshot({ path: path.join(out, 'sing-1-bars.png') });
      {
        // auto-tune and the voice changer are on the lane itself: a strip of tape that opens their menu
        await page.click('.hw-sing .sw-tune');
        await page.waitForTimeout(250);
        const m = await page.evaluate(() => { const all = document.querySelectorAll('.menu'); const e = all[all.length - 1]; const b = document.querySelector('.hw-sing .sw-tune'); return { menu: e ? e.textContent : '', label: b.textContent, pressed: b.getAttribute('aria-pressed') }; });
        if (!/Hard tune/.test(m.menu) || !/Voice:/.test(m.menu) || !/Tune to/.test(m.menu)) fail('the lane\'s auto-tune button opens no menu: ' + JSON.stringify(m));
        if (m.pressed !== String(!!tuneStyle)) fail('the lane\'s auto-tune button shows the wrong state: ' + JSON.stringify(m));
        await page.screenshot({ path: path.join(out, 'sing-1-tune-menu.png') });
        if (tuneStyle) {
          // Mute my voice: the voice stops, the choice is kept; pressing it again brings the voice back
          const press = async () => { await page.locator('.menu button', { hasText: 'Mute my voice' }).last().click(); await page.waitForTimeout(500); };
          const now = () => page.evaluate(async () => { const { autotune } = await import('/js/autotune.js'); return { on: autotune.on, muted: autotune.muted, style: autotune.style, label: document.querySelector('.hw-sing .sw-tune').textContent }; });
          await press();
          const off = await now();
          if (off.on || !off.muted || off.style !== tuneStyle || !/muted/i.test(off.label)) fail('Mute my voice did not stop the voice: ' + JSON.stringify(off));
          await page.click('.hw-sing .sw-tune');
          await page.waitForTimeout(250);
          await press();
          const back = await now();
          if (!back.on || back.muted) fail('un-muting did not bring the voice back: ' + JSON.stringify(back));
          console.log('MUTE', JSON.stringify({ off, back }));
        }
        // (Escape only while a menu is open: with none, it would leave the song)
        if (await page.locator('.menu').count()) await page.keyboard.press('Escape');
      }
      await until(11.2);
      await page.screenshot({ path: path.join(out, 'sing-2-bars-after-line.png') });
      const last = await page.evaluate(() => { const l = window.__tab.lyrics; return l[l.length - 1].t + l[l.length - 1].d; });
      await until(last - 2.2);
      await page.evaluate(async () => { const { setSingLook } = await import('/js/singlane.js'); setSingLook('words'); });
      await page.waitForTimeout(700);
      await page.screenshot({ path: path.join(out, 'sing-3-words.png') });
      await until(last + 0.6);
      const r = await page.evaluate(async () => {
        const H = document.querySelector('.highway').__hw;
        const j = H.sing.state.judge;
        const live = { share: [...j.good].map((g, i) => Math.round((g / j.syl[i].d) * 100)), frames: window.__frames, hits: j.hits, judged: j.judged, lines: [...j.lineResult], mode: H.sing.state.mode, asked: window.__micAsked };
        const e = window.__stage.engine;
        e.pause();
        e.dispatchEvent(new Event('ended'));
        await new Promise((x) => setTimeout(x, 300));
        const card = document.querySelector('.hw-card');
        return { ...live, card: !card.hidden, cardText: card.textContent, logs: window.__statsLogs || [], fps: H.fpsAcc ? Math.round(1 / H.fpsAcc) : null };
      });
      console.log('SING', JSON.stringify(r));
      if (kar) {
        if (!/sung/.test(r.cardText) || /notes hit/.test(r.cardText)) fail('karaoke should end on the singing card only: ' + r.cardText);
        await page.screenshot({ path: path.join(out, 'sing-4-card.png') });
        // karaoke isn't remembered for the song: without it the neck returns, the singer is put back
        // and singing is off again (the Sing button was never pressed for this song)
        const k2 = await page.evaluate(async () => {
          const H = document.querySelector('.highway').__hw;
          H.sing.setKaraoke(false);
          await new Promise((x) => setTimeout(x, 300));
          return { cls: document.querySelector('.highway').classList.contains('hw-karaoke'), big: document.querySelector('.hw-sing').dataset.k, muted: window.__vocals.muted, on: H.sing.active };
        });
        if (k2.cls || k2.big || k2.muted || k2.on) fail('leaving karaoke: ' + JSON.stringify(k2));
      }
      await page.screenshot({ path: path.join(out, 'sing-4-card.png') });
      const log = r.logs.find((x) => x.part === 'vocals');
      if (words) {
        if (r.mode !== 'rhythm') fail('a song with no notes should be scored on timing only: ' + r.mode);
        if (!(r.lines[0] >= 0.5 && r.lines[1] >= 0.7 && r.lines[2] <= 0.15 && r.lines[3] >= 0.85)) fail('timing-only lines: ' + JSON.stringify(r.lines));
      } else {
        if (r.mode !== (fromStem ? 'stem' : 'charted')) fail('mode ' + r.mode);
        // (the first line only has to be mostly there: this machine draws slowly just after the song starts)
        if (!(r.lines[0] >= 0.5 && r.lines[1] >= 0.7 && r.lines[2] === 0 && r.lines[3] >= 0.85)) fail('lines: ' + JSON.stringify(r.lines));
      }
      if (r.asked !== 1) fail('the microphone was asked for ' + r.asked + ' times');
      {
        // auto-tune: off, the voice is never played; on, what is played is on the song's notes
        const at = await page.evaluate(async () => { const { autotune } = await import('/js/autotune.js'); return { on: autotune.on, route: autotune.route, style: autotune.style, tuned: window.__tuned || [], state: autotune.state }; });
        if (!tuneStyle) {
          if (at.on) fail('the voice is played though auto-tune is off: ' + JSON.stringify(at));
        } else {
          const d = at.tuned.map(Math.abs).sort((a, b) => a - b);
          const mid = d[Math.floor(d.length / 2)];
          const near = d.filter((x) => x <= 15).length / Math.max(1, d.length);
          console.log('TUNE', JSON.stringify({ on: at.on, route: at.route, heard: d.length, middle: mid, within15: near, state: at.state }));
          if (!at.on || at.route !== 'speakers') fail('auto-tune is not playing: ' + JSON.stringify({ on: at.on, route: at.route }));
          // (the pretend singer is 40 cents flat; a note that just changed is still on its way)
          if (d.length < 40 || !(mid <= (tuneStyle === 'robot' ? 6 : 12)) || near < (tuneStyle === 'natural' ? 0.6 : 0.75)) fail('the tuned voice is off the notes: ' + JSON.stringify({ heard: d.length, mid, near }));
        }
      }
      if (!r.card || !/sung|Singing/.test(r.cardText)) fail('no singing on the score card: ' + r.cardText);
      if (!log || log.notes !== r.judged || !(log.accuracy > 0.6 && log.accuracy < 0.85) || !log.full) fail('stats: ' + JSON.stringify(r.logs));
      // switching it off lets the microphone go and brings the plain lyrics back
      await page.evaluate(() => document.querySelector('.highway').__hw.sing.turn(false));
      const off = await page.evaluate(async () => { const { mic } = await import('/js/mic.js'); return { mic: mic.on, lane: !document.querySelector('.hw-sing').hidden, pressed: document.querySelector('.hw-sing-chip').getAttribute('aria-pressed') }; });
      if (off.mic || off.lane || off.pressed !== 'false') fail('switching off: ' + JSON.stringify(off));
      if (await page.evaluate(async () => (await import('/js/autotune.js')).autotune.on)) fail('auto-tune still plays after singing stopped');
      if (tuneStyle) console.log(`PASS auto-tune (${tuneStyle}): a singer 40 cents flat comes out on the song's notes, and it stops with the singing`);
      console.log(`PASS sing along (${words ? 'timing only' : process.env.SING === 'check' ? 'chart notes checked against the vocals stem' : process.env.SING === 'stem' ? 'notes read off the vocals stem' : 'notes from the chart'}): off until pressed, sung lines count (an octave down), a skipped line doesn't, the card and the stats get it, off lets the microphone go`);
      continue;
    }
    if (process.env.TCHECK) {
      // the tuning check card: a Drop D song at A425 on an E Standard guitar, the low string
      // half way down (heard 100 cents above D), then in tune: it gets a tick
      await page.evaluate(async (dropVariant) => {
        const { rig } = await import('/js/rig.js');
        const { tuningGuide } = await import('/js/tuning-check.js');
        localStorage.removeItem('stagehand.myTuning');
        window.__pitch = 3900 - 60 + 100;
        rig.pitch = () => { const c = window.__pitch; if (c == null) return null; const midi = Math.round(c / 100); return { hz: 440 * 2 ** ((c - 6900) / 1200), midi, cents: c - midi * 100, clarity: 0.97 }; };
        tuningGuide(dropVariant ? { tuning: [-2, -2, -2, -2, -2, -2], cents: 0, type: 'lead' } : { tuning: [-2, 0, 0, 0, 0, 0], cents: -60, type: 'lead' }, { id: 's1', title: 'Scene T' });
      }, process.env.TCHECK === 'drop');
      if (process.env.TCHECK === 'drop') {
        await page.waitForTimeout(900);
        await page.screenshot({ path: path.join(out, 'tcheck-drop.png') });
        const d = await page.evaluate(() => ({ btn: !!document.querySelector('.tcheck-dropbtn'), first: document.querySelector('.modal .btn.primary') === document.querySelector('.tcheck-dropbtn'), focus: document.activeElement === document.querySelector('.tcheck-dropbtn') }));
        if (!d.btn || !d.first || !d.focus) throw new Error('drop offer: ' + JSON.stringify(d));
        console.log('PASS the tuning card offers the Drop as the big first choice, focused');
        continue;
      }
      await page.waitForTimeout(900);
      await page.screenshot({ path: path.join(out, 'tcheck-1.png') });
      // string 6 right, string 5 four cents off (must NOT tick), string 4 right, then string 6 played
      // again 9 cents out (loses its tick), then right again (ticks again)
      const r = await page.evaluate(async () => {
        const wait = (ms) => new Promise((x) => setTimeout(x, ms));
        const get = (n) => [...document.querySelectorAll('.tcheck-row')].find((x) => x.querySelector('.tcheck-num').textContent === String(n));
        const play = async (n, midi, off, ms) => { window.__pitch = null; await wait(350); window.__pitch = midi * 100 - 60 + off; await wait(ms); return get(n); };
        const out = {};
        let row = await play(6, 38, 2, 1700);
        out.six = row.classList.contains('done'); out.sixState0 = row.querySelector('.tcheck-state').textContent;
        row = await play(5, 45, 4, 1700);
        out.fiveTicked = row.classList.contains('done');
        out.fiveState = row.querySelector('.tcheck-state').textContent;
        out.fiveCents = document.querySelector('.tcheck-tuner .tn-read .c').textContent;
        row = await play(4, 50, -1, 1700);
        out.four = row.classList.contains('done');
        row = await play(6, 38, 9, 1400);
        out.sixSlipped = !row.classList.contains('done');
        out.sixState = row.querySelector('.tcheck-state').textContent;
        // 4.2: one tuner (the main tuner's look, centre line included), not a meter per string
        out.centre = document.querySelectorAll('.tcheck-tuner .tn-scale').length === 1 && !document.querySelector('.tcheck-row .tn-scale');
        out.rows = document.querySelectorAll('.tcheck-row').length;
        out.ref = (document.querySelector('.tcheck-ref') || {}).textContent;
        window.__shot = true;
        return out;
      });
      await page.screenshot({ path: path.join(out, 'tcheck-2.png') });
      const r2 = await page.evaluate(async () => {
        const row = [...document.querySelectorAll('.tcheck-row')].find((x) => x.querySelector('.tcheck-num').textContent === '6');
        window.__pitch = null; await new Promise((x) => setTimeout(x, 350));
        window.__pitch = 3800 - 60 + 1;
        await new Promise((x) => setTimeout(x, 1700));
        return row.classList.contains('done');
      });
      r.done = r.six && /Slipped/.test(r.sixState) && !r.fiveTicked && r.four && r.sixSlipped && r.centre && r2;
      console.log('TCHECK', JSON.stringify({ ...r, retickedAfterSlip: r2 }));
      if (!r.done || r.rows !== 6 || !/425/.test(r.ref || '')) throw new Error('tuning check card: ' + JSON.stringify(r));
      console.log('PASS the tuning check card: one tuner like the main one, 3 cents to tick, 4 cents off does not tick, a ticked string played out loses its tick');
      continue;
    }
    await page.waitForTimeout(play === 'p' ? 2600 : 2200);
    if (process.env.THEMES) {
      // every highway look at the same moment: nothing may move (notes, strings, frets, the hit line,
      // labels and their sizes match Classic within 1 px); a contact sheet of them all
      await page.evaluate(() => { const H = document.querySelector('.highway').__hw; if (H.perfState) H.perfState.n = -1e9; });
      await page.waitForTimeout(1500);
      const looks = await page.evaluate(async () => (await import('/js/hwlooks.js')).THEMES.map((t) => t.id));
      const grab = () => page.evaluate(async () => {
        const frame = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
        await frame();
        const H = document.querySelector('.highway').__hw;
        // 4.34: a style with its own graphics loads and builds them first
        if (H.hx && H.hx.whenReady) await Promise.race([H.hx.whenReady(), new Promise((r) => setTimeout(r, 20000))]);
        await frame();
        await frame();
        const R3 = H.r3;
        const out = { neck: [], solid: [], alpha: [], glow: [], text: [], look: H.look && H.look.id, post: R3.post, info: R3.info() };
        for (let s = 0; s < H.tab.strings; s++) for (let f = 0; f <= 24; f++) out.neck.push(H.projection.neck(f, s), H.projection.point(f, s, H.vis + 1));
        for (const k of ['solid', 'alpha', 'glow']) {
          const L = R3.L[k];
          for (let i = 0; i < L.n * 4; i++) { const p = R3.project(L.pos[i * 3], L.pos[i * 3 + 1], -L.pos[i * 3 + 2]); out[k].push(p[0], p[1]); }
        }
        const T = R3.text;
        for (let q = 0; q < T.n; q++) { const o = q * 12; out.text.push([T.pos[o], T.pos[o + 1], T.pos[o + 3] - T.pos[o], T.pos[o + 7] - T.pos[o + 1], T.rgba[q * 16 + 3]]); }
        return out;
      });
      const set = (id) => page.evaluate(async (id) => { const m = await import('/js/hwlooks.js'); const st = m.loadLooks(); m.saveLooks({ ...st, theme: id }); }, id);
      await set('classic');
      const base = await grab();
      const shots = [];
      let worst = { pts: 0, text: 0, size: 0 };
      const fails = [];
      for (const id of looks) {
        await set(id);
        const g = await grab();
        if (g.look !== id) fails.push(`${id}: look not in use (${g.look})`);
        const cmp = (a, b, what) => {
          if (a.length !== b.length) { fails.push(`${id}: ${what} count ${b.length} vs ${a.length}`); return 0; }
          let m = 0;
          for (let i = 0; i < a.length; i++) { const d = Math.abs((Array.isArray(a[i]) ? a[i][0] : a[i]) - (Array.isArray(b[i]) ? b[i][0] : b[i])) + (Array.isArray(a[i]) ? Math.abs(a[i][1] - b[i][1]) : 0); if (Number.isFinite(d)) m = Math.max(m, d); }
          return m;
        };
        const pts = Math.max(cmp(base.neck, g.neck, 'neck points'), cmp(base.solid, g.solid, 'notes, strings and frets'), cmp(base.alpha, g.alpha, 'see-through parts'), cmp(base.glow, g.glow, 'rims and marks'));
        let tx = 0;
        let sz = 0;
        if (base.text.length !== g.text.length) fails.push(`${id}: ${g.text.length} labels vs ${base.text.length}`);
        else for (let i = 0; i < g.text.length; i++) { tx = Math.max(tx, Math.abs(g.text[i][0] - base.text[i][0]), Math.abs(g.text[i][1] - base.text[i][1])); sz = Math.max(sz, Math.abs(g.text[i][2] - base.text[i][2]), Math.abs(g.text[i][3] - base.text[i][3]), Math.abs(g.text[i][4] - base.text[i][4]) * 100); }
        if (pts > 1) fails.push(`${id}: something moved ${pts.toFixed(2)} px`);
        if (tx > 1) fails.push(`${id}: a label moved ${tx.toFixed(2)} px`);
        if (sz > 1) fails.push(`${id}: a label changed size or strength (${sz.toFixed(2)})`);
        worst = { pts: Math.max(worst.pts, pts), text: Math.max(worst.text, tx), size: Math.max(worst.size, sz) };
        console.log(`THEME ${id}: points ${g.neck.length / 2}+${g.solid.length / 2}+${g.alpha.length / 2}+${g.glow.length / 2}, labels ${g.text.length}; most moved ${pts.toFixed(3)} px, labels ${tx.toFixed(3)} px, label size ${sz.toFixed(3)}; after-effects ${g.post ? 'on' : 'off'}`);
        const f = path.join(out, `theme-${id}.png`);
        await page.screenshot({ timeout: 60000, path: f });
        shots.push([id, f]);
      }
      await set('classic');
      // the contact sheet: every look at the same moment, in a grid
      const names = await page.evaluate(async () => Object.fromEntries((await import('/js/hwlooks.js')).THEMES.map((t) => [t.id, t.name])));
      const cells = shots.map(([id, f]) => [names[id], `data:image/png;base64,${fs.readFileSync(f).toString('base64')}`]);
      // laid over the page (one browser page only here), then taken away again
      await page.evaluate((cells) => {
        const d = document.createElement('div');
        d.id = 'theme-sheet';
        d.style.cssText = 'position:fixed;inset:0;z-index:99999;background:#111;color:#eee;font:600 16px sans-serif;display:grid;grid-template-columns:repeat(4,1fr);align-content:start;gap:6px;padding:6px';
        for (const [n, src] of cells) d.insertAdjacentHTML('beforeend', `<figure style="margin:0"><img style="width:100%;display:block" src="${src}"><figcaption style="padding:2px">${n}</figcaption></figure>`);
        document.body.append(d);
        return Promise.all([...d.querySelectorAll('img')].map((i) => i.decode()));
      }, cells);
      const sheetH = await page.evaluate(() => Math.ceil(document.getElementById('theme-sheet').lastElementChild.getBoundingClientRect().bottom + 6));
      await page.screenshot({ timeout: 60000, path: path.join(out, 'themes-sheet.png'), clip: { x: 0, y: 0, width: page.viewportSize().width, height: Math.min(page.viewportSize().height, sheetH) } });
      await page.evaluate(() => document.getElementById('theme-sheet').remove());
      if (fails.length) throw new Error(fails.join('; '));
      console.log(`PASS every look keeps everything in place: most moved ${worst.pts.toFixed(3)} px, labels ${worst.text.toFixed(3)} px, label sizes ${worst.size.toFixed(3)} (limit 1)`);
    }
    if (process.env.TUNER) { await page.keyboard.press('u'); await page.waitForTimeout(300); }
    if (process.env.CARD) { await page.evaluate(() => { const H = document.querySelector('.highway').__hw; H.showCard(); }); await page.waitForTimeout(Number(process.env.CARD_WAIT || 0)); }
    if (process.env.MASTER) { await page.evaluate(() => document.querySelector('.hw-dock.collapsed') && document.querySelector('.hw-set-btn').click()); await page.waitForTimeout(500); }
    // HWMENU=1 (4.31): the highway part of Sound & settings, and Settings › Display's highway part on
    // its own (hw-menu.png, hw-settings.png, hw-settings-open.png); a style tile and a background tile work
    if (process.env.HWMENU) {
      await page.evaluate(() => document.querySelector('.hw-dock.collapsed') && document.querySelector('.hw-set-btn').click());
      await page.waitForTimeout(500);
      const r = await page.evaluate(async () => {
        const d = document.querySelector('.hl-drawer');
        d.scrollIntoView({ block: 'start' });
        // 4.33: picking a style or flipping a switch must leave the side menu where it was
        let pane = d.parentElement;
        while (pane && pane.scrollHeight <= pane.clientHeight + 2) pane = pane.parentElement;
        const before = pane ? pane.scrollTop : 0;
        const wait = (ms) => new Promise((r) => setTimeout(r, ms));
        const strip = d.querySelector('.hl-styles');
        strip.scrollLeft = strip.scrollWidth; // a strip that scrolls sideways: go to its end first
        const n = d.querySelectorAll('.hl-style').length - 1;
        const at = () => { const b = d.querySelectorAll('.hl-style')[n].getBoundingClientRect(); return [Math.round(b.x), Math.round(b.y)]; };
        const tileBefore = at();
        d.querySelectorAll('.hl-style')[n].click();
        await wait(400);
        const tileAfter = at();
        const afterStyle = pane ? pane.scrollTop : 0;
        document.querySelector('.hw-master-opts .hw-opt-toggle').click();
        await wait(300);
        const afterSwitch = pane ? pane.scrollTop : 0;
        document.querySelector('.hw-master-opts .hw-opt-toggle').click();
        const kept = { before, afterStyle, afterSwitch, scrolled: !!pane, tileBefore, tileAfter };
        const tiles = d.querySelectorAll('.hl-style').length;
        const imgs = await Promise.all([...d.querySelectorAll('.hl-style img')].map((i) => i.decode().then(() => i.naturalWidth > 0, () => false)));
        d.querySelectorAll('.hl-style')[2].click();
        const m = await import('/js/hwlooks.js');
        const picked = m.loadLooks().theme;
        document.querySelector('.hl-drawer .hl-bg-fold .hl-fold-head').click();
        await new Promise((r) => setTimeout(r, 50));
        document.querySelector('.hl-drawer .hl-own').click();
        const bg = m.loadLooks().bg;
        return { tiles, kept, imgsOk: imgs.every(Boolean), picked, bg, fps: [...document.querySelectorAll('.hw-master-opts button')].filter((b) => /frame rate/i.test(b.textContent)).length };
      });
      console.log('HWMENU', JSON.stringify(r));
      await page.waitForTimeout(1200);
      const box = await page.evaluate(() => { const o = document.querySelector('.hw-master-opts'); const b = o.getBoundingClientRect(); return { x: b.x, y: Math.max(0, b.y), w: b.width, h: Math.min(innerHeight, b.height) }; });
      await page.screenshot({ path: path.join(out, 'hw-menu.png'), clip: { x: Math.max(0, box.x - 8), y: 0, width: Math.min(box.w + 16, 1920), height: 1080 } });
      await page.screenshot({ path: path.join(out, 'hw-menu-full.png') });
      await page.evaluate(async () => {
        const { lookSection } = await import('/js/hwlooks-pane.js');
        const d = document.createElement('div');
        d.id = 'hl-sheet';
        d.style.cssText = 'position:fixed;inset:0;z-index:99999;overflow:auto;background:#1b1814;padding:20px 30px;';
        const sec = document.createElement('div');
        sec.className = 'disp-sec';
        sec.style.cssText = 'max-width:760px;margin:0 auto;color:#eee;font:13px sans-serif';
        sec.innerHTML = '<h3>Highway</h3>';
        sec.append(lookSection());
        d.append(sec);
        document.body.append(d);
        await Promise.all([...d.querySelectorAll('img')].map((i) => i.decode().catch(() => {})));
      });
      await page.waitForTimeout(300);
      const fullShot = async (name) => {
        const hgt = await page.evaluate(() => document.querySelector('#hl-sheet > div').scrollHeight + 40);
        await page.setViewportSize({ width: 1920, height: Math.min(4000, hgt) });
        await page.waitForTimeout(300);
        await page.screenshot({ path: path.join(out, name), clip: { x: 560, y: 0, width: 800, height: Math.min(4000, hgt) } });
        await page.setViewportSize({ width: 1920, height: 1080 });
      };
      await fullShot('hw-settings.png');
      await page.evaluate(() => document.querySelector('#hl-sheet .hl-tune-fold .hl-fold-head').click());
      await fullShot('hw-settings-open.png');
      const steady = r.kept.tileBefore.join() === r.kept.tileAfter.join() && Math.abs(r.kept.afterStyle - r.kept.before) < 2 && Math.abs(r.kept.afterSwitch - r.kept.before) < 2;
      const ok = steady && r.tiles >= 6 && r.imgsOk && r.picked === 'synthwave' && r.bg === 'own' && r.fps === 0;
      if (!ok) throw new Error('highway menu: ' + JSON.stringify(r));
      console.log('PASS the highway menu stays put; style pictures, a style and the style’s own room picked, no frame rate switch there');
    }
    // 4.34: a style's sparks from the last hit are just born (unseen), and a frame here takes so long that
    // older ones have burnt out: stop the clock, let the hits land, make the sparks 0.25 s older, draw again
    if (hits && await page.evaluate(() => { const hx = document.querySelector('.highway').__hw.hx; if (!hx || !hx.on) return false; const t = performance.now(); performance.now = () => t; return true; })) {
      await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
      await page.evaluate(() => { document.querySelector('.highway').__hw.hx.age(0.25); return new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))); });
    }
    // :H (4.34.1): the same hit every time, with no playing: the clock stops, the notes of the last 0.15 s are
    // hit dead on (as in GFXCHECK) and the picture is drawn 0.1 s later. For stills of a hit that do not
    // depend on how busy the machine is.
    if (hits === 'H') {
      await page.evaluate(() => {
        const H = document.querySelector('.highway').__hw;
        const T = 100000;
        performance.now = () => T;
        H.hits = []; H.bursts = [];
        const pos = window.__stage.engine.position;
        H.targets.forEach((tg, id) => {
          if (tg.t > pos || tg.t < pos - 0.15) return;
          const at = T - 100;
          H.hits.push({ id, at, chord: tg.notes.length > 1, until: tg.t + (tg.sus || 0), offset: 0 });
          for (const nt of tg.notes) H.bursts.push({ s: nt.s, f: nt.f, at, until: tg.t + (tg.sus || 0) });
        });
        return new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      });
      await page.evaluate(() => { const hx = document.querySelector('.highway').__hw.hx; if (hx && hx.on) hx.age(0.1); return new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))); });
    }
    // HXINFO=1 (4.34): what a style with its own graphics drew in the last frame
    if (process.env.HXINFO) console.log('hd', await page.evaluate(() => JSON.stringify(document.querySelector('.highway').__hw.hx.info())));
    await page.evaluate(() => { const H = document.querySelector('.highway').__hw; H.open = false; cancelAnimationFrame(H.raf); });
    await page.screenshot({ timeout: 60000, path: path.join(out, `${scene}_${(file||'').replace('.json','')}_${t}${play === 'p' ? 'p' : ''}${hits || ''}.png`) });
    console.log('shot', spec);
  }
  await browser.close();
  srv.close();
})();
