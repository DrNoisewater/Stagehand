/**
 * Create tone's building blocks (4.1.9), with no page code so tests can run them:
 * the amps, the starting sounds, the cabinets, the pedals you can add, and the
 * tone a set of choices makes.
 *
 * The starting sounds were set by ear-shaped measurements: each one was rendered
 * through the sound engine (test/tonerecipes.test.mjs plays a riff, a lead line
 * and a chord through it) and checked for how hard it drives, how scooped or
 * pushed the mids are, and how bright it is.
 *
 * User: "I was not able to get anything anywhere near a more metal sound, like
 * the Cyanide distortion… Harvester of Sorrow… Metallica, Avenged Sevenfold,
 * Mötley Crüe, Poison lead sounds… Are we missing a pedal component?"
 */
import { gearInfo } from './gearspec.js';

export const G = (slot, key, knobs = {}, order = 0) => ({ slot, key, knobs, order });

/** Every real amp, with the Rocksmith amp it plays as and a matching modelled cabinet. */
export const AMPS = {
  guitar: [
    { pack: 'deluxe', key: 'Amp_TW22', cab: 'Cab_TW112C_57_Cone', name: 'Fender Deluxe Reverb', what: 'Sparkling clean' },
    { pack: 'tweed', key: 'Amp_GibsonGA79', cab: 'Cab_TW112C_57_Cone', name: 'Fender Tweed Deluxe', what: 'Warm, breaks up early' },
    { pack: 'ac30', key: 'Amp_AT120', cab: 'Cab_AT1121C_57_Cone', name: 'Vox AC30', what: 'Jangly, chimey' },
    { pack: 'jtm45', key: 'Amp_MarshallJTM45', cab: 'Cab_Marshall1960a_57_Cone', name: 'Marshall JTM45', what: 'Bluesy, round' },
    { pack: 'plexi', key: 'Amp_MarshallPlexi', cab: 'Cab_Marshall1960AX_57_Cone', name: 'Marshall Plexi', what: 'Classic rock' },
    { pack: 'jcm800', key: 'Amp_MarshallJCM800', cab: 'Cab_Marshall1960AX_57_Cone', name: 'Marshall JCM800', what: 'Hard rock, 80s, punk' },
    { pack: 'jvm', key: 'Amp_MarshallJVM410H', cab: 'Cab_Marshall1960AX_57_Cone', name: 'Marshall JVM410H', what: 'Modern rock' },
    { pack: 'rockerverb', key: 'Amp_OrangeAD50', cab: 'Cab_OrangePPC412_57_Cone', name: 'Orange Rockerverb', what: 'Thick, stoner, grunge' },
    { pack: '5150', key: 'Amp_HG180', cab: 'Cab_HG212C_57_Cone', name: 'Peavey 5150', what: 'High gain, modern metal, lead' },
    { pack: 'rectifier', key: 'Amp_CA100', cab: 'Cab_CA412C_57_Cone', name: 'Mesa Dual Rectifier', what: 'Tight, heavy, thrash' },
  ],
  bass: [
    { pack: 'svt', key: 'Bass_Amp_BT600B', cab: 'Bass_Cab_AT810BC_57_Cone', name: 'Ampeg SVT', what: 'The classic: round, deep' },
    { pack: 'eden', key: 'Bass_Amp_EdenWT800', cab: 'Bass_Cab_EdenD410XST_57_Cone', name: 'Eden WT', what: 'Clear, punchy, modern' },
    { pack: 'ad200', key: 'Bass_Amp_OrangeAD200B', cab: 'Bass_Cab_OrangeOBC810_57_Cone', name: 'Orange AD200', what: 'Growl, rock' },
    { pack: 'gk800', key: 'Bass_Amp_CH600B', cab: 'Bass_Cab_CH410BC_57_Cone', name: 'Gallien-Krueger 800RB', what: 'Bright, slap, funk' },
  ],
};

/**
 * The pedals you can add. knobs: [the pedal's own knob, what it's called here].
 * where: 'pre' = between guitar and amp, 'post' = after the amp (the effects loop).
 */
