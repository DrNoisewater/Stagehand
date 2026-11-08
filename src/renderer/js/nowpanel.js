/**
 * Now playing, the parts around the song view: part chips and the guitar in
 * the header, the score line, speed and Record take in the footer, and the
 * right panel (Mix, Riff repeater, Tone, Tuner).
 */
import { api } from './api.js';
import { state, on, emit, setPage } from './store.js';
import { h, icon, esc, toast } from './ui.js';
import { rig } from './rig.js';
import * as stage from './stage.js';
import { practice } from './practice.js';
import { drums } from './drums.js';
import { DiRecorder, saveTake } from './looper.js';
import { renderTone } from './render.js';
import { songToneChoice, saveToneChoice } from './tab.js';
import { tonelib, bySlot, useSlot, SLOT_GELS, SLOT_COUNT, saveSongTone, freeSlot, chainText, activeSlot, nowPlayingTone } from './tonelib.js';
import { demoButton } from './rigui.js';
import { guitarStatus } from './shell.js';
import { paintSpeedChip, openSpeedPopover } from './speedpop.js';
import { createTuner } from './tuner.js';

const { panel, partChips, guitarPill, scoreLine, recBtn, speedSeg, modeSeg, vol, volIcon } = stage.hosts;
const engine = stage.engine;
const PART_GEL = { lead: 'var(--gel-guitar)', combo: 'var(--gel-guitar)', rhythm: 'var(--tungsten)', bass: 'var(--gel-bass)' };
const N = { tab: localStorage.getItem('stagehand.nowTab') || 'mix', raf: 0, toneKey: null, meters: [], back: 'mix' };
// 4.2: the tuner is a tab in this panel, so it never sits over the tab itself.
// It only listens while its tab is showing; it isn't remembered for next time.
const npTuner = createTuner();
npTuner.el.classList.add('np-tuner');
if (N.tab === 'tuner') N.tab = 'mix';
const R = { on: false, sec: -1, trainer: true, start: 0.6, step: 0.05, goal: 1, thresh: 0.9, countIn: true, passes: [] };

const shown = () => state.page === 'now' && !document.getElementById('app').classList.contains('under-highway');
const song = () => stage.current();

// ------------------------------------------------------------ header bits --
function renderParts() {
  partChips.innerHTML = '';
  for (const p of practice.parts) {
    const onp = practice.tab && practice.tab.id === p.id;
    const b = h(`button.gchip${onp ? '.lit' : ''}`, { type: 'button', 'aria-pressed': String(!!onp), style: { '--gel': PART_GEL[p.type] || 'var(--tungsten)' }, title: `${p.name}${p.bonus ? ' (bonus)' : ''}${p.tuningName ? ` · ${p.tuningName}` : ''}` });
    b.innerHTML = `<span class="dot"></span>${esc(p.name)}`;
    b.onclick = async () => {
      if (onp) return;
      await practice.loadPart(p.id);
      const tv = stage.tabViewApi();
      if (tv && tv.selectPart) tv.selectPart(p.id);
    };
    partChips.append(b);
  }
}

// The Drop, one click away while you play (D on the keyboard too)
const dropPill = h('button.np-drop', { type: 'button' });
dropPill.onclick = () => rig.setDrop({ on: !rig.drop.on });
function renderDrop() {
  if (!dropPill.isConnected && guitarPill.parentNode) guitarPill.before(dropPill);
  const on = rig.drop.on;
  const amt = rig.dropAmount();
  dropPill.setAttribute('aria-pressed', String(on));
  dropPill.innerHTML = '';
  dropPill.append(h('span.led'), h('span', { text: on ? (amt === 12 ? 'Drop · Oct' : amt ? `Drop −${amt}` : 'Drop · song in E') : 'Drop' }));
  dropPill.title = on ? 'The Drop is on: click (or press D) to turn it off' : 'Turn on the Drop to play lower-tuned songs in E standard (D)';
}
rig.addEventListener('drop', renderDrop);

