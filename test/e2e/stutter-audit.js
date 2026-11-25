/* What stops the highway's picture for a moment while a song plays, in the full page (the real app's
   song start: the song and its stems loading, the top bar, the practice log, everything else that runs).
   A song is opened with the style and graphics given (HWTHEME, default ember; HWGFX, default ultra; HWBG
   own|venue; STUTTER_VENUE a moving background such as chrome or warp), played STUTTER_SECS (default 12)
   seconds, and the page's own work is sampled (a CPU profile) so each long task (over 50 ms) and each long
   wait between pictures is listed with the functions that ran in it, and the shader programs and texture
   uploads asked of the graphics card. The software GPU makes every frame slow: look at what the long ones
   hold that the others don't.
   SH_AUDIT=test/e2e/stutter-audit.js node test/e2e/ui3-chromium.js native/build/stagehand-audio-fake <outDir>
   Writes <outDir>/stutter-app.json. */
const fs = require('fs');
const path = require('path');
module.exports = async ({ page, outDir, check }) => {
  for (let i = 0; i < 3 && (await page.locator('.modal').count()); i++) await page.keyboard.press('Escape');
  // a small window: the software GPU draws every pixel itself
  await page.setViewportSize({ width: Number(process.env.VW || 800), height: Number(process.env.VH || 450) });
  const theme = process.env.HWTHEME || 'ember', preset = process.env.HWGFX || 'ultra', bg = process.env.HWBG || 'own';
  await page.evaluate(async ([theme, preset, bg, venue]) => {
    const m = await import('./js/hwlooks.js');
    m.saveLooks({ ...m.loadLooks(), theme, bg, gfx: { preset, fpsCap: 0 } });
    if (venue) { const p = JSON.parse(localStorage.getItem('stagehand.highway') || '{}'); p.venue = venue; localStorage.setItem('stagehand.highway', JSON.stringify(p)); }
  }, [theme, preset, bg, process.env.STUTTER_VENUE || '']);
  // the graphics card's work, per frame
  await page.evaluate(() => {
    const st = (window.__st = { frames: [], gl: [], longs: [], progs: [] });
    const newFrame = () => ({ gl: 0, prog: 0, tex: 0, texBytes: 0 });
    st.cur = newFrame();
    const tick = (ts) => { st.cur.ts = ts; st.frames.push(st.cur); st.cur = newFrame(); requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
    new PerformanceObserver((l) => { for (const e of l.getEntries()) st.longs.push({ at: e.startTime, ms: e.duration }); }).observe({ type: 'longtask' });
    const P = WebGL2RenderingContext.prototype;
    const wrap = (name, kind, size) => {
      const orig = P[name];
      P[name] = function (...a) {
        const t = performance.now();
        const r = orig.apply(this, a);
        const ms = performance.now() - t;
        st.cur.gl += ms;
        if (kind === 'prog') { st.cur.prog++; st.progs.push(t); }
        if (kind === 'tex') { st.cur.tex++; st.cur.texBytes += size(a); }
        if (ms > 2) st.gl.push({ at: t, name, ms: +ms.toFixed(1) });
        return r;
      };
    };
    wrap('linkProgram', 'prog');
    wrap('getProgramParameter');
    wrap('compileShader');
    const texSize = (a) => { const s = a[a.length - 1]; return s && s.width ? s.width * s.height * 4 : (a[3] * a[4] * 4) || 0; };
    const subSize = (a) => (a.length >= 9 ? a[4] * a[5] * 4 : texSize(a)); // texSubImage2D(target, level, x, y, w, h, format, type, source): the box sent
    wrap('texImage2D', 'tex', texSize);
    wrap('texSubImage2D', 'tex', subSize);
  });
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Profiler.enable');
  await cdp.send('Profiler.setSamplingInterval', { interval: 500 });
  const id = await page.evaluate(async () => { const { state } = await import('./js/store.js'); return [...state.songs.values()].find((s) => s.hasStems)?.id || [...state.songs.values()][0]?.id; });
  check(!!id, 'a song to play');
  await cdp.send('Profiler.start');
  const t0 = await page.evaluate(async (id) => {
    const t0 = performance.now();
    (await import('./js/actions.js')).playAlong(id);
    return t0;
  }, id);
  await page.waitForFunction(() => { const r = document.querySelector('.highway'); return r && !r.hidden && r.__hw && r.__hw.tab; }, null, { timeout: 30000 });
  // when the song really starts moving
  await page.waitForFunction(async () => { const { engine } = await import('./js/stage.js'); return engine.playing && engine.position > 0.05; }, null, { timeout: 30000, polling: 20 });
  const tPlay = await page.evaluate(async () => { const { engine } = await import('./js/stage.js'); return performance.now() - engine.position * 1000; });
  await page.waitForTimeout(Number(process.env.STUTTER_SECS || 12) * 1000);
  const { profile } = await cdp.send('Profiler.stop');
  const r = await page.evaluate(([t0, tPlay]) => {
    const st = window.__st;
    const H = document.querySelector('.highway').__hw;
    const F = st.frames.filter((f) => f.ts >= t0);
    const gaps = [];
    for (let i = 1; i < F.length; i++) gaps.push({ from: F[i - 1].ts, to: F[i].ts, gap: F[i].ts - F[i - 1].ts, gl: F[i].gl, prog: F[i].prog, tex: F[i].tex, texKB: Math.round(F[i].texBytes / 1024) });
    const sorted = gaps.map((g) => g.gap).sort((a, b) => a - b);
    return { tPlay, median: sorted[sorted.length >> 1], gaps, longs: st.longs.filter((l) => l.at >= t0), progs: st.progs.filter((p) => p >= t0), slowGl: st.gl.filter((g) => g.at >= t0), look: H.look && { id: H.look.id, res: H.look.res, aa: H.look.aa, bloom: !!H.look.bloom, refl: H.look.refl }, scale: H.r3 && H.r3.scale };
  }, [t0, tPlay]);
  // the profile: which functions ran (self time) between two page times
  const nodes = new Map(profile.nodes.map((n) => [n.id, n]));
  const parent = new Map();
  for (const n of profile.nodes) for (const c of n.children || []) parent.set(c, n.id);
  const name = (n) => { const f = n.callFrame; return `${f.functionName || '(anon)'} ${(f.url || '').split('/').pop()}:${f.lineNumber + 1}`; };
  // sample times are in the profiler's clock (microseconds); line it up with the page's performance.now()
  const times = [];
  let ts = profile.startTime;
  for (const d of profile.timeDeltas) times.push((ts += d));
  const perfAtStart = await page.evaluate(() => performance.now());
  const offset = perfAtStart * 1000 - profile.endTime; // rough: profiler end ≈ now
  const inWindow = (a, b) => {
    const self = new Map(), incl = new Map();
    profile.samples.forEach((sid, i) => {
      const t = (times[i] + offset) / 1000;
      if (t < a || t > b) return;
      const n = nodes.get(sid);
      self.set(name(n), (self.get(name(n)) || 0) + 0.5);
      const seen = new Set();
      for (let p = sid; p !== undefined; p = parent.get(p)) {
        const k = name(nodes.get(p));
        if (seen.has(k)) continue;
        seen.add(k);
        incl.set(k, (incl.get(k) || 0) + 0.5);
      }
    });
    const top = (m) => [...m.entries()].filter(([k]) => !/^\((root|program|idle)\)/.test(k)).sort((x, y) => y[1] - x[1]).slice(0, 8).map(([k, v]) => `${k} ${v.toFixed(1)}ms`);
    return { self: top(self), incl: top(incl) };
  };
  const rel = (t) => ((t - r.tPlay) / 1000).toFixed(2) + 's';
  const lines = [];
  lines.push(`STUTTER-APP ${JSON.stringify(r.look)} scale ${r.scale}: median frame gap ${r.median.toFixed(1)} ms (song start = 0 s)`);
  lines.push('  programs built: ' + (r.progs.map(rel).join(' ') || 'none'));
  lines.push('  slow GL calls: ' + (r.slowGl.map((g) => `${rel(g.at)} ${g.name} ${g.ms}ms`).join(' | ') || 'none'));
  const worst = r.gaps.slice().sort((a, b) => b.gap - a.gap).slice(0, 12).sort((a, b) => a.from - b.from);
  for (const g of worst) {
    const w = inWindow(g.from, g.to);
    lines.push(`  gap at ${rel(g.to)}: ${g.gap.toFixed(0)} ms (gl ${g.gl.toFixed(1)} ms, programs ${g.prog}, uploads ${g.tex} ${g.texKB} KB)`);
    lines.push('     self: ' + w.self.join(' · '));
    lines.push('     incl: ' + w.incl.join(' · '));
  }
  lines.push('  long tasks: ' + r.longs.map((l) => `${rel(l.at)} ${Math.round(l.ms)}ms`).join(' | '));
  for (const l of lines) console.log(l);
  fs.writeFileSync(path.join(outDir, 'stutter-app.json'), JSON.stringify({ ...r, gaps: worst, lines }, null, 1));
  check(true, 'measured');
};
