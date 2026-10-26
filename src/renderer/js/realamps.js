/**
 * Real amps in the interface: the strip on a tone's amp (what's playing, the
 * gain ladder, Get / Change / Modelled), the REAL badge, and
 * Settings › Real amps (TONE3000, your captures, more to get).
 */
import { h, icon, toast, showMenu, confirmDialog } from './ui.js';
import { rig } from './rig.js';
import { gearName, ampGain } from './gearspec.js';
import { caps, capturesApi, resolveCapture, suggestionFor, ampOf, curatedFor, packForCurated, realAmpsOn, setRealAmps, loadCaptures } from './captures.js';

const T3K_URL = 'https://www.tone3000.com';
const T3K_KEYS = 'https://www.tone3000.com/settings';

/** Opens Settings on a tab (dialogs.js owns the Settings window). */
const openSettings = (tab) => import('./dialogs.js').then((m) => m.settings(tab));

loadCaptures();

const where = () => (caps.st.t3k && caps.st.t3k.inApp && !caps.st.t3k.useBrowser ? 'in the TONE3000 window' : 'on TONE3000 in your browser');
const busyLine = (b) => (!b ? '' : b.stage === 'signin' ? `Sign in ${where()}…` : b.stage === 'browser' ? `Confirm ${where()}…` : 'Downloading the capture…');

/** "REAL" badge for a tone whose amp is a capture, else null. */
export function realBadge(tone, opts = {}) {
  const cap = resolveCapture(tone);
  if (!cap) return null;
  return h(`span.real-badge${opts.small ? '.sm' : ''}`, { text: 'REAL', title: `Real amp: ${cap.pack.title}${cap.pack.maker ? ` by ${cap.pack.maker}` : ''}` });
}

function explain(err) {
  if (!err) return;
  if (err.code === 'nokey') {
    toast({ title: 'Connect TONE3000 first', message: 'One-time setup, in Settings › Real amps.', kind: 'info', actions: [{ label: 'Set up', onClick: () => openSettings('amps') }] });
    return;
  }
  if (err.code === 'replaced') return; // you asked for another one; that one carries on
  if (err.code === 'cancelled') return toast({ title: 'Nothing downloaded', message: err.message || 'Cancelled on TONE3000.', kind: 'info', timeout: 3000 });
  toast({ title: 'Couldn’t get that capture', message: err.message, kind: 'err' });
}

/** Get a curated capture (one click; TONE3000 opens to confirm). */
export async function getRealAmp(packKey, ampKey) {
  const def = caps.st.map.packs[packKey];
  if (!caps.st.t3k.hasKey) return explain({ code: 'nokey' });
  toast({ title: `Getting the real ${def ? def.title : 'amp'}`, message: `Confirm ${where()}. If TONE3000 says it can’t be used, close it and try another.`, kind: 'info', timeout: 5000 });
  try {
    const r = await capturesApi.get(packKey, ampKey);
    const p = caps.st.packs.find((x) => x.id === r.id);
    toast({ title: 'Real amp ready', message: p ? `${p.title} · ${p.models.length} gain ${p.models.length === 1 ? 'setting' : 'settings'}` : '', kind: 'ok' });
  } catch (err) {
    explain(err);
  }
}

async function browseFor(ampKey, d, onChange) {
  if (!caps.st.t3k.hasKey) return explain({ code: 'nokey' });
  try {
    const r = await capturesApi.browse(ampKey, { bass: d && d.kind === 'bass' });
    if (d && r && r.id) {
      d.capture = r.id;
      onChange && onChange();
    }
    toast({ title: 'Real amp ready', kind: 'ok', timeout: 2500 });
  } catch (err) {
    explain(err);
  }
}

async function addOwn(ampKey, d, onChange) {
  try {
    const r = await capturesApi.addFiles(null);
    if (!r || !r.added || !r.added.length) return;
    if (d) {
      d.capture = r.added[0];
      onChange && onChange();
    } else if (ampKey) await capturesApi.assign(ampKey, r.added[0]);
    toast({ title: r.added.length === 1 ? 'Capture added' : `${r.added.length} captures added`, kind: 'ok', timeout: 2500 });
  } catch (err) {
    toast({ title: 'Couldn’t add that file', message: err.message, kind: 'err' });
  }
}

