/** Settings, stem engine setup, file renaming, backups and the activity pill. */
import { api } from './api.js';
import { state, on, emit, bump, loadLibrary, upsertSongs, loadRocksmith } from './store.js';
import { h, icon, esc, modal, toast, fmtBytes, fmtDateTime, confirmDialog, debounce } from './ui.js';
import * as actions from './actions.js';

// ---------------------------------------------------------- engine setup --
const VARIANT_LABEL = { cpu: 'CPU only', cu126: 'NVIDIA GPU (CUDA 12.6)', cu128: 'NVIDIA GPU (CUDA 12.8)' };

/**
 * Installs the stem engine, or with mode 'switch' swaps PyTorch for the build
 * that matches the graphics card.
 */
export async function engineSetup({ thenStems = null, mode = 'install', variant: preset = null } = {}) {
  let gpuInfo = null;
  try {
    gpuInfo = await api.engine.gpu();
  } catch (_) {}
  const card = gpuInfo && gpuInfo.gpu;
  const autoVariant = (gpuInfo && gpuInfo.variant) || 'cpu';
  const switching = mode === 'switch';
  const body = h('div');
  const intro = h('div');
  const others = ((gpuInfo && gpuInfo.gpus) || []).filter((g) => g.vendor !== 'nvidia');
  let gpuLine;
  if (switching) {
    gpuLine = `Stagehand will replace the CPU-only version of PyTorch with the GPU version for your ${card ? card.name : 'NVIDIA card'}. It's about a 2.5 GB download. Python, Demucs, the model and all your stems stay as they are.`;
  } else if (card && autoVariant !== 'cpu') {
    gpuLine = `Found ${card.name}. Stagehand will install the NVIDIA GPU version, which splits a song in under a minute on most cards. The download is about 3 GB.`;
  } else if (card) {
    gpuLine = `Found ${card.name}, but it's too old for current GPU builds of PyTorch, so Stagehand will install the CPU version (about 1 GB).`;
  } else if (others.length) {
    gpuLine = `Found ${others[0].name}. Demucs can only use NVIDIA graphics cards, so Stagehand will install the CPU version (about 1 GB). Splitting a song takes a few minutes.`;
  } else {
    gpuLine = 'No NVIDIA graphics card was found, so Stagehand will install the CPU version (about 1 GB). Splitting a song takes a few minutes on most PCs.';
  }
  intro.innerHTML = switching
    ? `<p>${esc(gpuLine)}</p>`
    : `<p>Stem separation uses <b>Demucs</b>, an open-source model from Meta that splits a song into guitar, bass, drums, vocals, keys and everything else. It runs entirely on your PC.</p><p>${esc(gpuLine)}</p><p>Everything installs into Stagehand’s own folder and can be removed from Settings.</p>`;
  body.append(intro);

  const variant = h('select.input', { 'aria-label': 'Install type', style: { width: 'auto' } });
  const opts = [
    ['auto', `Automatic (${VARIANT_LABEL[autoVariant] || autoVariant})`],
    ['cpu', VARIANT_LABEL.cpu],
    ['cu126', `${VARIANT_LABEL.cu126}, GTX 10 series to RTX 40 series`],
    ['cu128', `${VARIANT_LABEL.cu128}, also RTX 50 series`],
  ];
  for (const [v, l] of opts) variant.append(h('option', { value: v, text: l, selected: (preset || 'auto') === v ? true : null }));
  const advanced = h('details', { style: { margin: '4px 0 10px' } });
  advanced.append(h('summary', { text: 'Install options', style: { cursor: 'pointer', color: 'var(--ink-2)' } }));
  advanced.append(h('div', { style: { marginTop: '8px' } }, variant));
  body.append(advanced);

  const steps = h('div.steps', { hidden: true });
  const log = h('div.logbox', { hidden: true });
  body.append(steps, log);

  const start = h('button.btn.primary', { type: 'button', text: switching ? 'Switch to GPU' : 'Install' });
  const cancel = h('button.btn.ghost', { type: 'button', text: 'Not now' });
  const m = modal({ title: switching ? 'Use your graphics card for stems' : 'Set up stem separation', body, footer: [cancel, start], dismissable: true });
  let running = false;
  cancel.onclick = () => {
    if (running) api.engine.cancel();
    else m.close();
  };
  start.onclick = async () => {
    running = true;
    start.disabled = true;
    start.innerHTML = `<span class="spin"></span><span>${switching ? 'Switching' : 'Installing'}</span>`;
    cancel.textContent = 'Cancel';
    intro.hidden = true;
    advanced.hidden = true;
    steps.hidden = false;
    log.hidden = false;
    steps.innerHTML = '';
    const stepEls = [];
    for (const n of ['Download uv', 'Install Python', 'Install PyTorch', 'Install Demucs', 'Download separation model', 'Test the engine']) {
      const el = h('div.step', null, h('span.dot'), h('span.n', { text: n }), h('span.v'));
      stepEls.push(el);
      steps.append(el);
    }
    const off = api.on('engine:progress', (p) => {
      if (p.log) {
        log.textContent += p.log + '\n';
        if (log.textContent.length > 60000) log.textContent = log.textContent.slice(-40000);
        log.scrollTop = log.scrollHeight;
      }
      if (p.step) {
        stepEls.forEach((el, i) => {
          el.classList.toggle('done', i < p.index);
          el.classList.toggle('active', i === p.index);
          if (i === p.index) el.querySelector('.v').textContent = p.value ? `${Math.round(p.value * 100)}%` : p.detail || '';
        });
      }
    });
    try {
      const status = await api.engine.setup({ variant: variant.value });
      off();
      state.engine = status;
      running = false;
      emit('engine');
      const wantedGpu = (variant.value === 'auto' ? autoVariant : variant.value) !== 'cpu';
      if (wantedGpu && status.device !== 'cuda') {
        // Installed, but the card still isn't usable: keep the dialog open with the reason.
        stepEls.forEach((el) => el.classList.remove('active'));
        start.disabled = false;
        start.textContent = 'Try again';
        cancel.textContent = 'Close';
        const why = status.advice ? status.advice.detail : status.cudaError || 'PyTorch could not use the graphics card.';
        log.textContent += `\nThe engine works, but it is still running on the CPU.\n${why}\n`;
        log.scrollTop = log.scrollHeight;
        toast({ title: 'Your GPU still isn’t being used', message: why, kind: 'err' });
        return;
      }
      stepEls.forEach((el) => {
        el.classList.add('done');
        el.classList.remove('active');
      });
      m.close();
      toast({ title: switching ? 'Stems now use your GPU' : 'Stem separation is ready', message: `Running on ${status.deviceName || status.device}.` });
      if (thenStems && thenStems.length) actions.requestStems(thenStems);
    } catch (err) {
      off();
      running = false;
      start.disabled = false;
      start.textContent = 'Try again';
      cancel.textContent = 'Close';
      if (!err.message.includes('Cancelled')) log.textContent += `\n${err.message}\n`;
      log.scrollTop = log.scrollHeight;
      toast({ title: err.message.includes('Cancelled') ? 'Setup cancelled' : 'Setup did not finish', message: err.message.includes('Cancelled') ? '' : err.message, kind: err.message.includes('Cancelled') ? 'info' : 'err' });
    }
  };
}

