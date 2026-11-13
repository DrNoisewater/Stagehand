import { api } from './api.js';
import { h, modal } from './ui.js';
import { loadLibrary } from './store.js';

export async function openDlcImport() {
  let rows = [], running = false, closed = false;
  const selected = new Set();
  const status = h('p', { text: 'Select installed songs to add. Rocksmith files remain in place and must stay available.', role: 'status', 'aria-live': 'polite' });
  const search = h('input.input', { placeholder: 'Search artist or title', 'aria-label': 'Search discovered songs' });
  const list = h('div', { style: { maxHeight: '48vh', overflow: 'auto' } });
  const all = h('button.btn.small', { text: 'Select All' });
  const none = h('button.btn.small', { text: 'Deselect All' });
  const scan = h('button.btn', { text: 'Scan again' });
  const start = h('button.btn.primary', { text: 'Import Selected' });
  const cancel = h('button.btn', { text: 'Close' });
  const body = h('div', null, status, search, h('div', { style: { display: 'flex', gap: '8px', margin: '10px 0' } }, all, none), list);
  const off = api.on('dlc:progress', (p) => { status.textContent = `${p.phase}: ${p.done}/${p.total} — ${p.file || ''}`; });
  const m = modal({ title: 'Import Rocksmith DLC', body, wide: true, footer: [scan, cancel, start],
    onClose: () => { closed = true; off(); if (running) api.dlc.cancel(); } });
  function draw() {
    list.replaceChildren();
    const q = search.value.toLowerCase();
    for (const row of rows.filter((r) => `${r.artist} ${r.title}`.toLowerCase().includes(q))) {
      const check = h('input', { type: 'checkbox', checked: selected.has(row.id), disabled: running || !row.selectable,
        'aria-label': `Import ${row.artist} — ${row.title}` });
      check.onchange = () => { if (check.checked) selected.add(row.id); else selected.delete(row.id); controls(); };
      list.append(h('label', { style: { display: 'flex', gap: '10px', padding: '9px 0', borderBottom: '1px solid var(--line)' } }, check,
        h('div', null, h('strong', { text: `${row.artist ? row.artist + ' — ' : ''}${row.title}` }),
          h('div', { text: row.arrangements }), h('div', { text: row.status }))));
    }
    controls();
  }
  function controls() {
    scan.disabled = all.disabled = none.disabled = running;
    start.disabled = running || !rows.some((r) => r.selectable && selected.has(r.id));
    start.textContent = `Import Selected (${rows.filter((r) => r.selectable && selected.has(r.id)).length})`;
    cancel.textContent = running ? 'Cancel' : 'Close';
  }
  async function run(action) {
    running = true; draw();
    try {
      const result = await action();
      if (result) rows = result;
      status.textContent = `${rows.length} entries. Imported songs use normal playback and stem separation. Failed songs can be retried; scan again after fixing missing files.`;
      await loadLibrary();
    } catch (e) { status.textContent = e.message; }
    finally { running = false; if (!closed) draw(); }
  }
  search.oninput = draw;
  all.onclick = () => { rows.filter((r) => r.selectable).forEach((r) => selected.add(r.id)); draw(); };
  none.onclick = () => { selected.clear(); draw(); };
  scan.onclick = () => { selected.clear(); run(() => api.dlc.scan()); };
  start.onclick = () => run(() => api.dlc.importSelected([...selected]));
  cancel.onclick = () => { if (running) { api.dlc.cancel(); status.textContent = 'Cancelling…'; } else m.close(); };
  await run(() => api.dlc.scan());
}
