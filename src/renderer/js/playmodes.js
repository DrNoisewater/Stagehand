/**
 * 4.23: the ways to play a song (Lead, Rhythm, Bass, Sing & play, Karaoke) as one strip of buttons,
 * used on every song row and in the song's panel. Built from what the file really has.
 */
import { state, setSelection, songModes, missingParts } from './store.js';
import { icon, esc, toast, showMenu } from './ui.js';
import * as actions from './actions.js';

/**
 * 4.23: what each song can be played as, in the middle of its row: Lead, Rhythm, Bass, Sing & play and
 * Karaoke, each a button that starts it. What the file doesn't have is shown crossed out (it says why,
 * and offers to find a better version) instead of opening an empty mode. On a narrow window the
 * buttons fold into one "Play modes" button (CSS).
 */
const MODES = [
  ['lead', 'L', 'Lead', 'No lead part in this file'],
  ['rhythm', 'R', 'Rhythm', 'No rhythm part in this file'],
  ['bass', 'B', 'Bass', 'No bass part in this file'],
  ['sing', 'mic', 'Sing & play', 'No words in this file to sing'],
  ['karaoke', 'music', 'Karaoke', 'No words in this file to sing'],
  ['piano', 'piano', 'Piano', 'No part in this file to make a piano part from'],
];
function modeOk(m, k) {
  if (k === 'sing') return m.words && (m.lead || m.rhythm || m.bass);
  if (k === 'karaoke') return m.words;
  if (k === 'piano') return m.lead || m.rhythm || m.bass || m.words; // a piano part is written from the song
  return m[k];
}
export function modesHtml(s) {
  const m = songModes(s);
  const btns = MODES.map(([k, mark, label, none]) => {
    const ok = modeOk(m, k) && !m.noAudio;
    const glyph = mark.length === 1 ? `<span class="pm-l">${mark}</span>` : icon(mark);
    const why = m.noAudio ? 'Its audio wasn’t found' : none;
    return `<button type="button" class="pm pm-${k}${ok ? '' : ' none'}" data-mode="${k}" ${ok ? '' : 'aria-disabled="true" '}title="${esc(ok ? `${label}: play ${s.title}` : `${label}: ${why}. Click to find a better version`)}" aria-label="${esc(ok ? `Play ${s.title}: ${label}` : `${label} not available: ${why}`)}">${glyph}</button>`;
  }).join('');
  return `<div class="pm-row">${btns}<button type="button" class="pm-more" data-modes title="Play modes" aria-label="Play modes for ${esc(s.title)}">${icon('play')}<span>Modes</span></button></div>`;
}
/** What a mode button does: play that way, or say why not and offer a better version. */
export function runMode(id, k) {
  const s = state.songs.get(id);
  if (!s) return;
  const m = songModes(s);
  if (!modeOk(m, k) || m.noAudio) {
    const miss = missingParts(s);
    return (
      toast({
        title: `${MODES.find((x) => x[0] === k)[2]} isn’t in this file`,
        message: m.noAudio ? 'Its audio wasn’t found.' : MODES.find((x) => x[0] === k)[3] + '.',
        kind: 'info',
        actions: [{ label: 'Find a better version', onClick: () => import('./discover.js').then((d) => d.findBetter(s, miss)) }],
      })
    );
  }
  setSelection([id], { anchor: id, focus: id });
  if (k === 'karaoke') return actions.playKaraoke(id);
  if (k === 'sing') return actions.playAs(id, 'sing');
  if (k === 'piano') return actions.playAs(id, 'piano');
  return actions.playAs(id, 'guitar', k);
}
export function modesMenu(id, x, y) {
  const s = state.songs.get(id);
  if (!s) return;
  const m = songModes(s);
  (
    showMenu(x, y, [
      { heading: true, label: 'Play it as' },
      ...MODES.map(([k, mark, label]) => ({ label: modeOk(m, k) && !m.noAudio ? label : `${label} (not in this file)`, icon: mark === 'mic' ? 'mic' : mark === 'music' ? 'music' : mark === 'piano' ? 'piano' : 'guitar', onClick: () => runMode(id, k) })),
      ...(missingParts(s).length ? ['-', { label: 'Find a better version', icon: 'search', onClick: () => import('./discover.js').then((d) => d.findBetter(s, missingParts(s))) }] : []),
    ])
  );
}


/** The strip as an element, wired up (for the song's panel). */
export function modesStrip(s) {
  const el = document.createElement('div');
  el.className = 'insp-modes';
  el.innerHTML = modesHtml(s);
  el.addEventListener('click', (e) => {
    const b = e.target.closest('[data-mode]');
    if (b) return runMode(s.id, b.dataset.mode);
    const m = e.target.closest('[data-modes]');
    if (m) {
      const r = m.getBoundingClientRect();
      modesMenu(s.id, r.left, r.bottom + 4);
    }
  });
  return el;
}
