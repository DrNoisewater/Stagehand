/**
 * Keys 2–9 and your tones (4.1.9), with no page code so tests can run it.
 * Picking a tone never puts it on a key: that is its own step, which says what it
 * replaces and can be undone. Edits are a draft until you save them.
 *
 * User: "a lot of times I click a slot trying to select it, and write over it…"
 * "Lots of knobs: does it go back to default if a change isn't saved?"
 */

/** What putting tone `id` on key n would do: { tone, from, replaces, noop }. */
export function slotChange(list, id, n) {
  const tone = (list || []).find((t) => t.id === id) || null;
  const slot = n === null || n === undefined ? null : Number(n);
  const replaces = slot ? (list || []).find((t) => t.slot === slot && t.id !== id) || null : null;
  return { id, tone, slot, from: tone ? tone.slot || null : null, replaces, noop: !tone || (tone.slot || null) === slot };
}

/** The list after the change (one tone per key). */
export function applySlotChange(list, ch) {
  if (!ch || ch.noop) return list.map((t) => ({ ...t }));
  return list.map((t) => (t.id === ch.id ? { ...t, slot: ch.slot } : ch.slot && t.slot === ch.slot ? { ...t, slot: null } : { ...t }));
}

/** The list as it was before the change. */
export function undoSlotChange(list, ch) {
  if (!ch || ch.noop) return list.map((t) => ({ ...t }));
  return list.map((t) => (t.id === ch.id ? { ...t, slot: ch.from } : ch.replaces && t.id === ch.replaces.id ? { ...t, slot: ch.slot } : { ...t }));
}

/** The words for it: "Put “Thrash” on key 3? It replaces “Clean”." */
export function slotChangeText(ch) {
  if (!ch || !ch.tone) return '';
  if (!ch.slot) return `Take “${ch.tone.name}” off key ${ch.from}?`;
  return ch.replaces ? `Put “${ch.tone.name}” on key ${ch.slot}? It replaces “${ch.replaces.name}”, which stays in your tones.` : `Put “${ch.tone.name}” on key ${ch.slot}?`;
}

// "Gain" and "Amp_CA100_Gain" are the same knob (the editor writes the long name)
const knobPrint = (g) => {
  const m = new Map();
  for (const [k, v] of Object.entries(g.knobs || {})) m.set((String(k).startsWith(`${g.key}_`) ? String(k).slice(g.key.length + 1) : String(k)).toLowerCase(), Math.round(Number(v) * 1000) / 1000);
  return [...m].sort((a, b) => (a[0] < b[0] ? -1 : 1));
};
const print = (tone) =>
  JSON.stringify([
    tone && tone.kind,
    ((tone && tone.gear) || [])
      .map((g) => [g.slot, g.key, !!g.bypass, g.order || 0, knobPrint(g)])
      .sort((a, b) => (JSON.stringify(a) < JSON.stringify(b) ? -1 : 1)),
    (tone && tone.cabId) || null,
    (tone && tone.ir) || null,
    tone ? tone.autoCab !== false : true,
  ]);

/** True when the draft sounds different from the saved tone (name changes count too). */
export function isChanged(saved, draft) {
  if (!saved || !draft) return false;
  return print(saved) !== print(draft) || String(saved.name || '') !== String(draft.name || '');
}
