import {toneToast} from './ui.js';
/**
 * Your tones: the saved list (tones.json via the main process), slots 1–9,
 * and helpers for using, saving and copying tones. The rig looks saved tones
 * up by id (rig.registerTones).
 */
import { api } from './api.js';
import { rig, TONES } from './rig.js';
import { loadGear, describe, gearName, gearInfo } from './gearspec.js';
import { emit } from './store.js';
import { slotChange } from './toneslots.js';

export const SLOT_COUNT = 9;
/** One colour per slot, from the stem gels, so a slot looks the same everywhere. */
export const SLOT_GELS = ['#33c8e0', '#ffb547', '#ff6b3d', '#ff4d8d', '#8c7bff', '#9bdb5a', '#b0b8d4', '#ff8a5c', '#5fd4c4'];
export const TYPE_GELS = { pre: '#ff4d8d', post: '#ff4d8d', amp: '#ff6b3d', cab: '#8c7bff', rack: '#33c8e0' };
export const TYPE_NAMES = { pre: 'Pedal', post: 'Pedal', amp: 'Amp', cab: 'Cabinet', rack: 'Rack' };

export const tonelib = { list: [], loaded: false, library: null, libraryLoading: null };

function register() {
  rig.registerTones(tonelib.list);
  emit('tones');
}

// ------------------------------------------------- presets before 3.2 --
// The slots were first filled with copies of these. 3.2's presets are built on
// real amps, so copies you never changed are brought up to date (yours stay).
const G = (slot, key, knobs = {}) => ({ slot, key, knobs });
const OLD_PRESETS = [
  { id: 'clean', name: 'Clean', kind: 'guitar', desc: 'Bright and open, a touch of chorus and spring', gear: [G('amp', 'Amp_TW22', { Gain: 28, Bass: 45, Mid: 55, Treble: 66 }), G('cab', 'Cab_TW112C_57_Cone'), G('post', 'Pedal_Chorus20', { Rate: 0.6, Depth: 35, Mix: 30 }), G('post', 'Pedal_SpringReverb', { Time: 55, Mix: 28 })] },
  { id: 'crunch', name: 'Crunch', kind: 'guitar', desc: 'Slightly dirty, like a cranked plexi', gear: [G('amp', 'Amp_MarshallPlexi', { 'Loudness 1': 62, 'Loudness 2': 40, Bass: 55, Mid: 70, Treble: 65, Presence: 45 }), G('cab', 'Cab_Marshall1960AX_57_Cone'), G('rack', 'Rack_StudioChamber', { Decay: 35, Mix: 18 })] },
  { id: 'overdrive', name: 'Overdrive', kind: 'guitar', desc: 'Warm, singing drive with a mid push', gear: [G('pre', 'Pedal_SuperDrive', { Gain: 45, Tone: 55 }), G('amp', 'Amp_MarshallJTM45', { 'Vol 1': 60, Bass: 50, Mid: 70, Treble: 60, Presence: 40 }), G('cab', 'Cab_Marshall1960a_57_Cone'), G('post', 'Pedal_AnalogueDelay', { Time: 380, Feedback: 25, Mix: 18 })] },
  { id: 'metal', name: 'Metal', kind: 'guitar', desc: 'Tight, heavy high gain', gear: [G('pre', 'Pedal_NoiseGate', { Threshold: -62, Rate: 85 }), G('pre', 'Pedal_SuperDrive', { Gain: 8, Tone: 60 }), G('amp', 'Amp_CA100', { Gain: 72, Bass: 62, Mid: 45, Treble: 68, Presence: 55 }), G('cab', 'Cab_CA412C_57_Cone')] },
  { id: 'fuzz', name: 'Fuzz', kind: 'guitar', desc: 'Thick, woolly fuzz for big riffs', gear: [G('pre', 'Pedal_BuzzOne', { Gain: 70, Tone: 40 }), G('amp', 'Amp_OrangeAD50', { Gain: 35, Bass: 60, Mid: 60, Treble: 55 }), G('cab', 'Cab_OrangePPC412_57_Cone')] },
  { id: 'lead', name: 'Lead', kind: 'guitar', desc: 'Smooth high gain with delay for solos', gear: [G('amp', 'Amp_MarshallJCM800', { PreAmp: 85, Bass: 55, Mid: 75, Treble: 62, Presence: 45 }), G('cab', 'Cab_Marshall1960AX_57_Cone'), G('post', 'Pedal_AnalogueDelay', { Time: 400, Feedback: 32, Mix: 28 }), G('rack', 'Rack_StudioPlate', { Decay: 50, Mix: 26 })] },
  { id: 'bass-clean', name: 'Bass clean', kind: 'bass', desc: 'Round and punchy, gently compressed', gear: [G('amp', 'Bass_Amp_BT600B', { Gain: 25, Compression: 40 }), G('cab', 'Bass_Cab_AT810BC_57_Cone')] },
  { id: 'bass-grit', name: 'Bass grit', kind: 'bass', desc: 'Growling overdrive for rock bass', gear: [G('pre', 'Bass_Pedal_BassOverdrive', { Gain: 55, Tone: 45, Blend: 55 }), G('amp', 'Bass_Amp_OrangeAD200B', { Gain: 50 }), G('cab', 'Bass_Cab_OrangeOBC810_57_Cone')] },
];

