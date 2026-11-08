/**
 * The highway's tone menu (4.1.9): what you're playing now, your keys 1–9 (the same
 * as pressing the number), this song's own tones, a quick search, and Edit this tone /
 * Create a tone. It stays up to date while open: press a number, or let the song
 * change tone, and it follows.
 *
 * User: "useless and ignores selected keys. Needs complete rework, much smarter and in
 * line with the rest of Stagehand." "…that menu is so overwhelming…"
 */
import { h, icon, closeMenu } from './ui.js';
import { rig, TONES } from './rig.js';
import { emit, on, setPage } from './store.js';
import { tonelib, bySlot, byId, activeSlot, nowPlayingTone, gelOf, SLOT_GELS, SLOT_COUNT } from './tonelib.js';
import { describeTone, groupSongTones } from './tonesongs.js';
import { normText } from './searchmatch.js';
import { gateControl } from './pedalboard.js';
import { suggestionFor } from './captures.js';
import { getRealAmp, modelLabel } from './realamps.js';

let open = null;
// a tone saved or put on a key elsewhere (the store has no way to unsubscribe, so once here)
on('tones', () => open && open.redraw());

/** Closes the tone menu if it's open. */
export function closeToneMenu() {
  if (open) open.close();
}

/**
 * Opens the menu under `anchor`. ctx:
 *   kind: 'guitar' | 'bass'
 *   songTones(): the song's { tones, base, changes } or null
 *   songToneNow(): the song's tone at this moment, or null
 *   chooseTone(id): 'song' (follow the song) or a saved / preset tone id
 *   pause(): stops the song (before Create a tone)
 */
