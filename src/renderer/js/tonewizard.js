/**
 * Create tone (4.1.7): a step-by-step wizard for a new tone, with your guitar
 * live the whole way: every click is heard straight away.
 *
 *   1. Guitar or bass (what Stagehand hears plugged in)
 *   2. A starting sound (clean, crunch, metal…: an amp, its knobs and effects)
 *   3. The amp: every real amp (NAM captures from TONE3000), not only the ones
 *      your songs use, with "Get every real amp" in one go
 *   4. The cabinet: every cabinet file Stagehand has, or your own
 *   5. Dial it in: gain, bass, mid, treble, effects
 *   6. Name it and put it on a key
 *
 * User: "What about somebody who doesn't have very many songs? They'd only be
 * able to pull a few tones out. It should have all the neural networks and
 * cabinet files and a very easy setup wizard for a new tone, tied to the player
 * through the entire workflow with a Create tone button."
 */
import { api } from './api.js';
import { h, icon, esc, modal, toast } from './ui.js';
import { rig } from './rig.js';
import { loadGear, gearInfo } from './gearspec.js';
import { caps, loadCaptures, realAmpsOn, setRealAmps, packForCurated, resolveCapture } from './captures.js';
import { getRealAmp, getAllRealAmps, batch } from './realamps.js';
import { saveTone, useTone, bySlot, freeSlot, SLOT_COUNT, SLOT_GELS } from './tonelib.js';
import { rotaryKnob } from './rigui.js';
import { ampArt, cabArt, pedalArt, gearArt } from './gearart.js';

const G = (slot, key, knobs = {}, order = 0) => ({ slot, key, knobs, order });

/** Every real amp, with the Rocksmith amp it plays as and a matching modelled cabinet. */
export const AMPS = {
  guitar: [
    { pack: 'deluxe', key: 'Amp_TW22', cab: 'Cab_TW112C_57_Cone', name: 'Fender Deluxe Reverb', what: 'Sparkling clean' },
    { pack: 'tweed', key: 'Amp_GibsonGA79', cab: 'Cab_TW112C_57_Cone', name: 'Fender Tweed Deluxe', what: 'Warm, breaks up early' },
    { pack: 'ac30', key: 'Amp_AT120', cab: 'Cab_AT1121C_57_Cone', name: 'Vox AC30', what: 'Jangly, chimey' },
    { pack: 'jtm45', key: 'Amp_MarshallJTM45', cab: 'Cab_Marshall1960a_57_Cone', name: 'Marshall JTM45', what: 'Bluesy, round' },
    { pack: 'plexi', key: 'Amp_MarshallPlexi', cab: 'Cab_Marshall1960AX_57_Cone', name: 'Marshall Plexi', what: 'Classic rock' },
    { pack: 'jcm800', key: 'Amp_MarshallJCM800', cab: 'Cab_Marshall1960AX_57_Cone', name: 'Marshall JCM800', what: 'Hard rock, punk' },
    { pack: 'jvm', key: 'Amp_MarshallJVM410H', cab: 'Cab_Marshall1960AX_57_Cone', name: 'Marshall JVM410H', what: 'Modern rock' },
    { pack: 'rockerverb', key: 'Amp_OrangeAD50', cab: 'Cab_OrangePPC412_57_Cone', name: 'Orange Rockerverb', what: 'Thick, stoner, grunge' },
    { pack: '5150', key: 'Amp_HG180', cab: 'Cab_HG212C_57_Cone', name: 'Peavey 5150', what: 'High gain, lead' },
    { pack: 'rectifier', key: 'Amp_CA100', cab: 'Cab_CA412C_57_Cone', name: 'Mesa Dual Rectifier', what: 'Tight, heavy metal' },
  ],
  bass: [
    { pack: 'svt', key: 'Bass_Amp_BT600B', cab: 'Bass_Cab_AT810BC_57_Cone', name: 'Ampeg SVT', what: 'The classic: round, deep' },
    { pack: 'eden', key: 'Bass_Amp_EdenWT800', cab: 'Bass_Cab_EdenD410XST_57_Cone', name: 'Eden WT', what: 'Clear, punchy, modern' },
    { pack: 'ad200', key: 'Bass_Amp_OrangeAD200B', cab: 'Bass_Cab_OrangeOBC810_57_Cone', name: 'Orange AD200', what: 'Growl, rock' },
    { pack: 'gk800', key: 'Bass_Amp_CH600B', cab: 'Bass_Cab_CH410BC_57_Cone', name: 'Gallien-Krueger 800RB', what: 'Bright, slap, funk' },
  ],
};

