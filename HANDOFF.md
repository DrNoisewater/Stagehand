# Stagehand handoff (v3.2.5, 2026-10-26): real amps (NAM captures) built; waiting for the user's first try

Paste this into a new session and attach `stagehand-source.zip`. Unzip it, and the project is in `stagehand/`.

## Start here (3.2.0, 2026-10-26)

**What 3.2 is:** tones can play through real amp captures (Neural Amp Modeler `.nam`) in the amp's place, matched to every Rocksmith amp, from TONE3000. The user chose (asked at the start): **download on first use** from TONE3000, and **modelled amp when there's no match**. Built, tested here, packaged. **Not yet tried by the user, and never run against the real TONE3000 (blocked from the sandbox) or on Windows.**

Ask the user, in this order:
1. Did the one-time TONE3000 setup work (Settings › Real amps, 3 steps: account + app key, add the redirect address `http://127.0.0.1:47613/tone3000`, paste the publishable key)? If **Get the real amp** fails, the toast carries TONE3000's own message: fix from that (likely suspects below). Fallback that always works: download from tone3000.com by hand and **Add .nam or .zip files**.
2. How do real amps sound next to the modelled ones (the **Real | Modelled** switch on the amp, Tones page) and next to Rocksmith? Which amps sound wrong, too dirty/clean (gain mapping), too loud/quiet?
3. CPU: any crackles with real amps (Settings › Guitar & audio › Buffer: Safe)? Does a song with many tones take long to start?
4. Visual check: the REAL badges, the gain ladder on the amp, Settings › Real amps.

Then the earlier open asks (still unanswered from 3.1): highway camera, tones after the low-end fix, the Drop, venues and fire, the waveform; a visual-first pass across the app; a tuner quick-open on Now playing and the highway.