export const PEDALS = {
  guitar: [
    { key: 'Pedal_SuperDrive', name: 'Tube drive', what: 'Pushes the mids and tightens a big amp. The metal secret.', where: 'pre', group: 'drive', knobs: [['Gain', 'Drive'], ['Tone', 'Tone']], start: { Gain: 10, Tone: 60 } },
    { key: 'Pedal_LineDrive', name: 'Clean boost', what: 'Hits the amp harder without changing its sound', where: 'pre', group: 'drive', knobs: [['Gain', 'Boost'], ['Tone', 'Tone']], start: { Gain: 40, Tone: 50 } },
    { key: 'Pedal_MarshallGuvnorPlus', name: 'British drive', what: 'A Marshall in a box', where: 'pre', group: 'drive', knobs: [['Gain', 'Gain'], ['Bass', 'Bass'], ['Mid', 'Mid'], ['Treble', 'Treble']], start: { Gain: 45, Bass: 50, Mid: 60, Treble: 55 } },
    { key: 'Pedal_MetalDistortion', name: 'Metal distortion', what: 'Tight, scooped, saturated', where: 'pre', group: 'drive', knobs: [['Gain', 'Gain'], ['Tone', 'Tone']], start: { Gain: 60, Tone: 60 } },
    { key: 'Pedal_VintageDistortion', name: 'Vintage distortion', what: 'Raw and gritty, like a RAT', where: 'pre', group: 'drive', knobs: [['Gain', 'Gain'], ['Tone', 'Tone']], start: { Gain: 55, Tone: 55 } },
    { key: 'Pedal_ShredZone', name: 'Shred distortion', what: 'Huge gain with its own EQ', where: 'pre', group: 'drive', knobs: [['Gain', 'Gain'], ['Bass', 'Bass'], ['Mid', 'Mid'], ['Treble', 'Treble']], start: { Gain: 60, Bass: 0, Mid: 2, Treble: 0 } },
    { key: 'Pedal_BuzzOne', name: 'Fuzz', what: 'Thick and woolly, like a Big Muff', where: 'pre', group: 'drive', knobs: [['Gain', 'Fuzz'], ['Tone', 'Tone']], start: { Gain: 70, Tone: 40 } },
    { key: 'Pedal_FuzzWasHe', name: 'Vintage fuzz', what: 'Sixties fuzz, cleans up with your volume knob', where: 'pre', group: 'drive', knobs: [['Gain', 'Fuzz'], ['Tone', 'Tone']], start: { Gain: 70, Tone: 50 } },
    { key: 'Pedal_NoiseGate', name: 'Noise gate pedal', what: 'Cuts hiss hard below a set level (for tight chugs)', where: 'pre', group: 'dynamics', knobs: [['Threshold', 'Threshold'], ['Rate', 'Release']], start: { Threshold: -62, Rate: 85 } },
    { key: 'Pedal_Compression', name: 'Compressor', what: 'Evens out your picking, more sustain', where: 'pre', group: 'dynamics', knobs: [['Compression', 'Squeeze'], ['Attack', 'Attack']], start: { Compression: 50, Attack: 30 } },
    { key: 'Pedal_USWah', name: 'Auto wah', what: 'The wah opens as you pick harder', where: 'pre', group: 'filter', knobs: [['Sensitivity', 'Sensitivity'], ['Speed', 'Speed']], start: { 'Auto-Mode': 1, Sensitivity: 70, Speed: 85 } },
    { key: 'Pedal_EQ5', name: 'Graphic EQ', what: 'Scoop or push the mids (after the amp, like Metallica)', where: 'post', group: 'filter', knobs: [['63hz', 'Low'], ['250hz', 'Low mid'], ['750hz', 'Mid'], ['2.2khz', 'High mid'], ['5.7khz', 'High']], start: { '63hz': 0, '250hz': 0, '750hz': 0, '2.2khz': 0, '5.7khz': 0 } },
    { key: 'Pedal_Chorus20', name: 'Chorus', what: 'Shimmer and width', where: 'post', group: 'mod', knobs: [['Rate', 'Speed'], ['Depth', 'Depth'], ['Mix', 'Mix']], start: { Rate: 0.8, Depth: 35, Mix: 30 } },
    { key: 'Pedal_ClassicFlanger', name: 'Flanger', what: 'The jet-plane swoosh', where: 'post', group: 'mod', knobs: [['Rate', 'Speed'], ['Depth', 'Depth'], ['Mix', 'Mix']], start: { Rate: 20, Depth: 50, Mix: 45 } },
    { key: 'Pedal_Phaser', name: 'Phaser', what: 'A slow, swirling sweep', where: 'pre', group: 'mod', knobs: [['Rate', 'Speed']], start: { Rate: 25 } },
    { key: 'Pedal_Tremolo', name: 'Tremolo', what: 'The volume pulses', where: 'post', group: 'mod', knobs: [['Speed', 'Speed'], ['Mix', 'Depth']], start: { Speed: 60, Mix: 50 } },
    { key: 'Pedal_AnalogueDelay', name: 'Echo', what: 'Warm repeats, for leads', where: 'post', group: 'time', knobs: [['Time', 'Time'], ['Feedback', 'Repeats'], ['Mix', 'Mix']], start: { Time: 380, Feedback: 25, Mix: 22 } },
    { key: 'Pedal_SpringReverb', name: 'Spring reverb', what: 'The drip of an old amp', where: 'post', group: 'time', knobs: [['Time', 'Time'], ['Mix', 'Mix']], start: { Time: 50, Depth: 50, Mix: 30 } },
  ],
  bass: [
    { key: 'Bass_Pedal_BassOverdrive', name: 'Bass drive', what: 'Grit, blended with your clean low end', where: 'pre', group: 'drive', knobs: [['Gain', 'Drive'], ['Tone', 'Tone'], ['Blend', 'Blend']], start: { Gain: 35, Tone: 45, Blend: 45, Filter: 75 } },
    { key: 'Bass_Pedal_BassDistortion', name: 'Bass distortion', what: 'Heavy and aggressive', where: 'pre', group: 'drive', knobs: [['Gain', 'Gain'], ['Tone', 'Tone']], start: { Gain: 55, Tone: 35, Filter: 50 } },
    { key: 'Bass_Pedal_BassFuzz', name: 'Bass fuzz', what: 'Fat, buzzing fuzz', where: 'pre', group: 'drive', knobs: [['Gain', 'Fuzz'], ['Tone', 'Tone']], start: { Gain: 60, Tone: 25, Filter: 75 } },
    { key: 'Bass_Pedal_MBComp', name: 'Compressor', what: 'Every note the same level', where: 'pre', group: 'dynamics', knobs: [['Compression', 'Squeeze']], start: { Compression: 40, 'Recovery Speed': 40, 'Transition Band': 600 } },
    { key: 'Bass_Pedal_BassAutoFilter', name: 'Envelope filter', what: 'Funky, quacking notes', where: 'pre', group: 'filter', knobs: [['Sensitivity', 'Sensitivity'], ['Mix', 'Mix']], start: { Sensitivity: 80, Mix: 45 } },
    { key: 'Bass_Pedal_BassSubOctave', name: 'Sub octave', what: 'A second note an octave below', where: 'pre', group: 'filter', knobs: [['Mix', 'Mix'], ['Tone', 'Tone']], start: { Mix: 50, Tone: 80 } },
    { key: 'Bass_Pedal_BassChorus', name: 'Bass chorus', what: 'Wide and shimmering', where: 'post', group: 'mod', knobs: [['Rate', 'Speed'], ['Mix', 'Mix'], ['Depth', 'Depth']], start: { Rate: 1, Mix: 50, Depth: 50 } },
  ],
};

