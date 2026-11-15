/**
 * 4.19: one way to drag a knob, used by every knob in Stagehand.
 *
 * The user: "It is not intuitive for left and right turning of the knob… you end up having your
 * mouse all over the screen, trying to go up or down and left or right."
 *
 * - Any natural direction works: up or right is more, down or left is less. The direction of the
 *   first few pixels is the one that counts for the whole drag, so a wobbly hand never fights itself.
 * - The pointer is held where it is and hidden while you drag (it comes back on the knob when you let
 *   go), so it never wanders off or runs into the edge of the screen.
 * - A small guide pops up over the knob: the value in big type, a bar from least to most, and which
 *   way is more.
 */

let guide = null;
function guideEl() {
  if (guide) return guide;
  guide = document.createElement('div');
  guide.className = 'knob-guide';
  guide.setAttribute('aria-hidden', 'true');
  guide.innerHTML = '<b class="kg-val"></b><span class="kg-bar"><i></i></span><span class="kg-ways"><em>◀ ▼ less</em><em>more ▲ ▶</em></span>';
  guide.hidden = true;
  document.body.append(guide);
  return guide;
}
/** Shows the guide over `el`: `text` is the value, `share` (0…1) how far round it is. */
export function showKnobGuide(el, text, share) {
  const g = guideEl();
  g.querySelector('.kg-val').textContent = text;
  g.querySelector('.kg-bar i').style.width = `${Math.round(Math.max(0, Math.min(1, share)) * 100)}%`;
  if (g.hidden) {
    g.hidden = false;
    const r = el.getBoundingClientRect();
    const w = 168;
    const x = Math.max(8, Math.min(window.innerWidth - w - 8, r.left + r.width / 2 - w / 2));
    const above = r.top - 74 > 8;
    g.style.left = `${Math.round(x)}px`;
    g.style.top = `${Math.round(above ? r.top - 74 : r.bottom + 10)}px`;
  }
}
export function hideKnobGuide() {
  if (guide) guide.hidden = true;
}

/**
 * Makes `el` draggable as a knob.
 * @param {HTMLElement} el
 * @param {{ start?:(e:PointerEvent)=>boolean|void, move:(pixels:number, e:PointerEvent)=>void, end:(moved:number)=>void }} on
 *   start: return false to refuse the drag; move: pixels moved towards "more" since the last call
 *   (minus is towards less); end: the drag is over (`moved` = pixels travelled; under 3 is a click)
 */
export function knobDrag(el, on) {
  el.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || el.disabled) return;
    if (on.start && on.start(e) === false) return;
    el.focus({ preventScroll: true });
    try {
      el.setPointerCapture(e.pointerId);
    } catch (_) {}
    let x = e.clientX;
    let y = e.clientY;
    let axis = null; // 'x' or 'y', once the hand has shown which way it's going
    let sx = 0;
    let sy = 0;
    let moved = 0;
    let done = false;
    let mine = false; // we asked for the pointer
    let wasHeld = false; // …and got it
    let settled = false;
    const held = () => document.pointerLockElement === el;
    // hold the pointer in place once the hand moves (a plain click never takes it; nor do test
    // robots, which move the pointer by position)
    const hold = () => {
      if (!el.requestPointerLock || navigator.webdriver) return;
      try {
        const p = el.requestPointerLock();
        mine = true;
        if (p && p.catch) p.catch(() => (mine = false));
      } catch (_) {
        mine = false;
      }
    };
    const move = (ev) => {
      let dx;
      let dy;
      if (held()) {
        // the first move after the pointer is taken can carry a jump: leave it out
        if (!wasHeld) return void (wasHeld = true);
        if (!settled) return void (settled = true);
        dx = ev.movementX || 0;
        dy = ev.movementY || 0;
        // a held pointer now and then reports one wild leap: no hand moves that far in a moment
        if (Math.abs(dx) > 150 || Math.abs(dy) > 150) return;
      } else {
        dx = ev.clientX - x;
        dy = ev.clientY - y;
        x = ev.clientX;
        y = ev.clientY;
      }
      if (!dx && !dy) return;
      moved += Math.abs(dx) + Math.abs(dy);
      if (!axis) {
        sx += dx;
        sy += dy;
        if (Math.abs(sx) < 5 && Math.abs(sy) < 5) return;
        axis = Math.abs(sx) > Math.abs(sy) ? 'x' : 'y';
        hold();
        dx = sx;
        dy = sy;
      }
      on.move(axis === 'x' ? dx : -dy, ev);
    };
    const up = () => {
      if (done) return;
      done = true;
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
      el.removeEventListener('lostpointercapture', lost);
      window.removeEventListener('blur', up);
      // let go of the pointer; if it was still being handed over, let go the moment it arrives
      if (held()) document.exitPointerLock();
      if (!mine || wasHeld) document.removeEventListener('pointerlockchange', unlocked);
      hideKnobGuide();
      on.end(moved);
    };
    // taking hold of the pointer can drop the capture: that isn't the end of the drag
    const lost = () => !held() && !mine && up();
    // Escape lets the pointer go: the drag ends there
    const unlocked = () => {
      if (done) {
        if (held()) document.exitPointerLock();
        document.removeEventListener('pointerlockchange', unlocked);
        return;
      }
      if (held()) wasHeld = true;
      else if (wasHeld) up();
      else mine = false;
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    el.addEventListener('lostpointercapture', lost);
    document.addEventListener('pointerlockchange', unlocked);
    window.addEventListener('blur', up);
    e.preventDefault();
  });
}