const gearPrint = (gear) =>
  JSON.stringify(
    (gear || [])
      .map((g) => [g.slot, g.key, !!g.bypass, Object.entries(g.knobs || {}).map(([k, v]) => [k, Number(v)]).sort((a, b) => (a[0] < b[0] ? -1 : 1))])
      .sort((a, b) => (a[0] + a[1] < b[0] + b[1] ? -1 : 1))
  );

async function upgradePresets(list) {
  let changed = false;
  for (const t of list) {
    const pid = t.from && t.from.preset;
    const was = pid && OLD_PRESETS.find((p) => p.id === pid);
    const now = pid && TONES.find((p) => p.id === pid);
    if (!was || !now || t.name !== was.name || gearPrint(t.gear) !== gearPrint(was.gear)) continue;
    await api.tones.save({ ...t, name: now.name, kind: now.kind, gear: now.gear });
    changed = true;
  }
  // the new preset gets an empty slot if there is one
  const chime = TONES.find((p) => p.id === 'chime');
  const free = [9, 8, 7, 6, 5, 4, 3, 2].find((n) => !list.some((t) => t.slot === n));
  if (chime && free && !list.some((t) => t.from && t.from.preset === 'chime')) {
    await api.tones.save({ name: chime.name, kind: chime.kind, gear: chime.gear, slot: free, from: { preset: 'chime' } });
    changed = true;
  }
  return changed;
}

export async function loadTones() {
  await loadGear();
  let d = await api.tones.get();
  if (!d.seeded) {
    // First run: Stagehand's presets fill slots 1–8 as your own tones.
    const seed = TONES.map((t, i) => ({ name: t.name, kind: t.kind, gear: t.gear, slot: i < SLOT_COUNT-1 ? i + 2 : null, from: { preset: t.id } }));
    d = await api.tones.seed(seed);
  } else {
    let done = false;
    try {
      done = localStorage.getItem('stagehand.presets32') === '1';
    } catch (_) {}
    if (!done) {
      try {
        if (await upgradePresets(d.tones || [])) d = await api.tones.get();
        localStorage.setItem('stagehand.presets32', '1');
      } catch (_) {}
    }
  }
  tonelib.list = d.tones || [];
  tonelib.loaded = true;
  register();
  // Older versions remembered a preset id; move to its saved copy.
  if (rig.mode === 'preset' && !tonelib.list.some((t) => t.id === rig.toneId)) {
    const copy = tonelib.list.find((t) => t.from && t.from.preset === rig.toneId) || bySlot(lastSlot()) || tonelib.list.find((t) => t.slot);
    if (copy) rig.setTone(copy.id);
  }
  return tonelib.list;
}

export function bySlot(n) {
  if(n===1)return {id:'@song-auto',slot:1,name:'Automatic Song Tone',kind:rig.tone?.kind||'guitar',gear:rig.tone?.gear||[]};
  return tonelib.list.find((t) => t.slot === n) || null;
}

export function byId(id) {
  return tonelib.list.find((t) => t.id === id) || null;
}

