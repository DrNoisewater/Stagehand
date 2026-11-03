<div align="center">

# Stagehand

**Play along with your Rocksmith 2014 songs, on your PC, with your own guitar or bass.**

A note highway, tab and live amp tones through the Rocksmith cable. Split any song into stems, track your progress, and keep your whole `.psarc` library organised.

[![Latest release](https://img.shields.io/github/v/release/DrNoisewater/stagehand?label=download&color=ff6b3d)](https://github.com/DrNoisewater/stagehand/releases/latest)
[![CI](https://github.com/DrNoisewater/stagehand/actions/workflows/ci.yml/badge.svg)](https://github.com/DrNoisewater/stagehand/actions/workflows/ci.yml)
![Windows 10/11](https://img.shields.io/badge/Windows-10%20%7C%2011-8c7bff)

[Install](#install) · [Features](#features) · [Keyboard](#keyboard) · [What's new](#whats-new) · [Development](#development)

</div>

---

## Install

1. Download **`Stagehand-v<version>-win-x64.zip`** from the [latest release](https://github.com/DrNoisewater/stagehand/releases/latest).
2. Unzip it.
3. Double-click **Install Stagehand.bat**.

No admin rights needed. The first install downloads the app runtime (about 150 MB). Stagehand then opens, with shortcuts in the Start menu and on your desktop.

> [!NOTE]
> Windows may say *"Windows protected your PC"* because the installer isn't signed. Click **More info → Run anyway**.

**First launch.** Add your Rocksmith `dlc` folder. Stagehand offers it by itself if it finds your Steam install. Your songs stay where they are; nothing is copied.

**Updating.** Download the newer zip and run **Install Stagehand.bat** again. Only the app files are swapped. Your library, settings, stems, tones and stem splitter stay.

**Removing.** Use **Settings → Apps → Stagehand**, or **Uninstall Stagehand** in the Start menu. Your library data is kept unless you choose to delete it, and your `.psarc` files are never touched.

---

## Features

### 🎸 Play

Plug in the Rocksmith cable and your guitar is live straight away, no song needed.

- **Tones on keys 1–9.** **1** always follows the song's own tone (and its tone changes); **2–9** are your saved tones. Press a number anywhere to switch. The rig shows as a chain of pedals, amp, cabinet and rack. Click any piece to turn its knobs.
- **Guitar or bass, automatically (3.9.1).** Stagehand hears which one is plugged in. If your tone is for the other instrument, it plays one that suits what you're holding, and your own tone comes back when you switch back. A bass part played on guitar is scored an octave up.
- **Tuner, Drop and calibration.** A precise tuner, plus **Set input level**. The **Drop** works like a DigiTech Drop: lower your instrument 1–7 semitones or an octave, or match the song, so you can play E♭/D/C♯ songs without retuning. Press **D** anywhere.
- **Moving backgrounds** behind the highway or full screen in Jam: **Fluid**, **Nebula**, **Swarm**, **Mandala** and **Strings**. They move with the song's bass, beats and highs, flash with the notes on the highway in their string colours, and follow what you play.
- **Jam is home.** Rig, tuner, Drop, drums and looper on one screen. **Play over song** lets you improvise with a song's stems, your own part muted. **Open visualizer** (**J**) goes full screen with Fluid.
- **Drums** with 17 styles (Rock, Shuffle, Metal, Funk, Reggae, Jazz ride, Bossa, Drum & bass and more, 40–240 BPM, Tap; hold **+**/**−** to change tempo fast) and a **Looper** that records exactly what you hear and locks to the bar.

### 🎵 Play along

Double-click a song, or press **Play along**.

- **Note highway.** A 3D Rocksmith-style highway, measured off real gameplay and drawn by your graphics card at full frame rate. It has a camera that follows your hand positions, a look for each technique (bends, slides, vibrato, tremolo), lyrics, chord names, and venues to play in.
- **Tab and Waveform views** of the same song (**T** switches).
- **Scoring** as you play, with streaks, early/late feedback and a **score card** at the end: each section, what went best, and what to work on.
- **Riff repeater** with a speed trainer that starts at 60% and adds 5% after each clean pass.
- **Mix panel:** your level, the song, and every stem with a slider. **Take my part out** removes your part from the song.
- **Tone** follows the song's own tone changes, or pick any tone.
- **Score attack:** a full-speed run with a ×4 multiplier and your ten best runs per song. **Record clip** saves a video (MP4) of the highway with the song and your guitar. **U** opens a small tuner without stopping the song.

### 🔊 Tones and real amps

- **My tones, From my songs, Presets.** ▶ plays a demo riff through any tone. Rename tones, give them slots, edit the chain, pick the cab, mic and mic position, or load your own cab IR.
- **Real cabinets.** **Download amp + cab** pairs each real amp with a recorded cabinet: four guitar cabinets come with Stagehand, five bass cabinets download the first time you need them.
- **Real amps.** Tones can play through **captures of the real amps** ([Neural Amp Modeler](https://github.com/sdatkinson/NeuralAmpModelerCore)) instead of the modelled ones. 57 of Rocksmith's 60 amps are matched to a real one, many at several gain settings. Press **Get the real amp** on any amp, or **Get all**. They come from [TONE3000](https://www.tone3000.com) after a one-time setup in **Settings › Real amps**.
- **Presets on real amps:** Clean (Fender Deluxe), Chime (Vox AC30), Crunch (Marshall Plexi), Overdrive (JCM800), Lead (Peavey 5150), Metal (Mesa Rectifier), Fuzz (Orange), Bass clean (Ampeg SVT) and Bass grit (Orange AD200).

### 🥁 Stems

- **One click splits a song** into guitar, bass, drums, vocals, keys and other with [Demucs](https://github.com/facebookresearch/demucs), running on your PC.
- Each stem gets its own lane and waveform, with volume, mute and solo. All stems play in perfect sync, and your mix is remembered per song.
- **Store them your way:** lossless FLAC (about half the size of WAV) or Opus (about a sixth to a tenth). **Compare formats…** lets you hear the difference, and **Shrink my stems** converts the ones you already have.

### 📚 Library

- Every song with its title, artist, album, year, tuning, parts and length. Search, sort, filter by part, and switch between list and album tiles.
- **Your best** score on every song, plus favourites, ratings, play history and **setlists**. **Bring over Rocksmith lists** copies your old in-game lists in one click.
- **Find duplicate songs** keeps the best copy and moves the rest to backups, with Undo.
- **Edit details** and **Rename files** safely. See *How saving works* under [Good to know](#good-to-know).

### 🔎 Discover

- Search any artist or song on [MusicBrainz](https://musicbrainz.org) and see which album tracks you're missing.
- **Collection gaps** ranks your artists by how much you're missing. Keep a **Wanted** list.
- **Watch for downloads** checks every finished `.psarc` download and moves it into Rocksmith's `dlc` folder.

> [!NOTE]
> CustomsForge's rules don't allow apps to search or download from Ignition, so Stagehand never does. **Find** copies the search and opens the site in your browser, and Stagehand picks the file up once you've downloaded it.

### 📈 Progress

Time played, day streak, accuracy over time, the songs you're working on, highlights (what got better, your strongest and weakest techniques), and **your takes** to listen back to.

---

## Keyboard

| Key | Action |
| --- | --- |
| <kbd>Space</kbd> | Play / pause |
| <kbd>←</kbd> <kbd>→</kbd> | Back / forward 5 s (<kbd>Shift</kbd>: 15 s) |
| <kbd>Enter</kbd> | Open the selected song |
| <kbd>1</kbd> | Follow the song's tone |
| <kbd>2</kbd>–<kbd>9</kbd> | Switch to the tone in that slot |
| <kbd>U</kbd> | Small tuner on the highway |
| <kbd>Shift</kbd>+<kbd>1</kbd>–<kbd>6</kbd> | Turn a stem off or on (<kbd>Shift</kbd>+<kbd>Alt</kbd>: solo) |
| <kbd>H</kbd> | Note highway (<kbd>Esc</kbd> to go back) |
| <kbd>T</kbd> | Tab view / waveform view |
| <kbd>J</kbd> | Jam |
| <kbd>D</kbd> | Drop on / off |
| <kbd>L</kbd> | Loop the current section (<kbd>Esc</kbd> clears it) |
| <kbd>M</kbd> | Original mix / stems |
| <kbd>+</kbd> <kbd>−</kbd> <kbd>0</kbd> | Zoom in / out / whole song |
| <kbd>F2</kbd> or <kbd>Ctrl</kbd>+<kbd>E</kbd> | Edit details |
| <kbd>Ctrl</kbd>+<kbd>F</kbd> | Search (MusicBrainz while in Discover) |
| <kbd>Ctrl</kbd>+<kbd>,</kbd> | Settings |
| <kbd>Esc</kbd> | Leave Now playing |
| Mouse back / <kbd>Alt</kbd>+<kbd>←</kbd> | Back to the previous screen |

---

## Good to know

<details>
<summary><b>Stem splitting: setup and GPU</b></summary>

<br>

The first time you split a song, Stagehand offers a one-click setup. It downloads [uv](https://github.com/astral-sh/uv), a private Python 3.12, PyTorch and Demucs into `%LOCALAPPDATA%\Stagehand\Engine`. It never touches any Python you already have.

| Your PC | Download | Time per song |
| --- | --- | --- |
| NVIDIA GPU, GTX 10 series or newer | about 3 GB | well under a minute |
| AMD, Intel or no graphics card | about 1 GB | a few minutes |

**Is my GPU being used?** **Settings → Stems** shows where splitting runs. If you have an NVIDIA card but it says CPU, Stagehand explains why and offers the fix (**Switch to GPU**, or **Get NVIDIA driver**). If the GPU fails partway through, that song finishes on the CPU.

**Running cooler.** Splitting runs at low priority. **Settings → Stems → CPU load** limits it to half or a quarter of your cores.

Stems are cached by the song's audio, so editing or renaming a file keeps them.

</details>

<details>
<summary><b>How saving works</b></summary>

<br>

Rocksmith stores song names in the arrangement manifests (`.json`), the header file (`.hsan`), and sometimes the arrangement `.xml` files inside the archive. When you save:

1. Only those text values change. Every other byte of those files stays identical.
2. A new archive is written next to the original. Every file you didn't edit is copied exactly as it was stored.
3. The new archive is read back, and every file is checked against a hash of what it should contain.
4. The original is backed up to Stagehand's own folder, then the new file replaces it in one step.

If any step fails, the original is untouched. Undo is offered right after saving, and right-click → *Restore a backup…* lists older versions. If Rocksmith is running it may lock the files; close it and save again.

</details>

<details>
<summary><b>Audio decoding</b></summary>

<br>

Rocksmith audio is Wwise `.wem`. Stagehand decodes it with [vgmstream](https://github.com/vgmstream/vgmstream), which it installs with one click the first time you play a song (or point it at your own `vgmstream-cli.exe`).

</details>

<details>
<summary><b>Where things are kept</b></summary>

<br>

| What | Where |
| --- | --- |
| Library, setlists, settings, Wanted list, real amp captures | `%APPDATA%\Stagehand` |
| Decoded audio, album art, stems, backups, caches, stem engine | `%LOCALAPPDATA%\Stagehand` |
| The app itself | `%LOCALAPPDATA%\Programs\Stagehand` |

**Settings → Storage** shows sizes and clears caches.

</details>

---

## What's new

**4.1.1:** watching friends' videos copes with the odd things real networks do: a PC whose clock is wrong, the meeting point being down (a second one is tried at the same time), a PC waking from sleep or a dropped Wi-Fi (it reconnects by itself), work and school networks with a proxy, and a connection that drops partway through a video (it carries on from where it stopped). When a friend's Stagehand doesn't answer, it says what to check.

**4.1:** **watch your friends' videos.** Recordings now has two tabs. **Mine** is your recordings as before; each highway or Jam video has a **share** button (two people), and it lights up when the video is shared. **Friends** shows **your code** (like `JAJ5-XAM5-TMFE-KAR2`) and a **Sharing** switch. Send your code to a friend: they press **Add a friend**, type it in, and can watch the videos you share, from their own Stagehand, anywhere. Click a friend to see their shared videos, then ▶ to fetch one and watch it in the window. Only videos can be shared (never audio takes, the looper, or your songs), and only while your Stagehand is open with Sharing on. A dot on the Friends tab pulses while a friend is watching. The two PCs connect directly and everything between them is encrypted; a public relay (ntfy.sh) only passes on one sealed hello each way, locked with your code. Anyone with your code can watch what you share, so give it only to friends; **⋯ › New code** stops the old one working. Some work, school or mobile networks block direct connections; then it says it couldn't connect.

**4.0.3:** paid (official) DLC whose file has no audio inside now plays: Stagehand finds the audio in your Rocksmith folder (songs.psarc, the dlc folder, the Rocksmith 1 import packs) or your library and remembers where it is. Official DLC shows an **Official** tag instead of **no audio**. Stagehand no longer switches between guitar and bass by itself, and never changes your tone: set **Guitar or bass** in Settings (for scoring and the tuner).

**4.0.2:** songs whose file has no audio (some paid DLC) say so instead of seeming to freeze, and the song list marks them **no audio**; Stagehand finds song audio stored differently inside more official DLC files; only one stems progress screen shows at a time.

**3.12:** everything from 3.10 to 3.11.1 (real cabinets, Jam as home, 17 drum styles, a better looper, Score attack, Record clip, tone keys, progress goals, the Drop repair, clearer yellow and orange strings) together with 3.9.1's guitar-or-bass sensing. New moving backgrounds (Nebula, Swarm, Mandala, Strings) replace Aurora, Orbital and Prism, and Fluid reacts much more to the music. Tone match is gone for now. Full notes are on [Releases](https://github.com/DrNoisewater/stagehand/releases).

<details>
<summary><b>3.10 to 3.11.1</b></summary>

<br>

Real cabinets paired with real amps; Jam as the home screen with Play over song; 17 drum styles; the looper records the processed guitar; Score attack; Record clip (MP4); tone keys (1 follows the song); Progress goals (five songs at 95 %, a seven-day streak, a perfect section); bends drawn along the chart's curve; U for a quick tuner; the Drop no longer jumps in level. Built outside GitHub and brought in with 3.12.

</details>

<details>
<summary><b>3.9.1</b></summary>

<br>

Tell Stagehand whether you're playing guitar or bass (Settings › Guitar or bass), for scoring and the tuner; it never switches by itself or changes your tone (4.0.3). Real bass notes score much better, and a bass part played on guitar is scored an octave up.

</details>

<details>
<summary><b>3.9</b></summary>

<br>

- **Back button:** your mouse's back button (or <kbd>Alt</kbd>+<kbd>←</kbd>) goes to the screen you were on before.
- **Highway controls at the top:** play/pause, time and practice speed sit next to the song's name.
- **Master Settings:** the pullout on the highway's right edge has everything: Sync check, the mix, the Drop and your tuning, and the highway options.
- **Score card** at the end of a song: accuracy, each section, what went best and what to work on. It never blocks; switch it off in Master Settings.
- **Progress:** your last song up top, with highlights that update live.

</details>

<details>
<summary><b>3.8 and 3.8.1</b></summary>

<br>

- **Jam** (**J**): full screen, no song, a fluid picture that follows your playing.
- **Fluid venue** on the highway.
- **Smart tuning:** Stagehand knows what your guitar and bass are tuned to. It offers the Drop for songs in the same tuning but lower, or tells you which strings to retune.
- **Find duplicate songs.**
- **Search from anywhere**, and a bigger song list where you can click an artist, album, year, tuning or part to filter by it.
- A song you open always goes ahead of a stem split that's already running.

</details>

<details>
<summary><b>Earlier</b></summary>

<br>

- **3.7:** a look for each technique on the highway, linked notes as one note, setlists replace editing Rocksmith's own lists.
- **3.6:** a true 3D highway drawn by the graphics card, venue pictures, Sync check, lyrics and chord names.
- **3.3:** highway layout and camera rebuilt from real Rocksmith gameplay.
- **3.2:** real amp captures from TONE3000.

</details>

---

## Development

Plain JavaScript on Electron (no bundler, no build step for the UI), with a sound engine in C.

```bat
npm install          :: Windows: get Electron
npm start            :: run from source
npm test             :: the test suite (needs Python 3 with "cryptography")
```

```
src/main/        Electron main process: PSARC reader/writer, Rocksmith metadata, library,
                 stems queue, MusicBrainz, Discover, importer
src/renderer/    the UI (plain ES modules), player, highway, rig, note detection
native/dsp/      the amp engine in C: amps, cabinets, pedals, racks, NAM captures (also WebAssembly)
native/host/     stagehand-audio.exe: WASAPI in/out, song mixing, drift correction
engine/          the Demucs worker the app runs with its private Python
windows/         the installer and uninstaller
test/            tests (npm test) and Playwright end-to-end scripts
```

Every pull request is checked on Windows by [CI](.github/workflows/ci.yml). Releases are built by the [Release workflow](.github/workflows/release.yml): **Actions → Release → Run workflow**, then type the version (it must match `package.json`). More detail for contributors is in [`CLAUDE.md`](CLAUDE.md) and [`HANDOFF.md`](HANDOFF.md).

---

## Credits

[vgmstream](https://github.com/vgmstream/vgmstream) (ISC) · [Demucs](https://github.com/facebookresearch/demucs) (MIT, Meta AI) · [uv](https://github.com/astral-sh/uv) (MIT/Apache-2.0) · [Electron](https://www.electronjs.org) (MIT) · Archivo typeface (SIL OFL, Omnibus-Type) · NAM engine ported from [NeuralAmpModelerCore](https://github.com/sdatkinson/NeuralAmpModelerCore) (MIT, Steven Atkinson) · guitar cabinet IRs from zoyd's "650 Assorted Cabinet Impulses" (public domain, via [0xFX](https://github.com/averagenative/0xFX)) · bass cabinet IRs downloaded from [Shift Line](https://shift-line.com/irpackbass) (free pack, personal use) · Fluid venue from Pavel Dobryakov's [WebGL Fluid Simulation](https://github.com/PavelDoGreat/WebGL-Fluid-Simulation) (MIT)

Artist and album data from [MusicBrainz](https://musicbrainz.org) (CC0), covers from the Cover Art Archive. Rocksmith save format as documented by rsrtools (MIT) and [Rocksmith2014.NET](https://github.com/iminashi/Rocksmith2014.NET) (MIT), whose test archives are used in `test/fixtures`. Real amp captures are made by their creators and shared on [TONE3000](https://www.tone3000.com).

<div align="center"><sub>Made by Noisewater Labs</sub></div>