function renderGuitar() {
  renderDrop();
  const s = guitarStatus();
  guitarPill.className = `np-guitar${s.cls ? ` ${s.cls}` : ''}`;
  guitarPill.innerHTML = '';
  guitarPill.title = `${s.title}. ${s.line.replace(/<[^>]+>/g, '')}`;
  guitarPill.append(h(`span.dot${rig.on && !rig.muted ? '.glow' : ''}`), h('span', { text: rig.on ? (rig.muted ? 'Guitar muted' : `Guitar${rig.latencyMs ? ` · ${rig.latencyMs} ms` : ''}`) : 'No guitar' }));
  if (rig.on) {
    const m = h('span.meter-bar', null, h('i'));
    guitarPill.append(m);
    N.pillMeter = m.firstChild;
  } else N.pillMeter = null;
}

function updateSubtitle() {
  const s = song();
  const sub = document.querySelector('#stage .np-artist');
  if (!s || !sub) return;
  const t = practice.tab;
  const tone = nowPlayingTone().name;
  sub.textContent = [s.artist, t && t.tuningName, tone && `tone: ${tone}`].filter(Boolean).join(' · ');
  if (rig.capture) sub.append(h('span.real-badge.sm', { text: 'REAL', title: `Real amp: ${rig.capture.pack.title}` }));
}

// -------------------------------------------------------------- footer --
// 4.2: one chip that opens the speed panel (the same as on the highway)
const speedBtn = h('button', { type: 'button', 'aria-haspopup': 'dialog' });
speedBtn.onclick = () => openSpeedPopover(speedBtn, { engine, repeat: stage.repeat, above: true });
function renderSpeed() {
  if (!speedBtn.isConnected) {
    speedSeg.innerHTML = '';
    speedSeg.classList.add('np-speed-one');
    speedSeg.append(speedBtn);
  }
  paintSpeedChip(speedBtn, engine.speed || 1);
}
engine.addEventListener('speed', () => {
  renderSpeed();
  if (N.tab === 'riff') renderPanel();
});

const rec = { r: null, t0: 0, timer: null };
function renderRec() {
  const onr = !!rec.r;
  recBtn.setAttribute('aria-pressed', String(onr));
  recBtn.classList.toggle('rec', onr);
  recBtn.innerHTML = onr ? `${icon('stop')}<span>Stop · ${Math.floor(rec.r.seconds)} s</span>` : `<span class="dot" style="--gel: var(--danger)"></span><span>Record take</span>`;
}
recBtn.onclick = async () => {
  if (!rec.r) {
    if (!rig.on) return toast({ title: 'Plug in your guitar first', message: 'Record take records what you play.', kind: 'info' });
    rec.r = new DiRecorder();
    rec.r.start();
    rec.t0 = engine.position;
    rec.timer = setInterval(renderRec, 500);
    if (!engine.playing) stage.toggle();
    renderRec();
    return;
  }
  const r = rec.r;
  rec.r = null;
  clearInterval(rec.timer);
  const di = r.stop();
  renderRec();
  const rate = rig.sampleRate || 48000;
  if (di.length < rate) return toast({ title: 'Too short to keep', message: 'Record at least a second.', kind: 'info' });
  try {
    const { L, R: Rr } = await renderTone(rig.tone, di, rate, { ...rig.knobs, volume: Math.max(0.35, rig.knobs.volume ?? 0.7) });
    const s = song();
    const sec = s && (s.sections || []).find((x) => rec.t0 >= x.start && rec.t0 < x.end);
    await saveTake({ name: s ? `${s.title}${sec ? ` · ${sec.label}` : ''}${Math.abs(engine.speed - 1) > 0.001 ? ` at ${Math.round(engine.speed * 100)}%` : ''}` : 'Take', songId: s ? s.id : null, L, R: Rr, rate });
    emit('takes');
    toast({ title: 'Take saved', message: 'Listen back in Progress.', kind: 'ok', actions: [{ label: 'Open Progress', onClick: () => setPage('progress') }] });
  } catch (err) {
    toast({ title: 'Couldn’t save the take', message: err.message, kind: 'err' });
  }
};

// ---------------------------------------------------------------- score --
function renderScore() {
  const j = practice.judge;
  if (!practice.tab) {
    scoreLine.innerHTML = '';
    return;
  }
  if (!rig.on) {
    scoreLine.innerHTML = '<span class="muted">Plug in your guitar to see how you’re playing.</span>';
    return;
  }
  const acc = j ? j.accuracy : null;
  const deg = Math.round((acc || 0) * 360);
  scoreLine.innerHTML = `<span class="ring" style="--deg:${deg}deg"><i></i></span><span><b>${acc === null ? '–' : `${Math.round(acc * 100)}%`}</b> accuracy</span><span><b class="streak">${j ? j.streak : 0}</b> streak</span><span><b>${j ? `${j.hits}/${j.judged}` : '0/0'}</b> notes</span>`;
}

