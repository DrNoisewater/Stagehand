/**
 * 4.5: the developer menu (Ctrl+Shift+F12). Only when developer mode is on: Settings › About,
 * click the version seven times (or start Stagehand with STAGEHAND_DEV=1). The main process
 * checks developer mode on every call too, so nothing here works in a normal build.
 *
 *   Progression  set level, add/remove XP, venues, challenges, resets, celebrations, preview
 *   Statistics   lifetime counters, export, backups (make, restore), integrity, test data
 *   Testing      simulate levels, every reward tier, venue transitions, recovery, event log, balance
 *
 * Resets never touch lifetime statistics; erasing those needs a separate typed phrase, and a
 * backup is always made first.
 */
import { api } from './api.js';
import { h, modal, toast, confirmDialog } from './ui.js';
import { L, loadLevels, levelUp, trophyCard } from './rewards.js';
import { emit } from './store.js';

const n = (x) => Number(x || 0).toLocaleString();
let open = null;

export async function devEnabled() {
  try {
    return !!(api.dev && (await api.dev.enabled()));
  } catch (_) {
    return false;
  }
}

async function run(label, fn) {
  try {
    const r = await fn();
    await loadLevels();
    emit('stats');
    toast({ title: label, kind: 'ok', timeout: 2600 });
    return r;
  } catch (e) {
    toast({ title: `${label}: didn’t work`, message: e.message, kind: 'err' });
    return null;
  }
}

const btn = (text, onclick, extra = {}) => h(`button.btn.small${extra.danger ? '.danger' : extra.primary ? '.primary' : '.soft'}`, { type: 'button', text, onclick, ...(extra.act ? { 'data-act': extra.act } : {}) });

