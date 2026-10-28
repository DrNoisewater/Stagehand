  // ================================================================ 3D ==
  // A real 3D scene on the graphics card (highway3d.js), laid out like
  // Rocksmith 2014 as seen in your own gameplay videos:
  //   x runs along the neck (about a unit per fret), y is height above the
  //   highway floor (each string at its own height, low E on top by default),
  //   z is time ahead (0 = the neck, where you play).
  // The neck stands upright at z = 0 across the bottom of the screen. The
  // floor runs from it to a far vanishing point; your hand position is a lit
  // channel on that floor. Frets are nearly even in width so fret 20 reads
  // as easily as fret 3. Text (fret numbers, chord names, MISS…) is drawn
  // crisp on a 2D layer on top, placed by the 3D camera.
  const RATIO = 0.982; // each fret this much narrower than the one before
  const XF = (f) => (f < 0 ? f : (1 - Math.pow(RATIO, f)) / (1 - RATIO));
  const FX = (x) => (x < 0 ? x : Math.log(Math.max(1e-6, 1 - x * (1 - RATIO))) / Math.log(RATIO));
  const laneC = (f) => (XF(f - 1) + XF(f)) / 2;
  const laneW = (f) => XF(f) - XF(f - 1);
  const INLAYS = [3, 5, 7, 9, 12, 15, 17, 19, 21, 24];
  const PAST = 0.14; // seconds a note keeps travelling past the neck toward you, fading
  const CAM_LOOK = 2.2; // seconds of hand positions the camera frames ahead

  const G = {};

  function geometry(t) {
    const n = H.tab.strings;
    G.n = n;
    G.t = t;
    G.L = prefs.ahead;
    G.gy = n === 4 ? 0.46 : 0.36; // height per string (upright neck: every string at z = 0)
    G.hl = 0.14; // the bottom string above the floor
    G.gap = G.gy;
    G.yMid = G.hl + ((n - 1) / 2) * G.gy;
    G.yTop = G.hl + (n - 1) * G.gy;
    G.zs = APPROACH_UNITS * (prefs.flow ?? 1); // world units per song second, never tied to the camera
    G.zF = G.zs * G.L;
  }
  const level = (s) => (prefs.lowTop ? G.n - 1 - s : s);
  const nY = (L) => G.hl + L * G.gy;
  const strH = (s) => nY(level(s));
  const strZ = () => 0;
  const zOf = (time) => approachDepth(time, G.t, prefs.flow ?? 1);
  const anX0 = (an) => XF(an.fret - 1);
  const anX1 = (an) => XF(an.fret - 1 + (an.width || 4));
  const noteX = (nt, a) => (nt.f === 0 ? (anX0(a) + anX1(a)) / 2 : laneC(nt.f));

  // ---- camera --
  /** Frets (as lane edges, lo..hi) that the next few seconds of play use. */
  function playRange(t, horizon) {
    const A = H.tab.anchors || [];
    let lo = Infinity;
    let hi = -Infinity;
    const take = (a, b) => {
      lo = Math.min(lo, a);
      hi = Math.max(hi, b);
    };
    const an = anchorAt(t);
    take(an.fret - 1, an.fret - 1 + (an.width || 4));
    for (let i = lower(A, t); i < A.length && A[i].t < t + horizon; i++) take(A[i].fret - 1, A[i].fret - 1 + (A[i].width || 4));
    const T = H.targets;
    for (let i = lower(T, t - 0.2); i < T.length && T[i].t < t + horizon; i++) {
      for (const nt of T[i].notes) {
        if (nt.f > 0) take(nt.f - 1, nt.f);
        const sl = nt.slideTo !== undefined ? nt.slideTo : nt.slideUnpitchTo;
        if (sl > 0) take(sl - 1, sl);
      }
    }
    if (!isFinite(lo)) return { lo: 0, hi: 5 };
    return { lo, hi };
  }

  /** The stretch of neck to show for a range: room each side, at least ~11 frets. */
  function viewFor(r) {
    let lo = r.lo - 1.6;
    let hi = r.hi + 1.4;
    const MIN = 11;
    if (hi - lo < MIN) {
      const c = (lo + hi) / 2;
      lo = c - MIN / 2;
      hi = c + MIN / 2;
    }
    if (lo < -2.5) {
      hi += -2.5 - lo;
      lo = -2.5;
    }
    if (hi > 24.8) {
      lo = Math.max(-2.5, lo - (hi - 24.8));
      hi = 24.8;
    }
    return { lo, hi };
  }

  const CAM = { fov: 56, yaw: 0.075, neckY: 0.8, fill: 0.95 };
  function camera(t, dt) {
    const c = H.cam;
    const want = viewFor(playRange(t, CAM_LOOK));
    const fr = c.frame;
    if (!fr || !c.ready) c.frame = { ...want, slack: 0 };
    else if (want.lo < fr.lo - 0.05 || want.hi > fr.hi + 0.05) {
      // something coming doesn't fit: take it in now (keep what still fits, so it pans)
      c.frame = { lo: Math.min(want.lo, fr.lo), hi: Math.max(want.hi, fr.hi), slack: 0 };
      if (c.frame.hi - c.frame.lo > want.hi - want.lo + 2.5) c.frame = { ...want, slack: 0 };
    } else if (want.hi - want.lo < (fr.hi - fr.lo) * 0.8) {
      // more room than needed: close in once it has stayed that way a moment
      fr.slack += dt;
      if (fr.slack > 2.0) c.frame = { ...want, slack: 0 };
    } else fr.slack = 0;
    const x0 = XF(c.frame.lo);
    const x1 = XF(c.frame.hi);
    const tx = (x0 + x1) / 2;
    const span = x1 - x0;
    // zoomed right out (a solo roaming the neck) the camera drops a little lower and flatter
    const zoomK0 = Math.max(0, Math.min(1, (span - 9.5) / 9));
    c.zk = c.ready && c.zk !== undefined ? c.zk + (zoomK0 - c.zk) * Math.min(1, dt * 2.5) : zoomK0;
    const zoomK = c.zk;
    const elev = 0.5 - 0.1 * zoomK; // angle from the camera down to the neck
    const pitch = 0.27 - 0.05 * zoomK; // how far the camera looks down
    const F = HH / 2 / Math.tan(((CAM.fov / 2) * Math.PI) / 180); // focal length in pixels
    const dView = (F * span) / (CAM.fill * W); // depth that fits the span across the screen at the neck
    const td = dView / Math.cos(elev - pitch);
    if (!c.ready) Object.assign(c, { x: tx, d: td, vx: 0, vd: 0, ready: true });
    else {
      // a critically damped glide: quick to pull back, gentle coming in
      const w = td > c.d ? 4.2 : 2.2;
      for (let left = dt; left > 1e-6; left -= 1 / 120) {
        const st = Math.min(left, 1 / 120);
        c.vx += (4.2 * 4.2 * (tx - c.x) - 2 * 4.2 * c.vx) * st;
        c.x += c.vx * st;
        c.vd += (w * w * (td - c.d) - 2 * w * c.vd) * st;
        c.d += c.vd * st;
      }
    }
    const d = c.d;
    const yaw = CAM.yaw; // looking a touch left: the strings fall gently to the right, the highway leans in
    const target = [c.x, G.yMid, 0];
    const ce = Math.cos(elev);
    const pos = [target[0] + d * ce * Math.sin(yaw), target[1] + d * Math.sin(elev), -d * ce * Math.cos(yaw)];
    const look = [pos[0] - Math.sin(yaw) * Math.cos(pitch), pos[1] - Math.sin(pitch), pos[2] + Math.cos(yaw) * Math.cos(pitch)];
    // shift the picture (not the camera) so the neck sits low on the screen
    const neckAt = HH / 2 + F * Math.tan(elev - pitch);
    const dy = HH * (CAM.neckY + 0.04 * zoomK) - neckAt;
    R3.setCamera(pos, look, CAM.fov, 0, dy);
    G.camX = c.x;
    G.F = F;
    G.zoomK = zoomK;
    c.f = FX(c.x); // camera centre in frets (tests read this)
    c.px = scaleAt(c.x, G.yMid, 0); // pixels per unit at the neck (tests)
    H.projection = {
      point: (f, s, time) => {
        const p = R3.project(laneC(f), strH(s), zOf(time));
        return [p[0], p[1]];
      },
      neck: (f, s) => {
        const p = R3.project(laneC(f), strH(s), 0);
        return [p[0], p[1]];
      },
    };
  }

  const PX = (x, y, z) => R3.project(x, y, z)[0];
  const PY = (x, y, z) => R3.project(x, y, z)[1];
  const scaleAt = (x, y, z) => R3.project(x, y, z)[2];
  const rgba = (hex, a) => {
    const v = parseInt(hex.slice(1), 16);
    return `rgba(${(v >> 16) & 255}, ${(v >> 8) & 255}, ${v & 255}, ${a})`;
  };

  function draw(t, dt) {
    const tab = H.tab;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, HH);
    drawBackdrop(t);
    if (!tab || !R3) {
      if (R3) {
        R3.begin();
        R3.render(40, 1);
      }
      return;
    }
    geometry(t);
    camera(t, dt);
    const a = anchorAt(t);
    let f0 = 0;
    let f1 = 24;
    while (f0 < 24 && PX(XF(f0 + 1), 0, 0) < -40) f0++;
    while (f1 > 0 && PX(XF(f1 - 1), 0, 0) > W + 40) f1--;
    G.f0 = f0;
    G.f1 = f1;
    R3.begin();
    R3.setGlow(prefs.glow !== false);
    buildFloor(t, a, f0, f1);
    buildNeck(t, a, f0, f1);
    buildNotes(t, a);
    buildLands(t, a);
    buildHits(t, a);
    R3.render(G.zF, G.zs * PAST);
    drawNeckFront(t, a, f0, f1);
    drawLabels();
    drawHitsFront(t, a, dt);
    drawFire(a, dt);
  }

  // labels gathered while building the scene, drawn on the 2D layer afterwards
  const labels = [];
  function label(text, x, y, z, opts) {
    labels.push({ text, x, y, z, ...opts });
  }
  function drawLabels() {
    ctx.textAlign = 'center';
    for (const l of labels) {
      const [sx, sy, sc, front] = R3.project(l.x, l.y, l.z);
      if (!front) continue;
      const fs = Math.round(Math.max(l.min || 10, Math.min(l.max || 36, (l.size || 0.4) * sc)));
      if (fs < (l.hide || 0)) continue;
      ctx.globalAlpha = l.alpha ?? 1;
      ctx.font = `${l.weight || 900} ${fs}px ${FONT}`;
      ctx.textBaseline = l.base || 'middle';
      const y = sy + (l.dy || 0) * fs;
      if (l.pill) {
        const tw = ctx.measureText(l.text).width + fs * 0.9;
        rr(ctx, sx - tw / 2, y - fs * 0.62, tw, fs * 1.24, fs * 0.62);
        ctx.fillStyle = 'rgba(8, 12, 22, 0.85)';
        ctx.fill();
        ctx.fillStyle = l.color || '#ffe2b0';
        ctx.fillText(l.text, sx, y + 1);
        continue;
      }
      ctx.lineWidth = Math.max(2.5, fs * 0.16);
      ctx.strokeStyle = 'rgba(5, 8, 15, 0.85)';
      ctx.strokeText(l.text, sx, y);
      if (l.gold) {
        const g = ctx.createLinearGradient(0, y - fs / 2, 0, y + fs / 2);
        g.addColorStop(0, l.grey ? '#a0a4b4' : '#ffe9a8');
        g.addColorStop(1, l.grey ? '#6a6f82' : '#f3a51f');
        ctx.fillStyle = g;
      } else ctx.fillStyle = l.color || '#ffffff';
      ctx.fillText(l.text, sx, y);
    }
    ctx.globalAlpha = 1;
    labels.length = 0;
  }

  /** Flames off the neck outside your hand position, and the streak badge. */
  function drawFire(a, dt) {
    const yTop = PY(anX0(a), nY(G.n - 1) + 0.3, 0);
    const yBot = PY(anX0(a), -0.25, 0);
    const ha = PX(anX0(a), -0.25, 0);
    const hb = PX(anX1(a), -0.25, 0);
    const n0 = Math.max(0, PX(XF(0), -0.25, 0));
    fire.update(Math.min(0.05, dt || 0.016), G.heat, [[n0, ha - 24], [hb + 24, W]], yBot + 2);
    fire.draw(ctx);
    const streak = H.forceStreak ?? (H.judge && prefs.detect && rig.on ? H.judge.streak : 0);
    if (streak >= 8) {
      const hot = G.heat;
      const fs = Math.round(Math.min(40, HH * 0.04) * (1 + 0.08 * G.pulse));
      ctx.font = `900 ${fs}px ${FONT}`;
      ctx.textAlign = 'right';
      ctx.textBaseline = 'alphabetic';
      const x = W - 40;
      const y = Math.min(yTop - 24, HH * 0.62);
      ctx.lineWidth = 6;
      ctx.strokeStyle = 'rgba(5, 8, 15, 0.8)';
      ctx.strokeText(String(streak), x, y);
      const g = ctx.createLinearGradient(0, y - fs, 0, y);
      g.addColorStop(0, hot > 0.5 ? '#fff3b0' : '#ffffff');
      g.addColorStop(1, hot > 0.5 ? '#ff6a1f' : '#7fe8ff');
      ctx.fillStyle = g;
      ctx.shadowColor = hot > 0.5 ? '#ff7a1f' : '#4fe3ff';
      ctx.shadowBlur = 10 + 20 * hot;
      ctx.fillText(String(streak), x, y);
      ctx.shadowBlur = 0;
      ctx.font = `800 ${Math.round(fs * 0.36)}px ${FONT}`;
      ctx.fillStyle = hot > 0.5 ? '#ffb070' : 'rgba(170, 230, 255, 0.85)';
      ctx.fillText(hot >= 0.99 ? 'ON FIRE' : 'IN A ROW', x, y + fs * 0.45);
    }
  }

  // The venue behind the highway, lit by the beat and by how well you're playing.
  const venue = createVenue();
  const fire = createFire();
  function beatPulse(t) {
    const B = (H.tab && H.tab.beats) || [];
    const i = lower(B, t + 0.0001) - 1;
    if (i < 0 || !stage.engine.playing) return 0;
    const k = Math.max(0, t - B[i].t);
    return Math.exp(-k * (B[i].m >= 0 ? 5 : 7)) * (B[i].m >= 0 ? 1 : 0.65);
  }
  function drawBackdrop(t) {
    const streak = H.forceStreak ?? (H.judge && prefs.detect && rig.on ? H.judge.streak : 0);
    const want = Math.max(0, Math.min(1, (streak - 8) / 32));
    H.heat = (H.heat || 0) + (want - (H.heat || 0)) * (want < (H.heat || 0) ? 0.08 : 0.03);
    G.heat = prefs.fx ? H.heat : 0;
    G.pulse = beatPulse(t || 0);
    const target = R3 ? bgCtx : ctx;
    const bw = R3 ? R3.bg.width : W;
    const bh = R3 ? R3.bg.height : HH;
    venue.draw(target, prefs.venue || 'arena', bw, bh, performance.now() / 1000, G.pulse * 0.5, G.heat * 0.5);
    target.fillStyle = 'rgba(4, 6, 10, 0.3)';
    target.fillRect(0, 0, bw, bh);
  }

  /** Cyan edges that warm to orange as you heat up. */
  const RAIL = '#50e8ff';
  const RAIL_HOT = '#ff963c';
  const railCol = (a, k = 1) => mix(RAIL, RAIL_HOT, G.heat || 0, a, k);
  function railColor(a) {
    const k = G.heat || 0;
    return `rgba(${Math.round(80 + 175 * k)}, ${Math.round(232 - 82 * k)}, ${Math.round(255 - 195 * k)}, ${a})`;
  }

  // ------------------------------------------------------------ floor --
  function buildFloor(t, a, f0, f1) {
    const { floor, glow } = R3.L;
    const zF = G.zF;
    const zN = -G.zs * PAST;
    // every fret's line runs off to the vanishing point, faint
    const lineC = col('#5ad2eb', 0.34);
    for (let f = 0; f <= 24; f++) floor.bar([XF(f), 0, zN], [XF(f), 0, zF], 0.035, lineC);
    // hand positions: dark blue channels, one per fret, bright edges, stepping across the floor
    const A = H.tab.anchors || [];
    for (let i = Math.max(0, lower(A, t) - 1); i < A.length && A[i].t < t + G.L; i++) {
      const an = A[i];
      const za = Math.max(zN, zOf(an.t));
      const next = A[i + 1];
      const zb = Math.min(zF, zOf(next ? next.t : an.end || an.t + 600));
      if (zb <= za) continue;
      const xa = anX0(an);
      const xb = anX1(an);
      for (let f = an.fret; f < an.fret + (an.width || 4); f++) {
        const l = XF(f - 1);
        const r = XF(f);
        const w = r - l;
        floor.flat(l, r, za, zb, 0.002, col('#123856', 0.9), col('#0e2c46', 0.9));
        floor.flat(l + w * 0.16, r - w * 0.16, za, zb, 0.004, col('#4696d2', 0.2), col('#4696d2', 0.1));
      }
      for (let f = an.fret; f < an.fret - 1 + (an.width || 4); f++) floor.bar([XF(f), 0.006, za], [XF(f), 0.006, zb], 0.04, col('#78e6ff', 0.55));
      // the bright rails
      for (const x of [xa, xb]) {
        floor.bar([x, 0.008, za], [x, 0.008, zb], 0.09, railCol(0.95, 1.2));
        glow.bar([x, 0.01, za], [x, 0.01, zb], 0.3, railCol(0.22, 1));
      }
      // a new hand position: a light bar across its front edge and its fret numbers on the floor
      if (za > G.zs * 0.3 && za < zF * 0.9) {
        floor.bar([xa, 0.008, za], [xb, 0.008, za], 0.07, railCol(0.8, 1.2));
        glow.bar([xa, 0.01, za], [xb, 0.01, za], 0.25, railCol(0.2));
        const inA = (f) => f >= an.fret && f < an.fret + (an.width || 4);
        for (let f = Math.max(1, an.fret - 4); f <= Math.min(24, an.fret + (an.width || 4) + 4); f++) {
          if (!inA(f) && !INLAYS.includes(f)) continue;
          label(String(f), laneC(f), 0, za - 0.35, { size: 0.42 * laneW(f), min: 9, max: 26, weight: 800, color: inA(f) ? '#ffffff' : 'rgba(90, 210, 220, 0.8)', alpha: Math.max(0, Math.min(1, (zF - za) / (zF * 0.45))) });
        }
      }
    }
    // beat lines across the hand position: bars brighter
    const beats = H.tab.beats || [];
    for (let i = lower(beats, t); i < beats.length && beats[i].t < t + G.L; i++) {
      const z = zOf(beats[i].t);
      if (z < 0.05) continue;
      const bar = beats[i].m >= 0;
      const an = anchorAt(beats[i].t);
      floor.bar([anX0(an), 0.007, z], [anX1(an), 0.007, z], bar ? 0.06 : 0.03, col('#a0ebff', bar ? 0.45 : 0.16));
    }
  }

  // ------------------------------------------------------------- neck --
  function buildNeck(t, a, f0, f1) {
    const { solid, alpha, glow } = R3.L;
    const n = G.n;
    const xn = XF(-3);
    const xe = XF(24) + 0.8;
    const yb = -0.25;
    const yt = G.yTop + 0.32;
    // your hand position, faintly lit on the neck
    alpha.up(anX0(a), anX1(a), yb, yt, 0.06, col('#46c8ff', 0.05), col('#46c8ff', 0.1));
    // inlay panels behind the strings: gold in your hand position, teal elsewhere
    for (const f of INLAYS) {
      if (f < f0 - 1 || f > f1 + 1) continue;
      const inA = f >= a.fret && f < a.fret + (a.width || 4);
      const w = laneW(f);
      const c = laneC(f);
      alpha.up(c - w * 0.3, c + w * 0.3, G.hl - 0.05, G.yTop + 0.05, 0.05, inA ? col('#ffc446', 0.3) : col('#50c8d2', 0.12), inA ? col('#ffc446', 0.14) : col('#50c8d2', 0.05));
    }
    // fret wires: dark rods standing across the strings, the nut ivory
    for (let f = Math.max(0, f0 - 1); f <= Math.min(24, f1 + 1); f++) {
      const x = XF(f);
      const hw = f === 0 ? 0.07 : 0.035;
      solid.box(x - hw, x + hw, yb, yt, -0.04, 0.04, f === 0 ? col('#d8cfb6') : col('#2a2a31'), f === 0 ? col('#fff6e0') : col('#8f877a'), f === 0 ? col('#b0a890') : col('#18181d'));
      if (f > 0) solid.up(x - hw * 0.35, x + hw * 0.35, yb, yt, -0.045, col('#6e675d', 1));
    }
    // strings: thin and coloured, a touch thicker toward the low E, with a soft glow
    for (let s = 0; s < n; s++) {
      const y = strH(s);
      const th = (n === 4 ? 0.034 : 0.028) - s * (n === 4 ? 0.004 : 0.0028);
      solid.box(xn, xe, y - th, y + th, -th, th, col(STRING[s], 1, 1.25), col(STRING[s], 1, 1.6), col(STRING[s]));
      glow.up(xn, xe, y - th * 3, y + th * 3, -0.05, col(STRING[s], 0.18));
    }
    // the hand position's edges at the neck: two white posts, as in the game
    for (const x of [anX0(a), anX1(a)]) {
      solid.box(x - 0.03, x + 0.03, yb - 0.1, yt + 0.25, -0.08, -0.02, col('#fff0f8', 1, 1.6));
      glow.up(x - 0.14, x + 0.14, yb - 0.1, yt + 0.3, -0.085, col('#ff7ad2', 0.25), col('#ff7ad2', 0.1));
    }
  }

  /** In front of the neck: fret numbers, the next chord's name, finger numbers as a chord lands. */
  function drawNeckFront(t, a, f0, f1) {
    const T = H.targets;
    const yb = -0.25;
    const inA = (f) => f >= a.fret && f < a.fret + (a.width || 4);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    for (let f = Math.max(1, f0); f <= f1; f++) {
      if (!inA(f) && !INLAYS.includes(f)) continue;
      const [x, y0, sc] = R3.project(laneC(f), yb, -0.1);
      if (x < 14 || x > W - 14) continue;
      const big = inA(f);
      const fs = Math.round(Math.max(14, Math.min(big ? 48 : 30, sc * (big ? 0.42 : 0.3) * laneW(f))));
      const y = y0 + 6;
      ctx.font = `${big ? 900 : 700} ${fs}px ${FONT}`;
      if (big) {
        const g = ctx.createLinearGradient(0, y, 0, y + fs);
        g.addColorStop(0, '#ffe08a');
        g.addColorStop(1, '#f0a020');
        ctx.fillStyle = g;
        ctx.shadowColor = 'rgba(255, 170, 30, 0.55)';
        ctx.shadowBlur = 12;
      } else ctx.fillStyle = 'rgba(90, 200, 205, 0.65)';
      ctx.fillText(String(f), x, y);
      ctx.shadowBlur = 0;
    }
    // finger numbers on the neck: the coming chord's, or the shape you're holding
    const fingers = new Map();
    const HS = H.tab.handShapes || [];
    const hi = lower(HS, t + 0.0001, 'start') - 1;
    const hs = hi >= 0 && t < HS[hi].end ? HS[hi] : null;
    const shape = hs && H.tab.chords[hs.chord];
    if (shape && shape.frets) shape.frets.forEach((f, s) => {
      const finger = shape.fingers && shape.fingers[s];
      if (f > 0 && finger > 0) fingers.set(s, { f, finger, alpha: 0.55 });
    });
    let nextChord = null;
    for (let i = lower(T, t - 0.08); i < T.length && T[i].t < t + 0.45; i++) {
      if (T[i].kind === 'chord') {
        nextChord = T[i];
        break;
      }
    }
    if (nextChord) {
      const sh = H.tab.chords[nextChord.chord];
      fingers.clear();
      for (const nt of nextChord.notes) {
        const finger = sh && sh.fingers && sh.fingers[nt.s];
        if (nt.f > 0 && finger > 0) fingers.set(nt.s, { f: nt.f, finger, alpha: 0.95 });
      }
    }
    for (const [s, finger] of fingers) {
      const [px, py, sc] = R3.project(laneC(finger.f), strH(s), -0.1);
      const fs = Math.max(14, Math.min(34, G.gap * sc * 0.8));
      ctx.globalAlpha = finger.alpha;
      ctx.font = `800 ${Math.round(fs)}px ${FONT}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.beginPath();
      ctx.arc(px, py, fs * 0.62, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(245, 250, 255, 0.92)';
      ctx.fill();
      ctx.fillStyle = '#20252c';
      ctx.fillText(String(finger.finger), px, py + 1);
    }
    ctx.globalAlpha = 1;
    // the next chord's name, big and bold on the left (as in Rocksmith)
    for (let i = lower(T, t - 0.05); i < T.length && T[i].t < t + 1.6; i++) {
      const tg = T[i];
      if (tg.kind !== 'chord' || !tg.name) continue;
      const k = Math.min(1, (1.6 - (tg.t - t)) / 0.4);
      ctx.globalAlpha = Math.max(0, k);
      const fs = Math.round(Math.min(88, HH * 0.08));
      ctx.font = `900 ${fs}px ${FONT}`;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'alphabetic';
      const x = W * 0.15;
      const y = HH * 0.5;
      ctx.lineWidth = 8;
      ctx.strokeStyle = 'rgba(5, 8, 15, 0.7)';
      ctx.strokeText(tg.name, x, y);
      const g = ctx.createLinearGradient(0, y - fs, 0, y);
      g.addColorStop(0, '#ffffff');
      g.addColorStop(1, '#c9d2e6');
      ctx.fillStyle = g;
      ctx.fillText(tg.name, x, y);
      ctx.globalAlpha = 1;
      break;
    }
  }

  // ------------------------------------------------------------- notes --
  /** Bend (in half steps) of a note at song time `time`, from its real bend curve. */
  function bendAt(nt, time) {
    const pts = nt.bends;
    if (pts && pts.length) {
      const rel = pts[0].t < nt.t - 0.01;
      let pt = nt.t;
      let ps = 0;
      for (const p of pts) {
        const pt2 = rel ? nt.t + p.t : p.t;
        if (time <= pt2) {
          if (pt2 <= pt) return p.step;
          return ps + ((p.step - ps) * (time - pt)) / (pt2 - pt);
        }
        pt = pt2;
        ps = p.step;
      }
      return ps;
    }
    if (nt.bend) {
      const ramp = Math.max(0.08, (nt.sus || 0.3) * 0.3);
      return nt.bend * Math.min(1, Math.max(0, (time - nt.t) / ramp));
    }
    return 0;
  }
  const bendLabel = (b) => ({ 0.5: '¼', 1: '½', 1.5: '¾', 2: 'full', 3: '1½', 4: '2' })[b] || `${b / 2}`;
  const maxBend = (nt) => (nt.bends && nt.bends.length ? Math.max(...nt.bends.map((p) => p.step)) : nt.bend || 0);
  const judged = (tg) => (H.judge && prefs.detect && rig.on ? H.judge.state.get(tg.id) : null);
  const isChord = (tg) => tg.kind === 'chord' || (tg.kind === 'mute' && tg.notes.length > 1);

  function buildNotes(t, a) {
    const T = H.targets;
    const zF = G.zF;
    const i0 = lower(T, t - PAST);
    const sustain0 = firstSustain(H.sustainEnds || [], t);
    const i1 = lower(T, t + G.L);
    // sustain ribbons, under the gems
    for (let i = sustain0; i < i1; i++) {
      const tg = T[i];
      if (!tg.sus || tg.sus < 0.06) continue;
      const t0 = Math.max(tg.t, t);
      const t1 = Math.min(tg.t + tg.sus, t + G.L);
      if (t1 <= t0) continue;
      const an = anchorAt(tg.t);
      const st = judged(tg);
      for (const nt of tg.notes) {
        const end = Math.min(t1, noteEnd(nt, tg));
        if (end > t0) buildTrail(nt, tg, t0, end, an, st);
      }
    }
    for (let i = i1 - 1; i >= i0; i--) {
      const tg = T[i];
      const z = zOf(tg.t);
      if (z > zF) continue;
      const st = judged(tg);
      const missed = st && st.result === 'miss';
      const hit = st && st.result === 'hit';
      if (z < 0 && hit && t - tg.t > PAST * 0.6) continue; // a hit note bursts on the neck instead
      const an = anchorAt(tg.t);
      if (isChord(tg)) buildChord(tg, z, an, missed);
      else for (const nt of tg.notes) buildGem(nt, z, an, missed, tg.kind === 'mute');
    }
  }

  /** A note's sustain from t0 to t1 (song times): a flat glowing ribbon at its string's height. */
  function buildTrail(nt, tg, t0, t1, an, st) {
    const { alpha, glow } = R3.L;
    const open = nt.f === 0;
    const missed = st && st.result === 'miss';
    const holding = st && st.result === 'hit' && G.t >= tg.t;
    const hex = missed ? '#5a6078' : STRING[nt.s];
    const x0 = noteX(nt, an);
    const slideTo = nt.slideTo !== undefined ? nt.slideTo : nt.slideUnpitchTo;
    const x1 = slideTo !== undefined ? laneC(Math.max(1, slideTo)) : x0;
    const half = open ? 0.5 * (anX1(an) - anX0(an)) - 0.15 : laneW(Math.max(1, nt.f)) * 0.16;
    const L0 = level(nt.s);
    const lw = laneW(Math.max(1, nt.f || an.fret));
    const steps = Math.max(6, Math.min(120, Math.round((t1 - t0) * 40)));
    const duration = noteEnd(nt, tg) - tg.t;
    let prev = null;
    let peak = null;
    for (let k = 0; k <= steps; k++) {
      const time = t0 + ((t1 - t0) * k) / steps;
      const u = duration > 0 ? (time - tg.t) / duration : 0;
      const e = Math.min(1, Math.max(0, u));
      let x = x0 + (x1 - x0) * (e * e * (3 - 2 * e));
      if (nt.vibrato && u > 0.06) x += Math.sin((time - tg.t) * Math.PI * 2 * 5.5) * lw * 0.16;
      let L = L0 + (bendAt(nt, time) / 2) * 1.5;
      if (nt.tremolo) L += (((time - tg.t) * 14) % 1 < 0.5 ? 1 : -1) * 0.12;
      const p = [x, nY(L) - G.gy * 0.12, zOf(time)];
      if (!peak || Math.abs(L - L0) > Math.abs(peak.L - L0)) peak = { p, L };
      if (prev) {
        const c = col(hex, holding ? 0.62 : 0.4, holding ? 1.4 : 1);
        alpha.quad([prev[0] - half, prev[1], prev[2]], [prev[0] + half, prev[1], prev[2]], [p[0] + half, p[1], p[2]], [p[0] - half, p[1], p[2]], c);
        const ec = missed ? col('#7a7f96', 0.8) : col(hex, 0.95, holding ? 2.2 : 1.5);
        for (const side of [-1, 1]) alpha.bar([prev[0] + side * half, prev[1] + 0.002, prev[2]], [p[0] + side * half, p[1] + 0.002, p[2]], 0.035, ec);
        if (!missed) glow.quad([prev[0] - half * 1.6, prev[1], prev[2]], [prev[0] + half * 1.6, prev[1], prev[2]], [p[0] + half * 1.6, p[1], p[2]], [p[0] - half * 1.6, p[1], p[2]], col(hex, holding ? 0.3 : 0.12));
      }
      prev = p;
    }
    const mb = maxBend(nt);
    if (mb > 0 && peak && peak.p[2] >= 0) label(`↑${bendLabel(mb)}`, peak.p[0], peak.p[1] + G.gy * 0.4, peak.p[2], { size: 0.32, min: 12, max: 26, color: '#fff3d6', base: 'bottom' });
    if (nt.slideUnpitchTo !== undefined && nt.slideTo === undefined) void 0;
  }

  /**
   * A note: a glassy block in its string's colour at its string's height in
   * its fret's lane, facing you, with a bright rim; a thin stem down to the
   * floor with its fret number there.
   */
  function buildGem(nt, z, an, missed, mute, inChord = false, box = null, flare = 0, fade = 1) {
    const { solid, alpha, glow } = R3.L;
    const s = nt.s;
    const hex = missed ? '#5a6078' : STRING[s];
    const dark = missed ? '#3c4050' : STRING_DARK[s];
    const near = Math.max(0, 1 - Math.abs(z) / (G.zs * 0.5));
    const big = 1 + flare * 0.25;
    const y = strH(s);
    const DEPTH = 0.14;
    const rimK = (missed ? 0.8 : 1.4 + 0.8 * near + 2 * flare) * fade;
    if (nt.f === 0) {
      // an open string: a bar across the hand position (or the chord's frame)
      const xa = (box ? box[0] : anX0(an)) + 0.1;
      const xb = (box ? box[1] : anX1(an)) - 0.1;
      const hh = G.gy * 0.14 * big;
      solid.box(xa, xb, y - hh, y + hh, z, z + DEPTH, col(dark, fade), col(hex, fade, 1.2), col(dark, fade));
      glow.up(xa, xb, y - hh, y + hh, z - 0.005, col(hex, 0.55 * fade * (missed ? 0.3 : 1), rimK));
      return;
    }
    const x = laneC(nt.f);
    const lw = laneW(nt.f);
    const hw = lw * (inChord ? 0.27 : 0.3) * big;
    const hh = G.gy * (inChord ? 0.32 : 0.36) * big;
    if (!inChord && z > G.zs * 0.1 && z < G.zF * 0.75) {
      // a thin stem down to the floor, a mark in the lane, and the fret number there
      alpha.up(x - 0.012, x + 0.012, 0, y - hh, z + DEPTH * 0.5, col(hex, 0.75));
      alpha.flat(x - lw * 0.32, x + lw * 0.32, z - 0.05, z + 0.09, 0.012, col(hex, 0.55));
      label(mute || nt.mute ? '×' : String(nt.f), x, 0, z - 0.3, { size: 0.42 * lw, min: 11, max: 36, gold: true, grey: missed });
    }
    // the block: dark glass front, lit top, darker sides
    solid.box(x - hw, x + hw, y - hh, y + hh, z, z + DEPTH, col(dark, fade, 0.9 + 0.5 * near), col(hex, fade, 1.1), col(dark, fade, 0.7));
    // bright rim around the front, and a light bar across the middle
    const rim = Math.min(hw, hh) * 0.24;
    const rc = flare > 0.05 ? col('#ffffff', fade, rimK) : col(hex, fade, rimK);
    const zf = z - 0.006;
    glow.up(x - hw, x + hw, y + hh - rim, y + hh, zf, rc);
    glow.up(x - hw, x + hw, y - hh, y - hh + rim, zf, rc);
    glow.up(x - hw, x - hw + rim, y - hh, y + hh, zf, rc);
    glow.up(x + hw - rim, x + hw, y - hh, y + hh, zf, rc);
    glow.up(x - hw * 0.55, x + hw * 0.55, y - rim * 0.45, y + rim * 0.45, zf, col(hex, fade * 0.9, rimK * 0.9));
    if (!missed && near > 0.05) glow.up(x - hw * 1.8, x + hw * 1.8, y - hh * 1.8, y + hh * 1.8, z + 0.01, col(hex, 0.12 * near * fade));
    if (nt.accent && !missed) {
      const p = rim * 1.6;
      for (const [a0, a1, b0, b1] of [[x - hw - p, x + hw + p, y + hh + p * 0.4, y + hh + p], [x - hw - p, x + hw + p, y - hh - p, y - hh - p * 0.4], [x - hw - p, x - hw - p * 0.4, y - hh - p, y + hh + p], [x + hw + p * 0.4, x + hw + p, y - hh - p, y + hh + p]]) glow.up(a0, a1, b0, b1, zf, col('#ffffff', 0.9 * fade, 1.5));
    }
    if (mute || nt.mute) {
      glow.bar([x - hw * 0.5, y - hh * 0.6, zf - 0.002], [x + hw * 0.5, y + hh * 0.6, zf - 0.002], rim * 0.9, col('#ffffff', fade, 1.3), undefined, 'z');
      glow.bar([x - hw * 0.5, y + hh * 0.6, zf - 0.002], [x + hw * 0.5, y - hh * 0.6, zf - 0.002], rim * 0.9, col('#ffffff', fade, 1.3), undefined, 'z');
    }
    // technique tags above the note
    if (!inChord && z > 0.2) {
      const marks = [];
      if (nt.hammerOn) marks.push('H');
      if (nt.pullOff) marks.push('P');
      if (nt.tap) marks.push('T');
      if (nt.palmMute) marks.push('PM');
      if (nt.harmonic) marks.push('◆');
      if (nt.pinchHarmonic) marks.push('PH');
      if (nt.slap) marks.push('S');
      if (nt.pop) marks.push('Pop');
      if (maxBend(nt) && !(nt.sus > 0.06)) marks.push(`↑${bendLabel(maxBend(nt))}`);
      if (nt.slideTo !== undefined && !(nt.sus > 0.06)) marks.push(nt.slideTo > nt.f ? '↗' : '↘');
      if (marks.length) label(marks.join(' '), x, y + hh + G.gy * 0.35, z, { size: 0.22, min: 10, max: 18, hide: 11, weight: 800, pill: true });
    }
  }

  /** Where a chord's frame sits across the neck. */
  function chordBox(tg, an) {
    const [left, right] = chordSpan(tg.notes, an);
    return [XF(left), XF(right)];
  }

  /**
   * A chord: an upright glowing frame standing on the highway across the
   * hand position, from the floor to just above the top string. The first
   * of a run holds its notes; repeats are lower, empty frames, so the
   * strumming reads as steps.
   */
  function buildChord(tg, z, an, missed, flare = 0) {
    const { alpha, glow, solid } = R3.L;
    const [xa, xb] = chordBox(tg, an);
    const yT = (G.yTop + G.gy * 0.55) * (tg.repeat ? 0.5 : 1);
    const DZ = 0.22;
    const accent = tg.notes.some((x) => x.accent);
    const ec = missed ? col('#6e748c', 0.9) : railCol(0.95, 1.5 + 2 * flare);
    const w = 0.055;
    // the back frame, dimmer, and the top edges joining it: a little thickness
    const bc = missed ? col('#6e748c', 0.35) : railCol(0.4, 1);
    for (const [p, q] of [[[xa, 0, z + DZ], [xa, yT, z + DZ]], [[xb, 0, z + DZ], [xb, yT, z + DZ]], [[xa, yT, z + DZ], [xb, yT, z + DZ]]]) alpha.bar(p, q, w * 0.6, bc, bc, 'z');
    alpha.flat(xa, xb, z, z + DZ, yT, missed ? col('#5a6078', 0.25) : railCol(0.18));
    // the glass, brighter at the top
    alpha.up(xa, xb, 0, yT, z, missed ? col('#5a6078', 0.05) : col('#28a0dc', tg.repeat ? 0.04 : 0.08), missed ? col('#5a6078', 0.14) : col('#50d2fa', tg.repeat ? 0.06 : 0.14));
    // the front frame, glowing
    solid.box(xa - w, xa + w, 0, yT + w, z - w, z + w, ec);
    solid.box(xb - w, xb + w, 0, yT + w, z - w, z + w, ec);
    solid.box(xa - w, xb + w, yT - w, yT + w, z - w, z + w, ec);
    if (!missed) glow.up(xa - 0.2, xb + 0.2, -0.05, yT + 0.2, z + 0.02, railCol(0.08 + 0.3 * flare));
    if (accent && !missed) {
      const p = 0.1;
      glow.up(xa - p - 0.03, xb + p + 0.03, yT + p, yT + p + 0.04, z - 0.01, col('#ffffff', 0.9, 1.4));
      glow.up(xa - p - 0.03, xa - p, 0, yT + p + 0.04, z - 0.01, col('#ffffff', 0.9, 1.4));
      glow.up(xb + p, xb + p + 0.03, 0, yT + p + 0.04, z - 0.01, col('#ffffff', 0.9, 1.4));
    }
    if (tg.kind === 'mute') label('×', (xa + xb) / 2, yT / 2, z, { size: 0.5, min: 12, max: 40 });
    if (z > 0.15) {
      for (const f of [...new Set(tg.notes.filter((n) => n.f > 0).map((n) => n.f))]) label(String(f), laneC(f), 0, z - 0.3, { size: 0.32, min: 8, max: 28, hide: 9, weight: 800, color: '#f4cf75' });
    }
    if (tg.repeat) return;
    for (const nt of tg.notes) buildGem(nt, z, an, missed, tg.kind === 'mute', true, [xa, xb], flare);
    if (tg.name && z > 0.2 && prefs.chordLabels) label(tg.name, xa + 0.6, yT + G.gy * 0.5, z, { size: 0.24, min: 11, max: 22, hide: 11, weight: 800, pill: true, color: '#ffffff' });
  }

  // --------------------------------------------------------- hit feel --
  // The moment a note lands and you hit it, its string blazes along its whole
  // length, light posts stand at its fret, the note flares on the neck and
  // sparks fly. A held note keeps its string lit. Miss it and nothing lights:
  // the note passes the neck, grey.
  const sparks = [];
  function onJudged(e) {
    const tg = H.targets[e.id];
    if (!tg) return;
    const now = performance.now();
    const st = H.judge && H.judge.state.get(e.id);
    if (!e.hit) {
      H.misses = (H.misses || []).filter((m) => now - m.at < 600);
      H.misses.push({ id: e.id, at: now });
      return;
    }
    const chord = isChord(tg);
    H.hits.push({ id: e.id, at: now, chord, until: tg.t + (tg.sus || 0), offset: st ? st.offset : null });
    for (const nt of tg.notes) H.bursts.push({ s: nt.s, f: nt.f, at: now, until: tg.t + (tg.sus || 0) });
    if (!G.F || !R3) return;
    const an = anchorAt(tg.t);
    for (const nt of tg.notes) {
      const [px, py] = R3.project(noteX(nt, an), strH(nt.s), 0);
      const n = chord ? 6 : 12;
      for (let k = 0; k < n; k++) {
        const ang = -Math.PI / 2 + (Math.random() - 0.5) * 2.4;
        const sp = 160 + Math.random() * 380;
        sparks.push({ x: px, y: py, vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp, life: 0, max: 0.35 + Math.random() * 0.35, col: Math.random() < 0.35 ? '#ffffff' : STRING[nt.s] });
      }
    }
    if (sparks.length > 400) sparks.splice(0, sparks.length - 400);
  }

  function buildHits(t, a) {
    const { glow, solid } = R3.L;
    const now = performance.now();
    H.hits = H.hits.filter((h) => now - h.at < 700 || t < h.until);
    H.bursts = H.bursts.filter((b) => now - b.at < 700 || t < b.until);
    // 1. the string blazes along its whole length, hottest at the note
    const byString = new Map();
    for (const b of H.bursts) {
      const k = Math.max(Math.exp(-(now - b.at) / 260), t < b.until ? 0.55 : 0);
      if (k < 0.02) continue;
      const cur = byString.get(b.s);
      if (!cur || cur.k < k) byString.set(b.s, { k, b });
    }
    const xn = XF(-3);
    const xe = XF(24) + 0.8;
    for (const [s, { k, b }] of byString) {
      const y = strH(s);
      glow.up(xn, xe, y - G.gy * 0.4, y + G.gy * 0.4, -0.06, col(STRING[s], 0.0), col(STRING[s], 0.0));
      glow.quad([xn, y - G.gy * 0.45, -0.06], [xe, y - G.gy * 0.45, -0.06], [xe, y, -0.06], [xn, y, -0.06], col(STRING[s], 0), col(STRING[s], 0), col(STRING[s], 0.45 * k), col(STRING[s], 0.45 * k));
      glow.quad([xn, y, -0.06], [xe, y, -0.06], [xe, y + G.gy * 0.45, -0.06], [xn, y + G.gy * 0.45, -0.06], col(STRING[s], 0.45 * k), col(STRING[s], 0.45 * k), col(STRING[s], 0), col(STRING[s], 0));
      glow.up(xn, xe, y - 0.02, y + 0.02, -0.065, col('#ffffff', 0.9 * k, 1.5));
      const x = b.f === 0 ? noteX(b, a) : laneC(b.f);
      const r = laneW(Math.max(1, b.f || a.fret)) * (0.7 + 0.4 * k);
      glow.up(x - r, x + r, y - r * 0.5, y + r * 0.5, -0.07, col(STRING[s], 0.5 * k, 1.6));
    }
    // 2. light posts at the fret wires around what you hit (the chord's box for a chord)
    const posts = new Map();
    for (const h of H.hits) {
      const tg = H.targets[h.id];
      const k = Math.max(Math.exp(-(now - h.at) / 320), t < h.until ? 0.5 : 0);
      if (k < 0.03) continue;
      const an = anchorAt(tg.t);
      const xs = h.chord ? chordBox(tg, an) : tg.notes.flatMap((nt) => (nt.f === 0 ? [anX0(an), anX1(an)] : [XF(nt.f - 1), XF(nt.f)]));
      for (const x of xs) posts.set(x.toFixed(3), Math.max(posts.get(x.toFixed(3)) || 0, k));
    }
    for (const [xs, k] of posts) {
      const x = Number(xs);
      solid.box(x - 0.035, x + 0.035, -0.2, G.yTop + 0.9, -0.1, -0.03, col('#fff0f8', k, 2.2));
      glow.up(x - 0.18, x + 0.18, -0.2, G.yTop + 0.95, -0.11, col('#ff5aaa', 0.4 * k, 1.3), col('#ff5aaa', 0.1 * k));
    }
    // 3. the note flares on the neck: a bright pop, held while you sustain
    for (const h of H.hits) {
      const tg = H.targets[h.id];
      const age = (now - h.at) / 1000;
      const holding = t < h.until;
      const k = Math.max(Math.exp(-age / 0.22), holding ? 0.6 : 0);
      if (k < 0.04) continue;
      const an = anchorAt(tg.t);
      const fl = Math.exp(-age / 0.15);
      if (h.chord) {
        const box = chordBox(tg, an);
        for (const nt of tg.notes) buildGem(nt, -0.02, an, false, false, true, box, fl, Math.min(1, k * 1.2));
      } else for (const nt of tg.notes) buildGem(nt, -0.02, an, false, tg.kind === 'mute', true, null, fl, Math.min(1, k * 1.2));
    }
  }

  /** Sparks, MISS and EARLY / LATE on the 2D layer. */
  function drawHitsFront(t, a, dt) {
    const now = performance.now();
    for (const p of sparks) {
      p.life += dt;
      p.vy += 900 * dt;
      p.vx *= 1 - 1.8 * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
    }
    for (let i = sparks.length - 1; i >= 0; i--) if (sparks[i].life > sparks[i].max) sparks.splice(i, 1);
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const p of sparks) {
      const k = 1 - p.life / p.max;
      ctx.strokeStyle = rgba(p.col, k);
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(p.x - p.vx * 0.025, p.y - p.vy * 0.025);
      ctx.stroke();
    }
    ctx.restore();
    // a small MISS over the note you missed (only the latest, so they never pile up)
    H.misses = (H.misses || []).filter((m) => now - m.at < 700).slice(-1);
    for (const m of H.misses) {
      const tg = H.targets[m.id];
      if (!tg) continue;
      const an = anchorAt(tg.t);
      const age = (now - m.at) / 700;
      const [px, py] = R3.project(noteX(tg.notes[0], an), G.yTop + G.gy * 1.2 + age * 0.15, 0);
      const fs = Math.round(Math.min(26, HH * 0.022));
      ctx.globalAlpha = Math.min(1, (1 - age) * 2.2);
      ctx.font = `900 ${fs}px ${FONT}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.lineWidth = 4;
      ctx.strokeStyle = 'rgba(5, 8, 15, 0.7)';
      ctx.strokeText('MISS', px, py);
      ctx.fillStyle = 'rgba(170, 205, 215, 0.95)';
      ctx.fillText('MISS', px, py);
      ctx.globalAlpha = 1;
    }
    for (const h of H.hits) {
      const age = (now - h.at) / 1000;
      if (h.offset === null || h.offset === undefined || Math.abs(h.offset) <= 90 || age >= 0.7) continue;
      const tg = H.targets[h.id];
      const an = anchorAt(tg.t);
      const top = tg.notes.reduce((m, q) => (strH(q.s) > strH(m.s) ? q : m), tg.notes[0]);
      const [px, py0] = R3.project(noteX(tg.notes[0], an), strH(top.s), 0);
      const fs = Math.round(Math.min(22, HH * 0.02));
      ctx.globalAlpha = Math.min(1, (0.7 - age) * 3);
      ctx.font = `900 ${fs}px ${FONT}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'bottom';
      ctx.lineWidth = 4;
      ctx.strokeStyle = 'rgba(5, 8, 15, 0.85)';
      const txt = h.offset < 0 ? 'EARLY' : 'LATE';
      const py = py0 - 26 - age * 30;
      ctx.strokeText(txt, px, py);
      ctx.fillStyle = h.offset < 0 ? '#9fe6ff' : '#ffd38a';
      ctx.fillText(txt, px, py);
      ctx.globalAlpha = 1;
    }
  }

  /** Without scoring: notes still land with a soft flash on their string, so the timing reads. */
  function buildLands(t, a) {
    const { glow } = R3.L;
    const now = performance.now();
    H.lands = H.lands.filter((l) => now - l.at < 400 || t < l.until);
    for (const l of H.lands) {
      const tg = H.targets[l.id];
      const age = (now - l.at) / 1000;
      const k = Math.max(Math.exp(-age / 0.15), t < l.until ? 0.45 : 0);
      if (k < 0.05) continue;
      const an = anchorAt(tg.t);
      for (const nt of tg.notes) {
        const x = noteX(nt, an);
        const y = strH(nt.s);
        const r = laneW(Math.max(1, nt.f || an.fret)) * 0.75;
        glow.up(x - r, x + r, y - r * 0.45, y + r * 0.45, -0.07, col(STRING[nt.s], 0.45 * k, 1.4));
      }
      const box = isChord(tg) ? chordBox(tg, an) : null;
      for (const nt of tg.notes) buildGem(nt, -0.02, an, false, tg.kind === 'mute', true, box, 0, k * 0.8);
    }
  }