/** Opens the right fix for the engine's current advice. */
export function fixDevice(advice) {
  if (!advice) return;
  if (advice.action === 'driver') {
    api.shell.openExternal('https://www.nvidia.com/en-us/drivers/');
    return;
  }
  engineSetup({ mode: 'switch', variant: advice.variant && advice.variant.startsWith('cu') ? advice.variant : null });
}

// --------------------------------------------------------------- settings --
function setting(title, desc, ...controls) {
  return h('div.setting', null, h('div.t', { text: title }), h('div.d', { html: desc }), h('div.ctl', null, ...controls));
}

function toggleCtl(checked, onChange, label) {
  const t = h('input.toggle', { type: 'checkbox', 'aria-label': label });
  t.checked = !!checked;
  t.onchange = () => onChange(t.checked);
  return t;
}

async function saveSettings(patch) {
  state.settings = await api.settings.set(patch);
  emit('settings');
}

export async function settings(tab = 'library') {
  state.settings = await api.settings.get();
  const nav = h('nav');
  const section = h('section');
  const wrap = h('div.settings', null, nav, section);
  const tabs = [
    ['library', 'Library'],
    ['guitar', 'Guitar & audio'],
    ['amps', 'Real amps'],
    ['playback', 'Playback'],
    ['stems', 'Stems'],
    ['saving', 'Saving and backups'],
    ['storage', 'Storage'],
    ['about', 'About'],
  ];
  const m = modal({ title: 'Settings', body: wrap, wide: true });
  m.body.style.padding = '0';
  const show = async (key) => {
    nav.querySelectorAll('.nav-item').forEach((b) => b.setAttribute('aria-current', String(b.dataset.tab === key)));
    section.innerHTML = '';
    await PANES[key](section);
  };
  for (const [k, label] of tabs) {
    const b = h('button.nav-item', { type: 'button', text: label });
    b.dataset.tab = k;
    b.onclick = () => show(k);
    nav.append(b);
  }
  show(tab);
}

