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

- **Gear.** Every amp, cabinet, pedal and rack unit as a photo you can play with: turn the knobs right on the picture, hear it, compare it, play it with your guitar, start a tone with it.
- **Create a tone** on a real-looking pedalboard: your guitar, pedals, amp, cabinet and rack joined by cables that light up as you play. Pick gear from the wall beside it, turn any knob, stomp pedals on and off, undo anything, and move the mic in front of the speaker.
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

- **4.12.0:** Sing along. Press **Sing** on the highway and sing into any microphone (USB, headset, webcam): the lyrics become a lane with a bar for every syllable and a dot for your voice. Easy, Medium and Hard, any octave counts, and your singing gets its own score. Or open **Karaoke** on the left: pick a song and sing it with the stage to yourself, the words big, the singer taken out when the song has been split. It stays off until you press it.
- **4.11.0:** Official songs that said “no audio” (Rocksmith 1 DLC and others) now find their audio in your Rocksmith folder. A Tuner button on every page (or press U) with two looks to choose from. Every pedal was tested; Trem-Ole and AutoVibe now wobble as they should. Tidier cables in Create a Tone, and a small burst of light when you hit a note.
- **4.10.0:** Create a Tone’s board is tidy: your gear stands in order with short cables between the jacks, and you can drag a piece to shift it or swap it with its neighbour. Every knob on the gear photos was checked so it turns from where it really points, the graphic EQs have sliders you can grab, and eight photos were replaced with straight-on ones.
- **4.9.1:** the pictures take up much less room (the art went from 45 MB to 27 MB) and look exactly the same on screen.
- **4.9:** 56 new Mythology of Music characters around the app, and characters that show up for the big moments: level ups, milestones, achievements, the tuning and timing checks, stems splitting and saving a tone. The Rehearsal Room banner gets real tape, marker scribbles, new papers and hand-written notes for each page. Getting started circles what it's showing you.
- **4.8:** the screens around the highway, the Tab view and the Waveform view match the rest of Stagehand. The Drop is now the real DigiTech Drop pedal, and it pops open by itself when you use it. Page pictures reach up into the top bar again, and Songs, Discover and Progress are quicker with no blinking pictures.
- **4.7:** the overdrive, distortion, fuzz and booster pedals are now built like the real circuits: they clean up when you play softer and react to how hard you dig in. The pitch pedals hold a clean, steady note instead of warbling.
- **4.6.1:** the window buttons (minimize, maximize, close) come back after you leave the highway or Jam.
- **4.6:** a Gear page with every piece of gear as a photo you can turn the knobs on, and Create a tone rebuilt as a pedalboard with cables that light up as you play. Every knob on every piece now changes the sound, and the cabinet has a mic you can move (center to edge, close or back, angled, plus a room mic).
- **4.5:** the Road to 100. Levels now go to 100 (about a year of regular playing), venues open all along the way (Valhalla, a new legendary venue, at 100; Mandala rebuilt as a stained-glass rose window), achievements in six tiers up to Legendary, song mastery from First play to Mastered, and a redesigned Progress page (Overview, Career stats, Achievements, Song mastery, History). Your lifetime stats (every chord and note) are kept apart from levels and backed up every day. A new Drop console, steady-size Settings, badges on songs, album art that no longer blinks, and Stagehand's own window buttons. Venues you already had in 4.4 stay yours.
- **4.4.1:** stems split again, quickly, like before 4.4 (4.4.0 could sit on a countdown and never split).
- **4.4:** levels: earn points for playing well, with daily and weekly challenges, trophies, titles, pass styles and venues to unlock. Stems split faster, are ready before the song starts, can be stored smaller, and live in folders named after the song. A VIP pass on a lanyard and a neon sign in Backstage.
- **4.3:** Backstage replaces Recordings and friend codes: show a clip and everyone with Stagehand can watch it, with its song, part and tone. The Drop now holds from song to song and says plainly whether it's on, and turning the guitar or bass part off stays off for every song.
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
