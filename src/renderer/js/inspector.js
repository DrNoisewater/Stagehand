/** Right pane: song details, metadata editor (single and batch). */
import { api } from './api.js';
import { state, on, emit, selectedSongs, upsertSongs, setView, rsListIds, rsHas, rsListLabel } from './store.js';
import { h, icon, esc, fmtDuration, fmtBytes, fmtDate, toast } from './ui.js';
import * as actions from './actions.js';
import { setPage } from './store.js';

const SONG_GELS = ['#ff6b3d', '#8c7bff', '#ff4d8d', '#33c8e0', '#9bdb5a', '#ffb547'];
function gelOf(s) {
  let x = 0;
  for (const c of String(s.artist || s.title || s.id || '')) x = (x * 31 + c.charCodeAt(0)) >>> 0;
  return SONG_GELS[x % SONG_GELS.length];
}

/** The tones a song comes with (read from its parts), cached per song. */
const tonesCache = new Map();
async function songTonesOf(s) {
  const key = `${s.id}|${s.mtimeMs || 0}`;
  if (tonesCache.has(key)) return tonesCache.get(key);
  const out = [];
  const seen = new Set();
  const parts = (await api.tab.list(s.id)).filter((p) => ['lead', 'rhythm', 'combo', 'bass'].includes(p.type) && !p.bonus);
  for (const p of parts.slice(0, 3)) {
    try {
      const tab = await api.tab.load(s.id, p.id);
      for (const t of (tab.songTones && tab.songTones.tones) || []) {
        const k = `${t.kind}|${String(t.key).toLowerCase()}`;
        if (seen.has(k) || !t.gear || !t.gear.length) continue;
        seen.add(k);
        out.push(t);
      }
    } catch (_) {}
  }
  tonesCache.set(key, out);
  return out;
}

const root = document.getElementById('inspector');
const TYPE_LABEL = { lead: 'Lead', rhythm: 'Rhythm', combo: 'Combo', bass: 'Bass', vocals: 'Vocals', jvocals: 'Japanese vocals' };
const TYPE_LETTER = { lead: 'L', rhythm: 'R', combo: 'C', bass: 'B', vocals: 'V', jvocals: 'J' };

function sortable(s) {
  return String(s || '')
    .trim()
    .replace(/^the\s+/i, '')
    .trim();
}

function cover(song, size = 256) {
  const c = h('div.insp-cover');
  if (song && song.art) {
    const img = h('img', { src: api.artUrl(song, size), alt: '', draggable: 'false' });
    img.onerror = () => {
      img.remove();
      c.insertAdjacentHTML('afterbegin', icon('music'));
    };
    c.append(img);
  } else c.innerHTML = icon('music');
  return c;
}

function kv(rows) {
  const dl = h('dl.kv');
  for (const [k, v] of rows) {
    if (v === null || v === undefined || v === '') continue;
    dl.append(h('dt', { text: k }));
    const dd = h('dd');
    if (v instanceof Node) dd.append(v);
    else dd.textContent = v;
    dl.append(dd);
  }
  return dl;
}

function section(title, ...children) {
  return h('div.insp-section', null, h('h3', { text: title }), ...children);
}

// --------------------------------------------------------------- views --
function renderEmpty() {
  root.innerHTML = '';
  const total = state.songs.size;
  root.append(
    h(
      'div',
      { style: { color: 'var(--ink-3)', paddingTop: '28px', lineHeight: '1.55' } },
      h('div', { style: { color: 'var(--ink-2)', fontWeight: '600', marginBottom: '4px' }, text: total ? 'Nothing selected' : 'Details' }),
      total ? 'Select a song to see its arrangements, tunings and file details, or to edit what Rocksmith shows for it.' : 'Song details appear here once your library has songs.'
    )
  );
}