export function openToneMenu(anchor, ctx) {
  if (open) {
    const was = open.anchor === anchor;
    open.close();
    if (was) return null; // a second click closes it
  }
  closeMenu();
  const el = h('div.tm', { role: 'dialog', 'aria-label': 'Tone' });
  let query = '';
  const kind = ctx.kind === 'bass' ? 'bass' : 'guitar';

  const pick = (fn) => () => {
    fn();
    draw();
  };

  function nowBox() {
    const np = nowPlayingTone();
    const auto = !!rig.autoSong && !!(ctx.songTones && ctx.songTones());
    const t = np.tone || {};
    const desc = t.gear ? describeTone(t) : null;
    const slot = activeSlot();
    const box = h('div.tm-now', { style: { '--gel': np.gel || '#ffb547' } });
    box.append(
      h('b.tm-n', { text: slot ? String(slot) : '·' }),
      h('div.tm-now-main', null, h('small', { text: auto ? 'Following the song' : 'Playing now' }), h('strong', { text: np.name || 'Tone' }), h('span', { text: [desc && desc.text, auto ? null : np.from].filter(Boolean).join(' · ') }))
    );
    const cap = rig.capture;
    const sug = !cap && rig.tone ? suggestionFor(rig.tone) : null;
    if (cap) box.append(h('span.real-badge', { text: 'REAL', title: `${cap.pack.title}${modelLabel(cap) ? ` · ${modelLabel(cap)}` : ''}` }));
    else if (sug) {
      const get = h('button.btn.small.ghost', { type: 'button', html: `${icon('download')}<span>Real amp</span>`, title: `Get the real ${sug.def.title}` });
      get.onclick = () => getRealAmp(sug.key, null);
      box.append(get);
    }
    return box;
  }

  function keys() {
    const grid = h('div.tm-keys', { role: 'group', 'aria-label': 'Your keys' });
    const cur = activeSlot();
    const hasSong = !!(ctx.songTones && ctx.songTones());
    const k1 = h(`button.tm-key${cur === 1 ? '.on' : ''}`, { type: 'button', style: { '--gel': SLOT_GELS[0] }, title: 'Key 1: follow the song’s own tones' });
    k1.append(h('b', { text: '1' }), h('span', { text: hasSong ? 'Song’s tones' : 'Follows the song' }));
    k1.onclick = pick(() => ctx.chooseTone('song'));
    grid.append(k1);
    for (let n = 2; n <= SLOT_COUNT; n++) {
      const t = bySlot(n);
      const b = h(`button.tm-key${t ? '' : '.vacant'}${cur === n ? '.on' : ''}`, { type: 'button', disabled: t ? null : true, style: { '--gel': t ? gelOf(t) : SLOT_GELS[n - 1] }, title: t ? `Key ${n}: ${t.name}` : `Key ${n} is empty (put a tone on it in Tones)` });
      b.append(h('b', { text: String(n) }), h('span', { text: t ? t.name : 'Empty' }));
      if (t) b.onclick = pick(() => ctx.chooseTone(t.id));
      grid.append(b);
    }
    return grid;
  }

  function songList() {
    const st = ctx.songTones && ctx.songTones();
    if (!st || !(st.tones || []).length) return null;
    const now = ctx.songToneNow ? ctx.songToneNow() : null;
    const sec = h('div.tm-sec', null, h('h4', { text: 'This song’s tones' }));
    const list = h('div.tm-list');
    const playing = rig.mode === 'song' && rig.songTone ? rig.songTone.key : null;
    for (const t of st.tones) {
      if (!t || !(t.gear || []).length) continue;
      const d = describeTone(t);
      const on = playing === t.key;
      const b = h(`button.tm-row${on ? '.on' : ''}`, { type: 'button', title: rig.autoSong ? 'Play this one all the way through (key 1 follows the song again)' : 'Play this tone' });
      b.append(h('span.tm-dot', { style: { '--gel': t.kind === 'bass' ? '#8c7bff' : '#ff6b3d' } }), h('span.tm-row-main', null, h('b', { text: t.name }), h('small', { text: d.text })), h('span.tm-hint', { text: on ? (rig.autoSong ? 'now' : 'held') : now && now.key === t.key ? 'now in the song' : '' }));
      b.onclick = pick(() => {
        rig.autoSong = false;
        rig.setSongTone(t);
      });
      list.append(b);
    }
    sec.append(list);
    return sec;
  }

  function search() {
    const sec = h('div.tm-sec.tm-search');
    const input = h('input.input.tm-find', { type: 'search', placeholder: 'Find a tone: name, amp, artist, metal…', 'aria-label': 'Find a tone', value: query });
    const res = h('div.tm-list');
    const fill = () => {
      res.innerHTML = '';
      const q = normText(query).trim();
      if (!q) return;
      const words = q.split(' ').filter(Boolean);
      const hit = (s) => {
        const hay = ` ${normText(s)}`;
        return words.every((w) => hay.includes(` ${w}`) || (w.length >= 4 && hay.includes(w)));
      };
      const out = [];
      for (const t of tonelib.list || []) if (hit(`${t.name} ${describeTone(t).text} ${t.from && t.from.song ? t.from.song : ''} mine`)) out.push({ name: t.name, sub: `${t.slot ? `Key ${t.slot} · ` : ''}${describeTone(t).text}`, gel: gelOf(t), go: () => ctx.chooseTone(t.id) });
      for (const t of TONES) if (hit(`${t.name} ${t.desc} ${describeTone(t).text} preset`)) out.push({ name: t.name, sub: `Preset · ${t.desc}`, gel: t.kind === 'bass' ? '#8c7bff' : '#ffb547', go: () => ctx.chooseTone(t.id) });
      if (tonelib.library) {
        const r = groupSongTones(tonelib.library, { query, kind, limit: 12 });
        for (const g of r.groups)
          for (const it of g.items) {
            const song = `${it.title}${it.artist ? ` (${it.artist})` : ''}`;
            out.push({ name: `${it.title} · ${it.tone.name}`, sub: `${it.artist ? `${it.artist} · ` : ''}${it.desc.text}`, gel: '#ff6b3d', go: () => rig.setLiveTone({ ...it.tone, name: `${it.title} · ${it.tone.name}`, from: { songId: it.songId, toneKey: it.tone.key, song }, fromLabel: `Trying a tone from ${song}`, gel: '#ff6b3d' }) });
          }
      }
      for (const o of out.slice(0, 12)) {
        const b = h('button.tm-row', { type: 'button' });
        b.append(h('span.tm-dot', { style: { '--gel': o.gel } }), h('span.tm-row-main', null, h('b', { text: o.name }), h('small', { text: o.sub })));
        b.onclick = pick(o.go);
        res.append(b);
      }
      if (!out.length) res.append(h('p.tm-fine', { text: 'Nothing matches.' }));
      else if (out.length > 12) res.append(h('p.tm-fine', { text: `${out.length - 12} more: type more to narrow it down, or look in Tones.` }));
    };
    input.oninput = () => {
      query = input.value;
      fill();
    };
    sec.append(input, res);
    fill();
    return { sec, input };
  }

  function actions() {
    const row = h('div.tm-actions');
    const np = nowPlayingTone();
    const edit = h('button.btn.small.soft', { type: 'button', html: `${icon('edit')}<span>Edit this tone</span>` });
    edit.onclick = () => {
      const t = np.tone;
      close();
      ctx.pause && ctx.pause();
      if (rig.mode === 'preset' && t && byId(t.id)) emit('tones-open', { id: t.id });
      else if (t && t.gear) emit('tones-open', { tone: { ...t, from: t.from || null } });
      setPage('tones');
    };
    const create = h('button.btn.small.soft', { type: 'button', html: `${icon('plus')}<span>Create a tone</span>` });
    create.onclick = () => {
      close();
      ctx.pause && ctx.pause();
      import('./tonewizard.js').then((w) => w.openToneWizard({ kind }));
    };
    row.append(edit, create);
    return row;
  }

  let searchEl = null;
  function draw() {
    const focused = searchEl && document.activeElement === searchEl.input;
    const caret = focused ? searchEl.input.selectionStart : null;
    el.innerHTML = '';
    el.append(nowBox(), h('h4', { text: 'Your keys' }), keys());
    const s = songList();
    if (s) el.append(s);
    searchEl = search();
    el.append(searchEl.sec, actions(), gateControl({ compact: true }));
    if (focused) {
      searchEl.input.focus({ preventScroll: true });
      searchEl.input.setSelectionRange(caret, caret);
    }
    place();
  }

  function place() {
    const r = anchor.getBoundingClientRect();
    const w = el.offsetWidth || 380;
    el.style.left = `${Math.max(8, Math.min(window.innerWidth - w - 8, r.right - w))}px`;
    el.style.top = `${Math.round(r.bottom + 6)}px`;
    el.style.maxHeight = `${Math.max(240, window.innerHeight - r.bottom - 18)}px`;
  }

  // follow the rig: keys 1–9, the song changing tone, a tone saved elsewhere
  let raf = 0;
  const redraw = () => {
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(draw);
  };
  rig.addEventListener('change', redraw);
  const outside = (e) => {
    if (!el.contains(e.target) && !anchor.contains(e.target) && !e.target.closest('.modal, .menu, .toast')) close();
  };
  // Escape: first clears the search, then closes the menu (and nothing else: the highway stays)
  const esc = (e) => {
    if (e.key !== 'Escape') return;
    e.stopPropagation();
    e.preventDefault();
    const box = el.querySelector('.tm-find');
    if (box && box.value && document.activeElement === box) {
      box.value = query = '';
      draw();
    } else close();
  };
  function close() {
    if (!open || open.el !== el) return;
    open = null;
    cancelAnimationFrame(raf);
    rig.removeEventListener('change', redraw);
    document.removeEventListener('mousedown', outside, true);
    window.removeEventListener('keydown', esc, true);
    window.removeEventListener('resize', place);
    anchor.setAttribute('aria-expanded', 'false');
    el.remove();
  }
  document.body.append(el);
  open = { el, anchor, close, redraw };
  anchor.setAttribute('aria-expanded', 'true');
  draw();
  document.addEventListener('mousedown', outside, true);
  window.addEventListener('keydown', esc, true);
  window.addEventListener('resize', place);
  return { el, close, redraw };
}