const PANES = {
  async guitar(el) {
    await (await import('./guitarsettings.js')).pane(el, setting);
  },
  async amps(el) {
    await (await import('./realamps.js')).pane(el, setting);
  },
  async library(el) {
    const s = state.settings;
    void s;
    el.append(h('h3', { text: 'Folders', style: { margin: '10px 0 2px', fontSize: '14px', color: 'var(--ink)' } }));
    el.append(h('div.d', { text: 'Stagehand reads .psarc files in these folders and their subfolders. Changes on disk are picked up automatically.', style: { color: 'var(--ink-3)', fontSize: '12.5px' } }));
    const list = h('div.folder-list');
    const draw = () => {
      list.innerHTML = '';
      if (!state.folders.length) list.append(h('div', { text: 'No folders yet.', style: { color: 'var(--ink-3)' } }));
      for (const f of state.folders) {
        const row = h('div.folder-row', null, h('span', { html: icon('folder') }), h('span.p', { text: f.path, title: f.path }));
        if (!f.exists) row.append(h('span.status-pill.bad', { text: 'Missing' }));
        const rm = h('button.btn.small.ghost', { type: 'button', text: 'Remove' });
        rm.onclick = async () => {
          await api.library.removeFolder(f.path);
          await loadLibrary();
          draw();
        };
        row.append(rm);
        list.append(row);
      }
    };
    draw();
    el.append(list);
    const add = h('button.btn', { type: 'button', html: `${icon('folderPlus')}<span>Add folder</span>` });
    add.onclick = async () => {
      if (await api.library.addFolder()) {
        await loadLibrary();
        draw();
      }
    };
    const rescan = h('button.btn.ghost', { type: 'button', html: `${icon('refresh')}<span>Re-read every file</span>` });
    rescan.onclick = () => {
      api.library.rescan({ full: true });
      toast({ title: 'Re-reading your library', kind: 'info' });
    };
    el.append(h('div', { style: { display: 'flex', gap: '8px', margin: '6px 0 16px' } }, add, rescan));
    if (state.unreadable.length) {
      el.append(h('h3', { text: `Files Stagehand could not read (${state.unreadable.length})`, style: { margin: '10px 0 6px', fontSize: '14px', color: 'var(--ink)' } }));
      const box = h('div.logbox', { style: { height: 'auto', maxHeight: '160px' } });
      box.textContent = state.unreadable.map((u) => `${u.path}\n  ${u.error}`).join('\n');
      el.append(box);
    }
  },

  async playback(el) {
    const s = state.settings;
    el.append(
      setting('Start playing when a song opens', 'When this is off, double-clicking a song loads it paused so you can set up the mix first. The play buttons on covers always play.', toggleCtl(s.playback.autoplay, (v) => saveSettings({ playback: { autoplay: v } }), 'Autoplay'))
    );
    const end = h('select.input', { 'aria-label': 'When a song ends' });
    for (const [v, l] of [
      ['stop', 'Stop'],
      ['next', 'Play the next song'],
    ])
      end.append(h('option', { value: v, text: l, selected: s.playback.endAction === v ? true : null }));
    end.onchange = () => saveSettings({ playback: { endAction: end.value } });
    el.append(setting('When a song ends', 'Looping a section keeps playing that section regardless of this setting.', end));

    const dev = h('select.input', { 'aria-label': 'Output device' });
    dev.append(h('option', { value: '', text: 'System default' }));
    try {
      const devices = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'audiooutput' && d.deviceId !== 'default');
      for (const d of devices) dev.append(h('option', { value: d.deviceId, text: d.label || 'Output device', selected: s.ui.sinkId === d.deviceId ? true : null }));
    } catch (_) {}
    dev.onchange = async () => {
      await saveSettings({ ui: { sinkId: dev.value } });
      try {
        const stage = await import('./stage.js');
        await stage.setSink(dev.value);
      } catch (err) {
        toast({ title: 'Could not switch output', message: err.message, kind: 'err' });
      }
    };
    el.append(setting('Output device', 'Where Stagehand plays audio. Pick your audio interface or headphones.', dev));
  },

  async stems(el) {
    const s = state.settings;
    const status = h('span.status-pill', { text: 'Checking…' });
    const actionsBox = h('div', { style: { display: 'flex', gap: '8px', flexWrap: 'wrap', justifyContent: 'flex-end' } });
    const engineRow = setting('Separation engine', 'Checking which processor Demucs runs on…', status, actionsBox);
    const desc = engineRow.querySelector('.d');
    el.append(engineRow);
    const draw = (st) => {
      state.engine = st;
      actionsBox.innerHTML = '';
      const a = st.advice || {};
      if (st.installed) {
        status.className = `status-pill ${a.onGpu ? 'ok' : a.action ? 'warn' : 'ok'}`;
        status.textContent = a.onGpu ? `GPU: ${st.deviceName}` : 'CPU';
        status.title = '';
        const parts = [esc(a.detail || '')];
        if (a.error) parts.push(`<span style="color:var(--ink-3)">PyTorch said: ${esc(a.error)}</span>`);
        if (st.torch) parts.push(`<span style="color:var(--ink-3)">PyTorch ${esc(st.torch)}${st.threads ? `, ${st.threads} CPU threads` : ''}</span>`);
        desc.innerHTML = parts.filter(Boolean).join('<br>');
        if (a.action === 'switch') {
          const b = h('button.btn.small.primary', { type: 'button', text: a.kind === 'switch' && /CPU-only/.test(a.detail) ? 'Switch to GPU' : 'Reinstall GPU version' });
          b.onclick = () => fixDevice(a);
          actionsBox.append(b);
        } else if (a.action === 'driver') {
          const b = h('button.btn.small.primary', { type: 'button', text: 'Get NVIDIA driver' });
          b.onclick = () => fixDevice(a);
          actionsBox.append(b);
        }
        const recheck = h('button.btn.small.ghost', { type: 'button', text: 'Check again' });
        recheck.onclick = async () => {
          status.className = 'status-pill';
          status.textContent = 'Checking…';
          draw(await api.engine.status(true));
        };
        const rm = h('button.btn.small.ghost', { type: 'button', text: 'Remove' });
        rm.onclick = async () => {
          if (await confirmDialog({ title: 'Remove the stem engine?', message: 'This deletes Stagehand’s Python, PyTorch and Demucs install. Stems you already separated are kept.', confirm: 'Remove', danger: true })) {
            await api.engine.remove();
            state.engine = { installed: false };
            emit('engine');
            el.innerHTML = '';
            PANES.stems(el);
          }
        };
        actionsBox.append(recheck, rm);
      } else {
        status.className = `status-pill ${st.error ? 'bad' : 'warn'}`;
        status.textContent = st.error ? 'Not working' : 'Not installed';
        desc.textContent = st.error ? `The engine did not start: ${st.error}` : a.gpu ? `Not installed yet. Found ${a.gpu}.` : 'Not installed yet.';
        const go = h('button.btn.small.primary', { type: 'button', text: st.error ? 'Reinstall' : 'Set up' });
        go.onclick = () => engineSetup();
        actionsBox.append(go);
      }
      emit('engine');
    };
    api.engine.status(true).then(draw);

    const model = h('select.input', { 'aria-label': 'Separation model' });
    const models = state.info.models;
    for (const [k, v] of Object.entries(models)) model.append(h('option', { value: k, text: v.label, selected: s.stems.model === k ? true : null }));
    model.onchange = () => saveSettings({ stems: { model: model.value } });
    el.append(setting('Model', 'The 6-stem model is the only one that separates guitar and keys. Songs you already split keep their stems.', model));
    for (const r of await (await import('./stemformat.js')).settingsRows(setting)) el.append(r);

    const quality = h('select.input', { 'aria-label': 'Quality' });
    for (const [v, l] of [
      [1, 'Standard'],
      [2, 'Better (2× slower)'],
      [4, 'Best (4× slower)'],
    ])
      quality.append(h('option', { value: String(v), text: l, selected: Number(s.stems.shifts) === v ? true : null }));
    quality.onchange = () => saveSettings({ stems: { shifts: Number(quality.value) } });
    el.append(setting('Quality', 'Higher quality averages several passes over the song, which reduces bleed between instruments.', quality));

    const device = h('select.input', { 'aria-label': 'Device' });
    for (const [v, l] of [
      ['auto', 'Use the GPU when available'],
      ['cpu', 'Always use the CPU'],
    ])
      device.append(h('option', { value: v, text: l, selected: s.stems.device === v ? true : null }));
    device.onchange = async () => {
      await saveSettings({ stems: { device: device.value } });
      draw(await api.engine.status());
    };
    el.append(setting('Processor', 'Use the CPU only if separating stems makes your games stutter while they run together.', device));

    const load = h('select.input', { 'aria-label': 'CPU load' });
    for (const [v, l] of [
      ['full', 'All cores (fastest, runs hottest)'],
      ['half', 'Half the cores (cooler)'],
      ['low', 'A quarter of the cores (quietest, slowest)'],
    ])
      load.append(h('option', { value: v, text: l, selected: (s.stems.cpuLoad || 'full') === v ? true : null }));
    load.onchange = () => saveSettings({ stems: { cpuLoad: load.value } });
    el.append(setting('CPU load', 'How hard separation works the CPU when it runs there. Separation always runs at low priority, so other apps stay responsive. On a GPU the CPU stays mostly idle either way.', load));

    el.append(setting('Split songs automatically', 'When you open a song without stems, start separating it in the background.', toggleCtl(s.stems.auto, (v) => saveSettings({ stems: { auto: v } }), 'Split automatically')));
    el.append(setting('Wait for the stems', 'When you open a song to play, it starts once its stems are split and loaded (they’re split for you), so the mix never changes under you. You can always press Play now.', toggleCtl(s.stems.waitFirst !== false, (v) => saveSettings({ stems: { waitFirst: v } }), 'Wait for the stems')));
    el.append(setting('Switch to stems when ready', 'Play through the stem mixer as soon as a song’s stems load, instead of the full mix.', toggleCtl(s.stems.preferStems, (v) => saveSettings({ stems: { preferStems: v } }), 'Prefer stems')));
  },

  async rocksmith(el) {
    el.append(h('p', { text: 'Reading your Rocksmith profile…', style: { color: 'var(--ink-3)' } }));
    const r = await loadRocksmith();
    el.innerHTML = '';
    const draw = async () => {
      const rs = state.rs;
      el.innerHTML = '';
      const pick = h('select.input', { 'aria-label': 'Rocksmith profile', style: { maxWidth: '240px' } });
      for (const p of rs.profiles || []) {
        const who = p.name || p.uniqueId;
        const acct = p.accountName ? `, Steam account ${p.accountName}` : rs.profiles.some((x) => x.account !== p.account) ? `, Steam account ${p.account}` : '';
        pick.append(h('option', { value: p.id, text: `${who}${acct}`, selected: rs.profile && rs.profile.id === p.id ? true : null }));
      }
      pick.onchange = async () => {
        state.rs = await api.rocksmith.select(pick.value);
        bump();
        emit('rocksmith');
        draw();
      };
      const findSteam = h('button.btn.small.ghost', { type: 'button', text: rs.steam ? 'Change Steam folder' : 'Find Steam folder' });
      findSteam.onclick = async () => {
        try {
          const next = await api.rocksmith.pickSteam();
          if (next) {
            state.rs = next;
            bump();
            emit('rocksmith');
            draw();
          }
        } catch (err) {
          toast({ title: 'Not a Steam folder', message: err.message, kind: 'err' });
        }
      };
      if (rs.profiles && rs.profiles.length) {
        const desc = rs.error
          ? `<span style="color:#ffc1c1">This profile could not be read: ${esc(rs.error)}</span>`
          : `Stagehand edits Favorites and the ${rs.lists ? rs.lists.length : 6} song lists in this profile.${rs.steam ? `<br><span class="path">${esc(rs.profile.file)}</span>` : ''}`;
        el.append(setting('Profile', desc, pick, findSteam));
      } else {
        el.append(setting('Profile', rs.steam ? `No Rocksmith profile was found in ${esc(rs.steam)}. Start Rocksmith once on this PC to create one.` : 'Steam wasn’t found in its usual place. Point Stagehand at your Steam folder.', findSteam));
      }
      const mods = rs.rsmods || {};
      const chooseGame = h('button.btn.small.ghost', { type: 'button', text: mods.gameDir ? 'Change game folder' : 'Find game folder' });
      chooseGame.onclick = async () => {
        if (await actions.pickGameFolder()) draw();
      };
      const nameCtl = [];
      if (mods.gameDir && !mods.installed) {
        const get = h('button.btn.small', { type: 'button', text: 'Get RSMods' });
        get.onclick = () => api.shell.openExternal(actions.RSMODS_URL);
        nameCtl.push(get);
      }
      nameCtl.push(chooseGame);
      const nameDesc = !mods.gameDir
        ? 'Stagehand couldn’t find your Rocksmith 2014 folder, which is where list names are kept. Choose it to rename lists.'
        : mods.installed
          ? `Double-click a song list in the sidebar to rename it, or press + to add one, up to 20. RSMods shows the names and extra lists in the game.<br><span class="path">${esc(mods.gameDir)}</span>`
          : `Rocksmith always calls its lists SONG LIST 1 to 6. The free RSMods mod lets the game show your own names and up to 20 lists. Stagehand saves names where RSMods reads them, so they appear once it’s installed.<br><span class="path">${esc(mods.gameDir)}</span>`;
      const pill = h('span', { class: `status-pill ${mods.installed ? 'ok' : 'warn'}`, text: mods.installed ? 'RSMods installed' : mods.gameDir ? 'RSMods not installed' : 'Game not found' });
      el.append(setting('Song list names and extra lists', nameDesc, pill, ...nameCtl));
      el.append(
        setting(
          'How changes are made',
          'Rocksmith must be closed while Stagehand changes a list, or the game would overwrite it when it saves. Each change backs up your profile first, changes only the song lists inside it, checks the result, and updates Steam Cloud’s records so the new lists sync instead of being replaced by the old ones.'
        )
      );
      if (!rs.profile) return;
      const list = await api.rocksmith.backups().catch(() => []);
      const box = h('div');
      if (!list.length) {
        box.append(h('div', { text: 'No backups yet. One is made before every change.', style: { color: 'var(--ink-3)' } }));
      } else {
        const t = h('table.plan-table');
        t.innerHTML = '<thead><tr><th>Saved</th><th>Lists at the time</th><th></th></tr></thead>';
        const tb = h('tbody');
        for (const b of list) {
          const tr = h('tr');
          const inLists = b.counts.lists.reduce((a, x) => a + x, 0);
          const counts = `${b.counts.favorites} favorites, ${inLists} song${inLists === 1 ? '' : 's'} across ${b.counts.lists.length} lists`;
          tr.innerHTML = `<td>${esc(fmtDateTime(b.at))}${b.reason === 'before-restore' ? ' <span style="color:var(--ink-3)">(before a restore)</span>' : ''}</td><td>${esc(counts)}</td>`;
          const td = h('td', { style: { textAlign: 'right' } });
          const btn = h('button.btn.small', { type: 'button', text: 'Restore' });
          btn.onclick = async () => {
            if (!(await confirmDialog({ title: 'Restore this profile backup?', message: `Your Rocksmith profile goes back to how it was on ${fmtDateTime(b.at)}, including any progress made since. Your current profile is backed up first.`, confirm: 'Restore' }))) return;
            btn.disabled = true;
            try {
              state.rs = await api.rocksmith.restore(b.id);
              bump();
              emit('rocksmith');
              toast({ title: 'Profile restored' });
              draw();
            } catch (err) {
              btn.disabled = false;
              toast({ title: 'Could not restore', message: err.code === 'RS_RUNNING' ? 'Close Rocksmith first.' : err.message, kind: 'err' });
            }
          };
          td.append(btn);
          tr.append(td);
          tb.append(tr);
        }
        t.append(tb);
        box.append(h('div.plan-wrap', null, t));
      }
      el.append(h('h3', { text: 'Profile backups', style: { margin: '16px 0 8px', fontSize: '14px', color: 'var(--ink)' } }), box);
      const open = h('button.btn.small.ghost', { type: 'button', text: 'Open backup folder', style: { marginTop: '8px' } });
      open.onclick = () => api.shell.openPath(state.info.dirs.profileBackups);
      el.append(open);
    };
    void r;
    draw();
  },

  async saving(el) {
    const s = state.settings;
    el.append(
      setting(
        'How saving works',
        'When you save details, Stagehand writes a new copy of the .psarc beside the original, changing only the edited text inside the song manifests. It then reads the copy back and checks every file inside it against the original before swapping it in. If anything fails, your original is left exactly as it was.'
      )
    );
    el.append(setting('Keep a backup before each save', 'Backups go to Stagehand’s own folder, not your Rocksmith folder, so the game never sees duplicates.', toggleCtl(s.backups.enabled, (v) => saveSettings({ backups: { enabled: v } }), 'Keep backups')));
    const keep = h('select.input', { 'aria-label': 'Backups to keep' });
    for (const n of [1, 3, 5, 10, 25]) keep.append(h('option', { value: String(n), text: `${n} per song`, selected: s.backups.keep === n ? true : null }));
    keep.onchange = () => saveSettings({ backups: { keep: Number(keep.value) } });
    el.append(setting('Backups to keep', 'Older backups of the same file are removed automatically.', keep));
    const open = h('button.btn.small', { type: 'button', text: 'Open backup folder' });
    open.onclick = () => api.shell.openPath(state.info.dirs.backups);
    el.append(setting('Backup folder', esc(state.info.dirs.backups), open));
  },

  async storage(el) {
    el.append(h('p', { text: 'Measuring…', style: { color: 'var(--ink-3)' } }));
    const info = await api.cache.info();
    el.innerHTML = '';
    const s = state.settings;
    const row = (title, desc, size, which) => {
      const ctl = [h('span', { text: fmtBytes(size), style: { color: 'var(--ink-2)', fontVariantNumeric: 'tabular-nums' } })];
      if (which) {
        const b = h('button.btn.small.ghost', { type: 'button', text: 'Clear' });
        b.onclick = async () => {
          if (which === 'stems' && !(await confirmDialog({ title: 'Delete all stems?', message: 'Every separated song will need to be split again.', confirm: 'Delete stems', danger: true }))) return;
          await api.cache.clear(which);
          if (which === 'stems') {
            state.stems.clear();
            await loadLibrary();
            emit('stems');
          }
          PANES.storage((el.innerHTML = '', el));
        };
        ctl.push(b);
      }
      el.append(setting(title, desc, ...ctl));
    };
    row('Stems', 'Separated instruments for each song. These take time to make, so they are never removed automatically.', info.stems, 'stems');
    row('Decoded audio', 'Playable copies of song audio. Rebuilt quickly when needed.', info.audio, 'audio');
    row('Album art', 'Cover images converted for display.', info.art, 'art');
    row('Backups', 'Copies of songs from before you edited them.', info.backups, null);
    row('Stem engine', 'Python, PyTorch and the Demucs model.', info.engine, null);
    const lim = h('select.input', { 'aria-label': 'Decoded audio limit' });
    for (const n of [2, 4, 8, 16]) lim.append(h('option', { value: String(n), text: `${n} GB`, selected: s.cache.audioLimitGB === n ? true : null }));
    lim.onchange = () => saveSettings({ cache: { audioLimitGB: Number(lim.value) } });
    el.append(setting('Decoded audio limit', 'The least recently played songs are removed first.', lim));
  },

  async about(el) {
    const vg = (await api.tools.vgmstream().catch(() => null)) || {};
    el.append(
      h('div.about-brand', null, h('img', { src: 'splash/logo-256.png', alt: 'Noisewater Labs', title: 'Noisewater Labs', width: '44', height: '44' }), h('div', { style: { lineHeight: '1.5' } }, h('div', { style: { fontSize: '20px', fontWeight: '750', fontStretch: '118%', color: 'var(--ink)' }, text: 'Stagehand' }), h('div', { text: `Version ${state.info.version} · Noisewater Labs` })))
    );
    el.append(...(await (await import('./updates.js')).aboutRows(setting, toggleCtl, saveSettings)));
    el.append(setting('Audio decoder', vg.path ? esc(vg.path) : 'Not installed yet. It installs the first time you play a song.', h('span', { class: `status-pill ${vg.path ? 'ok' : 'warn'}`, text: vg.path ? 'Installed' : 'Missing' })));
    el.append(setting('Credits', 'Audio decoding by vgmstream. Stem separation by Demucs (Meta AI). Artist and album data from MusicBrainz; album covers from the Cover Art Archive. Interface set in Archivo by Omnibus-Type.'));
    const logBtn = h('button.btn.small', { type: 'button', text: 'Show log' });
    logBtn.onclick = async () => {
      const lines = await api.app.log();
      const box = h('div.logbox', { style: { height: '320px' } });
      box.textContent = lines.join('\n') || 'Nothing logged yet.';
      modal({ title: 'Activity log', body: box, wide: true });
    };
    el.append(setting('Troubleshooting', 'Recent errors and saves, useful when something does not work.', logBtn));
  },
};