export const pedalFor = (kind, key) => (PEDALS[kind] || []).find((p) => p.key === key) || PEDALS.guitar.find((p) => p.key === key) || PEDALS.bass.find((p) => p.key === key) || null;

/** A pedal as it sits on your board: its knobs at their starting points. */
export function newPedal(kind, key, overrides = {}) {
  const p = pedalFor(kind, key);
  if (!p) return null;
  return { key, where: p.where, knobs: { ...p.start, ...overrides } };
}

const P = (key, knobs) => ({ key, knobs });

/**
 * Starting sounds: an amp, where the knobs sit (0–1), the pedals in order, and reverb.
 * pre: pedals before the amp, post: after it (the effects loop).
 */
export const STYLES = {
  guitar: [
    { id: 'clean', name: 'Clean', what: 'Pop, funk, soul, arpeggios', amp: 'deluxe', gain: 0.3, bass: 0.45, mid: 0.55, treble: 0.62, pre: [], post: [P('Pedal_Chorus20', { Rate: 0.8, Depth: 35, Mix: 30 })], reverb: 0.35 },
    { id: 'jangle', name: 'Jangly', what: 'Indie, Britpop, strummed chords', amp: 'ac30', gain: 0.35, bass: 0.45, mid: 0.55, treble: 0.6, pre: [], post: [], reverb: 0.3 },
    { id: 'blues', name: 'Blues', what: 'Just breaking up when you dig in', amp: 'jtm45', gain: 0.55, bass: 0.5, mid: 0.6, treble: 0.55, pre: [], post: [], reverb: 0.25 },
    { id: 'classic', name: 'Classic rock', what: 'AC/DC, Zeppelin, Hendrix', amp: 'plexi', gain: 0.65, bass: 0.5, mid: 0.6, treble: 0.55, pre: [], post: [], reverb: 0.15 },
    { id: 'hard', name: 'Hard rock', what: 'Guns N’ Roses, Def Leppard, punk', amp: 'jcm800', gain: 0.75, bass: 0.5, mid: 0.6, treble: 0.6, pre: [P('Pedal_SuperDrive', { Gain: 12, Tone: 58 })], post: [], reverb: 0.1 },
    { id: 'modernrock', name: 'Modern rock', what: 'Foo Fighters, Muse, alt rock', amp: 'jvm', gain: 0.7, bass: 0.55, mid: 0.55, treble: 0.58, pre: [], post: [], reverb: 0.12 },
    { id: 'grunge', name: 'Grunge & stoner', what: 'Nirvana, Black Sabbath, fuzz', amp: 'rockerverb', gain: 0.5, bass: 0.6, mid: 0.55, treble: 0.5, pre: [P('Pedal_BuzzOne', { Gain: 70, Tone: 40 })], post: [], reverb: 0.1 },
    {
      id: 'thrash',
      name: 'Thrash / 80s Metallica',
      what: 'Master of Puppets, Harvester of Sorrow: scooped and tight',
      amp: 'rectifier',
      gain: 0.9,
      bass: 0.6,
      mid: 0.4,
      treble: 0.62,
      pre: [P('Pedal_SuperDrive', { Gain: 5, Tone: 62 })],
      post: [P('Pedal_EQ5', { '63hz': 2, '250hz': 0, '750hz': -7, '2.2khz': 1, '5.7khz': 0 })],
      reverb: 0.06,
    },
    {
      id: 'modernmetal',
      name: 'Modern metal',
      what: 'Avenged Sevenfold, Trivium, Pantera: tight and punchy',
      amp: '5150',
      gain: 0.85,
      bass: 0.55,
      mid: 0.55,
      treble: 0.6,
      pre: [P('Pedal_SuperDrive', { Gain: 1, Tone: 65 })],
      post: [P('Pedal_EQ5', { '63hz': 0, '250hz': -2, '750hz': -2, '2.2khz': 2, '5.7khz': 0 })],
      reverb: 0.06,
    },
    {
      id: 'hairlead',
      name: '80s hair-metal lead',
      what: 'Mötley Crüe, Poison, Def Leppard solos: singing, with echo',
      amp: 'jcm800',
      gain: 0.9,
      bass: 0.5,
      mid: 0.72,
      treble: 0.6,
      pre: [P('Pedal_SuperDrive', { Gain: 35, Tone: 70 })],
      post: [P('Pedal_Chorus20', { Rate: 0.6, Depth: 25, Mix: 20 }), P('Pedal_AnalogueDelay', { Time: 420, Feedback: 28, Mix: 24 })],
      reverb: 0.35,
    },
    {
      id: 'shred',
      name: 'Shred lead',
      what: 'Synyster Gates, Kirk Hammett solos: fast, smooth, long sustain',
      amp: '5150',
      gain: 0.92,
      bass: 0.5,
      mid: 0.68,
      treble: 0.56,
      pre: [P('Pedal_SuperDrive', { Gain: 20, Tone: 55 })],
      post: [P('Pedal_AnalogueDelay', { Time: 450, Feedback: 30, Mix: 22 })],
      reverb: 0.3,
    },
    { id: 'metal', name: 'Heavy metal', what: 'Slipknot, Metallica’s Black Album: big and heavy', amp: 'rectifier', gain: 0.8, bass: 0.6, mid: 0.5, treble: 0.6, pre: [P('Pedal_SuperDrive', { Gain: 8, Tone: 60 })], post: [], reverb: 0.05 },
    { id: 'lead', name: 'Rock lead', what: 'Solos: long sustain, a little echo', amp: '5150', gain: 0.8, bass: 0.5, mid: 0.62, treble: 0.55, pre: [], post: [P('Pedal_AnalogueDelay', { Time: 380, Feedback: 25, Mix: 22 })], reverb: 0.3 },
  ],
  bass: [
    { id: 'round', name: 'Round & clean', what: 'Motown, pop, anything', amp: 'svt', gain: 0.2, bass: 0.6, mid: 0.5, treble: 0.45, pre: [], post: [], reverb: 0 },
    { id: 'punch', name: 'Punchy', what: 'Clear notes that cut through', amp: 'eden', gain: 0.35, bass: 0.55, mid: 0.6, treble: 0.55, pre: [P('Bass_Pedal_MBComp', { Compression: 35 })], post: [], reverb: 0 },
    { id: 'growl', name: 'Growl', what: 'Rock, punk, a bit of dirt', amp: 'ad200', gain: 0.5, bass: 0.6, mid: 0.6, treble: 0.5, pre: [P('Bass_Pedal_BassOverdrive', { Gain: 35, Tone: 45, Blend: 45 })], post: [], reverb: 0 },
    { id: 'metalbass', name: 'Metal bass', what: 'Cliff Burton, modern metal: distorted, still deep', amp: 'svt', gain: 0.45, bass: 0.6, mid: 0.55, treble: 0.6, pre: [P('Bass_Pedal_BassOverdrive', { Gain: 70, Tone: 55, Blend: 55 })], post: [], reverb: 0 },
    { id: 'slap', name: 'Bright & slap', what: 'Funk, slap, metal bass', amp: 'gk800', gain: 0.3, bass: 0.55, mid: 0.45, treble: 0.65, pre: [], post: [], reverb: 0 },
  ],
};

