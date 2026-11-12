# Sing along: handoff to build it

Paste this into a new session (attach nothing; link the PC if you can). Read `HANDOFF.md` and `CLAUDE.md` first,
start from the latest `main`, and check `package.json`'s version against GitHub before writing anything.

## What the user asked for (2026-11-12)

"Include vocals for you the player to sing as well, or maybe a second player can sing. It could track based off of
the audio and have different difficulties like easy, medium or hard. Would this be able to capture audio from a
second microphone?" Then: "We wanna do it really smart and efficient, hopefully it doesn't take four sessions."

Standing rules that apply: visual first (see it, don't read it); the note highway's neck, notes, timing and scoring
are off limits; anything with more than one look gets a setting; plain words in the app.

## The plan: one session to build it, one short one to tune it after the user has sung

The whole feature fits in one session because almost every part already exists. Build in this order and stop
after each numbered step with something that works.

### 1. The targets: what to sing, when, at what pitch (`src/main/services/tabs.js`, `src/main/core/sng.js`)

- `sng.js` already reads each syllable's `time`, `length`, `lyric` and **`note`** (a MIDI pitch). `tabs.js _lyrics`
  drops the note: keep it (`{ t, d, w, p }`). Treat 0, 254, 255 and anything outside 36–96 as "no pitch".
- Decide per song, once, and cache with the tab:
  - **charted**: at least 60 % of syllables have a real pitch → use them (official songs);
  - **from the recording**: otherwise, if the song has stems, read the pitch off the **vocals stem** (below);
  - **rhythm only**: neither → score on singing at the right time (any voice counts). Say which mode it is.
- Pitch from the vocals stem (`src/renderer/workers/`, a new worker beside `peaks-worker`): decode the stem (the
  stems are already loaded for the mixer: reuse those samples, don't read the file twice), run `detectPitch`
  (`src/renderer/js/pitch.js`, YIN) in 46 ms frames every 20 ms with `minHz 70, maxHz 1100`, then for each
  syllable take the **median pitch of its voiced frames** (ignore the first 30 ms), and drop syllables where
  fewer than 40 % of frames were voiced. Cache the result next to the stems (`<stems folder>/vocals-pitch.json`,
  keyed by the stem's size and time) so it's done once per song. About a second or two per song.
- Test with a made-up stem (sine glides and steps with gaps): the recovered pitches must be within 30 cents.

### 2. The microphone (`src/renderer/js/` new `mic.js`; Settings › Guitar & audio)

- **Do this the simple way: the page listens** with `navigator.mediaDevices.getUserMedia({ audio: { deviceId,
  echoCancellation: false, noiseSuppression: false, autoGainControl: false } })`. `rig.js` (around line 310)
  already does this for the in-app engine: copy its pattern. No change to the sound engine, no rebuild.
- A **Microphone** picker under Settings › Guitar & audio (list `enumerateDevices()` audio inputs, leave out the
  Rocksmith cable by name, remember the choice; "None" = singing off). A small live level meter beside it.
- Pitch: an `AnalyserNode` (2048 samples) read ~50 times a second into `detectPitch` + `PitchSmoother`. Keep it
  off while not singing (no mic light on for nothing).
- **Check first on the user's PC** (it can't be checked on Linux): does the mic open while Stagehand holds the
  speakers in its fastest mode? It should (an input is a different device), but confirm before building on it. If
  it doesn't, the fallback is a second capture stream in `native/host/io_wasapi.c` (see "Later").
- The voice is **not** played through Stagehand in this version (scoring only). Say so in the setting.
- The mic also hears the song from the speakers. Offer **Take the singer out** (mute the vocals stem: the mixer
  already has per-stem switches, `stage.js`) when singing starts, and suggest headphones once, in one line.

### 3. Scoring (`src/renderer/js/` new `sing.js`, pure functions + a small state machine)

- Compare **folded to the octave** (people sing in their own octave): error = distance in cents to the nearest
  octave of the target.
- Per syllable: the share of its frames where a voice was heard within the tolerance. A syllable counts when that
  share reaches the bar. Timing slack ±150 ms on all levels.
  - **Easy**: within 250 cents, bar 40 %. **Medium**: 120 cents, 55 %. **Hard**: 60 cents, 70 %.
  - Rhythm-only songs and syllables without a pitch: any voice heard for 40 % of the syllable.
- Score per line and for the song; streak of lines; the result goes to the stats as part `vocals`
  (`practice.js` logs sessions; `levels.js` gives XP per part: add vocals like a guitar part, own bests).
- Unit tests (`test/sing.test.mjs`, in `npm test`): a perfect singer, an octave down, 80 cents sharp (passes Easy
  and Medium, fails Hard), late by 200 ms, silence, talking on a pitched line.

### 4. What you see (`src/renderer/js/` new `singlane.js`, `css/`)

- A **lane of its own**: a strip (about 110 px) with the words and, above them, a bar for each syllable placed by
  pitch (higher = higher), scrolling right to left with a fixed "now" line; a glowing dot shows your voice, the
  bar fills in the string-cyan vocal colour (`GEL.vocals`) as you hold it, gold when the line is perfect.
- On the highway it docks **at the top, where the lyrics are now** (`.hw-lyrics`, `buildLyrics`/`updateLyrics`
  in `highway.js`): it is a DOM/canvas overlay, nothing is added to the 3D scene. On Now playing it sits above
  the tab. Two looks, picked in Settings › Appearance › Pick your look: **Bars** (karaoke bars) and **Words**
  (today's lyrics with the dot and colour only).
- Turning it on: a **Sing** chip beside the part chips (Lead / Rhythm / Bass) that works alongside them: you can
  play and sing, or a second person sings. Difficulty (Easy / Medium / Hard) in the chip's menu.
- The end-of-song score card gets a vocals line when singing was on.

### 5. Tests and release

- `npm test` with the new unit tests; an e2e audit (`SH_AUDIT=test/e2e/sing-audit.js … ui3-chromium.js`): Chromium
  can be given a pretend microphone (`--use-fake-device-for-media-stream
  --use-file-for-fake-audio-capture=<wav>`): make a WAV that "sings" the test song's line and check the lane fills
  and the score comes out right; screenshots of both looks.
- Bump the version, HANDOFF, README line, PR, merge, run the Release workflow.

## Ask the user at the start (the answers decide details, not the plan)

1. Which microphone will they use (USB mic, headset, webcam)?
2. Speakers or headphones while singing?
3. Should the singer's voice come out of Stagehand, or is hearing themselves in the room enough?
4. One singer, or duets later?

## Later (only if asked)

- The voice through the sound engine (monitoring with reverb, and in recorded clips): a second capture stream in
  `io_wasapi.c` on its own clock, mixed in `host.c` like the song; needs a rebuild and real-hardware testing.
- Duets / harmony lines; pitch correction display ("you're flat" arrow); a vocal warm-up in Jam.

## Why this is quick

Words and timing: already read. Pitch detection: `pitch.js`. Stems: already split and loaded. Mixer switch for the
singer: exists. Stats, XP, score card: exist. The only new things are the lane, the scoring rules and a mic picker.
