# Pedal rebuild: working notes (branch ccr-137e0328-sqv9ba)

User (2026-11-11): "I don't really have any pedals. I was hoping you could code these in to the engine":
make the drive, fuzz and pitch pedals realistic in the C engine.

## Decisions
- Drive pedals live in `native/dsp/sh_drive.c`, pitch pedals in `native/dsp/sh_pitch.c` (moved out of sh_fx.c,
  bit-identical output checked before any sound change). The DSP file list is in 5 places: native/build.sh,
  scripts/session-setup.sh, CLAUDE.md, .github/workflows/ci.yml and release.yml.
- Drives: circuit-based models (real part values, diode equations solved per sample, op-amp bandwidth, real tone
  stacks), not part-by-part SPICE copies. Default loudness kept close to the old pedals, because the pedal level
  sets how hard the amp is pushed.
- Pitch pedals: the Drop's in-phase splicing (sh_engine.c "drop"), generalised to shift up as well as down.
- Input scale: "Set level" puts a strum's peaks at -6 dBFS, so 1.0 in the engine is roughly 1 V from a guitar.

## Found on the way
- sh_engine.c low_vs_mid_db(): its measuring filters started from leftover stack memory, so the same tone could
  build slightly differently each time (valgrind). Fixed: they start from zero.
- The committed stagehand-audio.exe was the 4.5 engine (4.6 couldn't rebuild it). This session's network
  allows llvm-mingw, so it is rebuilt with each step.

- Aliasing at 4x was worse than the old soft curves (Muff -41 vs -87 dB at 660 Hz): real clipping edges are that
  sharp. Fixed by running the circuits at 8x (an 11-tap half-band inside the 4x stage): Muff -56, RAT -79.
- Denormals after a note fades made the RAT cost 18% of a core in silence: 1e-15 guard + FTZ/DAZ, now ~1%.
- sh_log2f_fast is too rough for the transistor equations: sh_drive.c has its own `lnf`.
- Levels: calibrated with a riff against the old pedals at default knobs (within 0.1 dB); the engine normalises each
  tone's loudness anyway, so the level mainly sets how hard the amp is pushed.
- The tone-recipe sustain check (hairlead >= 2 s) flips between 1.7 and 2.28 s because the echo refills the note;
  the hair lead's TS Tone went 55 -> 70 to keep it passing (no pedal at all also gives 1.7).
- Pitch: shifting up needs room for the old head to finish its fade (dmin grows with the ratio, shorter fades);
  the splice search compares only samples already written.

## Status
- [x] split files, bug fix, exe + wasm rebuilt, npm test ok
- [x] drives and fuzzes (8x, calibrated, tone ranges widened on Fuzz Was He / Germanium / Custom)
- [x] pitch pedals
- [x] tests (test/pedals-wasm.cjs), gear coverage 671/671, HANDOFF/README, version 4.7.0
- [ ] the user's ears: ask how each pedal feels