**3.2.1 (same day, user: "the included tones don't match the new setup"):** the presets (rig.js `TONES`) were rebuilt on amps that have curated captures, each gain on a capture variant (Clean→Deluxe 0.30, Crunch→Plexi Driven 0.65, Overdrive→JCM800 High 0.75 + Super Drive, Metal→Rectifier Gain 8, Fuzz→Rockerverb Crunch, Lead→5150 R Gain #3, Bass clean→SVT Clean, Bass grit→AD200 Gain 5, new Chime→AC30 Edge of Breakup in slot 9). `tonelib.upgradePresets` (once, localStorage `stagehand.presets32`): saved slot tones that are untouched copies of the 3.1 presets (same name and gear fingerprint, `OLD_PRESETS` kept in tonelib.js) get the new gear; edited ones stay; Chime takes a free slot. Tests: captures.test.js checks every preset lands within 0.02 of a capture gain; `SH_OLD_SLOTS=1 node test/e2e/ui3-chromium.js …` checks the upgrade. Ask the user whether the presets sound right once the real amps are got.

**3.2.2 (user: "it has been reading my tones for a few minutes", wants a progress bar in the app's style):** `ToneIndex.list` now reports `{done, total}` (only songs actually read; nothing when all are remembered) as IPC event `tones:progress`, shares one read between callers (Tones page and Settings › Real amps used to read twice at once), and saves the cache every 25 songs so closing midway keeps progress. Page: `tonelib.readingBar()` (gel-striped tungsten fill with glow, eq icon, "440 of 1,200 songs", indeterminate before the first count), shown on Tones › From my songs and in Settings › Real amps (which now uses `songToneLibrary`). Tests: `test/toneindex.test.js` (in npm test); `SH_SLOW_TONES=1 node test/e2e/ui3-chromium.js …` screenshots `v3-18/19`. The harness bridge's `api.on` now delivers events (`window.__shEmit`). Ask how many songs the user has and how long the first read took.

**3.2.3 (user has 3,000+ songs; the 3.2.2 bar sat on "getting started" over a minute; asked to keep tones across versions):** the tone cache (`%LOCALAPPDATA%\Stagehand\Cache\tone-index.json`) was never touched by the installer, but 3.2.1 only saved after the whole read, so every interrupted read was lost. Now: progress counts every song (`{done, total, read}`, remembered ones too), first report before anything is opened, a song that takes > 15 s is skipped and retried next time (`slowMs`), saves at most every 10 s (`saveEveryMs`; the file is ~10 MB for 3,000 songs) and on quit (`flush`), and logs `Tones: N songs, X remembered, Y read, T s` plus any song over 2 s (Settings › About log). **3.2.4: cause found.** The Tones tab is remembered (3.1); opening Tones straight on From my songs showed the waiting state but `loadLibrary()` only ran on a tab click, so the read never started (since 3.1). `renderItems` now starts it whenever the bar shows; ui3 check "opening Tones on From my songs reads your songs by itself". Earlier note, now explained: (3,000 remembered songs list in 0.2 s and a 9 MB IPC payload serialises in 0.1 s here): if it happens again, get the log lines starting `Tones:`.

**3.2.5 (user's first real TONE3000 use):** one Get showed a TONE3000 page saying the tone "isn't compatible" and never redirected back, so the loopback server kept waiting and every later Get failed with "TONE3000 is already open in your browser"; the user also disliked the leftover browser tab. Now TONE3000 opens in a small Electron window (`openTone3000` in main.js, partition `persist:tone3000` so the sign-in is remembered; the redirect to `127.0.0.1:47613/tone3000` is caught by `webRequest.onBeforeRequest`/`will-redirect`, never loaded, and the window closes itself; closing it = cancelled). A new request cancels a pending one (`_pending.cancel()`, code `replaced`, silent in the UI). Settings › Real amps › "Use my web browser instead" (`t3k.useBrowser`) keeps the old browser + loopback path for Google sign-in (Google blocks embedded sign-in); its callback page tries `window.close()`. **Still unknown:** why TONE3000 said a tone isn't compatible; ask which amp it was. Guess: the user's TONE3000 app key may declare supported formats/architectures; Stagehand plays NAM A1 and A2 (not IRs/AIDA-X/Proteus). Check the key's settings with them.

**Not done from the agreed plan:** real **cab IRs per Rocksmith cab family** (step 2): captures are amp-only, so Rocksmith's cab is still Stagehand's modelled cab unless the user picks their own IR (existing), or the capture is a full rig (`kind: 'full'` skips the cab). Next obvious step: a curated IR per cab family from TONE3000 (format `ir`), same Get flow, wired into `cab_build_ir`. Also not done: pedal captures, VST3 hosting, AVX2 for the NAM loops (SSE only today).

### How it works

**Engine (native/dsp/sh_nam.c, plain C, no libc; native + WebAssembly):** a port of NeuralAmpModelerCore (MIT). Loads `.nam` JSON (own JSON parser, weights straight into floats), runs LSTM, WaveNet A1 (nano…standard, custom) and A2 (bottleneck, grouped convs, gated/blended, all 8 FiLM points, head1x1, post-stack head with kernel > 1, condition DSP), slimmable WaveNets at full size, SlimmableContainer (largest submodel; `size_pref` 1 = smallest). Block processing over time (NB = 256) so the inner loops vectorise. Prewarm = same sample counts as NAM. Fast float-accurate tanh (rational, < 4e-7). **Matches the reference to ~1e-6 relative on every example model** (`test/fixtures/nam`; recipe to rebuild the reference below).
- `namamp_build` (sh_nam.c): the amp block. Input trim = `(tone gain − gainRef) × 12 dB` (gainRef = the gain position the chosen model was captured at), then the tone's Bass/Mid/Treble/Presence as post-EQ around noon (±7/6/7/4 dB), DC blocker, user knobs via `sh_block.user` (amp_user dispatches). Resampler (16-tap windowed sinc, 512 phases) when the capture's rate ≠ device rate: ~79 dB clean, 0.3–0.5 ms extra (`native/test/rs_test.c`). Gate threshold from a measured "squash" (quiet vs loud gain), cached per capture.
- `sh_engine_set_nam(e, slot, json, len, full_rig, gain_ref, trim_db)` + `sh_engine_nam_error()`. Parsed model per slot in a 2 MB region after the slot arenas (`NAM_BYTES`); refuses the playing slot. `full_rig` skips cab blocks and the default cab. Build with a standard A1 capture ≈ 250 ms (was ≤ 81 ms modelled).
- CPU here (Xeon 2.8 GHz, SSE build): A1 standard ≈ 15% of a core at 48 kHz/128, A2 full ≈ 9%, whole tone with A1 standard ≈ 17% (24% at 44.1 kHz with resampling). `-march=x86-64-v3` would give ~10%.
- Helper: `{"cmd":"nam","slot","path","fullRig":0|1,"gainRef","trim"}` reads the file, answers `{"ev":"nam","slot","ok","error"}`; does **not** rebuild (the page builds next). Re-applied on engine re-init. wasm: `buf_nam()`, `buf_nam_size()` (4 MB), `set_nam(slot, len, full, ref, trim)`, `nam_error()`.

**Main (src/main/services/captures.js):** `<roaming>/Captures/captures.json` `{ packs, assign, t3k }`, models in `<packId>/*.nam`. Pack = one TONE3000 tone (or your files) with models at gain levels. `assign[RocksmithAmpKey] = packId | 'off'`. TONE3000: OAuth 2 + PKCE through a loopback server on 127.0.0.1:47613 (`/tone3000`), token encrypted with Electron safeStorage; `connect()` (plain sign-in), `get(packKey)` (`prompt=load_tone&tone_id=…` for a curated pack), `browse()` (`prompt=select_tone`), then `GET /api/v1/tones/{id}`, `GET /api/v1/models?tone_id=…` and each `model_url` with the bearer token. Free-tier rules (from their API terms): only the prompt flows, only download when the user asks, keep creator names; so nothing downloads in the background. `addFiles()` takes `.nam` and `.zip` (one pack per zip, or per gear make+model; gain from names). IPC `captures:*`, event `captures:change`, protocol `stagehand://capture/<pack>/<file>`. Env for tests: `STAGEHAND_T3K_BASE`, `STAGEHAND_T3K_PORT`, `STAGEHAND_T3K_OPEN=fetch`.
- **Unverified against the real API** (only the docs summary was readable): token endpoint body (form, falls back to JSON), response shapes (`data` arrays), `model_url` needing the bearer, `tone_id` in the callback, the `gears` filter (not sent). The user needs their own TONE3000 app key (free tier is for non-commercial apps; Stagehand is personal).

**Curated map (src/renderer/data/capturemap.json):** 14 packs covering 57 of 60 Rocksmith amps (not the CS solid-state cleans): Rectifier Rev G gain pack (CA100, GB100, BT15), 5150 Block Letter (HG*, EN50), JCM800 2203 (JCM800, CA38, EN30, GB38, BT30, TW40), 1959 Plexi (Plexi, GB50, BT45), JTM45 (JTM45, Bluesbreaker), JVM410H (JVM, DSLs), Rockerverb 50 MkII (all Oranges), AC30S1 10-pack (AT*), Deluxe Reverb full rig (TW22/26, CA85), Tweed Deluxe 5E3 (Gibsons, Epiphones), SVT-CL (BT/HT/LT bass), Orange AD200B, Eden WTDI, GK 800RB full rig (CH/CS bass). Each variant = exact model name (else substring) + the Rocksmith gain it plays like. Model names were read off the TONE3000 pages; if a name differs in the API, that variant is skipped (the rest still work). All T3K licence. The Rocksmith fictional amp → real amp pairs are best guesses by family (from sh_amp.c's families); adjust with the user's ear.

**Page:** `js/captures.js` (state + `resolveCapture(tone)`: Real amps off → tone.capture ('off' | pack) → your per-amp choice → curated pack if downloaded; model by nearest gain), `js/realamps.js` (amp strip in the tone editor: REAL/MODEL badge, Real | Modelled, Change menu, gain ladder, Get the real amp; REAL badges; Settings › Real amps pane with the 3-step setup, your captures, Get more sorted by how many of your song tones use each pack). `rig.js`: slot key includes the capture; sends `nam` before `build`; failed captures fall back to modelled with one toast; `rig.capture` + `capture` event; rebuilds when captures change. Demo riffs and loops render through the capture too (render.js fetches it). Saved tones keep `capture`. Real amps on/off: localStorage `stagehand.realAmps`.

### Tests and tools
- `npm test` now includes `test/captures.test.js`: the whole TONE3000 flow against a stand-in server (PKCE, load_tone, select_tone, model picking by gain, no lite duplicates/IRs), own files and zips, and a capture running in the wasm engine.
- `native/build.sh` also builds `build/nam_test` (render a file through a capture, timing), `build/nam_engine_test <model> <sr> [fullrig]` (whole tone, both amps), `build/rs_test` (resampler).
- Reference NAM renderer (for checking sh_nam.c): `git clone --depth 1 https://github.com/sdatkinson/NeuralAmpModelerCore`, Eigen from the GitHub mirror `https://github.com/PX4/eigen` (gitlab is blocked), build `NAM/*.cpp NAM/wavenet/*.cpp` with a small main using `nam::get_dsp`, `Reset(sr, block)`, `process` (NAM_SAMPLE is double). Compare float outputs.
- `test/e2e/ui3-chromium.js` has real-amp checks (seeded Plexi pack: REAL on Play/Tones, Driven named on the knobs, gain ladder, Real/Modelled switch, Get offer on a Cali-100, setup steps, Settings tiles) and screenshots `v3-13…17`. **Its bridge now batches raw guitar frames and coalesces meter events**: before that, this 2-core sandbox lagged > 8 s and gave "The sound engine didn’t answer" timeouts (the original 3.1 code had 7 of them too). Now 0 timeouts, 40/40 checks.



Paste this into a new session and attach `stagehand-source.zip`. Unzip it, and the project is in `stagehand/`.

## 3.1 session's last state (2026-10-25 ~21:40), kept for reference

**(Done in 3.2, see the top.)** The plan as it was agreed:
The user feels Stagehand's tones are "so much different than Rocksmith's sound". They pointed to Slopsmith (open-source Rocksmith clone, github.com/byrongamatos/slopsmith and slopsmith-desktop; forks e.g. JayMan8-1/slopsmith-desktop). Slopsmith does NOT model Rocksmith gear: its chain is guitar → input gain → VST/NAM/IR chain → output, built on JUCE 8 + NAM + RTNeural, with models from TONE3000 (formerly ToneHunt) / the NAM model database. Our engine hand-models ~600 Rocksmith gear items, which keeps song tones automatic but can't sound as real as captures.
Plan (approved in principle; confirm details with the user at the start):
1. **NAM in the C engine** (`native/dsp`): real-time inference for `.nam` models (JSON: architecture + weights). Start with LSTM and the standard/feather WaveNet. Both the native helper and the wasm build need it (or native only, with the in-app engine keeping the old models). Resample if the model rate ≠ engine rate; keep latency at 0 extra samples; check CPU on WaveNet "standard" at 48 kHz (budget: well under 30% of one core at 128-frame buffers). NAM core (MIT) and RTNeural (BSD) are usable references; we're plain C, so port the inference rather than link C++.
2. **Real cab IRs**: we already convolve user IRs (`cab_build_ir`, `ir` command, Tones › Use my own cab file); add a bundled or downloadable IR set per Rocksmith cab family.
3. **Gear → capture map**: each Rocksmith amp (e.g. Amp_CA100 ≈ Mesa Dual Rectifier, Amp_MarshallJCM800, Amp_GB50, Amp_HG180, Amp_TW* Fender-style, Amp_AT* Vox-style …) maps to a NAM capture at a matching gain, with the Rocksmith gain knob choosing among captures or driving an input trim; pedals before stay modelled or get captures (Tube Screamer-style drives have good NAM captures). Song tones keep switching automatically, which Slopsmith can't do.
4. **Licensing:** only use captures/IRs whose licence allows redistribution, or download them on first use from their source with credit; otherwise let the user point at their own files. Ask the user how they want to source models (bundle a curated set vs download from TONE3000 vs use their own).
5. **UI:** in the tone editor's amp block, "Real amp (NAM)" with the capture's name, a picker for your own `.nam` files, and Get models (TONE3000) like Get cab files. Visual first.
6. **Measure** with the scratchpad-style scans (tone frequency response vs 1 kHz, drive/compression test, build time) and A/B against the old models; then ask the user to compare by ear against Rocksmith.
Later, optional: VST3 hosting (bigger; needs a plugin host and plugin windows).

**Ask the user first (they asked to be asked later):**
- **NAM support**: now the next session's job (see above). Not started. Needs a real-time NAM inference path in the C engine (LSTM/"feather" models are cheap; standard WaveNet is heavier but doable), loading `.nam` JSON weights, resampling to the engine rate, and a UI slot in the tone chain (instead of or before the amp). Proposed as its own update.
- A **visual-first pass across the whole app** (their standing rule, see Conventions) and a **tuner quick-open** on Now playing and the highway (offered, not started).

**Then get their feedback on:** the highway camera (pitch 0.55, `fitsView` limits 6 frets / 16 units, max distance 28), tones after the low-end fix (do they still sound bassy? pinch harmonics?), the Drop, venues and fire, the new waveform.

**Last changes in this session (after the 3.1 notes below):**
- Play along (Songs panel) opens the highway first (no Tab flash) and never restarts a song that's already playing (`actions.playAlong`).
- Songs panel: no more "Tones in this song" (tones live on the Tones page); song facts are icon chips (`.insp-facts`). Now playing › Tone: pick only, no Save/demo (those live on Tones).
- Highway camera: pitch 0.85 → 0.55 (user: "basically straight down"), `camY = top + d*0.55`, neck at 0.78H, `zF = d*5.5`; framing uses `fitsView(lo, hi)` (≤ 6 frets and ≤ 16 world units) so a jump from low power chords to a high solo pans instead of zooming out (checked on Metallica One, fret 2 → 14 at 0:56).
- Waveform (`drawBars`, `overview`): neon style; played part glowing with a bright edge, the rest a blue wireframe; loudness scaled to the song's 92nd percentile on a 0.7 curve.
- Song volume in the bottom bar and your guitar's volume on the guitar card; a volume at 0 shows as red, pulsing, crossed-out speaker, plus a short toast with Turn it up.
- Tone editor: **Get cab files** opens TONE3000 (https://www.tone3000.com/categories/tags/guitar); IRs are .wav, native engine only.
- The guitar-not-in-speakers report was the user's own volume at 0 (solved).
- **Tones page cleanup** (user: confusing, no arrow keys, saving to slots should be easier, kept jumping back to My tones): a **slot strip** (9 tiles) under the tabs: click a tile or drag a tone onto it to put the selected tone there (song tones and presets are saved as your copy first), Alt+1–9 does the same; ↑/↓ move through the list and audition after 220 ms; the tab is remembered (`stagehand.tonesTab`) and saving no longer switches tabs; the editor's Slot dropdown is gone. Tests in ui3-chromium.js.
- **Tone you pick was being taken back (big bug, fixed):** Now playing's `tick()` → `followTone()` re-applied the song's tone every frame whenever the rig wasn't in song mode, so any tone picked on Tones, a slot or the highway menu reverted at once (user: "heavy Ozzy lead selected, clean coming out", "always defaults back"). `followsSong()` now also needs `rig.mode === 'song' || !N.toneKey`: the song sets the tone when it starts or when you tick Follow; your own pick stays. Test: "your pick stays while a song plays". Measured on the user's 25 songs: all 144 tones build OK in ≤ 81 ms in the native helper; amps saturate as expected (output rises 0–3 dB for +20 dB input), so drive itself was fine.
- **Highway tone menu** now lists Your slots (keys 1–9), Your tones, then Presets (it only had presets); the Tone chip shows the slot and name; while a menu is open the highway leaves its keys alone (Escape closes the menu, not the highway).

**Test tools added:** `test/e2e/ui3-chromium.js` env `SH_ONLY_FOLDER=<dir of .psarc>` (use other songs), `SH_HW_SEEK=<n>` (skip n×5 s for highway shots), `SH_AUDIO_SECS=<s>` (longer stand-in audio; the "Mix panel lists the stems" check can time out with long audio, test-only). The stand-in song now has music-like sections and drums. The user's 25 test songs were in `dlc.zip` (attachments; ask for them again in a new session if needed). A tone measurement script (pickup-shaped noise, transfer per band vs 1 kHz, alternating engine slots because a playing slot can't be rebuilt) was used from the scratchpad; recreate it if tones need re-measuring.

**Odd thing to watch:** twice this session, files changed on disk between turns that matched the work in progress (probably an interrupted earlier run of the same session). Before editing, check file mtimes against the last package.

## 3.1.0: what changed, and what was asked

User asks, in their words: FLAC only (no choosing/previewing formats for now), clear their stems so they can remake them, the new bottom waveform lacked personality and should reflect the actual song, demo riff felt wrong/samey, songs stayed slow and glitchy after the riff repeater, tones not as good as Rocksmith, guitar not loud enough at full, add a DigiTech Drop (a toggle, not part of a tone chain), small look pass, highway as close to Rocksmith's as possible (they sent two Rocksmith 2014 DLC trailer videos: Godsmack, RATM), play/pause in the bottom bar sometimes ignored clicks, lag when doing several things.

- **Stems:** format fixed to FLAC (`stemformat.js` encodes in `workers/flac-worker.js`; compare dialog removed; Settings › Stems shows one row with Convert to FLAC for leftover WAVs). `StemService.startup()` clears the whole stems folder once (`settings.stems.cleared310`), and on later starts deletes files left from a format switch. `finishFormat` no longer deletes the old files right away (that race made the 404 "Could not load the keys/other stem" toasts); stage.js retries a failed stem once with fresh URLs.
- **Speed:** riff repeater restores your speed when you stop; a new song starts at 100%. Worklet WSOLA: speed changes no longer reset the stretcher (no click), the splice search refines to the exact sample.
- **Waveform** (`drawBars` in wave.js): smooth gel envelope like the stem lanes, glow on the played part; `overview()` normalises loudness (RMS) separately from peaks so the song's shape shows (700/900 bins).
- **Play button bug:** the bar rebuilt the button's icon every frame, so a press and release landed on different elements and the click was lost. Icons now only change on state change; `button svg { pointer-events:none }`.
- **Demo riff** (`render.js`): better Karplus-Strong (fractional delay, pick position, per-note decay; tuned within a few cents) and a riff that suits the tone's drive: clean arpeggios, crunch A rock riff, high-gain gallop, bass groove.
- **Engine (native + wasm rebuilt):** `SHP_DROP` (9: semitones 0–12, a low-latency splice-aligned delay-line shifter, ~10–15 ms extra while on; `native/test/drop_test.c` checks pitch within ~4 cents) and `SHP_ROOM` (10: stereo early reflections after the cab, default 0.5, Settings › Guitar & audio › Room). Cab response: steeper roll-off above the cone's top, jagged 1–7 kHz breakup, a faint back-panel reflection. Loudness target 0.11→0.16 (bass 0.13→0.19); volume knob above 0.7 adds up to +12 dB; host mixes guitar + song through a soft knee instead of hard clipping.
- **Drop UI:** card on Play (switch, −1…−7/Oct, Match the song), pill in the Now playing header, key D. `rig.drop`, `rig.dropAmount()`, `rig.setSongTuning()`; `detect.js tuneShift` re-aims scoring (practice.js and highway rebuild targets on the rig `drop` event).
- **Highway:** core rewritten as a true 3D perspective scene (`highway.js` from "3D" to HUD): upright neck at z=0, floor, string heights, anchor troughs with walls and rails that step across the floor, 3D gem boxes with stems, sustain ribbons (bends lift, slides move), chord boxes with string bars and a back face, a glowing bracket on the neck, hit sparks and light posts. Camera: spring on x and distance (`H.cam.d`), pitch 0.45, sits toward the high side of the hand position; tests still read `H.cam.f`. Tune in `camera()` (pitch, `camY`, `zF`) and `geometry()` (`gap`, `lift`).
- **Polish:** card highlights, press feedback, focus rings, scrollbars.

- **Highway, second pass (same day, from the user's screenshot + Bleed It Out):** camera now steep like Rocksmith (pitch 0.85, `camY = top + d*0.8`, `zF = d*4.5`, neck at 0.8H, slim string gap 0.75/1.0), so near notes spread out and the neck is a thin strip. Repeated chords are thin frames only; **accents** (`note.accent`, from SNG/XML) get a white glowing outline (`accentOutline`), so strummed patterns show their beat. `SH_ONLY_FOLDER=<dir> SH_HW_SEEK=<n>` makes `ui3-chromium.js` load another song folder and skip ahead n×5 s for highway shots.
- **Highway, third pass (user: "my main mode of playing, a better Rocksmith, more fun"):** camera framing (`camera()`) keeps a range of frets and only moves when a coming hand position doesn't fit (max 8 frets wide, looks 1.6/0.7/0.25 s ahead), zooms in after 2.5 s of slack, spring ω 2.6; simulated on the user's 25 songs: direction changes ~25/min → 2–6/min. Notes rewritten: pill gems, sustain trails that follow the real **bend curves** (`note.bends` now kept from SNG/XML, in **half steps**: 2 = full; detect.js and tab.js labels fixed to that), slides over the sustain, vibrato 5.5 Hz and tremolo in real time, bend arrows and labels; chord frames always span the hand position (open strings inside). **Venues** (`venues.js`: Arena, Club, Neon, Studio; code-drawn, beat-lit, options menu) and **heat** from the streak (8→40): rails warm to orange, embers only along the neck's bottom edge outside the hand position, bracket glow, streak badge. `H.forceStreak` for tests; harness env `SH_AUDIO_SECS`. Highway Mix: **Your guitar** and **Whole song** levels above **Song stems** (stage passes `songLevel/setSongLevel/setYou`); Now playing labels likewise.
- **Tones, measured:** `scratchpad`-style scan (pickup-shaped noise, transfer vs 1 kHz) showed guitar tones +6/+7 dB at 60–200 Hz (should be below 1 kHz) and a mid scoop. Fixes: first-stage low cut per amp family (60–170 Hz, more for high gain: tighter, pinch harmonics cut through), amp out_hp 85 Hz, gentler cab resonance Q and a 4th-order fall below it, and a **per-tone low-shelf correction measured at build** (`low_vs_mid_db`, target −3 dB guitar / +4 dB bass, at most −10 dB). Average now −4.5 / +1 dB at 60–100 / 100–200 Hz. User also has a physical wah (goes before the cable; nothing in the chain to change, but the low-end fix helps it cut).
- **Open issue:** user reported the guitar shows levels but isn't heard from the speakers on 3.1. The fake-device path and engine params (Drop/Room) all pass; asked them which output the guitar card shows, whether songs play, and whether Shared / In-app engine works.

Ask: does the highway feel like Rocksmith now (camera height/angle, note size, speed)? Do tones and loudness compare better (try Room higher or lower)? How does the Drop sound and feel (delay)? Is the riff-repeater slowdown gone? Do clicks register now? Any lag left?

## What Stagehand is

Stagehand is a Windows desktop app (Electron 44.1.0) for Rocksmith 2014 `.psarc` song files. It has:

- a library, a player with a waveform, and safe metadata edits
- stem separation through Demucs (Python, GPU when available)
- in-game Rocksmith song lists (up to 20, renamable)
- **Discover**: MusicBrainz search, artist pages, collection gaps, a Wanted list, and a CustomsForge hand-off
  - The hand-off copies the search text and opens the browser. **Never automate CustomsForge**; their rules forbid bots.
- Downloads auto-import (watches the Downloads folder for `.psarc` only; zips only by manual pick or drag-drop)
- a **Tab view** (T key) with lyrics, play along, practice speed, string order and pages
- a **Your guitar** amp rig and tuner on the Rocksmith Real Tone Cable
- a full-screen **Note highway** (H key), styled after Rocksmith

The user plays guitar and bass, is good at Rocksmith, and is not a programmer. Write to them in plain words: what changed and what to do, with no code talk. They install updates by unzipping `Stagehand-Windows.zip` and running `Install Stagehand.bat`.


## Stagehand 3 (v3.0.0): what was built

Built in one session on top of 2.0.1. The design reference is the Design canvas https://claude.ai/artifact/F57qVGnjaDHnGo1UYxjckA (the user asked for more "magic", i.e. the stem lanes' gel colours and level-driven glow everywhere, then "ease up on the glow a little"; the shipped CSS follows the softer version). **Not yet seen or tested by the user on Windows.** Ask how it looks and plays.

Checks: `npm test` passes. UI: `PLAYWRIGHT=/opt/npm-tools/node_modules/playwright node test/e2e/ui3-chromium.js native/build/stagehand-audio-fake <outDir>` (the real page in Chromium, mock preload backed by the real Library/TabService/RigAudio/ToneStore/Stats/Takes, every song has fake stems) visits every page, records a loop, saves a song tone, plays a demo riff, makes format previews, and screenshots `v3-*.png`. Codecs: `node test/e2e/codec-chromium.js` (FLAC round trip exact; Opus aligned to the sample). Package: `scripts/package.sh <outDir>` (no native rebuild needed: nothing in `native/` changed). `native/build/stagehand-audio-fake` comes from `native/build.sh` (needs the toolchain notes below only for the .exe). The old `test/e2e/ui3-chromium.js` was removed (it drove the 2.x rig panel).

Main process:
- Single instance (`requestSingleInstanceLock`, second launch focuses the window).
- `services/tones.js`: ToneStore (`tones.json`: `{id, name, kind, gear, slot 1–9|null, from, ir, updatedAt}`, seeded from the presets on first run) and ToneIndex (every song's tones, cached by path+mtime in `Cache/tone-index.json`). IPC `tones:*`.
- `services/stats.js`: Stats (`stats.json` sessions; `summary(period)`, `best()`), Takes (`<roaming>/Takes/*.wav` + `takes.json`). IPC `stats:*`, `takes:*`, protocol `stagehand://take/<id>`.
- `song:setUser` accepts `mix` (`{you, song, stems:{name:{v,on}}}`).
- Stems: `meta.format` (`wav|flac|opus128|opus192|opus256`), files `<stem>.wav|.flac|.opus`; `stems:store`, `stems:finish` (switch format, delete the old files), `stems:formats`. Setting `stems.format` (default `wav`; the user wanted to compare before choosing).

Renderer (new files): `shell.js` (page classes on #app, bottom bar, guitar card, song gels/covers), `play.js`, `tuner.js`, `drums.js`, `looper.js`, `rigui.js` (rotary knobs, chain, tone demos), `render.js` + `workers/render-worker.js` (the WebAssembly amp engine over a buffer, for demos and takes), `practice.js` (part, scoring in every view, riff-repeater passes, practice logging), `nowpanel.js` (Now playing header bits, Mix/Riff/Tone panel, speed, Record take, tone following), `tonespage.js`, `progress.js`, `codec.js` (FLAC encoder, Ogg Opus via WebCodecs, decode back to the player's WAV layout), `stemformat.js` (compare dialog, Shrink my stems queue, auto-convert after separation), `guitarsettings.js` (Settings › Guitar & audio), `css/v3.css` (all new styles; loaded after app.css).

Changed: stage.js is now the Now playing page (header, panel hosts, footer transport + bar scrubber, per-song mix via `stemPref`/`saveMixSoon`, exports for the panel); tab.js lost its toolbar parts/speed/rig panel (the rig panel code is still there but never shown); highway's play-along chip is hidden and its guitar button mutes; `engine.setPlayAlong()` no longer mutes your part (the whole song always plays; Take my part out in the Mix panel); `engine.extraOut()` is the bus for drums, loops, demos, takes and format previews (it reaches the native engine like the song); rig: `autoStart()` (polls every 4 s while there's no cable), `setMuted`, `setLiveTone`, `registerTones`/`findTone`, `addInputTap` (dry guitar for recording), IR per tone, coalesced builds; `h()` sets CSS custom properties; CSP allows `'wasm-unsafe-eval'`; toasts sit bottom right; keys 1–9 = slots, Shift+1–6 = stem on/off, Esc leaves Now playing.

Known/uncertain:
- In the Chromium test, two tone builds hit the 8 s "sound engine didn't answer" timeout while a demo riff or loop was being rendered. Probably CPU contention in the sandbox; watch for it on the user's PC (the tone wouldn't change).
- Opus encoding needs WebCodecs `AudioEncoder` (Electron 44 has it). Stems are converted by the page, about 25 s per song for FLAC, a few seconds for Opus.
- Recorded takes and loops are your guitar only (dry input rendered through the tone you were on), not the song.
- The looper/record take timing compensates input delay roughly (`lateBy()` in looper.js); ask whether loops line up with the drums.

Ask the user: how the redesign looks and feels; whether the guitar starts by itself; which stem format they pick after comparing; whether loops line up; the earlier open questions below (highway, engine, song playing with the guitar on).

## Stagehand 3 plan (as approved; now built, see above)

The user approved this layout and asked for it to be built in a new session. **Mockup (5 clickable screens):** https://claude.ai/artifact/F57qVGnjaDHnGo1UYxjckA (Design canvas: Play, Songs, Now playing, Tones, Progress). Read it first with the Artifact tool (`read`, files under `project/`); it's the reference for placement and copy, but the shipped app keeps Stagehand's own CSS (`app.css` tokens, Archivo, tungsten #ffb547).

### The user's words, in short
- "Open the app and immediately play guitar, no song needed." No "Turn on" button: the guitar just works. Listening to a song alone also just works.
- "We want the whole mix to play while we play, our instrument louder; let the user edit the mix; mute a stem and remember it. Be smart about it."
- "So many things are in random places, too cluttered. Full polish pass, seamless integration."
- A **Tones** section: browse songs' tones, hear one, save it, rename it, edit it; **slots 1–9**.
- "Songs listed in a **list** by default, with an option for a nice **tile view** that looks like albums."
- "I really like the style of the stems and how it glows. **Keep that personality**": the GEL colours in stage.js (`GEL`: guitar orange #ff6b3d, bass violet #8c7bff, drums pink #ff4d8d, vocals cyan #33c8e0, keys green #9bdb5a, other grey) and the level-driven glow (`.gel::after` blurred, `--glow` set from the live level in stage.js ~548). Reuse that glow for live things: stem rows, input meter, tone slot of the playing tone, rig blocks when signal passes, record buttons.
- Answers to questions: **always fastest** (exclusive) mode; **Stagehand must be single instance**; mix remembered **per song only**; build **all four extras** (riff repeater + speed trainer, metronome/drum beat, looper/record yourself, practice stats) "laid out and implemented properly"; tone audition with **your guitar + a demo riff**.

### Layout (from the mockup)
- **Title bar:** brand, one search (songs, tones, artists; in Discover it searches MusicBrainz as now), Settings, Nw logo button.
- **Left menu:** Play (home, opens here) · Songs (with sub-items: All songs, Favorites, Recently added, Recently played, Stems ready; Setlists; In Rocksmith › song lists) · Tones · Progress · Discover (existing pages: Search, Collection gaps, Wanted, Imports move under it). Bottom of the menu: guitar status card (green dot "Guitar ready", input → output, delay in ms, live input meter with glow).
- **Bottom bar everywhere:** now-playing mini player (art, title, part, play/pause, progress, "Open song"). Replaces the old resizable stage panel.
- **Play:** current tone name and where it came from; "Set input level" (calibration) and "Edit this tone"; **slots 1–9** row (number badge, name, kind; empty slots dashed "+ Save here"); **rig chain** (Pedal → Amp → Cabinet → Rack blocks; click one to show its knobs as rotary knobs); Input / Effects / Volume sliders; right column: **Tuner** (as today), **Drums & metronome** (BPM ±, Tap, patterns Click/Rock/Shuffle/Metal/Half-time, Start/Stop), **Looper** (Record, Overdub, Clear; locks to the drum tempo).
- **Songs:** filter chips (Lead, Rhythm, Bass, Stems ready, tuning), **List | Tiles** switch (List default, choice remembered). List columns: Title, Artist, Tuning, Your best (bar + %), Stems, Length (keep existing columns/sorting where they exist). Tiles: square album art (real art via `stagehand.artUrl`), part badges L/R/B, best % badge, play button, title, artist · tuning. Right panel (inspector): art, title, artist, **Play along** / **Just listen**, parts with best %, **Tones in this song** (▶ demo, Save, "In slot N"), Split stems, Edit details, ⋯ (existing actions: rename files, backups, Rocksmith lists, etc.).
- **Now playing (song practice, full screen):** header (← Songs, title, tuning, current tone; part chips; Tab | Highway | Waveform; guitar status). Section strip (click to jump, double-click to loop). Score line (accuracy, streak, notes). Right panel tabs: **Mix** (You and Song levels, every stem slider + on/off, your part tagged, "Remember this mix for <song>" on by default), **Riff repeater** (section, speed trainer 60% → +5% after a clean pass ≥90% → 100%, pass history, count-in), **Tone** (follow the song's tone changes, the song's tones with Save, or pick a slot). Bottom: transport, speed chips, **Record take**. The full-screen highway (H) stays.
- **Tones:** tabs **My tones** (saved; slot number shown) / **From my songs** (every tone in the library, grouped by song) / **Presets**; each row has ▶ demo riff. Editor: name (rename), slot select, ▶ Demo riff, Save tone (saving a song tone makes a copy); chain blocks with **+ Add** and Swap for… / Bypass; knob sliders for the selected block; Cabinet card (cab, mic: dynamic/condenser/ribbon/tube, position: cone/edge/off axis, "Use my own cab file (IR)…"). Edits are live on the guitar.
- **Progress:** This week / month / all time; tiles: time playing, day streak, songs practised, average accuracy; minutes per day bars; songs you're working on (accuracy trend sparkline + best); your takes (recordings, playable).
- **Settings:** add **Guitar & audio** (input, output, buffer, calibration, in-app fallback toggle) and drop those from the old rig panel. Keep Library, Playback, Stems, Rocksmith, Saving and backups, Storage, About.

### Behaviour to build
1. **Single instance:** `app.requestSingleInstanceLock()` in main.js; a second launch focuses the existing window.
2. **Guitar always on:** start the rig at launch (exclusive, the rig's fallbacks stay: shared then in-app with a notice). Restart automatically when the cable is plugged in later (poll `devices` every few seconds while not running, or have the helper report device changes via IMMNotificationClient). If no cable: status card says "Plug in your Rocksmith cable". Remove the Turn on/off buttons; keep a mute toggle on the status card. Remember: other PC sounds are silent while Stagehand runs (user accepted).
3. **Mix while playing (per song, remembered):** the full mix (or all stems) always plays; "You" (rig volume) and "Song" (master) levels; with stems, every stem slider + on/off, your part's stem defaults to its normal level (the user turns it down/off if they want); remember per song id (store alongside song user data via `songs.setUser`, e.g. `user.mix = {you, song, stems:{name:{v,on}}}`). Replace today's "Play along mutes your stem" with this; keep a one-click "Take my part out" shortcut.
4. **Tones:** storage in settings or a `tones.json` in the roaming dir: `{id, name, kind, gear:[…] (same shape as song tones), slot|null, from:{songId, toneKey}|null, updatedAt}`. Slots 1–9 map to keys **1–9** globally (today digits 1–6 toggle stem mutes in main.js: move stem mutes to Shift+digit or the Mix panel). "From my songs" needs every song's tones: add a main-process index (read each song's manifests' `Tones` once, cache by path+mtime, like TabService) behind an IPC like `tones:library`. Edit = change `gear` and rebuild the slot (`rig._useTone`). Swap/Add lists come from `data/gear2014.json` (types amp/pedal/rack/cab, bass flag). **Demo riff:** a short DI guitar/bass recording run through the tone. The engine has no file input yet: add a `demo` command to the helper (and the wasm worklet) that feeds a buffer into the engine input instead of the cable for a few seconds; synthesise the riff (Karplus-Strong chords + single notes, as `native/test/dsp_bench.c` does) or ship a short licence-free DI clip.
5. **Metronome / drum beat:** synthesise in the page's player AudioContext (it's routed to the native engine already) or in the helper. Patterns: click, rock, shuffle, metal, half-time; BPM 40–240; tap tempo.
6. **Looper / record take:** record the rig output (helper: tap after the engine into a ring, page writes WAV to the roaming dir) and play back through the song path; overdub; loop length locked to drum tempo when drums run. Takes appear in Progress.
7. **Riff repeater + speed trainer:** uses existing section loops (`engine.setLoop`), practice speed (`engine.setSpeed`), and the Judge's accuracy per pass from detect.js; step speed +5% on ≥90%.
8. **Practice stats:** log sessions (song id, part, seconds, accuracy, date) to a `stats.json` in the roaming dir via a small main-process service; Progress page and the Songs "Your best" column read it.
9. **Tile view:** CSS grid of album tiles in library.js, virtualised like the list if the list is.

### Order that keeps the app working
Single instance → always-on guitar + status card → new shell (left menu, bottom bar, Play page with current rig/tuner) → Songs list/tiles + inspector → Now playing page (move tab/highway/waveform and the Mix panel there) → Tones section + slots → riff repeater → metronome → stats → looper. Bump to 3.0.0. Ship screenshots of each screen (`test/e2e/ui3-chromium.js` boots the real page in Chromium with a mock preload; extend it for the new screens if there's still no Electron).

## Layout

```
src/main/          Electron main process (CommonJS)
  main.js          window, IPC (handle() wraps results as {__sh, ok, value|error, code}), stagehand:// protocol, win:fullscreen
  preload.js       sandboxed bridge: window.stagehand.{library, tab, discover, imports, app.fullscreen, ...}
  core/            psarc.js, rocksmith.js, sng.js (SNG decrypt+parse → tab), xmlarr.js, tones.js (Rocksmith tone → preset)
  services/        captures.js (real amps, TONE3000 sign-in/downloads, 3.2), library, stems (Demucs), tabs (TabService.list/load, LRU 12), discover, musicbrainz, importer, rsprofiles, ...
src/renderer/      plain ES modules, no bundler
  js/api.js        unwraps IPC envelopes
  js/stage.js      player; owns `engine` (AudioEngine); Waveform / Tab / Highway buttons; exports openHighway()
  js/tab.js        Tab view (canvas), rig panel, tuner UI
  js/highway.js    Note highway (canvas 2D, see below)
  js/captures.js   real amps: which NAM capture plays for a tone (resolveCapture), state from main
  js/realamps.js   real amps UI: amp strip, REAL badges, Settings › Real amps
  data/capturemap.json  Rocksmith amp → TONE3000 capture packs (variants by gain)
  js/rig.js        the rig: NativeBackend (stagehand-audio.exe over MessagePorts) or WebBackend (WebAssembly in an AudioWorklet); presets as Rocksmith gear chains; slot cache (8 tones, LRU); calibrate(); tuner pitch, samples(), latencyMs
  js/gearspec.js   Rocksmith gear → engine spec text; data/gear2014.json (from the Song Creator Toolkit's pedals2014.json: 613 items with knob keys, ranges, defaults)
  worklets/rig-dsp-worklet.js + rig-dsp.wasm   in-app engine; worklets/song-tap-worklet.js sends the player's mix to the native engine
  js/detect.js     note detection and scoring: Analyzer, OnsetTracker, Judge, targetsFromTab
  js/pitch.js      YIN pitch detector for the tuner (about 0.1 cent accurate)
  js/audio-engine.js + worklets/player-worklet.js   multitrack player, WSOLA time-stretch, setSpeed, setPlayAlong(stemName)
  css/app.css      all styles; theme tokens in :root (tungsten #ffb547 accent, Archivo font)
engine/stagehand_stems.py   Demucs runner
native/dsp/sh_nam.c         NAM capture inference (LSTM, WaveNet A1/A2) + the real-amp block + resampler (3.2)
native/dsp/                 the amp engine in C (no libc): sh_amp.c (amp families, Yeh TMB tone stack, 4x oversampling), sh_cab.c (cab IRs synthesised from speaker+mic+position, min-phase), sh_fx.c (pedals/racks), sh_rev.c (FDN reverbs), sh_engine.c (8 slots, crossfade, loudness matching by rendering a test strum at build)
native/host/                stagehand-audio: host.c (framed stdin/stdout protocol, rings, guitar drift resampler, song "slipper" = pitch-exact splice drift correction), io_wasapi.c (exclusive / IAudioClient3 shared, Pro Audio threads), io_fake.c (tests)
native/build.sh             builds native/bin/stagehand-audio.exe (shipped), src/renderer/worklets/rig-dsp.wasm, native/build/{stagehand-audio-fake,dsp_bench}
native/toolchain/build-mingw.sh   builds the Windows cross toolchain from git (mingw-w64 + compiler-rt builtins) for clang 18 + lld; see below
src/main/services/rigaudio.js     spawns the helper, relays MessagePorts (control: commands/events/input audio; song: player mix)
windows/install.ps1         installer; updates reuse the installed Electron (electron-version.txt marker); the runtime zip is cached in %LOCALAPPDATA%\Stagehand\runtime
test/                       unit tests + test/e2e/*.js (Playwright driving Electron under xvfb)
```

## Note highway (src/renderer/js/highway.js)

The user asked for a highway that copies Rocksmith "with a fresh coat of paint". They sent 8 Rocksmith screenshots, and v1.8.0 was rebuilt to match them.

**Neck and highway**

- The guitar neck runs across the bottom, with real fret spacing: `NX(f) = 1 - 2^(-f/12)`.
- It has inlays and coloured strings, with **low E on top** (an option flips it).
- The highway floor runs from the neck toward a vanishing point at the top. Perspective is `P(z) = 1/(1+K·z)`, with `z = (tNote - t)/lookahead`.

**Hand position**

- Lit lanes on the floor with cyan rails.
- Two white bars on the neck.
- Gold fret numbers under the neck.
- When a new position comes up, its fret numbers are written on the floor at its front edge.

**Notes**

- Gems are coloured by string, with a **large white outlined fret number** (the user asked for readable numbers). Each has a stem down to the floor and a mark in its lane.
- Open strings are a bar across the hand position, with a "0".
- Chords are upright cyan boxes standing on the floor, with a name. A repeated chord is the box only.
- The next chord's name shows large on the left.
- Finger numbers appear on the neck as a chord arrives.
- Each note's spot on the neck shows a target outline as the note arrives.

**Motion**

- A smoothed clock: it runs on the frame timer and leans gently toward `engine.position`.
- The camera is a critically damped spring (ω≈3.4) over the hand positions from now to +1.4 s, so it never snaps.
- Notes appear 4 s ahead by default; 3–6 s is selectable.

**Controls and scoring**

- HUD: Back/Esc (leaves full screen), part chips, play along, Your guitar, an options menu, a section strip (click to jump, double-click to loop), and practice speed.
- When the rig is on, scoring runs through `detect.js` (Judge): hit bursts, and missed notes turn grey.
- Prefs are saved in localStorage `stagehand.highway`.
- `root.__hw` exposes internal state for tests.
- **Mix** panel (`.hw-mix` inside `.hw-dock`, docked on the right, collapses to a tab; open state in prefs.mixOpen): per-stem on/off switch, volume slider, solo; Split stems if none. **Tone** chip (shown when the rig is on): Song tone or any preset; choices share `songToneChoice` exported from tab.js. Tab view's stem chips also have volume sliders. All tones are offered for every part (user asked: "we want all tones available with bass or lead").

**Not yet verified with the user:** they haven't seen v1.8.0. Ask how it looks and feels, especially perspective depth (`G.K`, `G.yV`, `G.yS` in `geometry()`), gem size, and note speed.

## Splash

v1.9.1 removed the launch splash (user asked). Only the logo button `#btn-nw` plays it in-app; `splash-preload.js` and `test/e2e/splash.js` are gone.

## Guitar engine (v2.0.0)

The user asked for the engine redesign and better tones in one update. Answers they gave: they listen mostly through **speakers** (sometimes headphones) on the PC, use **ASIO4ALL** with Rocksmith, **Rocksmith feels good to play** (that's the latency target), and **taking over the output is fine**.

- **Native path:** rig.start() first moves the player onto the native route (AudioContext sink `{type:'none'}` + song-tap worklet → MessagePort → main → helper stdin), because Windows refuses exclusive access while any shared stream is open on the device. Then `start` (exclusive, falling back to shared with a notice). The helper mixes the song with the amp. `engine.extraLatency` = helper's songLatencyMs so `engine.position` stays in sync.
- **Song clock drift:** Chromium's `none` sink clock runs about 0.27% slow (measured). Resampling to follow it would bend pitch, so the song goes through a splicer (WSOLA-style skip/repeat of 4–30 ms at the best-matching point, 6 ms crossfade) and only a fixed-ratio resample. `native/test/slip_test.c` checks ±2% drift keeps 440.00 Hz.
- **Guitar path:** capture ring → small drift resampler (max ±0.1%) → engine → output. Target fill = in period + part of the out period + 24 frames.
- **Song route (2.0.1):** the user reported the song didn't play with the guitar on (2.0.0). Likely cause: the tap worklet *transferred* its ArrayBuffers to a port entangled with Electron's main process, which drops them. Now audio is copied, and if the helper's meters show no song for 1.5 s while playing, `engine.useSongRelay()` sends it through the page instead (remembered in localStorage `stagehand.songRelay`). `SH_DROP_DIRECT=1` / `SH_RELAY=1` exercise these in rig-chromium.js. Ask whether the song plays now and whether there was a ~1.5 s silent start the first time (= relay kicked in).
- **Fallbacks:** engine choice in the rig panel: Fastest (exclusive) / Shared / In-app (WebAssembly). Auto falls back native-shared → in-app with `rig.notice`.
- **Tones:** song tones carry their full GearList (`tones.js` mapTone → `gear`), built per song into engine slots ahead of time (`rig.prepareTones`). Presets are gear chains too (rig.js TONES). User knobs: gain absolute (−1 = tone's own), bass/mid/treble/fx offsets around 0.5.
- **Calibration:** "Set level" in the rig panel (4 s strum → input knob so peaks hit −6 dBFS).
- **NOT verified on real Windows.** The exe is cross-compiled; WASAPI code compiles but has never run. Ask the user how it went: does it start, what delay does the panel show, any crackles (try Buffer: Safe), does the song sound right, how do tones sound (Cyanide). If it fails, the panel shows the error and falls back to the in-app engine. Logs: helper events go to the app log (`Audio: exclusive … @ 48000 Hz, in N / out N frames`).
- **Tone tuning knobs** (if the user says amps are too dirty/clean or too dark): amp family gain ranges `lo_db/hi_db` in `prof_for()` (sh_amp.c), cab voicings in `speaker_for()` (sh_cab.c), loudness target in `sh_engine_build` (0.11 rms guitar).
- Possible next: custom cabinet IR files (helper `ir` command and `sh_engine_set_ir` exist; no UI yet), ASIO backend (user has ASIO4ALL; WASAPI exclusive should match it).

## Open requests (in the user's priority order)

0. **Stagehand 3 feedback.** Built (3.0.0); get the user's reactions and fix what they find. Stem format choice (compare tool in Settings › Stems).
1. **Highway feedback.** Iterate on the v1.8.0 look from the user's comments.
2. **Guitar engine feedback.** The guitar plays on the user's PC (2.0.0). 2.0.1 fixed the song not playing with the guitar on; not yet confirmed. Still ask about delay, crackles and tone accuracy (Cyanide).
3. **Detection accuracy** (`detect.js`).
   - Last synthetic results: correct notes about 94%, chords 83–100%, mutes 100%, wrong notes 0–6%, bass correct about 93–95%.
   - `test/detect.test.mjs` is not in `npm test` because some assertions are flaky.
   - Don't tune detection unless the user asks.

## Testing

- **Unit tests:** `npm test` (core, gpu, rsprofile, rsmods, discover, tab, plus a Python engine check). All pass at 1.8.0.
- **End-to-end tests** need a Linux Electron 44.1.0 binary, `vgmstream-cli`, Playwright (global) and xvfb:
  ```
  NODE_PATH=<global node_modules> xvfb-run -a -s "-screen 0 1920x1080x24" node test/e2e/highway.js <electron> <vgmstream-cli> $PWD/test/e2e/fake-engine/python <outDir>
  ```
  - `tab.js` and `run.js` take the same arguments.
  - `decoder.js` takes `<electron> <outDir>`.
  - `tab.js` feeds a fake microphone WAV (a flat A string) and checks that the tuner reads 7.0 cents flat.
- **Fixtures:** `test/fixtures/*.psarc`. The "The Test" song (integration_p) has Lead and Bass parts with notes from about 10.5 s.
- **Install test:** run `windows/install.ps1 -Destination <dir> -ElectronZip <electron-win.zip> -NoShortcuts -NoLaunch` with pwsh, then launch `<dir>/resources/app` with Electron.
- **Tools in the old sandbox** were at `/tmp/electron`, `/tmp/vgml/vgmstream-cli`, `/tmp/pwsh/pwsh` and `/tmp/electron-dl/electron-win.zip`. A new sandbox has to obtain these again. In the 2026-10-24 sandbox npm, PyPI, crates and GitHub release downloads were all blocked (only `git clone` from GitHub worked), so there was no Electron: UI was checked with `test/e2e/ui3-chromium.js` (the real page in Playwright's Chromium with a mock preload backed by the real Library/TabService/RigAudio) and the rig with `test/e2e/rig-chromium.js`. Both take `<native/build/stagehand-audio-fake> <outDir>` and need `PLAYWRIGHT=<global playwright>`.
- **Windows build without downloads:** clang 18, lld, llvm-dlltool/ar were preinstalled. `git clone --depth 1 https://github.com/mingw-w64/mingw-w64` and a sparse clone of llvm-project (`compiler-rt/lib/builtins`, release/18.x) into `/home/claude/tc`, then `native/toolchain/build-mingw.sh` (≈5 min), then copy `/usr/lib/llvm-18/lib/clang/18/include` to `/home/claude/tc/res/include` and the builtins lib to `/home/claude/tc/res/lib/windows/libclang_rt.builtins-x86_64.a`. `native/build.sh` uses `SH_TOOLCHAIN` (default `/home/claude/tc`).

## Packaging

- `Stagehand-Windows.zip` contains `Stagehand-Windows/` with:
  - `app/{src,engine,build,package.json}`
  - `install.ps1`, `uninstall.ps1`, `Install Stagehand.bat`, `Uninstall Stagehand.bat` (from `windows/`)
  - `README.md`
- `app/` also gets `native/bin/stagehand-audio.exe` (install.ps1 copies `native` and stops a stray `stagehand-audio` process before updating).
- Strip `__pycache__`.
- Bump `package.json` version on every release, and keep README sections current: Note highway, Tab view, Your guitar, Discover, Keyboard.

## Conventions

- **Visual first (the user's standing rule for everything we make):** "why read when you can see immediately?" Convey state with colour, icons, glow, motion and position before words; keep text short and secondary. Example: a volume at 0 shows as a red, pulsing, crossed-out speaker, not a paragraph.
- **Key controls always in reach:** song volume is in the bottom bar, your guitar's volume on the guitar card (bottom left); a short toast with "Turn it up" appears if you press play with either at 0 (the user lost time hunting for a 0 volume).

- **UI copy:** plain and friendly, typographic apostrophes (’), no jargon.
- **CSS class names:** check for collisions before adding.
- **Menus and toasts:** z-index 300 so they show above the highway (z 200).
- **Renderer:** no frameworks, `h()` / `icon()` / `showMenu()` / `toast()` from `ui.js`.
- **Before shipping:** verify UI changes with an e2e run and screenshots.
