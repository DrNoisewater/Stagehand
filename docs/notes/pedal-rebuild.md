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

## Status
- [x] split files, bug fix, exe + wasm rebuilt, npm test ok
- [ ] drives and fuzzes
- [ ] pitch pedals
- [ ] tests, gear coverage, HANDOFF/README, version bump