// ---------------------------------------------------------------- panel --
function tabsEl() {
  const t = h('div.np-tabs', { role: 'tablist' });
  for (const [id, label] of [['mix', 'Mix'], ['riff', 'Riff repeater'], ['tone', 'Tone'], ['tuner', 'Tuner']]) {
    const b = h('button', { type: 'button', role: 'tab', 'aria-selected': String(N.tab === id), text: label, title: id === 'tuner' ? 'Tuner (U)' : undefined });
    b.onclick = () => setTab(id);
    t.append(b);
  }
  return t;
}

function yourStem() {
  return practice.kind === 'bass' ? 'bass' : 'guitar';
}

function renderMix(box) {
  const s = song();
  N.meters = [];
  const you = h('div.lvl-card', { style: { '--gel': 'var(--gel-guitar)' } });
  const youV = rig.knobs.volume ?? 0.7;
  const youIn = h('input.glow-range', { type: 'range', min: '0', max: '1', step: '0.01', value: String(youV), 'aria-label': 'Your guitar level', style: { '--g': '#ff6b3d', '--p': `${Math.round(youV * 100)}%` } });
  const youDb = h('b', { text: `${Math.round(youV * 10)}` });
  youIn.oninput = () => {
    stage.setYou(Number(youIn.value));
    youIn.style.setProperty('--p', `${Math.round(Number(youIn.value) * 100)}%`);
    youDb.textContent = `${Math.round(Number(youIn.value) * 10)}`;
  };
  const youM = h('div.meter-bar.solo', null, h('i'));
  N.meters.push(['you', youM.firstChild]);
  you.append(h('div.lc-top', null, h('span', { text: 'Your guitar' }), youDb), youM, youIn);
  const sng = h('div.lvl-card', { style: { '--gel': 'var(--tungsten)' } });
  const songDb = h('b', { text: `${Math.round(engine.master * 10)}` });
  N.songDb = songDb;
  const sM = h('div.meter-bar.solo', null, h('i'));
  N.meters.push(['song', sM.firstChild]);
  sng.append(h('div.lc-top', null, h('span', { text: 'Whole song' }), songDb), sM, h('div.lc-row', null, volIcon, vol));
  box.append(h('div.lvl-grid', null, you, sng));

  const names = stage.stemNames();
  const loaded = stage.stems();
  const st = stage.stemStatus() || {};
  const head = h('div.sec-head', null, h('span', { text: 'Song stems' }), h('span.np-fine', { text: 'each instrument in the recording', style: { margin: '0 0 0 8px' } }), h('span.grow'));
  if (loaded.length) {
    const mine = yourStem();
    const out = stage.stemVolume(mine).muted;
    const take = h('button.btn.small.soft', { type: 'button', text: out ? 'Put my part back' : 'Take my part out', title: `Turn the ${mine} stem ${out ? 'back on' : 'off'} so you can play it yourself` });
    take.onclick = () => stage.setStem(mine, { muted: !out });
    head.append(take);
  }
  box.append(head);
  if (!loaded.length) {
    const busy = st.state === 'running' || st.state === 'queued';
    const pct = Math.round((st.progress || 0) * 100);
    const note = h('div.np-callout');
    if (busy) note.append(h('b', { text: st.state === 'queued' ? 'Waiting to split this song' : `Splitting instruments, ${pct}%` }), h('div.meter-bar', null, h('i', { style: { transform: `scaleX(${(st.progress || 0).toFixed(3)})` } })), h('span', { text: 'The whole song keeps playing meanwhile.' }));
    else {
      note.append(h('b', { text: 'Split this song into instruments' }), h('span', { text: 'Then you can turn any instrument up, down or off, and take your part out to play it yourself.' }));
      const go = h('button.btn.glow-primary', { type: 'button', html: `${icon('split')}<span>Split stems</span>` });
      go.onclick = () => stage.requestStemsNow();
      note.append(go);
    }
    box.append(note);
  } else {
    if (state.settings && engine.mode !== 'stems') box.append(h('div.np-hint', { text: 'You’re hearing the original mix. Switch to Stems to use these.' }));
    const list = h('div.stem-list');
    names.forEach((name, i) => {
      if (!loaded.includes(name)) return;
      const v = stage.stemVolume(name);
      const gel = stage.GEL[name][1];
      const off = v.muted;
      const row = h(`div.stem-row${off ? '.off' : ''}`, { style: { '--gel': off ? '#4a5068' : gel } });
      const bar = h('span.gelbar');
      N.meters.push([name, bar]);
      const fader = h('input.glow-range', { type: 'range', min: '0', max: '1', step: '0.001', value: String(v.volume), 'aria-label': `${stage.STEM_LABEL[name]} level`, style: { '--g': off ? '#4a5068' : gel, '--p': `${Math.round(v.volume * 100)}%` } });
      fader.oninput = () => {
        stage.setStem(name, { volume: Number(fader.value) });
        fader.style.setProperty('--p', `${Math.round(Number(fader.value) * 100)}%`);
      };
      fader.ondblclick = () => {
        fader.value = '0.8';
        fader.dispatchEvent(new Event('input'));
      };
      const sw = h('button.switch', { type: 'button', 'aria-pressed': String(!off), 'aria-label': `${stage.STEM_LABEL[name]} on or off`, title: `Shift+${i + 1}` });
      sw.onclick = () => stage.setStem(name, { muted: !off });
      const solo = h('button.solo-btn', { type: 'button', text: 'S', 'aria-pressed': String(v.solo), title: `Solo ${stage.STEM_LABEL[name]}` });
      solo.onclick = () => stage.setStem(name, { solo: !v.solo });
      row.append(bar, h('span.sn', null, h('b', { text: stage.STEM_LABEL[name] }), name === yourStem() ? h('span.tag', { text: 'recorded part', title: 'The recorded part you play. Your live guitar is the “Your guitar” level above.' }) : null), fader, solo, sw);
      list.append(row);
    });
    box.append(list);
  }
  box.append(h('div.sec-head', null, h('span', { text: 'Hear' }), h('span.grow'), modeSeg));
  if (s) {
    const lbl = h('label.check', null, h('input', { type: 'checkbox', checked: stage.remembersMix(s.id) ? true : null }), `Remember this mix for ${s.title}`);
    lbl.firstChild.onchange = (e) => stage.setRemembersMix(s.id, e.target.checked);
    box.append(lbl);
  }
  box.append(h('p.np-fine', { text: 'The whole song plays and your guitar sits on top. Turn your part down or off if you want to fill it in yourself.' }));
}

