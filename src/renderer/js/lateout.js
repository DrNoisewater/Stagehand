/*
 * 4.18: outputs that play your guitar late whatever Stagehand does.
 * A friend heard a big delay playing through his TV. Stagehand already plays
 * through Windows' fast mode (as quick as ASIO4ALL is for Rocksmith), but a TV
 * works on the sound before playing it, and Bluetooth is always late.
 * Setup checks the same thing with the device's real type; here only the name
 * is known, so this goes by the words Windows puts in it.
 */

const BT = ['bluetooth', 'hands-free', 'handsfree', 'airpods', 'buds'];
const TV = [
  'hdmi', 'displayport', 'television', 'display audio', // Intel(R) Display Audio
  'nvidia high definition audio', 'amd high definition audio', // the graphics card's HDMI sound
  'nvidia virtual audio',
];
const TV_BRANDS = /\b(tv|lg|samsung|sony|vizio|tcl|hisense|philips|panasonic|sharp|insignia|roku)\b/;

/** 'tv', 'bluetooth' or '' for an output's name as Windows shows it. */
export function lateKind(name) {
  const n = String(name || '').toLowerCase();
  if (!n) return '';
  if (BT.some((w) => n.includes(w))) return 'bluetooth';
  if (TV.some((w) => n.includes(w))) return 'tv';
  // "LG TV", "SAMSUNG (…)": the part before the brackets is the screen's own name
  const own = n.split(' (')[0];
  if (/\btv\b/.test(own) || (TV_BRANDS.test(own) && !/speaker|headphone|headset|soundbar|realtek/.test(own))) return 'tv';
  return '';
}

/** A short warning for the rig panel, or ''. */
export function lateWarning(name) {
  const kind = lateKind(name);
  const full = String(name || '');
  let short = full.split(' (')[0] || 'your output';
  // "Headphones (Galaxy Buds2 Pro)": the brackets say which ones
  const inner = (full.match(/\(([^)]*)\)/) || [])[1];
  if (inner && /^(headphones|headset|speakers|earphones)$/i.test(short)) short = inner;
  if (kind === 'tv') return `Your sound goes to ${short}, a TV or screen, so your guitar comes out late. Turn on the TV’s Game Mode, or plug speakers or headphones into the PC.`;
  if (kind === 'bluetooth') return `${short} is Bluetooth, so your guitar comes out late. Play with wired headphones or speakers.`;
  return '';
}