export async function openDevMenu() {
  if (open) return open.close();
  if (!(await devEnabled())) return;
  await loadLevels();
  const nav = h('nav', { role: 'tablist' });
  const pane = h('div.dm-pane');
  const body = h('div', null);
  const tabs = [['progression', 'Progression'], ['stats', 'Statistics'], ['testing', 'Testing']];
  let tab = 'progression';
  const show = async (t) => {
    tab = t;
    for (const b of nav.children) b.setAttribute('aria-selected', String(b.dataset.dtab === t));
    pane.innerHTML = '';
    pane.append(...(await ({ progression, stats, testing }[t])()));
  };
  for (const [id, label] of tabs) nav.append(h('button', { type: 'button', role: 'tab', 'data-dtab': id, text: label, onclick: () => show(id) }));
  const m = modal({ title: 'Developer menu', body: [nav, pane].reduce((f, el) => (f.append(el), f), document.createDocumentFragment()), wide: true, onClose: () => (open = null) });
  m.el.classList.add('devmenu');
  open = m;
  body.remove();
  await show(tab);
  const refresh = () => open && show(tab);

  // --------------------------------------------------------- progression --
  async function progression() {
    const st = L.st;
    const lvl = h('input.input', { type: 'number', name: 'level', min: '1', max: '100', value: String(st.level) });
    const xp = h('input.input', { type: 'number', name: 'xp', step: '100', value: '1000' });
    const out = [];
    out.push(h('section', null, h('h3', { text: `Level ${st.level} · ${n(st.xp)} XP${st.adjust ? ` (developer adjustment ${st.adjust > 0 ? '+' : ''}${n(st.adjust)})` : ''}` }),
      h('div.dm-row', null, lvl, btn('Set level', async () => (await run(`Level ${lvl.value}`, () => api.dev.levels('setLevel', Number(lvl.value)))) && refresh(), { act: 'setLevel', primary: true })),
      h('div.dm-row', null, xp, btn('Add XP', async () => (await run(`+${xp.value} XP`, () => api.dev.levels('addXp', Number(xp.value)))) && refresh()), btn('Remove XP', async () => (await run(`−${xp.value} XP`, () => api.dev.levels('addXp', -Number(xp.value)))) && refresh())),
      h('p.dm-note', { text: 'Setting a level adjusts XP; playing still adds on top. Every change is logged (Testing › Event log).' })));
    // venues
    const vbox = h('div.dm-venues');
    for (const v of st.venues || []) {
      const sel = h('select.input', { 'aria-label': `${v.name} venue` }, h('option', { value: 'normal', text: `Normal (level ${v.level})` }), h('option', { value: 'open', text: 'Unlocked' }), h('option', { value: 'locked', text: 'Locked' }));
      sel.value = v.why === 'dev' ? (v.unlocked ? 'open' : 'locked') : 'normal';
      sel.onchange = async () => (await run(`${v.name}: ${sel.value}`, () => api.dev.levels('setVenue', v.venue, sel.value === 'normal' ? null : sel.value === 'open'))) && refresh();
      vbox.append(h('div.dm-venue', null, h('span', { text: v.unlocked ? '🔓' : '🔒' }), h('b', { text: v.name }), h('small', { text: `LV ${v.level}${v.why ? ` · ${v.why}` : ''}` }), sel));
    }
    out.push(h('section', null, h('h3', { text: 'Venues' }), h('div.dm-row', null,
      btn('Unlock all venues', async () => (await run('All venues unlocked', () => api.dev.levels('unlockAll', true))) && refresh()),
      btn('Venues back to normal', async () => (await run('Venues back to normal', () => api.dev.levels('unlockAll', false))) && refresh()),
      btn(L.previewAll ? 'Stop previewing locked content' : 'Preview locked content', () => ((L.previewAll = !L.previewAll), toast({ title: L.previewAll ? 'Previewing: every venue usable on the highway until you turn this off' : 'Preview off', kind: 'info' }), refresh()))), vbox));
    // challenges
    const cl = h('div.dm-row');
    for (const c of [...st.challenges, ...(st.weekly || [])]) cl.append(btn(`${c.done ? '✓ ' : ''}${c.name.replace(/^Daily gig: /, '').slice(0, 42)}`, async () => (await run('Challenge completed', () => api.dev.levels('completeChallenge', c.key))) && refresh()));
    out.push(h('section', null, h('h3', { text: 'Challenges (click to complete)' }), cl, h('div.dm-row', null, btn('Reset today’s and this week’s', async () => (await confirmDialog({ title: 'Reset challenges?', message: 'Today’s and this week’s finished challenges and their XP are cleared. A backup is made first.', confirm: 'Reset' })) && (await run('Challenges reset', () => api.dev.levels('resetChallenges'))) && refresh()))));
    // resets
    out.push(h('section.dm-danger', null, h('h3', { text: 'Resets (lifetime statistics are never touched)' }), h('div.dm-row', null,
      btn('Reset achievements', async () => (await confirmDialog({ title: 'Reset achievements?', message: 'Achievements start counting again from now. Levels from other XP stay. A backup is made first.', confirm: 'Reset achievements', danger: true })) && (await run('Achievements reset', () => api.dev.levels('resetAchievements'))) && refresh(), { danger: true }),
      btn('Reset progression', async () => (await confirmDialog({ title: 'Start the Road to 100 over?', message: 'Level 1, no XP, challenges, achievements, titles or kept venues. Your lifetime statistics and play history stay exactly as they are. A backup is made first.', confirm: 'Reset progression', danger: true })) && (await run('Progression reset', () => api.dev.levels('resetProgression'))) && refresh(), { danger: true }))));
    return out;
  }

  // ------------------------------------------------------------ statistics --
  async function stats() {
    const out = [];
    const life = await api.career.lifetime().catch(() => null);
    if (life) {
      const rows = [['Sessions', life.sessions], ['Archived sessions', life.archived], ['Hours', life.hours.toFixed(1)], ['Notes played / hit', `${n(life.notes)} / ${n(life.notesHit)}`], ['Chords played / hit', `${n(life.chordsPlayed)} / ${n(life.chordsHit)}`], ['Songs played', life.songsPlayed], ['Different songs', life.uniqueSongs], ['Whole songs', life.fullSongs], ['Mastered', life.masteredSongs], ['Best / average accuracy', `${life.bestAccuracy ? Math.round(life.bestAccuracy * 1000) / 10 : '–'}% / ${life.averageAccuracy ? Math.round(life.averageAccuracy * 1000) / 10 : '–'}%`], ['Days played / best run', `${life.daysPlayed} / ${life.longestDayRun}`], ['First played', life.firstAt ? new Date(life.firstAt).toLocaleString() : '–']];
      out.push(h('section', null, h('h3', { text: 'Lifetime counters' }), h('table', null, ...rows.map(([k, v]) => h('tr', null, h('th', { text: k }), h('td', { text: typeof v === 'number' ? n(v) : String(v) }))))));
    }
    const list = await api.career.backups().catch(() => []);
    const bl = h('table', null, h('tr', null, h('th', { text: 'Backup' }), h('th', { text: 'Sessions' }), h('th', { text: '' })));
    for (const b of list.slice(0, 20)) {
      bl.append(h('tr', null, h('td', { text: `${new Date(b.at).toLocaleString()} · ${b.reason}` }), h('td', { text: b.files['stats.json'] ? n(b.files['stats.json'].sessions) : '–' }),
        h('td', null, btn('Restore', async () => {
          if (!(await confirmDialog({ title: 'Restore this backup?', message: `Your stats and levels go back to ${new Date(b.at).toLocaleString()}. A backup of how they are now is made first, so this can be undone.`, confirm: 'Restore', danger: true }))) return;
          (await run('Restored', () => api.dev.restore(b.id))) && refresh();
        }))));
    }
    out.push(h('section', null, h('h3', { text: 'Backups' }), h('div.dm-row', null,
      btn('Make a backup now', async () => (await run('Backup made', () => api.career.backup())) && refresh(), { primary: true }),
      btn('Export statistics…', () => run('Exported', () => api.career.export()))), list.length ? bl : h('p.dm-note', { text: 'No backups yet.' })));
    // integrity
    const res = h('div');
    const check = async (fix) => {
      const r = await api.dev.integrity(!!fix).catch((e) => ({ ok: false, checks: [{ ok: false, what: 'Check failed', detail: e.message }] }));
      res.innerHTML = '';
      res.append(h('table', null, ...r.checks.map((c) => h('tr', null, h('td', { class: c.ok ? 'dm-ok' : 'dm-bad', text: c.ok ? '✓' : '✗' }), h('td', { text: c.what }), h('td', { text: c.detail || '' })))));
      if (r.fixed) res.append(h('p.dm-note', { text: `Removed ${r.fixed} duplicate sessions (a backup was made first).` }));
    };
    out.push(h('section', null, h('h3', { text: 'Profile integrity' }), h('div.dm-row', null, btn('Validate', () => check(false)), btn('Remove duplicate sessions', () => check(true))), res));
    // test data
    const mins = h('input.input', { type: 'number', value: '60', min: '1' });
    out.push(h('section.dm-danger', null, h('h3', { text: 'Clear testing data' }),
      h('div.dm-row', null, h('span', { text: 'Remove sessions from the last' }), mins, h('span', { text: 'minutes' }),
        btn('Remove', async () => (await confirmDialog({ title: 'Remove recent sessions?', message: `Sessions from the last ${mins.value} minutes are removed from your history (and lifetime statistics). A backup is made first.`, confirm: 'Remove', danger: true })) && (await run('Removed', () => api.dev.clearRecent(Number(mins.value)))) && refresh(), { danger: true }))));
    // erase lifetime: a typed phrase
    const phrase = h('input.input', { type: 'text', placeholder: 'ERASE MY LIFETIME STATS', style: { width: '260px' }, 'aria-label': 'Type the phrase to erase lifetime statistics' });
    out.push(h('section.dm-danger', null, h('h3', { text: 'Erase lifetime statistics' }),
      h('p.dm-note', { text: 'Erases every recorded session (chords, notes, hours, history) and resets progression. Type the phrase exactly. A backup is made first and can be restored above.' }),
      h('div.dm-row', null, phrase, btn('Erase everything', async () => {
        if (phrase.value !== 'ERASE MY LIFETIME STATS') return toast({ title: 'Type the phrase exactly', kind: 'err' });
        if (!(await confirmDialog({ title: 'Really erase all lifetime statistics?', message: 'This is the one that removes your history. A backup is made first.', confirm: 'Erase', danger: true }))) return;
        (await run('Lifetime statistics erased', () => api.dev.eraseLifetime(phrase.value))) && refresh();
      }, { danger: true }))));
    return out;
  }

  // --------------------------------------------------------------- testing --
  async function testing() {
    const st = L.st;
    const out = [];
    out.push(h('section', null, h('h3', { text: 'Celebrations' }), h('div.dm-row', null,
      btn('Level up', () => levelUp({ ...st, level: st.level, tier: st.tier }, { ...st, level: st.level + 1 })),
      ...[10, 25, 50, 75, 100].map((lv) => btn(`Milestone ${lv}`, () => levelUp({ ...st, level: lv - 1, tier: { id: 'x' } }, { ...st, level: lv, tier: tierAt(st, lv), venues: st.venues }))),
      btn('Every achievement tier', () => {
        const t = st.trophies[0];
        for (let i = 0; i < 6; i++) trophyCard({ key: `t:${t.id}:${i}`, xp: 0 }, st);
      }))));
    out.push(h('section', null, h('h3', { text: 'Simulate' }), h('div.dm-row', null,
      btn('Level up ×5 (one at a time)', async () => {
        for (let i = 0; i < 5; i++) {
          const cur = L.st;
          await api.dev.levels('setLevel', Math.min(100, cur.level + 1));
          await loadLevels();
          await new Promise((r) => setTimeout(r, 1200));
        }
        refresh();
      }),
      btn('Preview venue transitions', () => {
        const vs = (L.st.venues || []).map((v) => v.venue);
        let i = 0;
        L.previewAll = true;
        const step = () => {
          if (i >= vs.length) return toast({ title: 'Venue tour done', kind: 'ok' });
          window.dispatchEvent(new CustomEvent('stagehand:preview-venue', { detail: vs[i++] }));
          setTimeout(step, 2500);
        };
        toast({ title: 'Open the highway: each venue shows for a few seconds', kind: 'info' });
        step();
      }),
      btn('Test backup recovery', () => run('Backup recovery', async () => {
        const r = await api.dev.testRecovery();
        if (!r.ok) throw new Error('A damaged file wasn’t recovered');
        return r;
      })))));
    // balance
    const bal = h('div', null, h('p.dm-note', { text: 'Runs a simulated year of playing through the real XP rules (takes a few seconds).' }));
    out.push(h('section', null, h('h3', { text: 'Validate XP balancing' }), h('div.dm-row', null, btn('Simulate a year', async () => {
      bal.innerHTML = 'Simulating…';
      const r = await api.dev.balance(365).catch((e) => ({ error: e.message }));
      bal.innerHTML = '';
      if (r.error) return bal.append(h('p.dm-bad', { text: r.error }));
      bal.append(h('table', null, h('tr', null, h('th', { text: 'Player' }), ...r.marks.map((d) => h('th', { text: d < 60 ? `${d} d` : `${Math.round(d / 30.4)} mo` })), h('th', { text: 'Level 100' })),
        ...r.rows.map((x) => h('tr', null, h('td', { text: x.name }), ...x.levels.map((l) => h('td', { text: String(l.level) })), h('td', { text: x.day100 ? `day ${x.day100}` : '—' })))));
    })), bal));
    // event log
    const log = h('div.dm-log');
    for (const e of [...(st.devLog || [])].reverse()) log.append(h('div', null, h('span', { text: new Date(e.at).toLocaleString() }), h('b', { text: e.type }), h('span', { text: e.text })));
    out.push(h('section', null, h('h3', { text: 'Progression event log' }), (st.devLog || []).length ? log : h('p.dm-note', { text: 'Nothing yet.' })));
    out.push(h('section', null, h('h3', { text: 'Progression history (newest first)' }), h('pre', { text: (st.timeline || []).slice(0, 80).map((e) => `${new Date(e.at).toLocaleDateString()}  ${e.type.padEnd(8)} ${e.text}`).join('\n') || '—' })));
    return out;
  }
}

function tierAt(st, level) {
  const tiers = [['roadie', 'Roadie', 1], ['garage', 'Garage band', 5], ['opener', 'Opening act', 12], ['headliner', 'Headliner', 20], ['rockstar', 'Rock star', 35], ['legend', 'Legend', 50], ['hof', 'Hall of Fame', 75], ['immortal', 'Immortal', 100]];
  const t = [...tiers].reverse().find((x) => level >= x[2]);
  return { id: t[0], name: t[1] };
}

// Ctrl+Shift+F12 opens it (only when developer mode is on)
document.addEventListener('keydown', (e) => {
  if (e.ctrlKey && e.shiftKey && e.key === 'F12') {
    e.preventDefault();
    openDevMenu();
  }
});
