# Stagehand: notes for Claude

Windows desktop app (Electron 44) for Rocksmith 2014 `.psarc` songs: library, player, stem mixer, and a live guitar/bass rig with note detection. **Read `HANDOFF.md` first**: it has the history, the design decisions, and who the user is (a guitar and bass player, not a programmer: write to them in plain words with no code talk).

## Start from the latest version (always)

A session once started from a copy several versions old (3.9 while GitHub had 4.0.9) and rebuilt video recording, which already existed. So:
- `.claude/hooks/session-start.sh` runs at every session start: it fetches GitHub and brings the checkout up to the latest `main` when that's safe, or prints a WARNING saying how far behind it is. Read that line before doing anything.
- Before building a feature, check it doesn't exist already: `git fetch origin main`, compare `package.json`'s version with `origin/main`'s, and search the code (`git grep`) for it. If the user says something already exists and you can't find it, you are on an old copy: fetch first, never rebuild it.
- New work branches start from `origin/main` (`git checkout -B <branch> origin/main`).

## Layout

- `src/main/`: Electron main process (CommonJS): `core/` (PSARC, SNG, saves, tones) and `services/` (library, stems, audio relay).
- `src/renderer/`: the UI (ES modules, no bundler, no build step): `js/rig.js` (the rig), `js/detect.js` (note detection), `js/instrument.js` (guitar or bass), `js/sing.js` + `js/singlane.js` + `js/mic.js` (Sing along, an add-on: off until its chip is pressed), `js/autotune.js` + `worklets/autotune-worklet.js` (4.17 auto-tune and voice changer: the microphone moved onto the song's notes and played with the song; off until a style or voice is picked), `js/karaoke.js` (the Karaoke page), `js/piano-arrange.js` + `js/piano-sheet.js` + `js/keys.js` + `js/midi.js` (Piano, an add-on: a part written from the song, sheet music and falling notes, a USB keyboard).
- `src/companion/`: the Quest companion's page (4.16, plain JS, served by `src/main/services/companion.js` over HTTPS on the home network, only when switched on in Settings › Quest headset; `core/ws.js` and `core/selfcert.js` are its WebSocket and certificate).
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
node test/chords.test.mjs       # chord scoring: wrong chords miss, messy right strums count (~40 s); NOT in npm test
node --test test/instrument.test.mjs   # guitar-or-bass sensing (also in npm test)
node --no-warnings test/autotune.test.mjs   # auto-tune and voice changer on a made-up voice (also in npm test)

# Linux helper with a fake audio device, needed by the e2e rig/UI tests (native/build/ is git-ignored)
cd native && mkdir -p build && cc -O3 -ffp-contract=fast -fno-math-errno -Wno-unused-function -pthread \
  -o build/stagehand-audio-fake host/host.c host/io_fake.c \
  dsp/sh_util.c dsp/sh_amp.c dsp/sh_cab.c dsp/sh_fx.c dsp/sh_drive.c dsp/sh_pitch.c dsp/sh_rev.c dsp/sh_engine.c dsp/sh_nam.c -lm && cd ..

# the rig end to end in Chromium (real rig.js + WebAssembly + relay + fake helper); ends with "all passed"
node test/e2e/rig-chromium.js native/build/stagehand-audio-fake <outDir>

# the moving backgrounds on a made-up song, Jam and behind the highway; writes sheet.png
node test/visuals/shoot.js <outDir> [fluid nebula swarm mandala strings]

# highway stills on made-up charts (scene T = techniques: bends, vibrato, held-on bends)
PLAYWRIGHT=playwright node test/hwlook/shoot.js <outDir> T:17.2 T:19.1
# the play-along timing check with a pretend guitar 80 ms late (expects about +30 ms)
PLAYCAL=80 PLAYWRIGHT=playwright node test/hwlook/shoot.js <outDir> T:3
# the tuning check card (every string, A425, a string ticked by a pretend guitar); writes tcheck-1/2.png
TCHECK=1 PLAYWRIGHT=playwright node test/hwlook/shoot.js <outDir> T:3
# the real app in Electron: crash the window mid-recording; it must reload with a note and save the clip
# (electron 44 installed outside the project, e.g. npm install electron@44 in a scratch folder)
ELECTRON=<electron> xvfb-run -a node test/e2e/crash-electron.js <outDir>
# the song finder in the real app on a pretend song site: Discover's Find opens it, Find searches, downloads land in the library
ELECTRON=<electron> xvfb-run -a node test/e2e/finder-electron.js <outDir>
# Tones in the real app: one tone used for guitar and bass (each row picks itself), an empty key
ELECTRON=<electron> xvfb-run -a node test/e2e/tones-electron.js <outDir>
# Sing along with a pretend microphone: the chart's notes (1), notes read off a made-up vocals stem (stem), timing only (words, karaoke (karaoke))
SING=1 PLAYWRIGHT=playwright node test/hwlook/shoot.js <outDir> T:1.5
# auto-tune: a pretend singer 40 cents flat hears their voice put on the note (robot, pop or natural)
TUNE=robot SING=1 PLAYWRIGHT=playwright node test/hwlook/shoot.js <outDir> T:1.5
# the tuned voice through the sound engine's own voice line (fake helper): whole, no gaps, the song beside it
node test/voice-native.js native/build/stagehand-audio-fake
# the same with an unsteady pretend voice (vibrato, drift, cracks, breaths): SING_WOBBLE=1 SING=1 …
# Piano with a pretend USB keyboard and pianist: a made-up song with a singer (tune), or a real chart (real, file sugar.json)
PIANO=tune PIANO_END=46 PLAYWRIGHT=playwright node test/hwlook/shoot.js <outDir> T:0.5
PIANO=real PLAYWRIGHT=playwright node test/hwlook/shoot.js <outDir> R:0.5:::sugar.json
# the highway's top bar fits (nothing off the edges, the title readable), Piano off and on, at a window width
TOPBAR=1 VW=1366 VH=768 PLAYWRIGHT=playwright node test/hwlook/shoot.js <outDir> T:3
# Piano in the full page: the keyboard in Settings, Piano on a real library song, a key scored
SH_AUDIT=test/e2e/piano-audit.js node test/e2e/ui3-chromium.js native/build/stagehand-audio-fake <outDir>
# Sing along's settings in the full page (the microphone picker, the look) and the Karaoke page
SH_AUDIT=test/e2e/sing-audit.js node test/e2e/ui3-chromium.js native/build/stagehand-audio-fake <outDir>
# Discover's look on made-up results, artist, gaps and Wanted; writes discover-*.png
SH_AUDIT=test/e2e/discover-audit.js node test/e2e/ui3-chromium.js native/build/stagehand-audio-fake <outDir>
# the Gear page's spec sheet (real gear, words, every knob) on an EQ, a cabinet and an amp
SH_AUDIT=test/e2e/gear-about-audit.js node test/e2e/ui3-chromium.js native/build/stagehand-audio-fake <outDir>
# stem splitting: a song in line names the one split first; a split moving along rebuilds nothing
SH_AUDIT=test/e2e/stems-audit.js node test/e2e/ui3-chromium.js native/build/stagehand-audio-fake <outDir>
# the Quest companion: the real server and page with a pretend Quest browser (pair, library, pick, play/seek both ways, clock); writes q-*.png
SH_AUDIT=test/e2e/companion-audit.js node test/e2e/ui3-chromium.js native/build/stagehand-audio-fake <outDir>
# the headset's highway on a made-up part, no app needed (quick pictures of its look); writes vr-<t>.png
node test/e2e/companion-vr-shot.js <outDir> 3.2 6.6
# Setup's header art, cut from the app's own banner (commit the results); then pack it for the build
SH_AUDIT=windows/setup/make-art.js node test/e2e/ui3-chromium.js native/build/stagehand-audio-fake <outDir> && python3 windows/setup/make-art.py
# a moving background must rebuild itself after the graphics card drops it
LOSE_CONTEXT=1 VENUE=nebula PLAYWRIGHT=playwright node test/hwlook/shoot.js <outDir> T:17:p
```

Timing in this container: `ui3-chromium.js` takes ~20 min (run timing-sensitive checks such as SING/PIANO/TCHECK/rig on their own, not beside it); in `rig-chromium.js` tone builds can take 5–8 s under load, so its "Keep my tone", "bass heard" and "speakers got the song" checks fail now and then (also before 3.13).

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
- `ci.yml` also (4.0.1) builds the small Setup on Linux and runs it for real on windows-latest (`windows/setup/test-windows.ps1`: install from GitHub, quick second run, cut-off downloads that must resume, uninstall).
- `.github/workflows/release.yml` is manual (Actions → Release → Run workflow, version e.g. `3.9.1`). It fails unless the version is `X.Y.Z`, equals `"version"` in `package.json`, and tag `v<version>` doesn't exist yet. Windows job: tests and the sound engine .exe. Linux job: builds `Stagehand-Setup-<version>.exe` (~4 MB; it downloads the runtime, decoder and uv when missing, pinned in `windows/setup/components.sh`, SHA-256 checked), then pushes tag `v<version>` and publishes the release with that one file and short notes.
- To release, bump `version` in `package.json` (and the HANDOFF heading) in a commit on the default branch, then run the Release workflow on that branch.

## Conventions

- Don't add npm dependencies to the app: everything is vendored or plain JS/C.
- Comments and UI text are plain, short sentences. User-facing text never mentions code.
- `README.md` is for players (it also ships inside the Windows zip): what Stagehand does, how to install it, short and plain. No file formats, internals or test details there; those go in this file or `HANDOFF.md`. What's new is one line per release.
- Keep `HANDOFF.md` up to date with each change: what the user asked for, what changed, where it lives, and what to ask them next.