// ---------------------------------------------------------------- organize --
const PRESETS = ['{artist} - {title}', '{artist} - {title}_v{version}', '{artist}_{title}', '{title} ({artist})'];

export async function organize(songIds) {
  const ids = songIds && songIds.length ? songIds : [...state.songs.keys()];
  const s = state.settings || (await api.settings.get());
  const body = h('div');
  body.append(h('p', { text: `Rename ${ids.length === state.songs.size ? 'every' : ids.length} song file${ids.length === 1 ? '' : 's'} from their details. The _p or _m ending that Rocksmith uses is kept automatically. Nothing inside the files changes.` }));
  const pattern = h('input.input', { value: (s.ui && s.ui.renamePattern) || PRESETS[0], spellcheck: 'false', 'aria-label': 'Name pattern' });
  body.append(h('label.field', null, h('span', { text: 'File name pattern' }), pattern));
  const tokens = h('div.token-row');
  for (const t of ['artist', 'title', 'album', 'year', 'author', 'version', 'tuning']) {
    const b = h('button', { type: 'button', text: `{${t}}` });
    b.onclick = () => {
      const pos = pattern.selectionStart ?? pattern.value.length;
      pattern.value = pattern.value.slice(0, pos) + `{${t}}` + pattern.value.slice(pattern.selectionEnd ?? pos);
      pattern.focus();
      refresh();
    };
    tokens.append(b);
  }
  for (const p of PRESETS) {
    const b = h('button', { type: 'button', text: p, title: 'Use this pattern', style: { borderStyle: 'dashed' } });
    b.onclick = () => {
      pattern.value = p;
      refresh();
    };
    tokens.append(b);
  }
  body.append(tokens);
  const mode = h('div.seg', { role: 'group', 'aria-label': 'Where files go', style: { marginBottom: '12px' } });
  const inPlace = h('button', { type: 'button', text: 'Rename in place', 'aria-pressed': 'true' });
  const folders = h('button', { type: 'button', text: 'Sort into artist folders', 'aria-pressed': 'false' });
  let modeVal = 'rename';
  inPlace.onclick = () => {
    modeVal = 'rename';
    inPlace.setAttribute('aria-pressed', 'true');
    folders.setAttribute('aria-pressed', 'false');
    refresh();
  };
  folders.onclick = () => {
    modeVal = 'folders';
    inPlace.setAttribute('aria-pressed', 'false');
    folders.setAttribute('aria-pressed', 'true');
    refresh();
  };
  mode.append(inPlace, folders);
  body.append(mode);
  const summary = h('div', { style: { margin: '0 0 8px', color: 'var(--ink-2)' } });
  const tableWrap = h('div.plan-wrap');
  body.append(summary, tableWrap);
  const apply = h('button.btn.primary', { type: 'button', text: 'Rename files' });
  const cancel = h('button.btn.ghost', { type: 'button', text: 'Cancel' });
  const undo = h('button.btn.ghost', { type: 'button', text: 'Undo last rename', hidden: true });
  const left = h('span.left');
  left.append(undo);
  const m = modal({ title: 'Rename files', body, footer: [left, cancel, apply], wide: true });
  cancel.onclick = () => m.close();
  api.organize.last().then((last) => {
    if (last) {
      undo.hidden = false;
      undo.title = `${last.moves.length} file${last.moves.length === 1 ? '' : 's'} on ${fmtDateTime(last.at)}`;
    }
  });
  undo.onclick = async () => {
    const r = await api.organize.undo();
    await loadLibrary();
    toast({ title: `Restored ${r.undone} file name${r.undone === 1 ? '' : 's'}`, message: r.failed.length ? `${r.failed.length} could not be restored.` : '', kind: r.failed.length ? 'err' : 'ok' });
    m.close();
  };
  let plan = [];
  const refresh = debounce(async () => {
    plan = await api.organize.preview({ songIds: ids, pattern: pattern.value, mode: modeVal });
    const ok = plan.filter((p) => p.status === 'ok').length;
    const conflicts = plan.filter((p) => p.status === 'conflict').length;
    summary.textContent = `${ok} file${ok === 1 ? '' : 's'} will be renamed${conflicts ? `, ${conflicts} skipped because of name clashes` : ''}.`;
    apply.disabled = !ok;
    apply.textContent = ok ? `Rename ${ok} file${ok === 1 ? '' : 's'}` : 'Rename files';
    const t = h('table.plan-table');
    t.innerHTML = '<thead><tr><th>Current name</th><th>New name</th></tr></thead>';
    const tb = h('tbody');
    const base = (p) => p.split(/[\\/]/).slice(modeVal === 'folders' ? -2 : -1).join('\\');
    for (const p of plan.slice(0, 500)) {
      const tr = h('tr', { class: p.status });
      tr.innerHTML = `<td>${esc(base(p.from))}</td><td class="to">${esc(base(p.to))}${p.reason && p.status !== 'ok' ? `<div style="color:var(--ink-3)">${esc(p.reason)}</div>` : ''}</td>`;
      tb.append(tr);
    }
    t.append(tb);
    tableWrap.innerHTML = '';
    tableWrap.append(t);
  }, 150);
  pattern.addEventListener('input', refresh);
  apply.onclick = async () => {
    apply.disabled = true;
    apply.innerHTML = '<span class="spin"></span><span>Renaming</span>';
    const results = await api.organize.apply(plan);
    await saveSettings({ ui: { renamePattern: pattern.value } });
    await loadLibrary();
    const done = results.filter((r) => r.status === 'done').length;
    const failed = results.filter((r) => r.status === 'error');
    m.close();
    toast({
      title: `Renamed ${done} file${done === 1 ? '' : 's'}`,
      message: failed.length ? `${failed.length} failed: ${failed[0].reason}` : '',
      kind: failed.length ? 'err' : 'ok',
      actions: done
        ? [
            {
              label: 'Undo',
              onClick: async () => {
                await api.organize.undo();
                await loadLibrary();
              },
            },
          ]
        : [],
    });
  };
  refresh();
}