export function gelOf(tone) {
  if (!tone) return '#b0b8d4';
  if (tone.slot) return SLOT_GELS[tone.slot - 1];
  let h = 0;
  for (const c of String(tone.id || tone.name || '')) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return SLOT_GELS[h % SLOT_GELS.length];
}

function lastSlot() {
  try {
    return Number(localStorage.getItem('stagehand.slot')) || 1;
  } catch (_) {
    return 1;
  }
}

/** The saved tone the rig is playing now, or null (song tone, live edit). */
export function activeTone() {
  if (rig.mode !== 'preset') return null;
  return byId(rig.toneId);
}

export function activeSlot() {
  if(rig.autoSong)return 1;
  const t = activeTone();
  return t ? t.slot : null;
}

/** What the rig is playing, for headings: { name, from, gel, tone }. */
export function nowPlayingTone() {
  if (rig.mode === 'song' && rig.songTone) return { name: rig.songTone.name, from: 'The song’s own tone', gel: '#ff6b3d', tone: rig.songTone };
  if (rig.mode === 'live' && rig.liveTone) return { name: rig.liveTone.name || 'Unsaved tone', from: rig.liveTone.fromLabel || 'Trying it out (not saved)', gel: rig.liveTone.gel || '#b0b8d4', tone: rig.liveTone };
  const t = activeTone();
  if (t) {
    const src = t.from && t.from.song ? `from ${t.from.song}` : t.from && t.from.preset ? 'Stagehand preset' : 'Saved';
    return { name: t.name, from: t.slot ? `Slot ${t.slot} · ${src}` : src, gel: gelOf(t), tone: t };
  }
  const p = rig.tone;
  return { name: (p && p.name) || 'Tone', from: 'Preset', gel: '#ffb547', tone: p };
}

export function useSlot(n) {
  if (n === 1) {
    rig.autoSong = true;
    // song-auto.js answers with what the engine did (or why it couldn't follow a song)
    let done = null;
    rig.dispatchEvent(new CustomEvent('song-auto', { detail: { reply: (p) => (done = p) } }));
    emit('tones');
    toneToast(1, 'the song’s own tones', done || Promise.resolve({ ok: false, error: 'open a song first: key 1 follows its tones.' }));
    return true;
  }
  const t = bySlot(n);
  if (!t) {
    toneToast(n, 'No Tone Assigned');
    return false;
  }
  try {
    localStorage.setItem('stagehand.slot', String(n));
  } catch (_) {}
  toneToast(n, t.name, rig.setTone(t.id));
  emit('tones');
  return true;
}

export function useTone(id) {
  const t = byId(id);
  if (!t) return;
  if (t.slot) {
    try {
      localStorage.setItem('stagehand.slot', String(t.slot));
    } catch (_) {}
  }
  rig.setTone(t.id);
  emit('tones');
}

export async function saveTone(tone) {
  const saved = await api.tones.save(tone);
  const i = tonelib.list.findIndex((t) => t.id === saved.id);
  if (saved.slot) for (const t of tonelib.list) if (t.id !== saved.id && t.slot === saved.slot) t.slot = null;
  if (i >= 0) tonelib.list[i] = saved;
  else tonelib.list.push(saved);
  register();
  return saved;
}

/**
 * Puts a saved tone on key n (null = off its key). Returns { change, undo }: undo() puts
 * both tones back where they were. Never call this from a plain click on a key.
 */
export async function assignSlot(id, n) {
  const change = slotChange(tonelib.list, id, n);
  if (change.noop) return { change, undo: async () => {} };
  await saveTone({ ...change.tone, slot: change.slot });
  const undo = async () => {
    if (change.replaces) await saveTone({ ...(byId(change.replaces.id) || change.replaces), slot: change.slot });
    const t = byId(id);
    if (t) await saveTone({ ...t, slot: change.from });
  };
  return { change, undo };
}

export async function removeTone(id) {
  await api.tones.remove(id);
  tonelib.list = tonelib.list.filter((t) => t.id !== id);
  register();
}

/** First empty slot, or null. */
export function freeSlot() {
  for (let n = 2; n <= SLOT_COUNT; n++) if (!bySlot(n)) return n;
  return null;
}