function renderOne(s) {
  root.innerHTML = '';
  const c = cover(s);
  const play = h('button.play', { type: 'button', title: 'Play', html: icon('play') });
  play.onclick = () => actions.playSong(s.id, { autoplay: true });
  c.append(play);
  const glow = h('div.insp-glow', null, c);
  glow.style.setProperty('--gel', gelOf(s));
  root.append(glow);

  root.append(h('div.insp-title', { text: s.title }));
  const artist = h('button.insp-artist', { type: 'button', text: s.artist || 'Unknown artist', title: `Show all songs by ${s.artist}` });
  artist.onclick = () => setView({ kind: 'artist', id: s.artist || '' });
  root.append(artist);
  const albumLine = h('div.insp-album');
  if (s.album) albumLine.append(h('span', { text: s.album }));
  if (s.year) albumLine.append(h('span', { text: String(s.year) }));
  root.append(albumLine);
  const along = h('button.btn.glow-primary', { type: 'button', html: `${icon('play')}<span>Play along</span>`, title: 'Play it on the note highway' });
  along.onclick = () => actions.playAlong(s.id);
  const listen = h('button.btn.soft', { type: 'button', text: 'Just listen', title: 'Play it here; the bottom bar has the controls' });
  listen.onclick = () => actions.playSong(s.id, { autoplay: true });
  root.append(h('div.insp-play', null, along, listen));

  const fav = !!(s.user && s.user.fav);
  const st = state.stems.get(s.id);
  const stemsReady = s.hasStems || (st && st.state === 'ready');
  const busy = st && (st.state === 'running' || st.state === 'queued');
  const row = h('div.insp-actions');
  const edit = h('button.btn', { type: 'button', html: `${icon('edit')}<span>Edit details</span>`, title: 'Edit details (F2)' });
  edit.onclick = () => beginEdit();
  const favBtn = h('button.btn', { type: 'button', title: fav ? 'Remove from favorites' : 'Add to favorites', 'aria-pressed': String(fav), html: icon('heart') });
  if (fav) favBtn.style.color = 'var(--tungsten)';
  favBtn.onclick = () => actions.toggleFav([s.id]);
  const stemBtn = h('button.btn', {
    type: 'button',
    'data-stem-btn': s.id,
    disabled: busy || stemsReady ? true : null,
    html: busy ? `<span class="spin"></span><span>${st.state === 'queued' ? 'Waiting' : `${Math.round((st.progress || 0) * 100)}%`}</span>` : stemsReady ? `${icon('check')}<span>Stems ready</span>` : `${icon('split')}<span>Split stems</span>`,
    title: stemsReady ? 'Stems are ready for this song' : 'Split this song into instrument stems',
  });
  stemBtn.onclick = () => actions.requestStems([s.id]);
  const more = h('button.btn', { type: 'button', title: 'More', html: icon('more') });
  more.onclick = (e) => {
    const r = more.getBoundingClientRect();
    actions.songMenu(r.left, r.bottom + 4, [s.id]);
    e.stopPropagation();
  };
  row.append(edit, stemBtn);
  root.append(row);

  // Rating
  const stars = h('span.stars', { role: 'radiogroup', 'aria-label': 'Rating' });
  const r = (s.user && s.user.rating) || 0;
  for (let i = 1; i <= 5; i++) {
    const b = h('button', { type: 'button', class: i <= r ? 'on' : '', 'aria-label': `${i} star${i > 1 ? 's' : ''}`, html: icon('star', 'fill') });
    b.style.width = '20px';
    b.onclick = () => actions.rate(s.id, r === i ? 0 : i);
    stars.append(b);
  }
  favBtn.className = 'icon-btn';
  more.className = 'icon-btn';
  root.append(h('div.insp-row2', null, stars, favBtn, more));

  // Arrangements
  const arrs = h('div.arr-list');
  for (const a of s.arrangements || []) {
    const tuning = a.tuningName ? `${a.tuningName}${a.capo ? `, capo ${a.capo}` : ''}` : '';
    const el = h('div.arr');
    el.innerHTML = `<span class="part on">${TYPE_LETTER[a.type] || '?'}</span>
      <span class="name">${esc(TYPE_LABEL[a.type] || a.name)}${a.bonus ? '<small>Bonus</small>' : !a.represent ? '<small>Alternate</small>' : ''}</span>
      <span class="tuning">${esc(tuning)}</span>`;
    const best = state.best && state.best[s.id];
    const key = a.type === 'combo' ? 'lead' : a.type;
    if (best && best[key] !== undefined && !a.bonus && a.represent !== false) {
      const pct = Math.round(best[key] * 100);
      el.querySelector('.name').append(h(`span.best-tag${pct >= 85 ? '.top' : ''}`, { text: `${pct}%`, title: 'Your best' }));
    }
    arrs.append(el);
  }
  if ((s.arrangements || []).length) root.append(section('Parts', arrs));
  // The essentials at a glance, as chips: tuning, length, tempo, plays, Rocksmith lists.
  // (Tones live on the Tones page; file details are in the ⋯ menu.)
  const chips = h('div.insp-facts');
  const chip = (ic, text, title, cls = '') => chips.append(h(`span.fact${cls}`, { title }, h('span.fi', { html: icon(ic) }), h('span', { text })));
  if (s.tuning) chip('tuning', `${s.tuning}${s.tuningCents ? ` ${s.tuningCents}` : ''}`, 'Tuning', s.tuning !== 'E Standard' ? '.alt' : '');
  if (s.length) chip('clock', fmtDuration(s.length), 'Length');
  if (s.tempo) chip('drum', `${Math.round(s.tempo)}`, 'Tempo (BPM)');
  if (s.user && s.user.plays) chip('play', `${s.user.plays}×`, 'Times played');
  const lists = state.rs && state.rs.profile ? rsListIds().filter((id) => rsHas(id, s)).map(rsListLabel) : [];
  if (lists.length) chip('list', lists.join(', '), 'In Rocksmith');
  root.append(chips);
}

