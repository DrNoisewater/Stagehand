/**
 * Repeating part of a song: one section or several in a row, at its own speed.
 *
 * - A repeat starts at the speed you were playing at. Change it while it
 *   repeats (the repeat bar's − / +, the speed control, [ and ]) and that is
 *   the repeat's speed; stop repeating and the speed goes back to what it was.
 * - "Speed up each time": each pass round the repeat is 5% faster, up to a
 *   goal (100% unless you pick another).
 *
 * Every view uses the same one (stage.js makes it). Loops set any other way
 * (the score card's Repeat it, the Riff repeater, a drag on the waveform) come
 * in through sync(), so their speed goes back afterwards too.
 */
import { trainerStart, trainerNext, wrapped } from './speed.js';

const same = (a, b) => !!a && !!b && Math.abs(a.start - b.start) < 0.01 && Math.abs(a.end - b.end) < 0.01;

export function createRepeat({ engine, setLoop, getLoop, every = 50 }) {
  const rep = new EventTarget();
  let cur = null; // the loop being repeated
  let prevSpeed = null; // the speed before it started
  let passes = 0;
  const trainer = { on: false, goal: 1, from: 1 };
  let lastT = NaN;
  let timer = null;
  const changed = () => rep.dispatchEvent(new Event('change'));

  function watch(on) {
    if (on && !timer) {
      lastT = engine.position;
      timer = setInterval(tick, every);
    } else if (!on && timer) {
      clearInterval(timer);
      timer = null;
    }
  }

  function tick() {
    if (!cur) return watch(false);
    const t = engine.position;
    if (rep.paused) return void (lastT = t); // the timing check has the player
    if (engine.playing && wrapped(lastT, t, cur)) {
      passes++;
      if (trainer.on) engine.setSpeed(trainerNext(engine.speed, trainer.goal));
      changed();
    }
    lastT = t;
  }

  // a seek by hand is not a pass
  engine.addEventListener('seek', () => (lastT = engine.position));

  /** A loop was set or cleared somewhere: take it on (or end the repeat). */
  rep.sync = (loop) => {
    if (loop && cur && same(loop, cur)) {
      cur = loop; // same range, maybe a new label
      return;
    }
    if (loop) {
      if (!cur) prevSpeed = engine.speed;
      cur = loop;
      passes = 1;
      // a new range with Speed up each time on: from its first speed again
      if (trainer.on) engine.setSpeed(trainer.from);
      watch(true);
      changed();
    } else if (cur) {
      cur = null;
      passes = 0;
      trainer.on = false;
      watch(false);
      const back = prevSpeed;
      prevSpeed = null;
      if (back !== null && Math.abs(back - engine.speed) > 0.001) engine.setSpeed(back);
      changed();
    }
  };

  /** Repeat start..end (section indexes from/to and anchor ride along for the strip). */
  rep.start = (loop) => {
    setLoop(loop);
    rep.sync(getLoop());
  };
  rep.stop = () => {
    setLoop(null);
    rep.sync(null);
  };
  /** A new song: forget the repeat without touching the speed (a new song starts at 100%). */
  rep.reset = () => {
    cur = null;
    prevSpeed = null;
    passes = 0;
    trainer.on = false;
    watch(false);
    changed();
  };

  rep.setTrainer = (on) => {
    trainer.on = !!on && !!cur;
    if (trainer.on) {
      passes = 1;
      trainer.from = trainerStart(engine.speed, trainer.goal);
      engine.setSpeed(trainer.from);
    }
    changed();
  };
  rep.setGoal = (goal) => {
    trainer.goal = goal;
    if (trainer.on && engine.speed > goal + 0.001) engine.setSpeed(goal);
    changed();
  };

  Object.defineProperties(rep, {
    loop: { get: () => cur },
    on: { get: () => !!cur },
    passes: { get: () => passes },
    trainer: { get: () => ({ ...trainer }) },
    /** The speed you'll get back when the repeat stops. */
    speedBefore: { get: () => prevSpeed },
  });
  return rep;
}