/** Saves a copy of a song's tone (the song keeps its own). */
export async function saveSongTone(songTone, { song, slot = null } = {}) {
  const generic = /^(default|base|clean|tone|guitar|bass|lead|rhythm)$/i.test(String(songTone.name || '').trim());
  return saveTone({
    name: song && generic ? `${song.title} · ${songTone.name}` : songTone.name,
    kind: songTone.kind,
    gear: songTone.gear,
    slot,
    from: { songId: song ? song.id : songTone.songId || null, toneKey: songTone.key, song: song ? `${song.title}${song.artist ? ` (${song.artist})` : ''}` : songTone.songLabel || null },
  });
}

/** Every tone in every song: [{ songId, title, artist, tones }], read once and cached. */
/** Reading your songs' tones: { done, total } while it runs (first time, or new songs), else null. */
export const toneReading = { p: null };
if (typeof window !== 'undefined' && window.stagehand && window.stagehand.on)
  window.stagehand.on('tones:progress', (p) => {
    toneReading.p = p && p.total && p.done < p.total ? p : null;
    emit('tones-progress', toneReading.p);
  });

/** A progress bar in the stem-lane gel style: { el, set(done, total) }. */
export function readingBar(label = 'Reading the tones in your songs') {
  const fill = document.createElement('i');
  const count = document.createElement('span');
  count.className = 'rb-count';
  const el = document.createElement('div');
  el.className = 'read-bar';
  el.setAttribute('role', 'progressbar');
  el.innerHTML = `<div class="rb-top"><span class="eq"><i></i><i></i><i></i><i></i></span><span class="rb-label"></span></div><div class="rb-track"></div><div class="rb-note">Only the first time: after this, your tones open instantly.</div>`;
  el.querySelector('.rb-label').textContent = label;
  el.querySelector('.rb-top').append(count);
  el.querySelector('.rb-track').append(fill);
  const set = (p) => {
    const total = (p && p.total) || 0;
    const done = (p && p.done) || 0;
    const f = total ? done / total : 0;
    fill.style.width = `${Math.max(2, Math.round(f * 100))}%`;
    count.textContent = total ? `${done.toLocaleString()} of ${total.toLocaleString()} songs` : 'getting started…';
    el.setAttribute('aria-valuenow', String(Math.round(f * 100)));
    el.classList.toggle('waiting', !total);
  };
  set(toneReading.p);
  return { el, set };
}

export function songToneLibrary({ refresh = false } = {}) {
  if (tonelib.library && !refresh) return Promise.resolve(tonelib.library);
  if (!tonelib.libraryLoading || refresh)
    tonelib.libraryLoading = api.tones
      .library()
      .then((list) => {
        tonelib.library = list || [];
        tonelib.libraryLoading = null;
        emit('tones-library');
        return tonelib.library;
      })
      .catch((err) => {
        tonelib.libraryLoading = null;
        throw err;
      });
  return tonelib.libraryLoading;
}

export function chainText(tone) {
  return tone && tone.gear ? describe(tone) : '';
}

export function kindLabel(tone) {
  if (!tone) return '';
  if (tone.from && tone.from.song) return 'From a song';
  if (tone.from && tone.from.preset) return 'Preset';
  return 'Saved';
}

/** Rocksmith gear order: pedals before the amp, then post pedals, cab, racks. */
const ORDER = { pre: 0, amp: 1, post: 2, cab: 3, rack: 4 };
export function orderedGear(tone) {
  return [...((tone && tone.gear) || [])].sort((a, b) => (ORDER[a.slot] ?? 9) - (ORDER[b.slot] ?? 9) || (a.order || 0) - (b.order || 0));
}

/** Knob list for one piece of gear: [{ name, key, min, max, def, value }]. */
export function knobsOf(g) {
  const info = gearInfo(g.key);
  const given = g.knobs || {};
  const byName = {};
  for (const [k, v] of Object.entries(given)) byName[k.toLowerCase()] = v;
  return ((info && info.k) || []).map(([name, key, min, max, def]) => {
    let v = given[key];
    if (v === undefined) v = byName[name.toLowerCase()];
    if (v === undefined || !Number.isFinite(Number(v))) v = def;
    return { name, key, min, max, def, value: Number(v) };
  });
}

export function shortGearName(key) {
  return gearName(key);
}