/** What's left of a model's name once the pack's title is taken out ("Driven", "GAIN 7"). */
export function modelLabel(cap) {
  if (!cap || !cap.model) return '';
  let n = String(cap.model.name || '');
  const t = String(cap.pack.title || '');
  if (t && n.toLowerCase().startsWith(t.toLowerCase())) n = n.slice(t.length);
  n = n.replace(/^[\s\-–·:/|]+/, '').trim();
  return n.length > 40 ? `${n.slice(0, 38)}…` : n;
}

/** The pack's models as a little ladder of gain levels, the playing one lit. */
function ladder(cap) {
  const ms = [...cap.pack.models].sort((a, b) => (a.gain ?? 0.5) - (b.gain ?? 0.5));
  const box = h('span.ra-ladder', { title: ms.length > 1 ? 'Each bar is the amp captured at another gain. The tone’s Gain knob picks one.' : 'One capture' });
  ms.forEach((m) => {
    const g = m.gain ?? 0.5;
    box.append(h(`i${m === cap.model ? '.on' : ''}`, { style: { height: `${30 + g * 70}%` }, title: m.name }));
  });
  return box;
}

/**
 * The real-amp strip for the tone editor's amp card. d = the tone being edited;
 * onChange() after d.capture changes (the editor pushes it live and re-renders).
 */
export function realAmpStrip(d, onChange) {
  const amp = ampOf(d);
  const wrap = h('div.ra-strip');
  if (!amp) return wrap;
  const draw = () => {
    wrap.innerHTML = '';
    const cap = resolveCapture(d);
    const busy = caps.st.busy;
    const sug = suggestionFor(d);
    const failed = cap && rig._badCaps && rig._badCaps.get(cap.path);
    wrap.classList.toggle('real', !!cap && !failed);
    // Real | Modelled
    const seg = h('div.gseg.ra-seg', { role: 'group', 'aria-label': 'Amp sound' });
    const realOn = !!cap && !failed;
    const bReal = h('button', { type: 'button', text: 'Real', 'aria-pressed': String(realOn), title: 'A capture of the real amp (NAM)' });
    const bModel = h('button', { type: 'button', text: 'Modelled', 'aria-pressed': String(!realOn), title: 'Stagehand’s own model of this amp' });
    bModel.onclick = () => {
      if (!realOn) return;
      d.capture = 'off';
      onChange();
    };
    bReal.onclick = () => {
      if (realOn) return;
      if (!realAmpsOn()) setRealAmps(true);
      if (d.capture === 'off') delete d.capture;
      if (resolveCapture(d)) return onChange();
      if (sug) return getRealAmp(sug.key, amp.key);
      changeMenu(bReal);
    };
    seg.append(bReal, bModel);
    const change = h('button.btn.small.soft', { type: 'button', html: `<span>Change</span>${icon('chevron')}` });
    const changeMenu = (anchor) => {
      const items = [];
      const mine = caps.st.packs.filter((p) => !!p.bass === (d.kind === 'bass') || p.source === 'file');
      for (const p of mine)
        items.push({
          label: `${p.title}${p.maker ? ` · ${p.maker}` : ''}`,
          icon: cap && cap.pack.id === p.id ? 'check' : 'amp',
          onClick: () => {
            d.capture = p.id;
            onChange();
          },
        });
      if (mine.length) items.push('-');
      const c = curatedFor(amp.key);
      if (c && !packForCurated(c.key)) items.push({ label: `Get ${c.def.title} (TONE3000)`, icon: 'download', onClick: () => getRealAmp(c.key, amp.key) });
      items.push({ label: 'Browse TONE3000…', icon: 'globe', onClick: () => browseFor(amp.key, d, onChange) });
      items.push({ label: 'Add .nam or .zip files…', icon: 'folderPlus', onClick: () => addOwn(amp.key, d, onChange) });
      if (d.capture && d.capture !== 'off') items.push('-', { label: `Back to Stagehand’s pick for ${gearName(amp.key)}`, icon: 'restore', onClick: () => (delete d.capture, onChange()) });
      if (cap) items.push({ label: `Use this for every ${gearName(amp.key)} tone`, icon: 'sparkle', onClick: () => capturesApi.assign(amp.key, cap.pack.id).then(() => toast({ title: `Every ${gearName(amp.key)} tone now plays ${cap.pack.title}`, kind: 'ok', timeout: 2500 })) });
      const r = anchor.getBoundingClientRect();
      showMenu(r.left, r.bottom + 4, items);
    };
    change.onclick = () => changeMenu(change);

    const head = h('div.ra-head', null, h(`span.real-badge${realOn ? '' : '.off'}`, { text: realOn ? 'REAL' : 'MODEL' }), seg, h('span.grow'), change);
    wrap.append(head);
    if (busy && (!busy.ampKey || busy.ampKey === amp.key)) {
      wrap.append(h('div.ra-busy', { html: `<span class="spin"></span> ${busyLine(busy)}` }));
      return;
    }
    if (realOn) {
      const p = cap.pack;
      const who = p.maker ? (p.url ? h('a', { href: '#', text: `by ${p.maker}`, title: 'Open on TONE3000' }) : h('span', { text: `by ${p.maker}` })) : null;
      if (who && p.url)
        who.onclick = (e) => {
          e.preventDefault();
          window.stagehand.shell.openExternal(p.url);
        };
      const gainNow = Math.round((cap.model.gain ?? ampGain(d)) * 10);
      const label = modelLabel(cap);
      wrap.append(
        h('div.ra-now', null, ladder(cap), h('div.ra-title', null, h('b', { text: p.title }), h('span.ra-sub', null, p.models.length > 1 ? `${label || `gain ${gainNow}`} · ` : '', who || '', p.source === 'tone3000' ? h('span.t3k', { text: ' · TONE3000' }) : '', p.kind === 'full' ? h('span.ra-kind', { text: ' · amp + cab' }) : '')))
      );
      return;
    }
    if (failed) wrap.append(h('div.ra-note.err', { text: `That capture didn’t load: ${failed}` }));
    if (sug) {
      const get = h('button.btn.glow-primary.ra-get', { type: 'button', html: `${icon('download')}<span>Get the real amp</span>` });
      get.onclick = () => getRealAmp(sug.key, amp.key);
      wrap.append(h('div.ra-offer', null, get, h('div.ra-title', null, h('b', { text: sug.def.title }), h('span.ra-sub', { text: `by ${sug.def.maker} · free on TONE3000, opens to confirm` }))));
    } else if (!realAmpsOn()) wrap.append(h('div.ra-note', { text: 'Real amps are off (Settings › Real amps).' }));
    else if (d.capture !== 'off' && caps.st.assign[amp.key] !== 'off') wrap.append(h('div.ra-note', { text: `No capture for the ${gearName(amp.key)} yet. Change › Browse TONE3000, or add your own .nam files.` }));
  };
  draw();
  const re = () => (wrap.isConnected ? draw() : caps.events.removeEventListener('change', re));
  caps.events.addEventListener('change', re);
  return wrap;
}