function renderMany(songs) {
  root.innerHTML = '';
  const stack = h('div.stack');
  songs.slice(0, 3).forEach((s, i) => {
    const c = cover(s, 128);
    c.style.left = `${i * 34}px`;
    c.style.top = `${i * 8}px`;
    c.style.zIndex = String(3 - i);
    stack.append(c);
  });
  root.append(stack);
  root.append(h('div.insp-title', { text: `${songs.length} songs selected` }));
  const mins = Math.round(songs.reduce((n, s) => n + (s.length || 0), 0) / 60);
  root.append(h('div.insp-album', null, h('span', { text: `${mins} minutes in total` })));
  const row = h('div.insp-actions');
  const edit = h('button.btn', { type: 'button', html: `${icon('edit')}<span>Edit details</span>` });
  edit.onclick = () => beginEdit();
  const stems = h('button.btn', { type: 'button', html: `${icon('split')}<span>Split stems</span>` });
  stems.onclick = () => actions.requestStems(songs.map((s) => s.id));
  const more = h('button.btn', { type: 'button', title: 'More', html: icon('more') });
  more.onclick = (e) => {
    const r = more.getBoundingClientRect();
    actions.songMenu(r.left, r.bottom + 4, songs.map((s) => s.id));
    e.stopPropagation();
  };
  row.append(edit, stems, more);
  root.append(row);
  const artists = new Set(songs.map((s) => s.artist));
  const tunings = new Set(songs.map((s) => s.tuning || 'Unknown'));
  root.append(
    section(
      'Selection',
      kv([
        ['Artists', artists.size === 1 ? [...artists][0] : `${artists.size} different`],
        ['Tunings', tunings.size <= 3 ? [...tunings].join(', ') : `${tunings.size} different`],
        ['Files', String(new Set(songs.map((s) => s.path)).size)],
      ])
    )
  );
}

// ---------------------------------------------------------------- edit --
const FIELDS = [
  ['title', 'Title'],
  ['artist', 'Artist'],
  ['album', 'Album'],
  ['year', 'Year'],
];
const SORTS = [
  ['titleSort', 'Title for sorting', 'title'],
  ['artistSort', 'Artist for sorting', 'artist'],
  ['albumSort', 'Album for sorting', 'album'],
];

function fieldEl(key, label, value, { placeholder = '', inputmode } = {}) {
  const input = h('input', { name: key, value: value ?? '', placeholder, spellcheck: 'false', autocomplete: 'off', inputmode });
  const wrap = h('label.field', null, h('span', { text: label }), input, h('div.err', { hidden: true }));
  return { wrap, input };
}