function sections() {
  const s = song();
  return (s && s.sections) || [];
}

function startRepeat() {
  const secs = sections();
  const sec = secs[R.sec];
  if (!sec) return;
  R.on = true;
  R.passes = [];
  stage.setLoopRange({ start: sec.start, end: sec.end, label: sec.label });
  if (R.prevSpeed == null) R.prevSpeed = engine.speed;
  if (R.trainer) engine.setSpeed(R.start);
  stage.seekTo(sec.start);
  practice.beginPass(sec.start, sec.end);
  const go = async () => {
    if (R.countIn) await drums.countIn();
    if (!engine.playing) stage.toggle();
  };
  if (engine.playing) stage.toggle();
  go();
  renderPanel();
}

function stopRepeat() {
  R.on = false;
  // back to the speed you had before repeating (the trainer slowed it down)
  if (R.prevSpeed != null) engine.setSpeed(R.prevSpeed);
  R.prevSpeed = null;
  practice.stopPasses();
  stage.setLoopRange(null);
  renderPanel();
}

practice.addEventListener('pass', async (e) => {
  if (!R.on) return;
  const p = e.detail;
  R.passes.push({ speed: p.speed, acc: p.accuracy, judged: p.judged, total: p.total });
  if (R.trainer && rig.on && p.accuracy !== null && p.accuracy >= R.thresh && engine.speed < R.goal - 0.001) {
    engine.setSpeed(Math.min(R.goal, Math.round((engine.speed + R.step) * 100) / 100));
    toast({ title: `Clean pass: ${Math.round(p.accuracy * 100)}%`, message: `Speeding up to ${Math.round(engine.speed * 100)}%.`, kind: 'ok', timeout: 2500 });
  }
  const sec = sections()[R.sec];
  if (sec) practice.beginPass(sec.start, sec.end);
  if (R.countIn && engine.playing) {
    stage.toggle();
    stage.seekTo(sec ? sec.start : engine.position);
    await drums.countIn();
    if (R.on && !engine.playing) stage.toggle();
  }
  if (N.tab === 'riff') renderPanel();
});