// ----------------------------------------------------------------- backups --
export async function backups(song) {
  const list = await api.edit.backups(song.id);
  const body = h('div');
  if (!list.length) {
    body.append(h('p', { text: 'There are no backups of this file yet. Stagehand makes one every time you save details.' }));
    modal({ title: 'Backups', body });
    return;
  }
  body.append(h('p', { text: `Restoring replaces ${song.fileName} with the copy you pick. The current file is backed up first, so this can be undone too.` }));
  const t = h('table.plan-table');
  t.innerHTML = '<thead><tr><th>Saved</th><th>Size</th><th></th></tr></thead>';
  const tb = h('tbody');
  const m = modal({ title: 'Restore a backup', body, wide: false });
  for (const b of list) {
    const tr = h('tr');
    tr.innerHTML = `<td>${esc(fmtDateTime(b.at))}${b.beforeRestore ? ' <span style="color:var(--ink-3)">(before a restore)</span>' : ''}</td><td>${esc(fmtBytes(b.size))}</td>`;
    const td = h('td', { style: { textAlign: 'right' } });
    const r = h('button.btn.small', { type: 'button', text: 'Restore' });
    r.onclick = async () => {
      r.disabled = true;
      try {
        const fresh = await api.edit.restore(song.id, b.path);
        upsertSongs(fresh);
        toast({ title: 'Backup restored', message: song.fileName });
        m.close();
      } catch (err) {
        r.disabled = false;
        toast({ title: 'Could not restore', message: err.message, kind: 'err' });
      }
    };
    td.append(r);
    tr.append(td);
    tb.append(tr);
  }
  t.append(tb);
  body.append(t);
}

