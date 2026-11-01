/** Settings › Guitar & audio: input, output, sound engine, buffer, calibration. */
import { h, toast } from './ui.js';
import { rig } from './rig.js';
import { guitarStatus } from './shell.js';

export async function pane(el, setting) {
  const draw = async () => {
    el.innerHTML = '';
    const s = guitarStatus();
    const pill = h(`span.status-pill.${rig.on ? (s.cls === 'warn' ? 'warn' : 'ok') : s.cls === 'err' ? 'bad' : 'warn'}`, { text: rig.on ? (rig.muted ? 'Muted' : 'Ready') : s.cls === 'err' ? 'Not working' : 'Waiting for the cable' });
    const restart = h('button.btn.small.soft', { type: 'button', text: rig.on ? 'Restart' : 'Try now' });
    restart.onclick = async () => {
      restart.disabled = true;
      if (rig.on) await rig.restart();
      else await rig._tryStart();
      draw();
    };
    el.append(setting('Your guitar', `${s.title}. ${s.line.replace(/<[^>]+>/g, '')}${s.sub ? ` · ${s.sub}` : ''}`, pill, restart));
    if (rig.notice) el.append(h('div.play-note', { text: rig.notice, style: { margin: '6px 0' } }));

    const inSel = h('select.input', { 'aria-label': 'Input' });
    const outSel = h('select.input', { 'aria-label': 'Output' });
    inSel.append(h('option', { value: '', text: 'Finding inputs…' }));
    const inRow = setting('Input', 'Your Rocksmith Real Tone Cable is picked automatically. Choose another input here if you use an audio interface.', inSel);
    const outRow = setting('Output', 'Where your guitar and the song come out (speakers or headphones).', outSel);
    outRow.hidden = true;
    el.append(inRow, outRow);
    rig
      .devices()
      .then((list) => {
        inSel.innerHTML = '';
        inSel.append(h('option', { value: '', text: 'The Rocksmith cable (automatic)' }));
        for (const d of list) inSel.append(h('option', { value: d.id, text: d.rocksmith ? `${d.label} (Rocksmith cable)` : d.label, selected: d.id === rig.deviceId ? true : null }));
        const outs = list.outputs || [];
        if (outs.length) {
          outSel.innerHTML = '';
          const def = outs.find((o) => o.isDefault);
          outSel.append(h('option', { value: '', text: def ? `Windows default (${def.label})` : 'Windows default' }));
          for (const d of outs) outSel.append(h('option', { value: d.id, text: d.label, selected: d.id === rig.outputId ? true : null }));
          outRow.hidden = false;
        }
      })
      .catch(() => {
        inSel.innerHTML = '';
        inSel.append(h('option', { value: '', text: 'The Rocksmith cable (automatic)' }));
      });
    inSel.onchange = async () => {
      await rig.setDevice(inSel.value);
      draw();
    };
    outSel.onchange = async () => {
      await rig.setOutput(outSel.value);
      draw();
    };

    const native = await rig.nativeAvailable();
    if (native) {
      const eng = h('select.input', { 'aria-label': 'Sound engine' });
      const cur = rig.engineChoice === 'web' ? 'web' : rig.exclusive ? 'fast' : 'shared';
      for (const [v, label] of [
        ['fast', 'Fastest (takes over your output, like Rocksmith)'],
        ['shared', 'Shared (other apps keep playing, a little more delay)'],
        ['web', 'In-app (if the others don’t work)'],
      ])
        eng.append(h('option', { value: v, text: label, selected: v === cur ? true : null }));
      eng.onchange = async () => {
        const v = eng.value;
        await rig.setEngine(v === 'web' ? { engine: 'web' } : { engine: rig.engineChoice === 'native' ? 'native' : 'auto', exclusive: v === 'fast' });
        draw();
      };
      el.append(setting('Sound engine', 'Fastest gives the lowest delay. While Stagehand runs, other sounds on this PC are silent.', eng));
      const buf = h('select.input', { 'aria-label': 'Buffer' });
      for (const [v, label] of [
        [0, 'Smallest delay'],
        [1, 'Small delay'],
        [2, 'Safe (if it crackles)'],
      ])
        buf.append(h('option', { value: String(v), text: label, selected: v === rig.buffer ? true : null }));
      buf.onchange = async () => {
        await rig.setEngine({ buffer: Number(buf.value) });
        draw();
      };
      el.append(setting('Buffer', rig.latencyMs ? `Your guitar is about ${rig.latencyMs} ms behind your strings right now.` : 'Pick Safe if you hear crackles.', buf));
      const fb = h('input', { type: 'checkbox', checked: rig.engineChoice !== 'native' ? true : null, 'aria-label': 'Fall back to the in-app engine' });
      fb.onchange = async () => {
        if (rig.engineChoice === 'web') return;
        await rig.setEngine({ engine: fb.checked ? 'auto' : 'native' });
        draw();
      };
      el.append(setting('If the fast engine can’t start', 'Use the in-app engine instead (more delay, but you can still play). Turn off to see the error instead.', h('label.switch-row', null, fb)));
    }

    const calib = h('button.btn.small.soft', { type: 'button', text: rig.calibrating ? 'Strum hard…' : 'Set input level', disabled: !rig.on || rig.calibrating });
    calib.onclick = async () => {
      calib.disabled = true;
      const r = await rig.calibrate(4, (p) => (calib.textContent = `Strum hard… ${Math.max(1, Math.ceil(4 - p * 4))}`));
      if (!r) toast({ title: 'Didn’t hear anything', message: 'Check the cable is plugged in, then strum hard while it counts down.', kind: 'info' });
      else toast({ title: 'Input level set', message: `Your hardest strum peaked at ${Math.round(r.peakDb)} dB.`, kind: 'ok' });
      draw();
    };
    el.append(setting('Calibration', 'Strum as hard as you play for 4 seconds; Stagehand sets the input level, like Rocksmith does.', calib));
    const room = h('input.glow-range', { type: 'range', min: '0', max: '1', step: '0.05', value: String(rig.room), 'aria-label': 'Room', style: { '--g': '#ffb547', '--p': `${Math.round(rig.room * 100)}%` } });
    room.oninput = () => {
      rig.setRoom(Number(room.value));
      room.style.setProperty('--p', `${Math.round(Number(room.value) * 100)}%`);
    };
    el.append(setting('Room', 'A little space around your amp, like a mic’d cab in a studio. Slide left for a dry close mic.', room));
    const inst = h('select.input', { 'aria-label': 'Instrument' });
    const heard = rig.sense.instrument ? ` (hearing a ${rig.sense.instrument} now)` : '';
    for (const [v, label] of [['auto', `Tell by what I play${heard}`], ['guitar', 'Always guitar'], ['bass', 'Always bass']]) inst.append(h('option', { value: v, text: label, selected: v === rig.instrumentPref ? true : null }));
    inst.onchange = () => rig.setInstrumentPref(inst.value);
    el.append(setting('Guitar or bass', 'Stagehand hears which one is plugged in. If your tone is for the other one, it plays a tone that suits what you’re holding (the last one you picked for it), and scores a bass part played on guitar an octave up.', inst));
    el.append(h('p.np-fine', { text: 'If you hear yourself twice, turn off “Listen to this device” for the cable in Windows sound settings.', style: { marginTop: '10px' } }));
  };
  await draw();
}