function renderRiff(box) {
  const secs = sections();
  if (!secs.length) {
    box.append(h('div.np-callout', null, h('b', { text: 'No sections in this song' }), h('span', { text: 'Drag across the timeline in Waveform view to loop any part instead.' })));
    return;
  }
  if (R.sec < 0 || R.sec >= secs.length) {
    const t = engine.position;
    R.sec = Math.max(0, secs.findIndex((x) => t >= x.start && t < x.end));
  }
  const sec = secs[R.sec];
  const fmt = (x) => `${Math.floor(x / 60)}:${String(Math.floor(x % 60)).padStart(2, '0')}`;
  const sel = h('select.input', { 'aria-label': 'Section' });
  secs.forEach((x, i) => sel.append(h('option', { value: String(i), text: `${x.label} · ${fmt(x.start)}–${fmt(x.end)}`, selected: i === R.sec ? true : null })));
  sel.onchange = () => {
    R.sec = Number(sel.value);
    if (R.on) startRepeat();
    else renderPanel();
  };
  box.append(h('div.riff-now', null, h('span.muted', { text: R.on ? 'Repeating' : 'Section' }), h('b', { text: `${sec.label} · ${fmt(sec.start)}–${fmt(sec.end)}` })), sel);
  // speed trainer
  const steps = [];
  for (let v = R.start; v <= R.goal + 1e-6; v = Math.round((v + R.step) * 100) / 100) steps.push(v);
  const cur = engine.speed;
  const ladder = h('div.ladder', { style: { '--n': String(steps.length) } });
  for (const v of steps) {
    const cls = v < cur - 0.001 ? 'done' : Math.abs(v - cur) < 0.001 ? 'cur' : '';
    ladder.append(h(`span${cls ? `.${cls}` : ''}${cls === 'cur' && R.on ? '.lit' : ''}`, { text: String(Math.round(v * 100)) }));
  }
  const tr = h('div.trainer', null, h('div.tr-top', null, h('label.check', null, h('input', { type: 'checkbox', checked: R.trainer ? true : null }), 'Speed trainer'), h('span.grow'), h('b', { text: `${Math.round(cur * 100)}%` })), ladder, h('div.tr-foot', null, h('span', { text: `Start ${Math.round(R.start * 100)}%` }), h('span', { text: `+${Math.round(R.step * 100)}% after a clean pass (${Math.round(R.thresh * 100)}%+)` }), h('span', { text: `Goal ${Math.round(R.goal * 100)}%` })));
  tr.querySelector('input').onchange = (e) => {
    R.trainer = e.target.checked;
    renderPanel();
  };
  box.append(tr);
  if (R.passes.length) {
    const list = h('div.passes');
    R.passes.slice(-8).forEach((p, i, a) => {
      const n = R.passes.length - a.length + i + 1;
      const pct = p.acc === null ? null : Math.round(p.acc * 100);
      list.append(h('div.pass', null, h('span.muted', { text: `Pass ${n} · ${Math.round(p.speed * 100)}%` }), h('span.pbar', null, h('i', { style: { width: `${pct || 0}%`, '--gel': pct !== null && pct >= R.thresh * 100 ? '#9bdb5a' : '#ffb547' } })), h('b', { text: pct === null ? '–' : `${pct}%` })));
    });
    box.append(list);
  } else if (R.on) box.append(h('p.np-fine', { text: rig.on ? 'Each time round, your accuracy shows here.' : 'Plug in your guitar so passes can be scored.' }));
  const go = h(`button.btn${R.on ? '.soft' : '.glow-primary'}`, { type: 'button', text: R.on ? 'Stop repeating' : 'Repeat this section' });
  go.onclick = () => (R.on ? stopRepeat() : startRepeat());
  const ci = h('label.check', null, h('input', { type: 'checkbox', checked: R.countIn ? true : null }), 'Count in 1 bar before each pass');
  ci.firstChild.onchange = (e) => (R.countIn = e.target.checked);
  box.append(h('div.btn-row', null, go), ci, h('p.np-fine', { text: `Count-in uses the drum tempo (${drums.bpm} BPM, set it on Play).` }));
}