/** Stagehand's cabinet files (data/cabs/manifest.json), by kind. 'auto' = matched to the amp. */
export const CABS = {
  guitar: [
    ['auto', 'Matched to the amp', 'Stagehand picks the cabinet that amp usually plays through'],
    ['1x12_open', '1×12 open-back', 'Airy and open: cleans, blues'],
    ['2x12_closed', '2×12 closed-back', 'Focused: jangle, crunch'],
    ['4x12_slant', '4×12 slant', 'Big and bright: classic rock'],
    ['4x12_straight', '4×12 straight', 'Deep and tight: hard rock, metal'],
  ],
  bass: [
    ['auto', 'Matched to the amp', 'Stagehand picks the cabinet that amp usually plays through'],
    ['bass-810', 'Ampeg SVT 8×10', 'Huge and deep'],
    ['bass-410', 'EBS 4×10', 'Punchy and clear'],
    ['bass-115', 'Ampeg B15 1×15', 'Warm, old-school thump'],
    ['bass-215', 'Sunn 2×15', 'Big, loose and loud'],
    ['bass-orange', 'Orange 8×10', 'Grind and growl'],
  ],
};

/** Knob spec ([name, key, min, max, def]) on an amp for gain / bass / mid / treble. */
export function ampKnob(key, what) {
  const k = (gearInfo(key) && gearInfo(key).k) || [];
  if (what === 'gain') return k.find(([n]) => /gain|pre ?amp|loudness|^vol|volume/i.test(n)) || null;
  const re = { bass: /^bass$/i, mid: /^mid(dle)?$/i, treble: /^treble$/i }[what];
  return k.find(([n]) => re.test(n)) || null;
}
const at = (spec, t) => (spec ? Math.round((spec[2] + (spec[3] - spec[2]) * t) * 10) / 10 : null);

