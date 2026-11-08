/**
 * Practice speed: the numbers behind the speed control and the repeat's
 * "Speed up each time". No page parts here, so it can be tested on its own
 * (test/speed.test.mjs).
 */
export const MIN_SPEED = 0.25;
export const MAX_SPEED = 1.5;
export const STEP = 0.05;
/** The quick picks in the speed control. */
export const PICKS = [0.5, 0.6, 0.75, 0.9, 1, 1.1, 1.25, 1.5];
/** Where "Speed up each time" can stop. */
export const GOALS = [0.8, 0.9, 1, 1.1, 1.25, 1.5];

const r2 = (x) => Math.round(x * 100) / 100;

export function clampSpeed(s) {
  const v = Number(s);
  return r2(Math.max(MIN_SPEED, Math.min(MAX_SPEED, Number.isFinite(v) ? v : 1)));
}

/** One 5% step up (dir 1) or down (-1). Off the 5% grid, the first step lands on it. */
export function stepSpeed(s, dir) {
  const g = Math.round(s / STEP);
  const on = Math.abs(g * STEP - s) < 0.004;
  const next = on ? g + Math.sign(dir) : dir > 0 ? Math.ceil(s / STEP) : Math.floor(s / STEP);
  return clampSpeed(next * STEP);
}

export const pct = (s) => `${Math.round(s * 100)}%`;

/** 'slow', 'fast', or '' at 100%. */
export function speedKind(s) {
  return s < 0.995 ? 'slow' : s > 1.005 ? 'fast' : '';
}

export function speedWords(s) {
  const k = speedKind(s);
  return k === 'slow' ? 'Slower, same pitch' : k === 'fast' ? 'Faster, same pitch' : 'Full speed';
}

/** Speed up each time: where it starts. Already at (or past) the goal, it starts 25% below it. */
export function trainerStart(cur, goal) {
  return cur < goal - 0.001 ? clampSpeed(cur) : clampSpeed(Math.max(0.5, goal - 0.25));
}

/** Speed up each time: the speed for the next pass (5% up, never past the goal). */
export function trainerNext(cur, goal, step = STEP) {
  if (cur >= goal - 0.001) return clampSpeed(cur);
  return clampSpeed(Math.min(goal, r2(cur + step)));
}

/**
 * Has the song gone round the repeat (from near its end back to near its start)?
 * Times in song seconds; a jump back by hand from the middle doesn't count.
 */
export function wrapped(prev, now, loop) {
  if (!loop || !Number.isFinite(prev) || !Number.isFinite(now)) return false;
  const len = loop.end - loop.start;
  if (len <= 0) return false;
  const edge = Math.min(0.6, len * 0.4);
  return now < prev - len * 0.5 && prev > loop.end - edge && now < loop.start + edge;
}
