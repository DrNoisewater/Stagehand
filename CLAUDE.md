# Stagehand: notes for Claude

Windows desktop app (Electron 44) for Rocksmith 2014 `.psarc` songs: library, player, stem mixer, and a live guitar/bass rig with note detection. **Read `HANDOFF.md` first**: it has the history, the design decisions, and who the user is (a guitar and bass player, not a programmer: write to them in plain words with no code talk).

## Layout

- `src/main/`: Electron main process (CommonJS): `core/` (PSARC, SNG, saves, tones) and `services/` (library, stems, audio relay).
- `src/renderer/`: the UI (ES modules, no bundler, no build step): `js/rig.js` (the rig), `js/detect.js` (note detection), `js/instrument.js` (guitar or bass).
- `engine/stagehand_stems.py`: stem splitting (Demucs/PyTorch, installed on the user's PC at runtime).
- `native/`: the sound engine in plain C. `dsp/` is the amp, cab, effects and NAM code, shared by the Windows helper (`host/io_wasapi.c` → `native/bin/stagehand-audio.exe`, **prebuilt and committed**) and the in-app WebAssembly engine (`src/renderer/worklets/rig-dsp.wasm`, **committed**).
- `windows/`: the installers: `install.ps1` + `Install Stagehand.bat` (zip install), and `setup/` (the Setup .exe, C, cross-compiled).
- `test/`: plain Node and Python test scripts (no framework except `node:test` in a few), plus `test/e2e/` (Playwright + Chromium).

## Commands (verified on Linux in a cloud session, 2026-11-01)

No `npm install` is needed for tests: there is no lockfile, and no test uses `node_modules`.

```sh
# test dependencies: Node 20+ (22 used), Python 3 with cryptography
python3 -m pip install cryptography

npm test                        # the whole suite (~1 min); must pass before committing
node test/detect.test.mjs       # note detection on synthesised playing (~20 s); NOT in npm test: a few assertions can be flaky
node --test test/instrument.test.mjs   # guitar-or-bass sensing (also in npm test)

# Linux helper with a fake audio device, needed by the e2e rig/UI tests (native/build/ is git-ignored)
cd native && mkdir -p build && cc -O3 -ffp-contract=fast -fno-math-errno -Wno-unused-function -pthread \
  -o build/stagehand-audio-fake host/host.c host/io_fake.c \
  dsp/sh_util.c dsp/sh_amp.c dsp/sh_cab.c dsp/sh_fx.c dsp/sh_rev.c dsp/sh_engine.c dsp/sh_nam.c -lm && cd ..

# the rig end to end in Chromium (real rig.js + WebAssembly + relay + fake helper); ends with "all passed"
node test/e2e/rig-chromium.js native/build/stagehand-audio-fake <outDir>
```

Also documented in HANDOFF.md but not re-run on 2026-11-01:
- `bash scripts/session-setup.sh` fetches llvm-mingw (the Windows cross compiler) and the Setup payload zips, and builds the fake helper.
- `PLAYWRIGHT=/opt/npm-tools/node_modules/playwright node test/e2e/ui3-chromium.js native/build/stagehand-audio-fake <outDir>` visits every page and takes screenshots. Without `PLAYWRIGHT`, `require('playwright')` resolves to the preinstalled one.
- `bash native/build.sh` rebuilds the .exe (needs llvm-mingw), the .wasm (needs clang with wasm32) and the native tests. **Only run it when `native/` changes**, and commit the rebuilt `native/bin/stagehand-audio.exe` and `rig-dsp.wasm`.
- `sh scripts/package.sh <outDir>` builds `Stagehand-Windows.zip` and `stagehand-source.zip`. With `SETUP_DEPS=…` it also builds `Stagehand-Setup-<version>.exe`.

## What Linux can't do

- **Run the app.** It is Windows-only (Electron, WASAPI audio through the Rocksmith cable). `npm start`, `npm run dist` (electron-builder NSIS) and the WASAPI helper only work on Windows. On Linux, check the UI with the Chromium e2e scripts, which use a mock preload and a fake audio device.
- **Hear anything or use a real instrument.** Detection and tone changes are tested on synthesised audio only, so ask the user how they feel.
- **Run the Setup .exe or the .ps1 installers.** `windows/setup/test-wine.sh` exists for Wine.

## CI and releases (GitHub Actions, windows-latest)

- `.github/workflows/ci.yml` runs on every pull request: `npm test` (with `PYTHON=python`, because Windows has no `python3`), then compiles `stagehand-audio.exe` from source with llvm-mingw `20251104` and the same flags as `native/build.sh`.
- `.github/workflows/release.yml` is manual (Actions → Release → Run workflow, version e.g. `3.9.1`). It fails unless the version is `X.Y.Z`, equals `"version"` in `package.json`, and tag `v<version>` doesn't exist yet. It then runs the tests, rebuilds the .exe, zips the `Stagehand-Windows.zip` layout as `Stagehand-v<version>-win-x64.zip`, pushes tag `v<version>`, and creates the GitHub Release with auto-generated notes.
- To release, bump `version` in `package.json` (and the HANDOFF heading) in a commit on the default branch, then run the Release workflow on that branch.

## Conventions

- Don't add npm dependencies to the app: everything is vendored or plain JS/C.
- Comments and UI text are plain, short sentences. User-facing text never mentions code.
- Keep `HANDOFF.md` up to date with each change: what the user asked for, what changed, where it lives, and what to ask them next.