/** A pedal's knob spec ([name, key, min, max, def]) by the knob's name. */
export function pedalKnob(key, name) {
  const k = (gearInfo(key) && gearInfo(key).k) || [];
  return k.find(([n]) => n.toLowerCase() === String(name).toLowerCase()) || null;
}

export function styleOf(kind, id) {
  return STYLES[kind].find((s) => s.id === id) || STYLES[kind][0];
}

/** The choices for a starting sound: the amp's knobs, and its pedals in order on the board. */
export function fromStyle(kind, s) {
  const board = [...(s.pre || []).map((p) => newPedal(kind, p.key, p.knobs)), ...(s.post || []).map((p) => newPedal(kind, p.key, p.knobs))].filter(Boolean);
  return { style: s.id, amp: s.amp, gain: s.gain, bass: s.bass, mid: s.mid, treble: s.treble, board, reverb: s.reverb };
}

export function freshChoices(kind, slot = null) {
  return { kind, ...fromStyle(kind, STYLES[kind][0]), cab: 'auto', ir: null, name: '', slot };
}

/**
 * The tone the choices make (what you hear, and what gets saved). W.board holds the
 * pedals in signal order; each has where: 'pre' (before the amp) or 'post' (after it).
 */
export function buildTone(W) {
  const amp = AMPS[W.kind].find((a) => a.pack === W.amp) || AMPS[W.kind][0];
  const knobs = {};
  for (const what of ['gain', 'bass', 'mid', 'treble']) {
    const spec = ampKnob(amp.key, what);
    if (spec) knobs[spec[1]] = at(spec, W[what]);
  }
  const gear = [];
  let o = 0;
  const board = (W.board || []).filter((p) => p && p.key);
  for (const p of board) if (p.where !== 'post') gear.push({ ...G('pre', p.key, { ...p.knobs }, o++), ...(p.off ? { bypass: true } : {}) });
  gear.push(G('amp', amp.key, knobs, o++));
  gear.push(G('cab', amp.cab, {}, o++));
  for (const p of board) if (p.where === 'post') gear.push({ ...G('post', p.key, { ...p.knobs }, o++), ...(p.off ? { bypass: true } : {}) });
  if (W.reverb > 0.02) gear.push(G('rack', 'Rack_StudioPlate', { Decay: 45, Diffusion: 80, Mix: Math.round(5 + W.reverb * 55), Tone: 55 }, o++));
  return {
    name: W.name || 'My tone',
    kind: W.kind,
    gear,
    cabId: W.cab && W.cab !== 'auto' ? W.cab : null,
    ir: W.ir || null,
    autoCab: true,
    capture: null,
  };
}

/** Moves board[i] one step left (-1) or right (+1); crossing the amp moves it between before and after the amp. */
export function movePedal(board, i, dir) {
  const b = board.map((p) => ({ ...p }));
  const p = b[i];
  if (!p) return b;
  // the chain as you see it: pre pedals, the amp, post pedals
  const pre = b.filter((x) => x.where !== 'post'), post = b.filter((x) => x.where === 'post');
  const chain = [...pre, 'AMP', ...post];
  const j = chain.indexOf(p);
  const k = j + dir;
  if (k < 0 || k >= chain.length) return b;
  [chain[j], chain[k]] = [chain[k], chain[j]];
  const amp = chain.indexOf('AMP');
  return chain.filter((x) => x !== 'AMP').map((x, n) => ({ ...x, where: n < amp ? 'pre' : 'post' }));
}
