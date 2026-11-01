/**
 * Highway tools (3.10): the small tuner (U), Score attack and Record clip.
 * Tone match was here in 3.10 and 3.11; taken out in 3.12 at the user's request.
 */
import { h, toast, isTyping } from './ui.js';
import { createTuner } from './tuner.js';
import { scoreHit } from './performance-math.js';
import { createClipRecorder } from './take-video.js';

export function createPerformanceTools({ root, stage, H, rig }) {
  const eng = stage.engine;
  const row = h('div.hw-tools');
  root.append(row);
  const button = (text, title, fn) => {
    const b = h('button.hw-chip', { type: 'button', text, title });
    b.onclick = fn;
    row.append(b);
    return b;
  };

  // ------------------------------------------------------------ tuner --
  const tuner = createTuner();
  tuner.el.classList.add('hw-mini-tuner');
  tuner.el.hidden = true;
  root.append(tuner.el);
  const toggleTuner = () => {
    tuner.el.hidden = !tuner.el.hidden;
    if (tuner.el.hidden) tuner.hide(); else tuner.show();
  };
  button('Tuner · U', 'Open tuner without leaving the song (U)', toggleTuner);

  // ----------------------------------------------------- score attack --
  // A full-speed run from the start. Hits earn 100 × multiplier (up to ×4,
  // +1 every 10 in a row); a miss resets it. Seeking, looping, slowing down
  // or changing part makes it a practice run that isn't saved.
  const hud = h('div.attack-hud', { hidden: true });
  root.append(hud);
  let run = null, seen = new Set(), last = 0, runSong = null, runPart = null, personalBest = 0;
  const boardKey = () => `stagehand.attack:${runSong}:${runPart}`;
  eng.addEventListener('seek', () => { if (run) run.valid = false; });
  eng.addEventListener('speed', () => { if (run && eng.speed !== 1) run.valid = false; });
  const draw = () => {
    hud.innerHTML = `<small>Score attack · ×${run.multiplier}</small><b>${run.points.toLocaleString()}</b>`
      + `<span>${run.combo} streak${run.valid ? '' : ' · practice run'} · Best ${personalBest.toLocaleString()}</span>`;
  };
  const stopRun = () => {
    run = null;
    hud.hidden = true;
    attack.setAttribute('aria-pressed', 'false');
  };
  const attack = button('Score attack', 'Start a full-speed run from the beginning', () => {
    if (!H.tab || !rig.on) return toast({ title: 'Connect your instrument first', kind: 'info' });
    if (run) return stopRun();
    stage.setLoop?.(null);
    eng.setSpeed(1);
    stage.seek(0);
    H.judge?.reset(0);
    seen.clear();
    last = 0;
    runSong = H.song.id;
    runPart = H.tab.id;
    try { personalBest = Math.max(0, ...JSON.parse(localStorage.getItem(boardKey()) || '[]').map((r) => r.points)); }
    catch { personalBest = 0; }
    run = { points: 0, combo: 0, multiplier: 1, bestCombo: 0, valid: true };
    hud.hidden = false;
    attack.setAttribute('aria-pressed', 'true');
    draw();
    if (!eng.playing) stage.toggle();
  });
  const leaderboard = h('section.perf-panel', { hidden: true });
  root.append(leaderboard);
  const closeBoard = h('button.btn.soft', { text: 'Close' });
  closeBoard.onclick = () => { leaderboard.hidden = true; };

  // ------------------------------------------------------ record clip --
  const clip = createClipRecorder({ rig, engine: eng });
  const rec = button('● Record clip', 'Save highway video with the audible song and processed instrument', async () => {
    rec.disabled = true;
    try {
      if (clip.active) {
        rec.textContent = 'Exporting MP4…';
        await clip.stop();
        rec.textContent = '● Record clip';
      } else {
        await clip.start();
        rec.textContent = '■ Save clip';
      }
    } catch (e) {
      rec.textContent = '● Record clip';
      toast({ title: 'Clip recording', message: e.message, kind: 'err' });
    } finally {
      rec.disabled = false;
    }
  });

  setInterval(() => {
    if (!H.open) return;
    if (run) {
      const pos = eng.position;
      if (pos < last - 0.15 || eng.speed !== 1 || stage.getLoop?.() || !rig.on || H.song.id !== runSong || H.tab?.id !== runPart) run.valid = false;
      last = pos;
      draw();
    }
    if (!clip.active && rec.textContent === '■ Save clip') rec.textContent = '● Record clip';
  }, 250);

  document.addEventListener('keydown', (e) => {
    if (!H.open || isTyping() || e.ctrlKey || e.altKey || e.metaKey) return;
    if (e.key.toLowerCase() === 'u') { e.preventDefault(); toggleTuner(); }
  });

  return {
    /** Every judged note while the highway is open. */
    judged(e) {
      if (!run || seen.has(e.id)) return;
      if (stage.getLoop?.() || eng.speed !== 1) run.valid = false;
      seen.add(e.id);
      scoreHit(run, !!e.hit);
      draw();
    },
    /** Song finished: a valid run of 20+ notes covering 90 % of the chart goes on the board. */
    ended() {
      if (!run) return;
      const total = H.targets.filter((t) => !t.linked).length;
      if (run.valid && seen.size >= 20 && seen.size >= total * 0.9) {
        let runs = [];
        try { runs = JSON.parse(localStorage.getItem(boardKey()) || '[]'); } catch {}
        runs.push({ ...run, at: Date.now() });
        runs.sort((a, b) => b.points - a.points);
        runs = runs.slice(0, 10);
        localStorage.setItem(boardKey(), JSON.stringify(runs));
        leaderboard.replaceChildren(
          h('h3', { text: 'Your score attack leaderboard' }),
          ...runs.map((r, i) => h('p', { text: `${i + 1}. ${r.points.toLocaleString()} points · ${r.bestCombo} streak · ${new Date(r.at).toLocaleDateString()}` })),
          closeBoard,
        );
        leaderboard.hidden = false;
      } else {
        toast({ title: 'Practice run complete', message: 'Leaderboard runs require a full song at 100% speed, without seeks or loops.', kind: 'info' });
      }
      stopRun();
    },
    /** Highway closing. */
    close() {
      leaderboard.hidden = true;
      tuner.hide();
      tuner.el.hidden = true;
      stopRun();
      if (clip.active) clip.stop().catch((e) => toast({ title: 'Clip could not be saved', message: e.message, kind: 'err' }));
    },
  };
}