function followsSong() {
  const s = song();
  if (!(s && practice.tab && practice.tab.songTones && (songToneChoice[s.id] || 'song') === 'song')) return false;
  // once you pick a tone yourself (a slot, the Tones page, the highway), the song stops taking it back
  return rig.mode === 'song' || !N.toneKey;
}

function renderTonePane(box) {
  const s = song();
  const st = practice.tab && practice.tab.songTones;
  const fol = h('label.check', null, h('input', { type: 'checkbox', checked: followsSong() ? true : null, disabled: !st ? true : null }), 'Follow the song’s tone changes');
  fol.firstChild.onchange = (e) => {
    if (!s) return;
    songToneChoice[s.id] = e.target.checked ? 'song' : (tonelib.list.find((t) => t.slot === (activeSlot() || 1)) || {}).id || 'song';
    saveToneChoice();
    N.toneKey = null;
    if (!e.target.checked) {
      const t = bySlot(activeSlot() || 1);
      if (t) useSlot(t.slot);
    }
    renderPanel();
  };
  box.append(fol);
  if (st) {
    const list = h('div.tone-list');
    for (const t of st.tones) {
      const onT = rig.mode === 'song' && rig.songTone && rig.songTone.key === t.key;
      const row = h(`div.tone-row${onT ? '.on.lit' : ''}`, { style: { '--gel': onT ? 'var(--gel-guitar)' : 'var(--gel-vocals)' } });
      const pick = h('button.tr-main', { type: 'button', title: 'Play this tone now' }, h('b', { text: t.name }), h('span', { text: chainText(t) }));
      pick.onclick = () => {
        songToneChoice[s.id] = 'song';
        saveToneChoice();
        rig.setSongTone({ ...t });
        N.toneKey = t.key;
        renderPanel();
      };
      row.append(h('span.gelbar'), pick); // saving and demos live on the Tones page
      list.append(row);
    }
    box.append(list);
  } else box.append(h('p.np-fine', { text: practice.tab ? 'This part has no tones of its own.' : 'Pick a part to see its tones.' }));
  box.append(h('div.sec-head', null, h('span', { text: 'Or use a slot' })));
  const grid = h('div.slot-keys');
  const act = rig.mode === 'preset' ? activeSlot() : null;
  for (let n = 1; n <= SLOT_COUNT; n++) {
    const t = bySlot(n);
    const b = h(`button${act === n ? '.on.lit' : ''}`, { type: 'button', text: String(n), title: t ? t.name : 'Empty', disabled: !t ? true : null, style: { '--gel': t ? SLOT_GELS[n - 1] : '#2c3552' } });
    b.onclick = () => {
      if (s) {
        songToneChoice[s.id] = t.id;
        saveToneChoice();
      }
      useSlot(n);
      renderPanel();
    };
    grid.append(b);
  }
  box.append(grid);
}

function setTab(id) {
  if (id !== 'tuner') {
    N.back = id;
    try {
      localStorage.setItem('stagehand.nowTab', id);
    } catch (_) {}
  }
  N.tab = id;
  renderPanel();
}

function renderPanel() {
  if (!shown()) return npTuner.hide();
  panel.innerHTML = '';
  panel.append(tabsEl());
  const box = h('div.np-pane');
  if (N.tab === 'riff') renderRiff(box);
  else if (N.tab === 'tone') renderTonePane(box);
  else if (N.tab === 'tuner') box.append(npTuner.el);
  else renderMix(box);
  panel.append(box);
  if (N.tab === 'tuner') npTuner.show();
  else npTuner.hide();
}

// U in the tab view (tab.js), or its menu: open the Tuner tab, or go back to the last one
window.addEventListener('stagehand:tab-tuner', () => {
  if (!shown()) return;
  setTab(N.tab === 'tuner' ? N.back || 'mix' : 'tuner');
});
// leaving the page, or the highway coming up over it: stop listening
setInterval(() => {
  if (N.tab === 'tuner' && !shown()) npTuner.hide();
}, 1000);
export const tabTunerOpen = () => N.tab === 'tuner' && shown();