// ------------------------------------------------------------ settings --
/** Settings › Real amps */
export async function pane(el, setting) {
  await loadCaptures();
  let library = null;
  const draw = () => {
    if (!el.isConnected && el.childNodes.length) return caps.events.removeEventListener('change', draw);
    el.innerHTML = '';
    const st = caps.st;
    const on = h('input.toggle', { type: 'checkbox', 'aria-label': 'Real amps' });
    on.checked = realAmpsOn();
    on.onchange = () => setRealAmps(on.checked);
    el.append(setting('Real amps', 'Captures of real amps (Neural Amp Modeler) play in your tones’ amp place. Turn off to hear Stagehand’s modelled amps.', on));

    // TONE3000
    const t = st.t3k || {};
    const card = h('div.ra-t3k');
    const logo = h('div.ra-logo', null, h('b', { text: 'TONE3000' }), h('span', { text: 'free amp captures, by players' }));
    if (!t.hasKey) {
      const key = h('input.input', { placeholder: 'Paste your publishable key', 'aria-label': 'TONE3000 publishable key', spellcheck: 'false' });
      const saveKey = h('button.btn.small', { type: 'button', text: 'Save' });
      saveKey.onclick = async () => {
        try {
          await capturesApi.setKey(key.value);
          toast({ title: 'TONE3000 key saved', message: 'Now Connect, or just Get a real amp.', kind: 'ok', timeout: 2500 });
        } catch (err) {
          toast({ title: 'That key didn’t work', message: err.message, kind: 'err' });
        }
      };
      const open = h('button.btn.small.soft', { type: 'button', html: `<span>Open TONE3000</span>${icon('external')}` });
      open.onclick = () => window.stagehand.shell.openExternal(T3K_KEYS);
      const copy = h('button.btn.small.soft', { type: 'button', html: `${icon('copy')}<span>Copy</span>` });
      copy.onclick = () => {
        navigator.clipboard.writeText(t.redirectUri).then(() => toast({ title: 'Copied', kind: 'ok', timeout: 1200 }));
      };
      card.append(
        logo,
        h(
          'ol.ra-steps',
          null,
          h('li', null, h('span.n', { text: '1' }), h('div', null, h('b', { text: 'Make a free account and an app key' }), h('span', { text: 'TONE3000 › Settings › API. Any name works, e.g. “Stagehand”.' })), open),
          h('li', null, h('span.n', { text: '2' }), h('div', null, h('b', { text: 'Add this redirect address to the key' }), h('code', { text: t.redirectUri })), copy),
          h('li', null, h('span.n', { text: '3' }), h('div', null, h('b', { text: 'Paste the publishable key here' }), key), saveKey)
        ),
        h('p.np-fine', { text: 'Only once. After that, getting a real amp is one click: TONE3000 opens to confirm, Stagehand downloads it. Captures are only downloaded when you ask (TONE3000’s rule for free apps).' })
      );
    } else {
      const who = t.connected && t.user ? h('div.ra-user', null, h('span.av', { text: (t.user.name || t.user.username || '?').slice(0, 1).toUpperCase() }), h('b', { text: t.user.name || t.user.username })) : h('div.ra-user.off', null, h('span.dot.off'), h('span', { text: 'Not signed in yet (TONE3000 asks when you get your first amp)' }));
      const btns = h('div.ra-btns');
      if (!t.connected) {
        const c = h('button.btn.small', { type: 'button', text: 'Sign in' });
        c.onclick = () => capturesApi.connect().catch(explain);
        btns.append(c);
      } else {
        const x = h('button.btn.small.ghost', { type: 'button', text: 'Sign out' });
        x.onclick = () => capturesApi.disconnect();
        btns.append(x);
      }
      const forget = h('button.btn.small.ghost', { type: 'button', text: 'Change key' });
      forget.onclick = () => capturesApi.setKey('');
      btns.append(forget);
      card.append(logo, who, btns);
      if (st.busy) card.append(h('div.ra-busy', { html: `<span class="spin"></span> ${busyLine(st.busy)}` }));
    }
    el.append(card);
    if (t.inApp) {
      const ub = h('input.toggle', { type: 'checkbox', 'aria-label': 'Use my web browser for TONE3000' });
      ub.checked = !!t.useBrowser;
      ub.onchange = () => capturesApi.useBrowser(ub.checked);
      el.append(setting('Use my web browser instead', 'TONE3000 opens in a small Stagehand window that closes by itself. Turn this on if you sign in with Google there (Google doesn’t allow signing in inside apps).', ub));
    }

    // your captures
    el.append(h('h3.ra-h', { text: 'Your real amps' }));
    const grid = h('div.ra-grid');
    const users = {};
    for (const [amp, pk] of Object.entries(st.map.amps || {})) (users[pk] = users[pk] || []).push(amp);
    for (const p of st.packs) {
      const ampsFor = Object.entries(st.assign)
        .filter(([, v]) => v === p.id)
        .map(([k]) => k)
        .concat(p.mapKey && users[p.mapKey] ? users[p.mapKey].filter((a) => !st.assign[a]) : []);
      const tile = h('div.ra-tile', { style: { '--gel': p.bass ? 'var(--gel-bass)' : 'var(--tungsten)' } });
      const kind = h('button.ra-kindbtn', { type: 'button', text: p.kind === 'full' ? 'amp + cab' : 'amp only', title: 'Amp only: your tone’s cabinet is added. Amp + cab: the capture already has its speaker.' });
      kind.onclick = () => capturesApi.setKind(p.id, p.kind === 'full' ? 'amp' : 'full');
      const rm = h('button.icon-btn', { type: 'button', title: 'Remove', 'aria-label': 'Remove', html: icon('trash') });
      rm.onclick = async () => {
        if (await confirmDialog({ title: `Remove ${p.title}?`, message: 'Tones using it go back to the modelled amp.', confirm: 'Remove' })) capturesApi.remove(p.id);
      };
      const bars = h('span.ra-ladder');
      [...p.models].sort((a, b) => (a.gain ?? 0.5) - (b.gain ?? 0.5)).forEach((m) => bars.append(h('i', { style: { height: `${30 + (m.gain ?? 0.5) * 70}%` }, title: m.name })));
      tile.append(
        h('div.ra-tile-top', null, bars, h('span.grow'), kind, rm),
        h('b', { text: p.title }),
        h('span.ra-sub', { text: `${p.maker ? `by ${p.maker}` : 'your file'}${p.source === 'tone3000' ? ' · TONE3000' : ''}` }),
        h('div.ra-amps', null, ...ampsFor.slice(0, 6).map((a) => h('span.chip', { text: gearName(a) })), ampsFor.length > 6 ? h('span.chip', { text: `+${ampsFor.length - 6}` }) : '')
      );
      grid.append(tile);
    }
    const add = h('button.ra-tile.add', { type: 'button', html: `${icon('folderPlus')}<b>Add .nam or .zip files</b><span class="ra-sub">captures you downloaded yourself</span>` });
    add.onclick = () => addOwn(null, null, null);
    grid.append(add);
    el.append(grid);

    // more to get, the most-used first
    const want = Object.entries(st.map.packs || {}).filter(([k]) => !packForCurated(k));
    if (want.length) {
      el.append(h('h3.ra-h', { text: 'Get more' }), h('p.np-fine', { text: library ? 'Sorted by how many tones in your songs use each amp.' : 'One click each; TONE3000 opens to confirm.' }));
      const count = (k) => (library ? library[k] || 0 : 0);
      want.sort((a, b) => count(b[0]) - count(a[0]) || a[1].title.localeCompare(b[1].title));
      const list = h('div.ra-grid');
      for (const [k, def] of want) {
        const n = count(k);
        const tile = h('div.ra-tile.get', { style: { '--gel': def.bass ? 'var(--gel-bass)' : 'var(--tungsten)' } });
        const get = h('button.btn.small', { type: 'button', html: `${icon('download')}<span>Get</span>`, disabled: st.busy ? true : null });
        get.onclick = () => getRealAmp(k, null);
        const meter = h('span.ra-use', { title: n ? `${n} tones in your songs use it` : '' }, h('i', { style: { width: `${Math.min(100, n * 4)}%` } }));
        tile.append(h('div.ra-tile-top', null, meter, h('span.ra-n', { text: n ? String(n) : '' }), h('span.grow'), get), h('b', { text: def.title }), h('span.ra-sub', { text: `by ${def.maker} · ${def.variants.length > 1 ? `${def.variants.length} gain settings` : '1 setting'}${def.kind === 'full' ? ' · amp + cab' : ''}` }), h('div.ra-amps', null, ...(users[k] || []).slice(0, 5).map((a) => h('span.chip', { text: gearName(a) }))));
        list.append(tile);
      }
      el.append(list);
    }
    const credit = h('p.np-fine.ra-credit', null, 'Captures are made by their creators and shared on ', h('a', { href: '#', text: 'TONE3000' }), ' under the T3K licence: free to play with, not to pass on. Powered by TONE3000.');
    credit.querySelector('a').onclick = (e) => {
      e.preventDefault();
      window.stagehand.shell.openExternal(T3K_URL);
    };
    el.append(credit);
  };
  draw();
  caps.events.addEventListener('change', draw);
  // how much each pack would be used, from the tones in your songs
  try {
    const { songToneLibrary, readingBar } = await import('./tonelib.js');
    const { on } = await import('./store.js');
    let bar = null;
    if (!(await Promise.race([songToneLibrary().then(() => true), new Promise((r) => setTimeout(() => r(false), 300))]))) {
      // still reading your songs: show it, under the title
      bar = readingBar('Reading the tones in your songs, to sort these');
      el.insertBefore(bar.el, el.querySelector('.ra-h') || null);
      on('tones-progress', (p) => bar.el.isConnected && bar.set(p));
    }
    const songs = (await songToneLibrary()) || [];
    if (bar) bar.el.remove();
    const counts = {};
    for (const s of Array.isArray(songs) ? songs : []) {
      for (const tone of s.tones || []) {
        const amp = ampOf(tone);
        const k = amp && caps.st.map.amps[amp.key];
        if (k) counts[k] = (counts[k] || 0) + 1;
      }
    }
    library = counts;
    draw();
  } catch (_) {}
}

// a capture that won't load: say so once, the tone keeps playing on the modelled amp
rig.addEventListener('capture-error', (e) => {
  const { cap, error } = e.detail || {};
  toast({ title: 'That real amp didn’t load', message: `${cap && cap.pack ? cap.pack.title : 'The capture'} plays as the modelled amp instead. ${error || ''}`.trim(), kind: 'err' });
});
