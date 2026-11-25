/**
 * The Loop switcher (an A/B box): the guitar goes in, two loops come out, and a footswitch picks
 * loop A or loop B. Any pedal, amp or cabinet can sit in loop A or loop B (its `loop` field);
 * gear in neither loop is shared and always plays.
 *
 * The switcher itself is never sent to the sound engine, and neither is the loop that isn't
 * playing (two amps in one chain would run in series). Switching is a normal tone change: the
 * other loop is built ahead, so the jump is a clean crossfade (echoes and reverb of the loop you
 * left stop, they don't carry over).
 *
 * Which loop is playing is live, never saved in the tone (it must not count as an edit).
 *
 * User: "A pedal that is an A/B box: two loops, one footswitch."
 */

export const LOOP_KEY = 'Util_LoopSwitch';
export const LOOP_NAME = 'Loop switcher';
export const LOOP_WHAT = 'Two loops, one footswitch: build two sounds on one board and jump between them.';
export const LOOP_INFO = { n: LOOP_NAME, t: 'pedal', c: 'Utility', k: [] };

const isSwitch = (g) => !!g && g.key === LOOP_KEY;

/** True when the tone has a Loop switcher that is on (a bypassed one doesn't count). */
export function hasLoopSwitch(tone) {
  return !!tone && (tone.gear || []).some((g) => isSwitch(g) && !g.bypass);
}

/** True when the tone has a Loop switcher at all, on or bypassed. */
export function hasLoopSwitchGear(tone) {
  return !!tone && (tone.gear || []).some(isSwitch);
}

/** 'A', 'B' or '' (both: shared, always plays). */
export const loopOf = (g) => (g && (g.loop === 'A' || g.loop === 'B') ? g.loop : '');

/**
 * What actually plays on one side: the tone without the switcher and without the other loop's gear.
 * A tone with no switcher is returned as it is (stray `loop` tags are ignored).
 * A bypassed switcher is a box that is switched off: the signal stays on loop A, so side B is
 * never heard and A plays (shared gear plus loop A gear).
 */
export function loopView(tone, side = 'A') {
  if (!tone || !hasLoopSwitchGear(tone)) return tone;
  const want = hasLoopSwitch(tone) && side === 'B' ? 'B' : 'A';
  const gear = (tone.gear || []).filter((g) => g && !isSwitch(g) && (!loopOf(g) || loopOf(g) === want));
  return { ...tone, gear };
}

/** The tone's key for remembering its loop side. */
export const toneWho = (tone) => String((tone && (tone.id || tone.name)) || '');

const LS = 'stagehand.loopSides';
export function loadSides() {
  try {
    const o = JSON.parse(localStorage.getItem(LS) || '{}');
    return o && typeof o === 'object' ? o : {};
  } catch (e) {
    return {};
  }
}
export function saveSides(sides) {
  try {
    localStorage.setItem(LS, JSON.stringify(sides));
  } catch (e) {}
}

// The live controls live on the rig (rig.js binds itself here), so the highway and keys can use
// these plain functions: loopSide(), toggleLoop(), setLoop('A'|'B').
let R = null;
export function bindLoopRig(rig) {
  R = rig;
}
export const loopSide = () => (R ? R.loopSide() : 'A');
export const toggleLoop = () => (R ? R.toggleLoop() : Promise.resolve(null));
export const setLoop = (side) => (R ? R.setLoop(side) : Promise.resolve(null));
export const currentHasLoopSwitch = () => (R ? R.hasLoopSwitch() : false);
