/**
 * 4.23: Settings › Display, and the TV safe area on the page.
 *
 * The safe area is a black border round the whole app (0–10% of the window): a TV that crops its
 * edges then shows everything, the highway and its buttons included. It's drawn by fencing the page
 * in (html[data-safe]); the window itself stays the size it is. The app's size is the window's zoom,
 * set by the main process (services/display.js). Each screen keeps its own of both.
 */
import { api } from './api.js';
import { h, icon, toast } from './ui.js';
import { lookSection } from './hwlooks-pane.js';

const root = document.documentElement;
function applySafe(safe) {
  const v = Math.max(0, Math.min(10, Number(safe) || 0));
  if (v > 0) {
    root.dataset.safe = '1';
    root.style.setProperty('--safe-x', `${v}vw`);
    root.style.setProperty('--safe-y', `${v}vh`);
  } else {
    delete root.dataset.safe;
    root.style.removeProperty('--safe-x');
    root.style.removeProperty('--safe-y');
  }
  // canvases and lists measure themselves on resize
  window.dispatchEvent(new Event('resize'));
}
if (api.on) api.on('display:changed', (d) => d && applySafe(d.safe));
if (api.app && api.app.display) api.app.display().then((d) => d && applySafe(d.safe)).catch(() => {});

const SCALES = [['auto', 'Auto'], [0.8, '80%'], [0.9, '90%'], [1, '100%'], [1.1, '110%'], [1.25, '125%'], [1.5, '150%']];

/** The calibration picture: a frame at the edge of the safe area with corner marks and arrows. */
let pattern = null;
let patternTimer = 0;
function showPattern() {
  clearTimeout(patternTimer);
  if (!pattern) {
    pattern = h('div.safe-pattern', { 'aria-hidden': 'true' }, h('i.c.tl'), h('i.c.tr'), h('i.c.bl'), h('i.c.br'), h('b', { text: 'Can you see all four corners and the whole frame? If not, make the border bigger.' }));
    document.body.append(pattern);
  }
  patternTimer = setTimeout(() => {
    pattern && pattern.remove();
    pattern = null;
  }, 4000);
}

/** A window change you can take back: it goes back by itself after 15 seconds unless kept. */
function keepOrUndo(before) {
  let left = 15;
  let done = false;
  const msg = () => `Going back in ${left} s unless you keep it.`;
  const t = toast({
    title: 'Keep this window size?',
    message: msg(),
    kind: 'info',
    timeout: 16000,
    actions: [
      { label: 'Keep it', onClick: () => (done = true) },
      { label: 'Undo', onClick: () => ((done = true), api.app.restoreWindow(before).catch(() => {})) },
    ],
  });
  const tick = setInterval(() => {
    left--;
    if (done) return clearInterval(tick);
    if (left <= 0) {
      clearInterval(tick);
      done = true;
      if (typeof t === 'function') t();
      api.app.restoreWindow(before).catch(() => {});
    }
  }, 1000);
}