// ---------------------------------------------------------- tone follow --
function followTone() {
  const s = song();
  if (!s || !rig.on || !followsSong()) return;
  const st = practice.tab.songTones;
  const t = engine.position;
  let key = st.base;
  for (const c of st.changes) {
    if (c.t <= t + 0.02) key = c.key;
    else break;
  }
  if (key === N.toneKey && rig.mode === 'song') return;
  const tone = st.tones.find((x) => x.key === key) || st.tones[0];
  N.toneKey = key;
  if (tone) {
    rig.setSongTone(tone);
    if (shown() && N.tab === 'tone') renderPanel();
  }
}

// ----------------------------------------------------------------- loop --
const lv = new Map();
function smooth(k, v) {
  const p = lv.get(k) || 0;
  const n = v > p ? p + (v - p) * 0.5 : p + (v - p) * 0.12;
  lv.set(k, n);
  return n;
}
function tick() {
  N.raf = requestAnimationFrame(tick);
  if (song() && (engine.playing || shown())) followTone();
  if (!shown()) return;
  const l = rig.levels();
  if (N.pillMeter) N.pillMeter.style.transform = `scaleX(${Math.min(1, Math.sqrt(smooth('in', l.input || 0)) * 1.6).toFixed(3)})`;
  for (const [k, el] of N.meters) {
    let v;
    if (k === 'you') v = smooth('you', Math.sqrt(l.output || 0) * 1.5);
    else if (k === 'song') v = smooth('song', Math.sqrt(engine.masterLevel()) * 1.4);
    else v = smooth(k, engine.level(stage.trackIndex(k)) * 3.2);
    if (k === 'you' || k === 'song') el.style.transform = `scaleX(${Math.min(1, v).toFixed(3)})`;
    else el.style.setProperty('--glow', Math.min(0.9, v).toFixed(3));
  }
  if (!N.lastScore || performance.now() - N.lastScore > 200) {
    N.lastScore = performance.now();
    renderScore();
  }
}
N.raf = requestAnimationFrame(tick);

vol.addEventListener('input', () => N.songDb && (N.songDb.textContent = `${Math.round(Number(vol.value) * 10)}`));

// ------------------------------------------------------------- wiring --
function renderAll() {
  renderParts();
  renderGuitar();
  renderSpeed();
  renderRec();
  renderScore();
  renderPanel();
  updateSubtitle();
}
on('page', () => shown() && renderAll());
on('practice', () => {
  renderParts();
  updateSubtitle();
  if (practice.tab && practice.tab.songTones && rig.on) rig.prepareTones(practice.tab.songTones.tones);
  N.toneKey = null;
  if (shown()) renderPanel();
});
on('stage-song', () => {
  // a new song always starts at full speed
  if (Math.abs(engine.speed - 1) > 0.001) engine.setSpeed(1);
  R.prevSpeed = null;
  R.on = false;
  R.sec = -1;
  R.passes = [];
  if (shown()) renderAll();
});
on('stems', () => shown() && N.tab === 'mix' && renderPanel());
on('stems-progress', () => shown() && N.tab === 'mix' && !stage.stems().length && renderPanel());
on('tones', () => shown() && N.tab === 'tone' && renderPanel());
on('stage-loop', (l) => {
  if (!l && R.on) {
    R.on = false;
    practice.stopPasses();
    if (shown() && N.tab === 'riff') renderPanel();
  }
});
engine.addEventListener('mix', () => {
  if (!shown() || N.tab !== 'mix') return;
  if (document.activeElement && document.activeElement.matches('.np-panel input[type=range]')) return;
  renderPanel();
});
rig.addEventListener('change', () => {
  // picking a tone yourself while a song is up keeps it for that song
  const s = song();
  if (s && rig.mode === 'preset' && songToneChoice[s.id] !== rig.toneId) {
    if ((songToneChoice[s.id] || 'song') === 'song' && N.toneKey) {
      songToneChoice[s.id] = rig.toneId;
      saveToneChoice();
    }
  }
  if (!shown()) return;
  renderGuitar();
  updateSubtitle();
  if (N.tab !== 'mix' || !document.activeElement || !document.activeElement.matches('.np-panel input[type=range]')) renderPanel();
});
on('library', updateSubtitle);
