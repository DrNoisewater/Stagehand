// Record clip's sound track (4.1.2): the sound stays on the recording's clock.
// Normal uneven delivery adds nothing; a dropout is filled with silence so what comes
// after it lands at the right time; sound cut short at the end is topped up; the
// sound is never shorter than the recording.
import assert from 'node:assert';
import { createSoundTrack } from '../src/renderer/js/clip-sound.js';

const RATE = 48000;
const piece = (frames, v) => new Float32Array(frames * 2).fill(v);

function run({ seconds, gaps = [], stopAt = seconds, jitter = true }) {
  const t = createSoundTrack(RATE);
  // before recording: the start check only needs to know sound arrives
  t.feed(piece(480, 0.5), RATE, -20);
  assert.ok(t.seen, 'sound seen before recording');
  t.begin(0);
  const out = [];
  let now = 0;
  let sent = 0; // frames the engine has made so far
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  let nextFlush = 1000;
  while (now < seconds * 1000) {
    // the engine sends about every 10 ms, sometimes late in bunches (the page was busy)
    now += jitter ? 5 + rnd() * (rnd() < 0.02 ? 150 : 12) : 10;
    const due = Math.floor((now / 1000) * RATE) - 60 * 48; // ~60 ms pipeline delay
    const inGap = gaps.some(([a, b]) => now >= a * 1000 && now < b * 1000) || now > stopAt * 1000;
    if (due > sent) {
      if (!inGap) {
        // a marker: the value is the second this sound belongs to
        const frames = due - sent;
        t.feed(piece(frames, ((Math.floor(sent / RATE) % 90) + 1) / 100), RATE, now);
      }
      sent = due; // during a gap the engine's sound is lost, not delayed
    }
    if (now >= nextFlush) {
      const a = t.take(now);
      if (a) out.push(a);
      nextFlush += 1000;
    }
  }
  const a = t.take(now, { end: true });
  if (a) out.push(a);
  const all = new Int16Array(out.reduce((n, x) => n + x.length, 0));
  let o = 0;
  for (const x of out) all.set(x, o), (o += x.length);
  return { t, all, now };
}
// which second of the engine's sound is heard at time s of the recording
const near = (a, s) => a !== null && Math.min(Math.abs(a - (s % 90)), 90 - Math.abs(a - (s % 90))) <= 1;
const heard = (all, s) => {
  const v = all[Math.floor(s * RATE) * 2] / 32767;
  return v ? Math.round(v * 100 - 1) : null; // null = silence
};

{
  const { t, all, now } = run({ seconds: 240 });
  const len = all.length / 2 / RATE;
  assert.ok(Math.abs(len - now / 1000) < 0.02, `4 minutes, uneven delivery: sound is as long as the recording (${len.toFixed(3)} s vs ${(now / 1000).toFixed(3)} s)`);
  assert.ok(t.padded / RATE < 0.2, `uneven delivery adds almost no silence (${(t.padded / RATE).toFixed(3)} s, all at gaps it filled)`);
  for (const s of [10, 120, 230]) assert.ok(near(heard(all, s + 0.5), s), `in step at ${s} s (heard ${heard(all, s + 0.5)})`);
  console.log(`ok   4 min with uneven delivery: ${len.toFixed(2)} s of sound for ${(now / 1000).toFixed(2)} s of video, in step`);
}
{
  const { all, now } = run({ seconds: 60, gaps: [[20, 23]] });
  const len = all.length / 2 / RATE;
  assert.ok(Math.abs(len - now / 1000) < 0.02, `with a dropout: still as long as the recording (${len.toFixed(3)})`);
  assert.strictEqual(heard(all, 21.5), null, 'the dropout is silence');
  for (const s of [10, 30, 50]) assert.ok(near(heard(all, s + 0.5), s), `after the dropout, still in step at ${s} s (heard ${heard(all, s + 0.5)})`);
  console.log('ok   a 3 s dropout: filled with silence, everything after it stays in step');
}
{
  const { all, now } = run({ seconds: 30, stopAt: 25 });
  const len = all.length / 2 / RATE;
  assert.ok(Math.abs(len - now / 1000) < 0.02, `sound cut off 5 s before the end is topped up (${len.toFixed(3)} vs ${(now / 1000).toFixed(3)})`);
  assert.ok(near(heard(all, 20.5), 20), 'in step before it was cut off');
  console.log('ok   sound cut off before the end: topped up to the full length');
}
{
  const { all, now } = run({ seconds: 20, gaps: [[0, 6]] });
  assert.ok(Math.abs(all.length / 2 / RATE - now / 1000) < 0.02 && near(heard(all, 10.5), 10), 'sound that starts late lands at the right time');
  console.log('ok   sound arriving late at the start lands at the right time');
}
{
  const t = createSoundTrack(48000);
  t.feed(piece(441, 0.1), 44100, 0);
  assert.strictEqual(t.rate, 44100, 'takes the engine’s rate from the start check');
  console.log('ok   uses the sound engine’s rate');
}
console.log('clip-sound: all passed');