// ---------------------------------------------------------------- activity --
const pill = document.getElementById('activity');
let popover = null;
function renderActivity() {
  const scan = state.scan && state.scan.state !== 'done' ? state.scan : null;
  const busy = [...state.stems.entries()].filter(([, s]) => s.state === 'running' || s.state === 'queued');
  const running = busy.find(([, s]) => s.state === 'running');
  if (!scan && !busy.length) {
    pill.hidden = true;
    if (popover) closePopover();
    return;
  }
  pill.hidden = false;
  let text;
  if (scan) text = scan.total ? `Reading songs ${scan.done} of ${scan.total}` : 'Looking for songs';
  else if (running) {
    const song = state.songs.get(running[0]);
    text = `Splitting ${song ? song.title : 'song'} ${Math.round((running[1].progress || 0) * 100)}%`;
  } else text = `${busy.length} waiting to split`;
  if (!scan && busy.length > 1) text += ` (+${busy.length - 1})`;
  pill.innerHTML = `<span class="spin"></span><span>${esc(text)}</span>`;
  if (popover) fillPopover();
}

function fillPopover() {
  popover.innerHTML = '';
  if (state.scan && state.scan.state !== 'done') {
    popover.append(h('h4', { text: 'Library' }));
    const s = state.scan;
    const it = h('div.qitem', null, h('div.n', { text: s.total ? `Reading ${s.done} of ${s.total} files` : 'Looking for songs' }), h('div.s', { text: s.file || '' }));
    if (s.total) it.append(h('div.progress', { style: { '--p': `${Math.round((s.done / s.total) * 100)}%` } }, h('i')));
    popover.append(it);
  }
  const busy = [...state.stems.entries()].filter(([, s]) => s.state === 'running' || s.state === 'queued');
  if (busy.length) {
    popover.append(h('h4', { text: 'Stem separation', style: { marginTop: '8px' } }));
    busy.sort((a, b) => (a[1].state === 'running' ? -1 : b[1].state === 'running' ? 1 : 0));
    for (const [id, st] of busy) {
      const song = state.songs.get(id);
      const cancel = h('button.btn.small.ghost', { type: 'button', text: 'Cancel' });
      cancel.onclick = () => api.stems.cancel(id);
      const it = h('div.qitem', null, h('div.n', { text: song ? `${song.title}, ${song.artist}` : id }), cancel, h('div.s', { text: st.state === 'running' ? `${Math.round((st.progress || 0) * 100)}%, ${st.message || ''}` : 'Waiting' }));
      if (st.state === 'running') it.append(h('div.progress', { style: { '--p': `${Math.round((st.progress || 0) * 100)}%` } }, h('i')));
      popover.append(it);
    }
  }
}