function renderEdit(songs) {
  state.editing = true;
  root.innerHTML = '';
  const batch = songs.length > 1;
  const common = (k) => {
    const vals = new Set(songs.map((s) => (s[k] === null || s[k] === undefined ? '' : String(s[k]))));
    return vals.size === 1 ? [...vals][0] : null;
  };
  const form = h('form.edit-form', { novalidate: true });
  form.append(h('h2', { text: batch ? `Edit ${songs.length} songs` : 'Edit details' }));
  if (!batch) {
    const s = songs[0];
    form.append(h('div', { style: { color: 'var(--ink-3)', fontSize: '12px', marginTop: '-6px' }, text: s.fileName }));
  }
  const inputs = {};
  const original = {};
  for (const [k, label] of FIELDS) {
    if (batch && k === 'title') continue;
    const v = common(k);
    original[k] = v;
    const f = fieldEl(k, label, v ?? '', { placeholder: v === null ? 'Mixed, leave blank to keep' : '', inputmode: k === 'year' ? 'numeric' : undefined });
    inputs[k] = f;
  }
  if (inputs.title) form.append(inputs.title.wrap);
  form.append(inputs.artist.wrap);
  const two = h('div.two', null, inputs.album.wrap, inputs.year.wrap);
  form.append(two);

  // Sort names follow their main field unless the user changes them.
  const linked = {};
  if (!batch) {
    const s = songs[0];
    const det = h('details');
    det.append(h('summary', { html: `${icon('chevron')}<span>Sort names</span>` }));
    const inner = h('div.inner');
    for (const [k, label, src] of SORTS) {
      original[k] = s[k] || '';
      const f = fieldEl(k, label, s[k] || '');
      inputs[k] = f;
      linked[k] = !s[k] || s[k] === sortable(s[src]) || s[k] === s[src];
      f.input.addEventListener('input', () => (linked[k] = false));
      inner.append(f.wrap);
    }
    inner.append(h('div.edit-note', { text: 'Rocksmith sorts by these. They follow the fields above until you change them.' }));
    det.append(inner);
    form.append(det);
    for (const [k, , src] of SORTS) {
      inputs[src].input.addEventListener('input', () => {
        if (linked[k]) inputs[k].input.value = sortable(inputs[src].input.value);
      });
    }
    if (s.jpTitle || s.jpArtist) {
      const jd = h('details');
      jd.append(h('summary', { html: `${icon('chevron')}<span>Japanese names</span>` }));
      const ji = h('div.inner');
      for (const [k, label] of [
        ['jpTitle', 'Japanese title'],
        ['jpArtist', 'Japanese artist'],
      ]) {
        original[k] = s[k] || '';
        const f = fieldEl(k, label, s[k] || '');
        inputs[k] = f;
        ji.append(f.wrap);
      }
      jd.append(ji);
      form.append(jd);
    }
  }
  for (const [k, f] of Object.entries(inputs)) {
    f.input.addEventListener('input', () => {
      f.wrap.classList.toggle('changed', f.input.value !== (original[k] ?? ''));
      f.wrap.classList.remove('invalid');
      f.wrap.querySelector('.err').hidden = true;
    });
  }

  const errorBox = h('div.form-error', { hidden: true });
  form.append(errorBox);
  form.append(
    h('div.edit-note', {
      text: 'Saving rewrites only these fields inside the .psarc. Stagehand checks the new file end to end and keeps a backup of the original before replacing it.',
    })
  );
  const cancel = h('button.btn.ghost', { type: 'button', text: 'Cancel' });
  const save = h('button.btn.primary', { type: 'submit', html: '<span>Save to file</span>' });
  form.append(h('div.edit-buttons', null, cancel, save));
  cancel.onclick = () => endEdit();
  form.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Escape') endEdit();
    if (e.key === 's' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      form.requestSubmit();
    }
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const changes = {};
    for (const [k, f] of Object.entries(inputs)) {
      const v = f.input.value.trim();
      if (batch && original[k] === null && v === '') continue;
      if (v === (original[k] ?? '')) continue;
      changes[k] = v;
    }
    // Local validation
    let bad = false;
    const flag = (k, msg) => {
      bad = true;
      const f = inputs[k];
      f.wrap.classList.add('invalid');
      const err = f.wrap.querySelector('.err');
      err.textContent = msg;
      err.hidden = false;
    };
    if ('year' in changes && !/^\d{1,4}$/.test(changes.year)) flag('year', 'Use a year like 1994');
    if ('title' in changes && !changes.title) flag('title', 'Title cannot be empty');
    if ('artist' in changes && !changes.artist) flag('artist', 'Artist cannot be empty');
    if (bad) return;
    if (!Object.keys(changes).length) {
      endEdit();
      return;
    }
    save.disabled = true;
    cancel.disabled = true;
    save.innerHTML = '<span class="spin"></span><span>Saving</span>';
    errorBox.hidden = true;
    try {
      const items = songs.map((s) => {
        const c = { ...changes };
        if (batch) {
          // In a batch, sort names follow the new value only where they followed the old one.
          for (const [sk, , src] of SORTS) {
            if (src in c && (!s[sk] || s[sk] === sortable(s[src]) || s[sk] === s[src])) c[sk] = sortable(c[src]);
          }
        }
        return { songId: s.id, changes: c };
      });
      const res = await api.edit.save(items);
      if (res.songs.length) upsertSongs(res.songs);
      const failed = res.results.filter((r) => !r.ok);
      const okCount = res.results.length - failed.length;
      if (failed.length) {
        const f = failed[0];
        if (f.field && inputs[f.field]) flag(f.field, f.error);
        errorBox.textContent = failed.length === res.results.length ? `Nothing was saved. ${f.error}` : `${okCount} saved, ${failed.length} not saved. ${f.error}`;
        errorBox.hidden = false;
        save.disabled = false;
        cancel.disabled = false;
        save.innerHTML = '<span>Save to file</span>';
        return;
      }
      const files = new Set(res.results.flatMap((r) => r.replaced || []));
      toast({
        title: batch ? `Saved ${okCount} songs` : `Saved ${changes.title || songs[0].title}`,
        message: files.size ? `Updated ${files.size} file${files.size === 1 ? '' : 's'} inside the archive. The original is backed up.` : 'Nothing needed changing.',
        actions: !batch && res.results[0] && res.results[0].backupPath ? [{ label: 'Undo', onClick: () => undoSave(songs[0].id, res.results[0].backupPath) }] : [],
      });
      endEdit();
    } catch (err) {
      errorBox.textContent = `Nothing was saved. ${err.message}`;
      errorBox.hidden = false;
      save.disabled = false;
      cancel.disabled = false;
      save.innerHTML = '<span>Save to file</span>';
    }
  });

  root.append(form);
  setTimeout(() => (inputs.title || inputs.artist).input.focus(), 20);
}

async function undoSave(songId, backupPath) {
  try {
    const fresh = await api.edit.restore(songId, backupPath);
    upsertSongs(fresh);
    toast({ title: 'Restored the previous version', kind: 'info' });
  } catch (err) {
    toast({ title: 'Could not undo', message: err.message, kind: 'err' });
  }
}

export function beginEdit() {
  const songs = selectedSongs();
  if (!songs.length) return;
  renderEdit(songs);
}

function endEdit() {
  state.editing = false;
  render();
}

export function render() {
  if (state.editing) return;
  const songs = selectedSongs();
  if (!songs.length) renderEmpty();
  else if (songs.length === 1) renderOne(songs[0]);
  else renderMany(songs);
}

on('selection', () => {
  state.editing = false;
  render();
});
on('library', render);
on('stems', render);
on('rocksmith', render);
on('stems-progress', () => {
  const b = root.querySelector('[data-stem-btn]');
  if (!b || state.editing) return;
  const st = state.stems.get(b.dataset.stemBtn);
  if (st && st.state === 'running') b.innerHTML = `<span class="spin"></span><span>${Math.round((st.progress || 0) * 100)}%</span>`;
});
emit('inspector-ready');
void upsertSongs;
on('best', render);
