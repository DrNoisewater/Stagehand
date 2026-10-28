/**
 * How a play-through went, broken down (3.9): per section of the song and per
 * kind of note (single notes, chords, bends, slides, hammer-ons and pull-offs,
 * sustains), plus the longest streak. Used by the score card at the end of a
 * song on the highway, by the practice log (Progress) and its encouragement.
 */

const SECTION_NAMES = {
  intro: 'Intro', outro: 'Outro', verse: 'Verse', chorus: 'Chorus', bridge: 'Bridge', solo: 'Solo', riff: 'Riff', breakdown: 'Breakdown', prechorus: 'Pre-chorus', postchorus: 'Post-chorus', hook: 'Hook', interlude: 'Interlude', transition: 'Transition', fadein: 'Fade in', fadeout: 'Fade out', buildup: 'Build-up', modverse: 'Verse', modchorus: 'Chorus', modbridge: 'Bridge', ambient: 'Ambient', vamp: 'Vamp', head: 'Head', melody: 'Melody', tapping: 'Tapping', noguitar: 'No guitar', silence: 'Silence',
};

export function sectionLabel(s) {
  const key = String(s.name || '').toLowerCase().replace(/[^a-z]/g, '').replace(/\d+$/, '');
  const base = SECTION_NAMES[key] || (s.name ? s.name.charAt(0).toUpperCase() + s.name.slice(1) : 'Section');
  return s.n ? `${base} ${s.n}` : base;
}

const KINDS = [
  ['single', 'Single notes'],
  ['chord', 'Chords'],
  ['bend', 'Bends'],
  ['slide', 'Slides'],
  ['legato', 'Hammer-ons & pull-offs'],
  ['sustain', 'Held notes'],
];
export const KIND_LABEL = Object.fromEntries(KINDS);

function kindsOf(tg) {
  const k = [];
  const many = tg.notes.length > 1;
  k.push(many ? 'chord' : 'single');
  if (tg.notes.some((n) => n.bend || (n.bends && n.bends.length))) k.push('bend');
  if (tg.notes.some((n) => n.slideTo !== undefined || n.slideUnpitchTo !== undefined)) k.push('slide');
  if (tg.notes.some((n) => n.hammerOn || n.pullOff || n.tap)) k.push('legato');
  if ((tg.sus || 0) >= 0.5) k.push('sustain');
  return k;
}

/**
 * tab: { sections }, targets: Judge targets, judge: Judge (state Map id → {result}).
 * Only notes you've reached count (judged ones), so a stopped-early run is fair.
 */
export function breakdown(tab, targets, judge, { from = -Infinity, to = Infinity } = {}) {
  const secs = ((tab && tab.sections) || []).filter((s) => s.end > s.start);
  const bySec = secs.map((s) => ({ name: s.name, n: s.n, label: sectionLabel(s), start: s.start, end: s.end, hit: 0, notes: 0 }));
  const byKind = Object.fromEntries(KINDS.map(([k]) => [k, { hit: 0, notes: 0 }]));
  let hit = 0;
  let notes = 0;
  let streak = 0;
  let best = 0;
  for (const tg of targets || []) {
    if (tg.t < from || tg.t > to || tg.linked) continue;
    const st = judge && judge.state.get(tg.id);
    if (!st) continue;
    const ok = st.result === 'hit';
    notes++;
    if (ok) hit++;
    streak = ok ? streak + 1 : 0;
    best = Math.max(best, streak);
    const sec = bySec.find((s) => tg.t >= s.start - 0.01 && tg.t < s.end);
    if (sec) {
      sec.notes++;
      if (ok) sec.hit++;
    }
    for (const k of kindsOf(tg)) {
      byKind[k].notes++;
      if (ok) byKind[k].hit++;
    }
  }
  const acc = (x) => (x.notes ? x.hit / x.notes : null);
  const sections = bySec.filter((s) => s.notes).map((s) => ({ ...s, acc: acc(s) }));
  const kinds = KINDS.map(([k, label]) => ({ kind: k, label, ...byKind[k], acc: acc(byKind[k]) })).filter((k) => k.notes >= 3);
  // what went best and what to work on (sections with enough notes to mean something)
  const solid = sections.filter((s) => s.notes >= 4);
  const strongest = solid.length ? solid.reduce((a, b) => (b.acc > a.acc ? b : a)) : null;
  const weakest = solid.length > 1 ? solid.reduce((a, b) => (b.acc < a.acc ? b : a)) : null;
  return { hit, notes, acc: notes ? hit / notes : null, bestStreak: best, sections, kinds, strongest, weakest: weakest && strongest && weakest !== strongest && weakest.acc < 0.95 ? weakest : null };
}

/** Compact form for the practice log: [[label, hit, notes], …] and { kind: [hit, notes] }. */
export function compact(b) {
  return {
    sections: b.sections.slice(0, 60).map((s) => [s.label, s.hit, s.notes]),
    kinds: Object.fromEntries(b.kinds.map((k) => [k.kind, [k.hit, k.notes]])),
    bestStreak: b.bestStreak,
  };
}

/** A few warm, specific words about a run. */
export function cheer(b, prevBest) {
  if (!b || b.acc === null) return '';
  const pct = Math.round(b.acc * 100);
  if (prevBest !== null && prevBest !== undefined && b.acc > prevBest + 0.005) return `New best! Up ${Math.round((b.acc - prevBest) * 100)} points.`;
  if (pct >= 95) return 'Nearly flawless.';
  if (pct >= 85) return 'Really solid playing.';
  if (pct >= 70) return 'Good run. It’s coming together.';
  if (pct >= 50) return 'Halfway there. Repeat the tricky bits and it’ll click.';
  return 'Every run counts. Try a section at a slower speed.';
}