function closePopover() {
  if (popover) popover.remove();
  popover = null;
}

pill.addEventListener('click', (e) => {
  e.stopPropagation();
  if (popover) return closePopover();
  popover = h('div.popover');
  document.body.append(popover);
  fillPopover();
  const r = pill.getBoundingClientRect();
  popover.style.top = `${r.bottom + 6}px`;
  popover.style.left = `${Math.max(8, r.right - 360)}px`;
});
document.addEventListener('mousedown', (e) => {
  if (popover && !popover.contains(e.target) && e.target !== pill && !pill.contains(e.target)) closePopover();
});

on('scan', renderActivity);
on('stems', renderActivity);
on('stems-progress', renderActivity);

// -------------------------------------------------------------- duplicates --
/**
 * 3.7: the same song in more than one file. Each group shows its copies with
 * what's in them; the copy kept (green) must have audio, then has the most
 * parts and the newest version. Click another copy to keep that one instead.
 * The others move to Stagehand's backups (Undo brings them back).
 */
export async function duplicates() {
  const body = h('div.dupes');
  const note = h('p.dupes-note', { text: 'Looking for songs you have more than once…' });
  body.append(note);
  const cancel = h('button.btn.soft', { type: 'button', text: 'Close' });
  const go = h('button.btn.primary', { type: 'button', text: 'Move extra copies', disabled: true });
  const m = modal({ title: 'Duplicate songs', body, footer: [cancel, go], wide: true });
  cancel.onclick = () => m.close();
  const stemIds = [...state.songs.values()].filter((s) => s.hasStems || (state.stems.get(s.id) || {}).state === 'ready').map((s) => s.id);
  let groups = [];
  try {
    groups = await api.library.findDuplicates(stemIds);
  } catch (err) {
    note.textContent = `Couldn’t check: ${err.message}`;
    return;
  }
  const count = () => groups.reduce((n, g) => n + g.items.filter((i) => i.remove).length, 0);
  const sync = () => {
    const n = count();
    go.disabled = !n;
    go.textContent = n ? `Move ${n} extra ${n === 1 ? 'copy' : 'copies'}` : 'Nothing to move';
  };
  if (!groups.length) {
    note.textContent = 'No duplicates: every song is in your library once.';
    sync();
    return;
  }
  note.innerHTML = `<b>${groups.length} song${groups.length === 1 ? '' : 's'}</b> ${groups.length === 1 ? 'is' : 'are'} in your library more than once. Stagehand always plays the full part (the hardest level), so a DD copy plays the same as a non-DD one. It keeps the copy with audio, the most parts and the newest version (green), and moves the others to its backups. Your favourites, plays and setlists move to the copy kept. Click a copy to keep that one instead.`;
  const list = h('div.dupes-list');
  body.append(list);
  const partLetter = { lead: 'L', rhythm: 'R', bass: 'B', combo: 'C', vocals: 'V' };
  const render = () => {
    list.innerHTML = '';
    for (const g of groups) {
      const card = h('div.dupe-group');
      card.append(h('div.dupe-head', null, h('b', { text: g.title }), h('span', { text: g.artist || '' })));
      for (const it of g.items) {
        const keep = it.id === g.keep;
        const row = h(`button.dupe-row${keep ? '.keep' : it.remove ? '.drop' : '.stay'}`, { type: 'button', title: it.path || it.fileName });
        const badge = keep ? 'Keep' : it.pack ? 'In a pack: stays' : it.remove ? 'Move aside' : 'Stays';
        row.innerHTML = `<span class="dupe-state">${esc(badge)}</span><span class="dupe-file">${esc(it.fileName || '')}</span>
          <span class="dupe-chips">${it.audio ? `<i class="ok" title="Has audio">${icon('volume')}</i>` : `<i class="bad" title="No audio inside">${icon('volumeOff')} no audio</i>`}
          ${['lead', 'rhythm', 'bass', 'vocals'].map((p) => `<i class="part${it.parts.includes(p) ? ' on' : ''}" title="${p}">${partLetter[p]}</i>`).join('')}
          ${it.version && it.version !== '0' ? `<i title="Version">v${esc(it.version)}</i>` : ''}${it.dd ? '<i title="Dynamic difficulty build">DD</i>' : ''}${it.stems ? `<i class="ok" title="Stems ready">${icon('split')}</i>` : ''}${it.plays ? `<i title="Times played">${it.plays}×</i>` : ''}<i class="size">${fmtBytes(it.size)}</i></span>`;
        row.onclick = () => {
          if (keep || it.pack) return;
          g.keep = it.id;
          for (const x of g.items) x.remove = x.id !== it.id && !x.pack;
          render();
          sync();
        };
        card.append(row);
      }
      list.append(card);
    }
  };
  render();
  sync();
  go.onclick = async () => {
    const pairs = [];
    for (const g of groups) for (const it of g.items) if (it.remove) pairs.push({ remove: it.id, keep: g.keep });
    go.disabled = true;
    go.textContent = 'Moving…';
    try {
      const r = await api.library.removeDuplicates(pairs);
      m.close();
      await loadLibrary();
      toast({
        title: `${r.moved} extra ${r.moved === 1 ? 'copy' : 'copies'} moved aside`,
        message: r.failed.length ? `${r.failed.length} couldn’t be moved (in use?).` : 'They’re in Stagehand’s backups, not deleted.',
        kind: 'ok',
        timeout: 12000,
        actions: [{ label: 'Undo', onClick: async () => { const u = await api.library.undoDuplicates(r.id); await loadLibrary(); toast({ title: `${u.restored} put back`, kind: 'info', timeout: 3000 }); } }],
      });
    } catch (err) {
      sync();
      toast({ title: 'Couldn’t move the copies', message: err.message, kind: 'err' });
    }
  };
}
