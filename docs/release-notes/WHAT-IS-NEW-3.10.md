# Stagehand 3.10 — Play, capture, improve

The existing highway camera, scrolling speed, note timing, judgement windows, and core layout are preserved.

## Install on Windows

Close Stagehand, extract the entire download, then run **Stagehand-Windows/Install Stagehand.bat**. This updates the app and its native audio helper together. It keeps your library, tones, stems, and settings. The installer uses your existing runtime when possible; a first installation downloads Electron. Full editable source is in `stagehand/`.

## Amp + cabinet, together

Use the existing real-amp download button, now **Download amp + cab**. Stagehand pairs an amp-only capture with a recommended real cabinet IR. Full-rig NAMs already contain a cabinet, so another cabinet is not added. An IR you select yourself takes priority.

Four guitar cabinet IRs are included as an offline starter set; five bass cabinet choices are downloaded directly from Shift Line's free pack. Downloads are cached and SHA-256 checked. These are recommended family matches, not a claim that every amplifier has its exact original speaker/mic capture. If the bass download is unavailable, the existing modeled cabinet remains usable. The tone editor retains its optional custom WAV import and a switch back to modeled cabinet/mic controls. Captured IRs have fixed mic positions, so modeled mic controls are disabled while a capture is active.

## Highway tools

- **U** toggles the small tuner. The song keeps playing; the tuner's tuning/reference controls remain available.
- **Tone match · BETA** compares the separated guitar stem with your processed instrument while you play the same passage for eight seconds. Bass, mid, and treble corrections are bounded; the gain adjustment is a small spectral heuristic. **Undo match** restores your previous settings. It cannot reconstruct the original rig, picking technique, or production effects. It needs a loaded guitar stem, running playback, and instrument signal; the reference stem may remain muted in your mix.
- **Score attack** restarts the song at full speed. Hits earn points with a multiplier up to ×4; a miss resets the multiplier. Your personal best is shown during the run, and your ten best runs for that song/arrangement appear at the end. Seeking, looping, changing parts, or slowing down makes the run practice-only. Runs need at least 20 judged notes and 90% chart coverage for the board. Click the button again to leave Score attack.
- **Record clip** starts a recording of Stagehand's window and its internal song-plus-instrument mix. **Save clip** exports a WebM video (up to five minutes / roughly 300 MB). Native recording taps the final stereo output after amp/cab processing and song mixing, so it does not need Windows loopback and does not turn exclusive mode off. The in-app engine uses internal audio buses too. Stem mute/solo and volume changes are included. The exported file is saved wherever you choose, rather than in the old audio-only Takes list.

## Jam and backgrounds

**Jam** is in the main left navigation, below Discover. Choose/load a song, return to Jam, and turn **Play over song** on. Select guitar or bass to mute that stem while you improvise. Turn the backing off to play freely. Your previous stem mix is restored when you leave. Songs must have separated stems to mute an instrument; guitar separation may contain both lead and rhythm together.

Fluid now follows the audible mix rather than chart events. Three additional looks—**Aurora**, **Orbital**, and **Prism**—are available in the highway venue picker and Jam. They react to the song's post-fader audio plus your instrument; muted stems stop contributing. Jam remembers its chosen look.

## Progress and bends

Progress has goals for five songs at 95% or better this calendar month (100+ notes, full speed), a seven-day practice streak, and a first perfect section (10+ notes, full speed). Earned goals glow and produce a small celebration. Progress data stays local.

Bend ribbons follow the chart's ramp, hold, and release points, move inward according to the string and string-order setting, and show the required bend amount. This changes their presentation without changing the chart timestamps or scoring rules.

## Validation and remaining hardware check

The existing automated core suite and new logic checks cover timing/layout regressions, bend/release curves, multipliers, bounded tone corrections, calendar goals, and cabinet integrity/cache recovery. Native fake-device tests verify separate processed-instrument and final stereo song-plus-instrument taps, and stopping the tap. The Windows helper is rebuilt and included.

Browser checks exercise navigation, Jam's backing and mute restoration, the tuner, score-attack start, actual tone-match analysis, and recording/encoding. A focused Web Audio test verifies frequency-dependent correction and exact Undo. Test video uses a synthetic window source; VP9 video and stereo Opus audio have been decoded and inspected. Actual Windows desktop capture, your Rocksmith cable, hardware A/V sync, GPU performance, and the live TONE3000 authorization/download flow still need a check on your PC. Tone match is explicitly beta.

Asset sources and terms: `src/renderer/data/cabs/ATTRIBUTION.md`.
