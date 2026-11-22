// 4.26: on the highway (and the tab view) the mouse pointer goes away after a few seconds
// of holding still, and comes back the moment the mouse moves. It stays put over open menus,
// dialogs and pop-ups, and while a button is held (dragging).
const IDLE_MS = 3000;
let lastMove = performance.now();
let lastXY = '';
let held = false;
let hidden = false;

const shown = (sel) => [...document.querySelectorAll(sel)].some((el) => !el.hidden && el.getClientRects().length > 0);
const onStage = () => shown('.highway, .tab-view');
const blocked = () => !!document.querySelector('.menu[role="menu"], .modal-backdrop, .popover:not([hidden])') || (document.activeElement && document.activeElement.tagName === 'SELECT');

function set(on) {
  if (on === hidden) return;
  hidden = on;
  document.documentElement.classList.toggle('cursor-idle', on);
}
function wake(e) {
  // the browser sometimes repeats a move without the mouse having moved: not a wake-up
  if (e && e.type === 'pointermove') {
    const xy = `${e.screenX},${e.screenY}`;
    if (xy === lastXY) return;
    lastXY = xy;
  }
  lastMove = performance.now();
  set(false);
}
document.addEventListener('pointermove', wake, true);
document.addEventListener('pointerdown', (e) => ((held = true), wake(e)), true);
document.addEventListener('pointerup', (e) => ((held = false), wake(e)), true);
document.addEventListener('pointercancel', () => (held = false), true);
document.addEventListener('wheel', wake, true);
window.addEventListener('blur', () => ((held = false), set(false)));
document.addEventListener('mouseleave', () => set(false));

setInterval(() => {
  if (hidden && (blocked() || !onStage())) return set(false);
  if (!hidden && !held && performance.now() - lastMove >= IDLE_MS && onStage() && !blocked()) set(true);
}, 250);

window.__cursorHide = { idle: () => hidden }; // for tests