export async function pane(el) {
  if (!(api.app && api.app.display)) {
    el.append(h('p', { text: 'Display settings need the Stagehand app.' }));
    return;
  }
  const draw = async () => {
    const d = await api.app.display().catch(() => null);
    el.innerHTML = '';
    if (!d) return el.append(h('p', { text: 'The screen couldn’t be read.' }));
    const c = d.current;
    const sec = (title, sub) => {
      const box = h('div.disp-sec', null, h('h3', { text: title }), sub ? h('p.disp-sub', { text: sub }) : null);
      el.append(box);
      return box;
    };
    // what Stagehand is on
    const now = sec('This screen');
    now.append(
      h('dl.disp-facts', null,
        h('dt', { text: 'Screen' }), h('dd', { text: `${c.pixelsWide} × ${c.pixelsHigh}${c.primary ? ' (main screen)' : ''}${d.displays.length > 1 ? ` · ${d.displays.length} screens` : ''}` }),
        h('dt', { text: 'Windows scale' }), h('dd', { text: `${c.scale}% (Stagehand gets ${c.width} × ${c.height})` }),
        h('dt', { text: 'Refresh' }), h('dd', { text: c.refresh ? `${Math.round(c.refresh)} Hz` : 'Unknown' }),
        h('dt', { text: 'Window' }), h('dd', { text: d.mode === 'fullscreen' ? 'Full screen' : d.mode === 'maximized' ? 'Maximized' : d.bounds ? `${d.bounds.width} × ${d.bounds.height}` : 'Windowed' }),
        h('dt', { text: 'Stagehand size' }), h('dd', { text: `${Math.round(d.zoom * 100)}%${d.scale === 'auto' ? ' (Auto)' : ''}` })
      )
    );
    // how big the app is
    const size = sec('Stagehand’s size', 'Auto is 100%, or smaller on a screen too small for Stagehand (a TV at a big Windows scale). Bigger makes everything easier to read from the sofa.');
    const seg = h('div.disp-seg', { role: 'group', 'aria-label': 'Stagehand’s size' });
    for (const [v, label] of SCALES) {
      const on = d.scale === v || (v !== 'auto' && d.scale !== 'auto' && Math.abs(d.scale - v) < 0.001);
      const b = h('button', { type: 'button', text: label, 'aria-pressed': String(!!on) });
      b.onclick = async () => {
        await api.app.setDisplay({ scale: v });
        draw();
      };
      seg.append(b);
    }
    size.append(seg);
    // TV safe area
    const safe = sec('TV safe area', 'If the edges are cut off on a TV, add a border. A picture shows where the edges will be.');
    const val = h('output', { text: `${d.safe}%` });
    const range = h('input', { type: 'range', min: '0', max: '10', step: '0.5', value: String(d.safe), 'aria-label': 'TV safe area' });
    let t = 0;
    range.oninput = () => {
      val.textContent = `${range.value}%`;
      clearTimeout(t);
      t = setTimeout(async () => {
        await api.app.setDisplay({ safe: Number(range.value) });
        showPattern();
      }, 120);
    };
    const test = h('button.btn.soft', { type: 'button', text: 'Show the picture' });
    test.onclick = () => showPattern();
    safe.append(h('div.disp-range', null, range, val, test));
    safe.append(
      h('p.disp-sub', {
        html: 'On a Roku TV, first try the TV’s own setting: <b>Settings › TV picture settings › Picture size</b> set to <b>Direct</b> (or <i>Fit</i>/<i>Just scan</i> on other TVs). That shows the whole picture with no border needed. Windows’ own scale is in <b>Windows Settings › System › Display</b>.',
      })
    );
    // the window
    const w = sec('Window', 'A size, windowed or full screen. Changes go back by themselves after 15 seconds unless you keep them.');
    const modes = h('div.disp-seg', { role: 'group', 'aria-label': 'Window' });
    for (const [m, label] of [['windowed', 'Windowed'], ['maximized', 'Maximized'], ['fullscreen', 'Full screen']]) {
      const b = h('button', { type: 'button', text: label, 'aria-pressed': String(d.mode === m) });
      b.onclick = async () => {
        const r = await api.app.displayWindow({ mode: m }).catch(() => null);
        if (r) keepOrUndo(r.before);
        setTimeout(draw, 400);
      };
      modes.append(b);
    }
    w.append(modes);
    if (d.sizes.length) {
      const sizes = h('div.disp-seg', { role: 'group', 'aria-label': 'Window size' });
      for (const s of d.sizes) {
        const b = h('button', { type: 'button', text: `${s.width} × ${s.height}` });
        b.onclick = async () => {
          const r = await api.app.displayWindow({ mode: 'windowed', width: s.width, height: s.height }).catch(() => null);
          if (r) keepOrUndo(r.before);
          setTimeout(draw, 400);
        };
        sizes.append(b);
      }
      w.append(sizes);
    }
    // 4.24: the flicker fix (needs a restart)
    if (api.app.flickerFix) {
      const fx = sec('Screen flicker fix', 'If the screen flashes or flickers (above all when a menu opens over the highway or a moving background), try Fewer layers first. It takes effect when Stagehand restarts.');
      const fseg = h('div.disp-seg', { role: 'group', 'aria-label': 'Screen flicker fix' });
      const cur = d.flickerFix || 'off';
      for (const [v, label, tip] of [
        ['off', 'Off', 'How Stagehand has always drawn'],
        ['layers', 'Fewer layers', 'Windows draws Stagehand as one picture; the graphics card still does the work'],
        ['basic', 'No graphics card', 'A last test: everything drawn without the graphics card (slower; moving backgrounds may stutter)'],
      ]) {
        const b = h('button', { type: 'button', text: label, title: tip, 'aria-pressed': String(cur === v) });
        b.onclick = async () => {
          await api.app.flickerFix(v).catch(() => null);
          draw();
        };
        fseg.append(b);
      }
      fx.append(fseg);
      if ((d.flickerFix || 'off') !== (d.flickerRunning || 'off')) {
        const rs = h('button.btn.primary', { type: 'button', text: 'Restart Stagehand now' });
        rs.onclick = () => api.app.restartApp().catch(() => {});
        fx.append(h('div.disp-range', null, h('span.disp-sub', { text: 'Restart to use it.' }), rs));
      }
    }
    // 4.30: the highway's look and graphics (the same block as in the highway's Sound & settings)
    const hl = sec('Highway look and graphics', 'How the note highway looks and how hard your PC works to draw it. Looks change colours and light only: every note, string, fret and label stays exactly where it is.');
    hl.append(lookSection({ compact: false }));
    const reset = h('button.btn', { type: 'button', html: `${icon('repeat')}<span>Reset this screen</span>` });
    reset.onclick = async () => {
      await api.app.resetDisplay();
      draw();
    };
    el.append(h('div.disp-foot', null, reset, h('span.disp-sub', { text: 'Each screen keeps its own size and border: a TV and your desk screen can differ.' })));
  };
  await draw();
}