/** Starting sounds: an amp, where the knobs sit (0–1) and which effects are on. */
export const STYLES = {
  guitar: [
    { id: 'clean', name: 'Clean', what: 'Pop, funk, soul, arpeggios', amp: 'deluxe', gain: 0.3, bass: 0.45, mid: 0.55, treble: 0.62, fx: { chorus: true }, reverb: 0.35 },
    { id: 'jangle', name: 'Jangly', what: 'Indie, Britpop, strummed chords', amp: 'ac30', gain: 0.35, bass: 0.45, mid: 0.55, treble: 0.6, fx: {}, reverb: 0.3 },
    { id: 'blues', name: 'Blues', what: 'Just breaking up when you dig in', amp: 'jtm45', gain: 0.55, bass: 0.5, mid: 0.6, treble: 0.55, fx: {}, reverb: 0.25 },
    { id: 'classic', name: 'Classic rock', what: 'AC/DC, Zeppelin, Hendrix', amp: 'plexi', gain: 0.65, bass: 0.5, mid: 0.6, treble: 0.55, fx: {}, reverb: 0.15 },
    { id: 'hard', name: 'Hard rock', what: 'Guns N’ Roses, punk, 80s', amp: 'jcm800', gain: 0.75, bass: 0.5, mid: 0.6, treble: 0.6, fx: { drive: true }, reverb: 0.1 },
    { id: 'modern', name: 'Modern rock', what: 'Foo Fighters, Muse, alt rock', amp: 'jvm', gain: 0.7, bass: 0.55, mid: 0.55, treble: 0.58, fx: {}, reverb: 0.12 },
    { id: 'grunge', name: 'Grunge & stoner', what: 'Nirvana, Black Sabbath, fuzz', amp: 'rockerverb', gain: 0.5, bass: 0.6, mid: 0.55, treble: 0.5, fx: { fuzz: true }, reverb: 0.1 },
    { id: 'metal', name: 'Metal', what: 'Metallica, Slipknot, tight riffs', amp: 'rectifier', gain: 0.8, bass: 0.55, mid: 0.45, treble: 0.62, fx: { gate: true, drive: true }, reverb: 0 },
    { id: 'lead', name: 'Lead', what: 'Solos: long sustain, a little echo', amp: '5150', gain: 0.85, bass: 0.5, mid: 0.6, treble: 0.55, fx: { delay: true }, reverb: 0.3 },
  ],
  bass: [
    { id: 'round', name: 'Round & clean', what: 'Motown, pop, anything', amp: 'svt', gain: 0.2, bass: 0.6, mid: 0.5, treble: 0.45, fx: {}, reverb: 0 },
    { id: 'punch', name: 'Punchy', what: 'Clear notes that cut through', amp: 'eden', gain: 0.35, bass: 0.55, mid: 0.6, treble: 0.55, fx: {}, reverb: 0 },
    { id: 'growl', name: 'Growl', what: 'Rock, punk, a bit of dirt', amp: 'ad200', gain: 0.5, bass: 0.6, mid: 0.6, treble: 0.5, fx: { drive: true }, reverb: 0 },
    { id: 'slap', name: 'Bright & slap', what: 'Funk, slap, metal bass', amp: 'gk800', gain: 0.3, bass: 0.55, mid: 0.45, treble: 0.65, fx: {}, reverb: 0 },
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

const FX = {
  guitar: [
    ['gate', 'Noise gate', 'Quiet between notes (high gain)'],
    ['drive', 'Drive pedal', 'More push into the amp'],
    ['fuzz', 'Fuzz', 'Thick, woolly'],
    ['chorus', 'Chorus', 'Shimmer and width'],
    ['delay', 'Echo', 'A soft repeat'],
  ],
  bass: [['drive', 'Bass drive', 'Grit, blended with your clean sound']],
};

/** Knob spec ([name, key, min, max, def]) on an amp for gain / bass / mid / treble. */
function ampKnob(key, what) {
  const k = (gearInfo(key) && gearInfo(key).k) || [];
  if (what === 'gain') return k.find(([n]) => /gain|pre ?amp|loudness|^vol|volume/i.test(n)) || null;
  const re = { bass: /^bass$/i, mid: /^mid(dle)?$/i, treble: /^treble$/i }[what];
  return k.find(([n]) => re.test(n)) || null;
}
const at = (spec, t) => (spec ? Math.round((spec[2] + (spec[3] - spec[2]) * t) * 10) / 10 : null);

/** The tone the wizard's choices make (what you hear, and what gets saved). */
export function buildTone(W) {
  const amp = AMPS[W.kind].find((a) => a.pack === W.amp) || AMPS[W.kind][0];
  const knobs = {};
  for (const what of ['gain', 'bass', 'mid', 'treble']) {
    const spec = ampKnob(amp.key, what);
    if (spec) knobs[spec[1]] = at(spec, W[what]);
  }
  const gear = [];
  let o = 0;
  const fx = W.fx || {};
  if (W.kind === 'bass') {
    if (fx.drive) gear.push(G('pre', 'Bass_Pedal_BassOverdrive', { Gain: 35, Tone: 45, Blend: 45 }, o++));
  } else {
    if (fx.gate) gear.push(G('pre', 'Pedal_NoiseGate', { Threshold: -62, Rate: 85 }, o++));
    if (fx.fuzz) gear.push(G('pre', 'Pedal_BuzzOne', { Gain: 70, Tone: 40 }, o++));
    if (fx.drive) gear.push(G('pre', 'Pedal_SuperDrive', { Gain: 12, Tone: 58 }, o++));
  }
  gear.push(G('amp', amp.key, knobs, o++));
  gear.push(G('cab', amp.cab, {}, o++));
  if (W.kind !== 'bass') {
    if (fx.chorus) gear.push(G('post', 'Pedal_Chorus20', { Rate: 0.8, Depth: 35, Mix: 30 }, o++));
    if (fx.delay) gear.push(G('post', 'Pedal_AnalogueDelay', { Time: 380, Feedback: 25, Mix: 22 }, o++));
  }
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

function styleOf(kind, id) {
  return STYLES[kind].find((s) => s.id === id) || STYLES[kind][0];
}

function fresh(kind) {
  const s = STYLES[kind][0];
  return { kind, style: s.id, amp: s.amp, gain: s.gain, bass: s.bass, mid: s.mid, treble: s.treble, fx: { ...s.fx }, reverb: s.reverb, cab: 'auto', ir: null, name: '', slot: freeSlot() };
}

function applyStyle(W, s) {
  Object.assign(W, { style: s.id, amp: s.amp, gain: s.gain, bass: s.bass, mid: s.mid, treble: s.treble, fx: { ...s.fx }, reverb: s.reverb });
}

const STEPS = ['Guitar or bass', 'Starting sound', 'Amp', 'Cabinet', 'Dial it in', 'Name and save'];

let open = null;

/** Opens Create tone. kind: 'guitar' | 'bass' (default: what's plugged in). */
export async function openToneWizard({ kind = null } = {}) {
  if (open) return;
  await loadGear();
  await loadCaptures().catch(() => {});
  const k = kind || (rig.instrument === 'bass' || (rig.tone && rig.tone.kind === 'bass') ? 'bass' : 'guitar');
  const W = fresh(k);
  let at = 0;
  let saved = null;
  // what you were playing through, to go back to if you leave without saving
  const before = { mode: rig.mode, toneId: rig.toneId, live: rig.liveTone ? { ...rig.liveTone } : null };

  const side = h('nav.tw-steps');
  const live = h('div.tw-live');
  const body = h('div.tw-body');
  const back = h('button.btn.ghost', { type: 'button', text: 'Back' });
  const next = h('button.btn.primary', { type: 'button', text: 'Next' });
  const m = modal({
    title: 'Create a tone',
    wide: true,
    body: h('div.tw', null, side, h('div.tw-main', null, live, body)),
    footer: [h('span.grow'), back, next],
    onClose: () => {
      open = null;
      clearInterval(meterT);
      caps.events.removeEventListener('change', onCaps);
      rig.removeEventListener('change', onRig);
      if (!saved) restore();
    },
  });
  m.el?.classList?.add('tw-modal');
  open = m;

  function restore() {
    try {
      if (before.mode === 'preset' && before.toneId) rig.setTone(before.toneId);
      else if (before.mode === 'live' && before.live) rig.setLiveTone(before.live);
      else if (before.mode === 'song') import('./song-auto.js').then((s) => s.refreshSongTone && s.refreshSongTone(true)).catch(() => {});
    } catch (_) {}
  }

  // you hear every change straight away (a short wait while you turn a knob)
  let liveT = 0;
  let liveTimer = 0;
  function hear() {
    const go = () => {
      liveT = performance.now();
      rig.setLiveTone({ ...buildTone(W), fromLabel: 'Creating a tone (not saved yet)', gel: SLOT_GELS[(W.slot || 2) - 1] });
    };
    clearTimeout(liveTimer);
    const since = performance.now() - liveT;
    if (since > 140) go();
    else liveTimer = setTimeout(go, 140 - since);
  }

  // the live strip: is your instrument heard, and how loud
  const meter = h('i');
  const liveText = h('span');
  live.append(h('span.tw-live-dot'), liveText, h('span.tw-meter', null, meter));
  function showLive() {
    const on = rig.on;
    live.classList.toggle('off', !on);
    liveText.textContent = on ? `Play your ${W.kind} while you choose: every change is live` : `Plug in your ${W.kind} to hear each choice as you make it`;
  }
  const meterT = setInterval(() => {
    const l = rig.on ? rig.levels().input : 0;
    meter.style.width = `${Math.min(100, Math.round(Math.sqrt(l) * 140))}%`;
  }, 80);
  const onRig = () => showLive();
  rig.addEventListener('change', onRig);
  const onCaps = () => (at === 2 || at === 3) && draw();
  caps.events.addEventListener('change', onCaps);

  back.onclick = () => go(at - 1);
  next.onclick = async () => {
    if (at < STEPS.length - 1) return go(at + 1);
    if (saved) return m.close();
    await save();
  };

  function go(i) {
    at = Math.max(0, Math.min(STEPS.length - 1, i));
    draw();
  }

  function draw() {
    side.innerHTML = '';
    STEPS.forEach((t, j) => {
      const b = h(`button.gs-step${j === at ? '.on' : ''}${j < at ? '.done' : ''}`, { type: 'button', html: `<i>${j < at ? icon('check') : j + 1}</i><span>${esc(t)}</span>` });
      b.onclick = () => go(j);
      side.append(b);
    });
    body.innerHTML = '';
    body.scrollTop = 0;
    showLive();
    body.append(h('div.gs-count', { text: `Step ${at + 1} of ${STEPS.length}` }), h('h3', { text: STEP_TITLE[at] }), PAGES[at]());
    back.disabled = at === 0;
    back.hidden = !!saved;
    next.textContent = saved ? 'Done' : at === STEPS.length - 1 ? 'Save tone' : 'Next';
  }

  const STEP_TITLE = ['Guitar or bass?', 'Pick a starting sound', 'Pick an amp', 'Pick a cabinet', 'Dial it in', 'Name it and put it on a key'];
  const card = (on, title, what, extra, onClick, art = '') => {
    const b = h(`button.tw-card${on ? '.on' : ''}${art ? '.has-art' : ''}`, { type: 'button', 'aria-pressed': String(!!on) }, art ? h('div.tw-art', { html: art }) : null, h('b', { text: title }), what ? h('span', { text: what }) : null, extra || null);
    b.onclick = onClick;
    return b;
  };
  const p = (text) => h('p', { text });
  /** Your rig so far, as pictures: pedals → amp → cabinet → rack. */
  const rigRow = () => {
    const t = buildTone(W);
    const row = h('div.tw-rig', { 'aria-label': 'Your rig' });
    const order = { pre: 0, amp: 1, cab: 2, post: 3, rack: 4 };
    const gear = [...t.gear].sort((a, b) => order[a.slot] - order[b.slot] || a.order - b.order);
    gear.forEach((g, i) => {
      const art = g.slot === 'cab' ? cabArt(W.ir ? g.key : W.cab !== 'auto' ? W.cab : g.key) : gearArt(g);
      row.append(h(`div.tw-rig-item.${g.slot}`, { html: art }));
      if (i < gear.length - 1) row.append(h('i.tw-cable'));
    });
    return row;
  };

  const PAGES = [
    // 1 guitar or bass
    () =>
      h(
        'div',
        null,
        p('Stagehand makes the tone for what you play. It guessed from what’s plugged in; change it if it’s wrong.'),
        h(
          'div.tw-grid.two',
          null,
          ...['guitar', 'bass'].map((kd) =>
            card(W.kind === kd, kd === 'guitar' ? 'Guitar' : 'Bass', kd === 'guitar' ? '6 strings: amps from sparkling clean to metal' : '4 strings: amps from round and deep to growl', null, () => {
              if (W.kind !== kd) Object.assign(W, fresh(kd));
              hear();
              go(1);
            })
          )
        ),
        h('p.fine', { text: 'Each step changes the sound straight away, so keep playing. Nothing is saved until the last step.' })
      ),
    // 2 starting sound
    () => {
      const grid = h('div.tw-grid');
      for (const s of STYLES[W.kind]) {
        const a = AMPS[W.kind].find((x) => x.pack === s.amp);
        grid.append(
          card(W.style === s.id, s.name, s.what, h('small', { text: a ? a.name : '' }), () => {
            applyStyle(W, s);
            hear();
            draw();
          }, a ? ampArt(a.key) : '')
        );
      }
      return h('div', null, p('Click one and play: you hear it right away. You can change everything after this.'), grid);
    },
    // 3 amp
    () => {
      const box = h('div');
      box.append(p('Every real amp Stagehand knows, for any song, whether or not your songs use it. Real amps are recordings of the actual amp (neural captures); until you get one, Stagehand plays its own model of that amp.'));
      const list = AMPS[W.kind];
      const missing = list.filter((a) => !packForCurated(a.pack) && caps.st.map.packs[a.pack]);
      const head = h('div.tw-amphead');
      if (!realAmpsOn()) {
        const on = h('button.btn.primary', { type: 'button', text: 'Turn real amps on' });
        on.onclick = () => {
          setRealAmps(true);
          hear();
          draw();
        };
        head.append(h('span', { text: 'Real amps are off (Settings › Real amps).' }), on);
      } else if (batch.on) head.append(h('span', { text: `Getting real amps: ${batch.i} of ${batch.n}… confirm each one in the TONE3000 window.` }));
      else if (missing.length) {
        const all = h('button.btn.primary', { type: 'button', html: `${icon('download')}<span>Get every real ${W.kind === 'bass' ? 'bass ' : ''}amp (${missing.length})</span>` });
        all.onclick = async () => {
          await getAllRealAmps(missing.map((a) => a.pack));
          await loadCaptures().catch(() => {});
          hear();
          draw();
        };
        head.append(h('span', { text: `${list.length - missing.length} of ${list.length} real amps ready. Free, from TONE3000 (a one-time sign-in; you confirm each amp).` }), all);
      } else head.append(h('span.ok', { html: `${icon('check')}<span>Every real ${W.kind === 'bass' ? 'bass ' : ''}amp is ready</span>` }));
      box.append(head);
      const grid = h('div.tw-grid');
      for (const a of list) {
        const have = !!packForCurated(a.pack);
        const tag = h(`small.tw-tag${have ? '.real' : ''}`, { text: have ? 'Real amp' : 'Modelled', title: have ? 'Plays the recording of the real amp' : 'Stagehand’s own model of this amp, until you get the real one' });
        const foot = h('div.tw-foot', null, tag);
        const c = card(W.amp === a.pack, a.name, a.what, foot, () => {
          W.amp = a.pack;
          hear();
          draw();
        }, ampArt(a.key));
        if (!have && realAmpsOn() && caps.st.map.packs[a.pack]) {
          const get = h('span.tw-get', { role: 'button', tabindex: '0', text: 'Get the real amp' });
          get.onclick = async (e) => {
            e.stopPropagation();
            W.amp = a.pack;
            await getRealAmp(a.pack, a.key);
            await loadCaptures().catch(() => {});
            hear();
            draw();
          };
          foot.append(get);
        }
        grid.append(c);
      }
      box.append(grid);
      return box;
    },
    // 4 cabinet
    () => {
      const box = h('div');
      const full = resolveCapture(buildTone(W));
      if (full && full.fullRig) {
        box.append(p('This real amp was recorded with its own cabinet, so it already sounds like a whole amp and cabinet. Nothing to pick here.'));
        return box;
      }
      box.append(p('The cabinet is the speaker box the amp plays through. It changes the sound a lot: try a few while you play.'));
      const grid = h('div.tw-grid');
      const amp = AMPS[W.kind].find((x) => x.pack === W.amp);
      for (const [id, name, what] of CABS[W.kind]) {
        grid.append(
          card(!W.ir && W.cab === id, name, what, null, () => {
            W.cab = id;
            W.ir = null;
            hear();
            draw();
          }, cabArt(id === 'auto' ? (amp ? amp.cab : '') : id))
        );
      }
      const own = card(!!W.ir, 'Your own cabinet file', W.ir ? W.ir.split(/[\\/]/).pop() : 'A .wav impulse response (IR) you downloaded', null, async () => {
        const f = await api.dialog.pickFile({ title: 'Pick a cabinet file (impulse response .wav)', filters: [{ name: 'Impulse response', extensions: ['wav'] }] }).catch(() => null);
        if (!f) return;
        W.ir = f;
        hear();
        draw();
      });
      grid.append(own);
      box.append(grid, h('p.fine', { text: 'Free cabinet files: TONE3000 has thousands (search “IR”). Download a .wav, then pick it here.' }));
      return box;
    },
    // 5 dial it in
    () => {
      const box = h('div');
      box.append(rigRow(), p('Turn the knobs while you play (drag up and down, or use the arrow keys).'));
      const knobs = h('div.tw-knobs');
      const fmt = (v) => (Math.round(v * 100) / 10).toFixed(1);
      for (const [key, name] of [['gain', 'Gain'], ['bass', 'Bass'], ['mid', 'Mid'], ['treble', 'Treble'], ['reverb', 'Reverb']]) {
        const a = AMPS[W.kind].find((x) => x.pack === W.amp);
        if (key !== 'reverb' && a && !ampKnob(a.key, key)) continue; // some amps have no mid knob
        knobs.append(
          rotaryKnob({
            name,
            min: 0,
            max: 1,
            value: W[key],
            def: key === 'reverb' ? 0 : styleOf(W.kind, W.style)[key],
            fmt,
            step: 0.01,
            gel: key === 'gain' ? '#ff6b3d' : key === 'reverb' ? '#33c8e0' : 'var(--tungsten)',
            onInput: (v) => {
              W[key] = v;
              hear();
            },
            onChange: (v) => {
              W[key] = v;
              hear();
            },
          })
        );
      }
      box.append(knobs, h('h4', { text: 'Effects' }));
      const fx = h('div.tw-fx');
      const PEDAL_KEY = { gate: 'Pedal_NoiseGate', drive: W.kind === 'bass' ? 'Bass_Pedal_BassOverdrive' : 'Pedal_SuperDrive', fuzz: 'Pedal_BuzzOne', chorus: 'Pedal_Chorus20', delay: 'Pedal_AnalogueDelay' };
      for (const [id, name, what] of FX[W.kind]) {
        const b = h(`button.tw-switch${W.fx[id] ? '.on' : ''}`, { type: 'button', 'aria-pressed': String(!!W.fx[id]) }, h('div.tw-pedal', { html: pedalArt(PEDAL_KEY[id]) }), h('i.led'), h('b', { text: name }), h('span', { text: what }));
        b.onclick = () => {
          W.fx[id] = !W.fx[id];
          if (id === 'fuzz' && W.fx.fuzz) W.fx.drive = false;
          if (id === 'drive' && W.fx.drive) W.fx.fuzz = false;
          hear();
          draw();
        };
        fx.append(b);
      }
      box.append(fx);
      return box;
    },
    // 6 name and save
    () => {
      const box = h('div');
      if (saved) {
        box.append(
          h('div.gs-status.ok', null, h('span.gs-dot'), h('span', { text: `Saved “${saved.name}”${saved.slot ? ` on key ${saved.slot}` : ''}. You’re playing it now.` })),
          p(saved.slot ? `Press ${saved.slot} any time to switch to it, on the Jam page or while you play a song. It’s in Tones › My tones, where you can change anything later.` : 'It’s in Tones › My tones, where you can put it on a key or change anything later.')
        );
        const again = h('button.btn', { type: 'button', html: `${icon('plus')}<span>Create another</span>` });
        again.onclick = () => {
          saved = null;
          Object.assign(W, fresh(W.kind));
          hear();
          go(1);
        };
        const tones = h('button.btn', { type: 'button', html: `${icon('tones')}<span>Open in Tones</span>` });
        tones.onclick = () => {
          m.close();
          import('./store.js').then((s) => s.setPage('tones'));
        };
        box.append(h('div.gs-actions', null, again, tones));
        return box;
      }
      const s = styleOf(W.kind, W.style);
      const a = AMPS[W.kind].find((x) => x.pack === W.amp);
      if (!W.name) W.name = `My ${s.name.toLowerCase()}`;
      const name = h('input.input.tw-name', { type: 'text', value: W.name, maxlength: '60', 'aria-label': 'Tone name', spellcheck: 'false' });
      name.oninput = () => (W.name = name.value);
      box.append(rigRow(), h('label.te-field', null, h('span', { text: 'Name' }), name));
      box.append(h('p.fine', { text: `${a ? a.name : ''}${W.ir ? ' · your own cabinet' : W.cab !== 'auto' ? ` · ${(CABS[W.kind].find((c) => c[0] === W.cab) || [])[1] || ''}` : ''}${Object.keys(W.fx).filter((k) => W.fx[k]).length ? ` · ${FX[W.kind].filter(([id]) => W.fx[id]).map(([, n]) => n.toLowerCase()).join(', ')}` : ''}${W.reverb > 0.02 ? ' · reverb' : ''}` }));
      box.append(h('h4', { text: 'Put it on a key' }), p('Keys 2–9 switch tones while you play (key 1 is the song’s own tone).'));
      const keys = h('div.tw-keys');
      for (let n = 2; n <= SLOT_COUNT; n++) {
        const t = bySlot(n);
        const b = h(`button.tw-key${W.slot === n ? '.on' : ''}`, { type: 'button', 'aria-pressed': String(W.slot === n), style: { '--gel': SLOT_GELS[n - 1] } }, h('b', { text: String(n) }), h('span', { text: t ? `replaces ${t.name}` : 'empty' }));
        b.onclick = () => {
          W.slot = n;
          draw();
        };
        keys.append(b);
      }
      const none = h(`button.tw-key${W.slot ? '' : '.on'}`, { type: 'button', 'aria-pressed': String(!W.slot) }, h('b', { text: '–' }), h('span', { text: 'no key' }));
      none.onclick = () => {
        W.slot = null;
        draw();
      };
      keys.append(none);
      box.append(keys);
      setTimeout(() => name.focus(), 30);
      name.onkeydown = (e) => e.key === 'Enter' && save();
      return box;
    },
  ];

  async function save() {
    try {
      const t = await saveTone({ ...buildTone(W), name: (W.name || '').trim() || 'My tone', slot: W.slot || null });
      saved = t;
      useTone(t.id);
      toast({ title: `Saved “${t.name}”`, message: t.slot ? `On key ${t.slot}.` : 'In Tones › My tones.', kind: 'ok', timeout: 3500 });
      draw();
    } catch (err) {
      toast({ title: 'Couldn’t save the tone', message: err.message, kind: 'err' });
    }
  }

  hear();
  draw();
}

/** A "Create tone" button, for any page. */
export function createToneButton({ cls = 'btn.soft', label = 'Create tone', kind = null } = {}) {
  const b = h(`button.${cls}`, { type: 'button', html: `${icon('plus')}<span>${esc(label)}</span>`, title: 'Make a new tone step by step, hearing each choice as you play' });
  b.onclick = () => openToneWizard({ kind });
  return b;
}

