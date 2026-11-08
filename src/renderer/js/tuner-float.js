/**
 * The tuner from anywhere (4.1.9): a Tuner entry in the main menu and the U key open a
 * small tuner window over whatever page you're on. It is the same tuner as on the Jam
 * page (follows the song's tuning). On the highway U belongs to its own mini tuner
 * (performance-tools.js), so this one stays out of the way there.
 */
import { h, icon, isTyping } from './ui.js';
import { createTuner } from './tuner.js';

let win = null;
let tuner = null;
let watch = 0;

const highwayOpen = () => !!document.querySelector('.highway:not([hidden])');

export const tunerWindowOpen = () => !!win && !win.hidden;

function build() {
  tuner = createTuner();
  const close = h('button.tn-float-x', { type: 'button', title: 'Close the tuner (U)', 'aria-label': 'Close the tuner', html: icon('x') });
  close.onclick = () => closeTunerWindow();
  win = h('div.tn-float', { role: 'dialog', 'aria-label': 'Tuner' }, tuner.el, close);
  win.hidden = true;
  document.body.append(win);
}

export function openTunerWindow() {
  if (highwayOpen()) return;
  if (!win) build();
  win.hidden = false;
  tuner.show();
  // the highway opening takes the tuner over with its own mini one: never two
  clearInterval(watch);
  watch = setInterval(() => highwayOpen() && closeTunerWindow(), 400);
}

export function closeTunerWindow() {
  clearInterval(watch);
  if (!win) return;
  win.hidden = true;
  tuner.hide();
}

/** The menu entry and U. On the highway this hands over to the highway's own tuner. */
export function toggleTunerWindow() {
  if (highwayOpen()) {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'u', bubbles: true }));
    return;
  }
  if (tunerWindowOpen()) closeTunerWindow();
  else openTunerWindow();
}

document.addEventListener('keydown', (e) => {
  if (e.key.toLowerCase() !== 'u' || e.ctrlKey || e.altKey || e.metaKey || e.shiftKey || e.repeat) return;
  if (isTyping() || highwayOpen()) return;
  e.preventDefault();
  toggleTunerWindow();
});
