# Stagehand 3.11.1 — Drop audio repair

Close Stagehand, run Stagehand-Setup-3.11.1.exe, and reopen it. Existing library and settings are retained.

## Fixed
- Corrected pitch-shifter splice fades: correlated audio now uses smooth unity-sum weights. The former equal-power fade could boost the signal by 3 dB and change the amp's drive at every splice.
- Expanded phase-alignment search from 11 ms to 26 ms, covering the period of a bass low E; lengthened splice fades from 5 ms to 8 ms.
- Corrected interpolation of negative read positions during startup.
- Settled enabled Drop to fully wet, and retained exact bypass after switching it off.
- Rebuilt both Windows native audio and the WebAssembly fallback from the same corrected DSP.

## Focused checks
- Native DSP: 44.1/48/96 kHz; semitone settings 0–12; unity splice gain; finite output; bypass restoration.
- Half-step spectral check: 41.2, 82.4 and 440 Hz at all three rates; measured output within 1 cent of the expected pitch.
- Existing chord/pitch checks and tuning-plan checks pass.
- At 48 kHz / −1 semitone, 50 ms RMS level variation improved from 0.67 to 0.23 dB for an 82.4 Hz input, and 1.28 to 0.24 dB for 41.2 Hz. These are synthetic test signals, not recordings of a real guitar.
- Routing reviewed: Drop precedes the amp/effects and only shifts the instrument; no second dry playback path found. Song audio is mixed afterward.

## Limits and quick listening check
This is a repair to Stagehand's existing time-domain pitch shifter, not a reproduction of DigiTech's proprietary DSP. Chord/transient artifacts may remain. Its variable algorithmic delay is approximately 4–44 ms while enabled, in addition to interface latency; the wider search increases the maximum delay by about 15 ms. No physical instrument or DigiTech A/B comparison was available.

For a half-step test, bypass your physical pedal, turn off “Match the song's tuning,” select −1, and enable Stagehand Drop. Compare single notes, chords and palm-muted attacks at a moderate volume. Turn Stagehand Drop off before using your physical pedal. Do not judge using a microphone mixed with the unshifted acoustic strings.

All 3.11 Jam, looper, tone-slot and visualizer changes are included. No new UI is introduced in this update.
