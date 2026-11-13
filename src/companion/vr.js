/**
 * The headset's highway (4.16, step 2): a preview in the page, and the same scene in VR
 * (immersive-vr: the venue all around you) or in your room (immersive-ar: passthrough,
 * the highway floating in front of you and your guitar).
 *
 * In VR: the trigger plays and pauses, a thumbstick up/down brings the highway nearer
 * or further, the other one raises or lowers it, B or Y leaves. Where you put it is
 * kept (on the headset and on the PC).
 */
import { createStage } from './stage3d.js';
import { targets, Results, lyricLines, lyricAt } from './chart.js';
import { perspective, lookAt, mul } from './mat.js';

export function createVR({ canvas, clock, nowMs, send, comfort, saveComfort, info }) {
  const gl = canvas.getContext('webgl2', { antialias: true, alpha: true, xrCompatible: true });
  if (!gl) return null;
  const stage = createStage(gl);
  Object.assign(stage.S.comfort, comfort || {});
  const V = { session: null, ref: null, mode: null, chart: null, lines: [], results: null, raf: 0, last: 0, offsetMs: (comfort && comfort.offsetMs) || 0 };

  function setChart(tab) {
    V.chart = tab;
    const list = tab ? targets(tab) : [];
    V.results = new Results(list);
    V.lines = tab ? lyricLines(tab.lyrics || []) : [];
    stage.setChart(tab, list, V.results);
  }
  function judged(e) {
    if (!V.results) return;
    const id = V.results.judged(e, performance.now());
    if (id >= 0) stage.judged(id, e.hit, performance.now());
  }
  function songTime() {
    return clock.at(nowMs()) - V.offsetMs / 1000;
  }
  function panelInfo(t) {
    const i = info();
    return { ...i, words: lyricAt(V.lines, t) };
  }

  // ---------------------------------------------------------- preview --
  function resize() {
    const r = canvas.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.max(2, Math.round(r.width * dpr)), h = Math.max(2, Math.round(r.height * dpr));
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
  }
  function previewFrame(now) {
    V.raf = requestAnimationFrame(previewFrame);
    if (V.session || document.hidden || canvas.offsetParent === null) return;
    resize();
    const dt = V.last ? Math.min(0.1, (now - V.last) / 1000) : 0;
    V.last = now;
    const t = songTime();
    stage.build(t, performance.now(), dt);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.clearColor(0.05, 0.05, 0.06, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    // where your eyes would be, standing at the highway
    const c = stage.S.comfort;
    const proj = perspective((62 * Math.PI) / 180, canvas.width / canvas.height, 0.05, 60);
    const view = lookAt([0, c.height + 0.38, 0.05], [0, c.height - 0.05, -c.dist - 1.6]);
    stage.drawView(mul(proj, view), { panelInfo: panelInfo(t) });
  }
  V.raf = requestAnimationFrame(previewFrame);

  // --------------------------------------------------------------- XR --
  async function supported() {
    const xr = navigator.xr;
    if (!xr || !window.isSecureContext) return { vr: false, ar: false };
    const [vr, ar] = await Promise.all([xr.isSessionSupported('immersive-vr').catch(() => false), xr.isSessionSupported('immersive-ar').catch(() => false)]);
    return { vr, ar };
  }

  async function enter(mode = 'immersive-vr') {
    if (V.session) return;
    const session = await navigator.xr.requestSession(mode, { requiredFeatures: ['local-floor'], optionalFeatures: ['hand-tracking'] });
    V.session = session;
    V.mode = mode;
    await gl.makeXRCompatible();
    const layer = new XRWebGLLayer(session, gl, { alpha: mode === 'immersive-ar', antialias: true });
    session.updateRenderState({ baseLayer: layer, depthNear: 0.05, depthFar: 60 });
    V.ref = await session.requestReferenceSpace('local-floor');
    session.addEventListener('select', () => send({ type: clock.st && clock.st.playing ? 'pause' : 'play' }));
    session.addEventListener('end', () => {
      V.session = null;
      V.mode = null;
      saveComfort({ ...stage.S.comfort, offsetMs: V.offsetMs });
      V.onChange && V.onChange();
    });
    V.last = 0;
    V.pressed = new Set();
    session.requestAnimationFrame(xrFrame);
    V.onChange && V.onChange();
  }
  function leave() {
    if (V.session) V.session.end().catch(() => {});
  }

  function input(session, dt) {
    const c = stage.S.comfort;
    for (const src of session.inputSources) {
      const gp = src.gamepad;
      if (!gp) continue;
      const y = gp.axes[3] || 0;
      if (Math.abs(y) > 0.35) {
        if (src.handedness === 'left') c.height = Math.max(0.5, Math.min(1.9, c.height - y * dt * 0.4));
        else c.dist = Math.max(0.5, Math.min(2.6, c.dist + y * dt * 0.8));
      }
      // B or Y: leave
      const b = gp.buttons[5];
      const key = `${src.handedness}5`;
      if (b && b.pressed && !V.pressed.has(key)) {
        V.pressed.add(key);
        leave();
      } else if (b && !b.pressed) V.pressed.delete(key);
    }
  }

  function xrFrame(time, frame) {
    const session = frame.session;
    if (!V.session) return;
    session.requestAnimationFrame(xrFrame);
    const dt = V.last ? Math.min(0.1, (time - V.last) / 1000) : 0;
    V.last = time;
    input(session, dt);
    const pose = frame.getViewerPose(V.ref);
    const layer = session.renderState.baseLayer;
    gl.bindFramebuffer(gl.FRAMEBUFFER, layer.framebuffer);
    const ar = V.mode === 'immersive-ar';
    gl.clearColor(0.04, 0.04, 0.05, ar ? 0 : 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    if (!pose) return;
    const t = songTime();
    stage.build(t, performance.now(), dt);
    const pi = panelInfo(t);
    for (const view of pose.views) {
      const vp = layer.getViewport(view);
      gl.viewport(vp.x, vp.y, vp.width, vp.height);
      stage.drawView(mul(view.projectionMatrix, view.transform.inverse.matrix), { ar, panelInfo: pi });
    }
  }

  return {
    V,
    stage,
    setChart,
    judged,
    setVenue: (url) => stage.setVenue(url),
    setOffset: (ms) => (V.offsetMs = ms),
    rewind: (t) => V.results && V.results.rewind(t),
    supported,
    enter,
    leave,
    get inXR() {
      return !!V.session;
    },
  };
}
