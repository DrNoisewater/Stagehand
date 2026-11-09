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

1. Download **`Stagehand-Setup-<version>.exe`** from the [latest release](https://github.com/DrNoisewater/stagehand/releases/latest).
2. Run it. No admin rights needed. The first install takes a few minutes.
3. Add your Rocksmith `dlc` folder when Stagehand opens. Your songs stay where they are.

> [!NOTE]
> If Windows says *"Windows protected your PC"*, click **More info → Run anyway**. The installer isn't signed.

**Updating:** run the newer Setup. Your library, settings, stems and tones are kept.

**Removing:** Start menu → **Uninstall Stagehand**. Your `.psarc` files are never touched.

---

## Features

### 🎸 Play

Plug in the Rocksmith cable and your guitar is live straight away, no song needed.

- **Tones on keys 1–9.** **1** follows the song's own tone; **2–9** are your saved tones. Click any pedal, amp or cabinet to turn its knobs.
- **Guitar or bass:** choose which you're playing in **Settings › Guitar or bass**. A bass part played on guitar is scored an octave up.
- **Tuner, Drop and input level.** The **Drop** lowers your instrument up to 7 semitones or an octave, so you can play E♭, D or C♯ songs without retuning. Press **D** anywhere.
- **Jam** is the home screen: rig, tuner, Drop, drums and looper in one place. **Play over song** lets you improvise over a song with your part muted.
- **Drums** in 17 styles (40–240 BPM, or tap the tempo) and a **Looper** that stays in time with the bar.
- **Moving backgrounds** (Fluid, Nebula, Swarm, Mandala, Strings) that react to the song and your playing. Press **J** for full screen.

### 🎵 Play along

Double-click a song, or press **Play along**.

- **Note highway.** A smooth 3D Rocksmith-style highway, with lyrics, chord names, and a camera that follows your hands.
- **Tab and Waveform views** of the same song (**T** switches).
- **Scoring** as you play, with streaks, early/late feedback and a **score card** at the end: each section, what went best, and what to work on.
- **Riff repeater** with a speed trainer that starts at 60% and adds 5% after each clean pass.
- **Mix panel:** your level, the song, and every stem with a slider. **Take my part out** removes your part from the song.
- **Tone** follows the song's own tone changes, or pick any tone.
- **Score attack:** a full-speed run with a ×4 multiplier and a top-ten list per song.
- **Record clip** saves a video of you playing along. **U** opens a quick tuner without stopping the song.

### 🔊 Tones and real amps

- **My tones, From my songs, Presets.** ▶ plays a demo riff through any tone. Edit the pedals, amp, cabinet and mic, or load your own cabinet file (IR).
- **Real amps.** Play your tones through recordings of real amps instead of simulated ones. Almost every Rocksmith amp has a real match. Press **Get the real amp**, or **Get all** for every amp your songs use. Set it up once in **Settings › Real amps** (a free [TONE3000](https://www.tone3000.com) account).
- **Real cabinets** to go with them: **Download amp + cab**.
- **Presets** built on classic amps: Fender Deluxe, Vox AC30, Marshall Plexi, JCM800, Peavey 5150, Mesa Rectifier, Orange, and Ampeg SVT for bass.

### 🥁 Stems

- **One click splits a song** into guitar, bass, drums, vocals, keys and other, on your own PC.
- Each one gets its own volume, mute and solo. Your mix is remembered for each song. Turn the guitar or bass part off to play it yourself and it stays off for every song until you turn it back on.
- Stems take a lot of space. **Settings › Stems** can store them smaller, and **Compare formats** lets you hear the difference.

### 📚 Library

- Search, sort and filter your songs, as a list or as album covers.
- **Your best** score on every song, plus favourites, ratings and **setlists**. **Bring over Rocksmith lists** copies your in-game lists.
- **Find duplicate songs** keeps the best copy and moves the rest to backups, with Undo.
- **Edit details** and **Rename files** safely: your original is always backed up first.

### 🔎 Discover

- Search any artist and see which of their album songs you're missing.
- Keep a **Wanted** list. **Find** opens CustomsForge with the search ready to paste.
- **Watch for downloads** moves new songs from your Downloads folder into Rocksmith's `dlc` folder for you.

### 📈 Progress

Time played, day streak, accuracy over time, goals, what's improving, and **your recordings** to look back on.

### 👥 Backstage

Just above Getting started on the menu. **Everyone** shows who has Stagehand open right now (a green dot) and the clips they show. **My clips** has everything you've recorded. Press **Show backstage** on a video and everyone with Stagehand can watch it while your Stagehand is open. Each clip shows the song, the part and the tone: try or keep someone's tone, open the song if you have it (or find it on CustomsForge), and message them about it. No codes, no accounts: just a name.

---

## Keyboard

| Key | Action |
| --- | --- |
| <kbd>Space</kbd> | Play / pause |
| <kbd>←</kbd> <kbd>→</kbd> | Back / forward 5 s (<kbd>Shift</kbd>: 15 s) |
| <kbd>Enter</kbd> | Open the selected song |
| <kbd>1</kbd> | Follow the song's tone |
| <kbd>2</kbd>–<kbd>9</kbd> | Switch to the tone in that slot |
| <kbd>U</kbd> | Tuner (on the highway and in the tab view) |
| <kbd>[</kbd> <kbd>]</kbd> | Slower / faster (25% to 150%) |
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

The first time you split a song, Stagehand offers to install the stem splitter. It won't touch any Python you already have.

| Your PC | Download | Time per song |
| --- | --- | --- |
| NVIDIA graphics card (GTX 10 series or newer) | about 3 GB | under a minute |
| Anything else | about 1 GB | a few minutes |

**Slow with an NVIDIA card?** **Settings → Stems** shows whether your graphics card is being used, and offers a fix if it isn't.

**PC getting hot?** Lower **CPU load** in **Settings → Stems**.

</details>

<details>
<summary><b>Is editing my songs safe?</b></summary>

<br>

Yes. Stagehand only changes the details you edit, checks the new file before using it, and backs up your original first. If anything goes wrong, the original is left alone.

**Undo** appears right after saving, and right-click → **Restore a backup…** brings back older versions. If Rocksmith is open it may lock the files: close it and save again.

</details>

<details>
<summary><b>Where things are kept</b></summary>

<br>

| What | Where |
| --- | --- |
| Library, setlists, settings, real amps | `%APPDATA%\Stagehand` |
| Stems, album art, backups | `%LOCALAPPDATA%\Stagehand` |
| The app itself | `%LOCALAPPDATA%\Programs\Stagehand` |

**Settings → Storage** shows sizes and clears caches.

</details>

---

## What's new

- **4.3:** Backstage replaces Recordings and friend codes: show a clip and everyone with Stagehand can watch it, with its song, part and tone. The Drop now holds from song to song and says plainly whether it's on, and turning the guitar or bass part off stays off for every song. Levels: earn points for playing well and trying new things, with daily challenges, pass styles and venues to unlock.
- **4.2.1:** the neck lights up as notes arrive, like Rocksmith: each note's spot on its string, the frets around it, and the chord frame.
- **4.2:** a real practice song for the timing check, slow down or speed up one or several sections, metal and lead sounds with pedals and a noise gate, a calmer Tones page, and a tab view you can click and drag.
- **4.1:** watch your friends' highway and Jam videos. Only videos you choose to share can be seen, and only while your Stagehand is open. 4.1.1 makes connecting more reliable.
- **4.0.3:** official DLC plays, even when its audio is stored elsewhere in your Rocksmith folder.
- **3.12:** real cabinets, Jam as the home screen, 17 drum styles, Score attack, Record clip, progress goals and new moving backgrounds.
- **3.9:** a score card after each song, Master Settings on the highway, and the mouse back button.
- **3.8:** Jam, smart tuning and Find duplicate songs.

Full notes for every version are on [Releases](https://github.com/DrNoisewater/stagehand/releases).

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
