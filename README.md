# Stagehand

A Windows desktop app for your Rocksmith 2014 `.psarc` songs: browse and organize them, hear any song instantly with a detailed animated waveform, edit what Rocksmith shows for it, and split it into instrument stems you can mix independently.

## Install

1. Unzip `Stagehand-Windows.zip`.
2. Double-click **Install Stagehand.bat**.

The installer downloads the app runtime (Electron, about 150 MB, once, from GitHub), installs Stagehand into your user profile without needing admin rights, adds Start menu and desktop shortcuts, lists it under Settings → Apps, and opens it. Running it again updates Stagehand and keeps your library. To remove it, use Settings → Apps or **Uninstall Stagehand** in the Start menu.

On first launch, add your Rocksmith `dlc` folder (Stagehand offers it automatically if it finds your Steam install). Files are read where they are; nothing is copied.

**From source** (needs [Node.js 20+](https://nodejs.org)):

```bat
npm install
npm start            :: run from source
npm run dist         :: build a regular Setup .exe into dist\
```

## Stagehand 3

Open Stagehand and play: your guitar is live straight away, no song needed. The left menu has five places, and the bar along the bottom always shows what's playing.

- **Play** (where it opens). The tone you're on, **slots 1–9** (click one, or press 1–9 anywhere; right-click a slot to save the tone you're playing into it), and the rig as a chain of pedals, amp, cabinet and rack. Click a piece to turn its knobs (drag up and down, scroll, or double-click for the default). Changes are live; **Save** keeps them, **Undo changes** goes back. Also here: **Set input level** (calibration), the **tuner**, the **Drop** (like a DigiTech Drop: lower your guitar 1–7 semitones or an octave, or match the song's tuning, so you can play E♭/D/C♯ songs without retuning; press **D** anywhere, and scoring follows it), **Drums & metronome** (Click, Rock, Shuffle, Metal, Half-time, 40–240 BPM, Tap) and the **Looper** (Record, Overdub, Clear, Save to your takes; it starts and ends on the bar when the drums run).
- **Songs.** Your library as a **list** (with a **Your best** column from your practice) or as **album tiles** with your best score on each. The panel on the right has **Play along** (opens the song) and **Just listen** (plays it in the bottom bar), your best per part, and the **tones in the song** to hear (▶) and save.
- **Now playing** (Play along, or **Open song** in the bottom bar). Tab, Highway or Waveform, with your score underneath. On the right: **Mix** (You and Song levels, every stem with a slider and on/off, **Take my part out**, remembered for each song), **Riff repeater** (repeat a section with a speed trainer that starts at 60% and adds 5% after each clean pass, optional count-in), and **Tone** (follow the song's tone changes, hear and save its tones, or pick a slot). Along the bottom: transport, the song as a waveform you can click, speed 50–100% and **Record take**.
- **Tones.** **My tones**, **From my songs** (every tone in your library, grouped by song) and **Presets**. ▶ plays a short demo riff through any tone; clicking a tone puts it on your guitar. Rename it, give it a slot, edit its chain (+ Add, Swap for…, Bypass), pick the cabinet, mic and mic position, or use your own cab file (IR); **Get cab files** opens [TONE3000](https://www.tone3000.com/categories/tags/guitar) (formerly ToneHunt), where you can download free cabinet IRs as .wav. Saving a song's tone makes your own copy.
- **Progress.** Time playing, day streak, songs practised and average accuracy (this week, month or all time), minutes per day, the songs you're working on with your accuracy over time, and **your takes** to listen back to.

### Real amps (3.2)

Your tones can play through **captures of the real amps** (Neural Amp Modeler, the same format as Slopsmith and the NAM plugin) instead of Stagehand's modelled ones. Each Rocksmith amp is matched to a real one (the Cali-100 to a Mesa Dual Rectifier, the HG amps to a Peavey 5150, the AT amps to a Vox AC30, and so on: 57 of the 60), and many come at several gain settings, so the song's **Gain** knob picks the matching capture. Song tones keep switching by themselves, as before.

- **Get a real amp:** on a tone's amp (Tones, click the amp), press **Get the real amp**. [TONE3000](https://www.tone3000.com) opens in your browser to confirm, and Stagehand downloads it. After that, every tone with that amp uses it. **Settings › Real amps** lists them all, the ones your songs use most first.
- **One-time setup:** TONE3000 asks free apps to connect with your own key. Settings › Real amps walks you through it in three steps (make a free account and key, add the address it shows, paste the key).
- **Real | Modelled** on the amp switches a tone back and forth; **Change** picks another capture, browses TONE3000, or adds captures you downloaded yourself (`.nam` files, or the `.zip` TONE3000's Download all gives; gain levels are read from the names). **REAL** marks every tone and amp that plays a capture.
- **Presets are built on real amps (3.2.1):** Clean (Fender Deluxe), Chime (Vox AC30), Crunch (Marshall Plexi), Overdrive (JCM800), Lead (Peavey 5150), Metal (Mesa Rectifier), Fuzz (Orange), Bass clean (Ampeg SVT) and Bass grit (Orange AD200), each set to land on one of the capture's gain settings. Slots still holding an old preset you never changed get the new version; your edited ones stay.
- Captures stay with their makers' names, as TONE3000 asks, and are only downloaded when you ask. Turn them all off in Settings › Real amps.

The whole song always plays while you play; turn your part down or off in the Mix panel if you want to fill it in yourself. Your guitar starts by itself when the Rocksmith cable is plugged in (also later), and the card at the bottom of the menu shows it working; its speaker button mutes it. Stagehand runs one copy at a time.

## What it does

- **Library.** Every song in your folders, including subfolders, with title, artist, album, year, tuning (with A432-style cent offsets), arrangements (lead, rhythm, bass, vocals) and length. Sort any column, filter by parts, search across everything, switch between list and cover views. Favorites, star ratings, play history, setlists (drag songs onto them), and automatic groups by tuning and artist. New or changed files are picked up while the app is open.
- **Instant preview.** Double-click a song and the full mix plays. The waveform shows peak and RMS detail at any zoom (Ctrl + wheel), with Rocksmith's own sections (Verse, Chorus, Solo…) on the timeline. Click a section to jump, double-click to loop it, or drag on the timeline to loop any range.
- **Stems.** Stored as lossless FLAC (3.1 cleared older stems once so you can remake them). One click splits a song into guitar, bass, drums, vocals, keys and other with Demucs, running locally. Each stem gets its own lane with a waveform drawn from that stem's actual audio, plus volume, mute and solo. Waveform height follows the fader, so what you see is what you hear. All stems play from one sample clock, so they never drift. Your mix is remembered for each song.
- **Safe editing.** Change title, artist, album, year, sort names (and Japanese names where present) for one song or many at once. See "How saving works" below.
- **Rename files.** Rename and optionally sort files into artist folders from a pattern like `{artist} - {title}`, with a full preview, clash detection and one-click undo. The `_p`/`_m` suffix is kept.
- **Rocksmith song lists.** Edit the game's own Favorites and Song Lists 1 to 6 without opening the game. See below.
- **Note highway.** The part coming at you down a 3D fretboard, Rocksmith style, full screen, with big fret numbers and a camera that glides between hand positions. See below.
- **Tab view.** Every guitar and bass part as tab that plays along with the song, with play-along (your part taken out of the mix), practice speed, lyrics, and your own guitar through the Rocksmith cable with amp tones and a precise tuner. See below.
- **Discover.** Search any artist or song, see which album tracks you're missing, keep a Wanted list, and have downloads go straight into Rocksmith. See below.

## Splash

The Noisewater Labs logo at the top right, next to Settings, plays the Noisewater Labs splash over Stagehand. Click it to skip. Stagehand itself opens straight to your song list.

## How saving works

Rocksmith stores song names in the arrangement manifests (`.json`), the header file (`.hsan`) and sometimes the arrangement `.xml` files inside the archive. When you save:

1. Only those text values are changed. Every other byte of those files (formatting, line endings, number formatting) stays identical.
2. A new archive is written next to the original. Every file you did not edit is copied block-for-block exactly as it was stored; only the table of contents is rebuilt and re-encrypted.
3. The new archive is read back and every file inside it is checked against a hash of what it should contain.
4. The original is backed up to Stagehand's own folder (not the `dlc` folder), then the new file replaces it in one atomic step.

If any step fails, the original is untouched. Undo is offered right after saving, and right-click → *Restore a backup…* lists older versions. An unedited round trip through this writer produces a byte-identical file on the test archives.

If Rocksmith is running it may lock the files; close it and save again.

## Rocksmith song lists

The sidebar's **In Rocksmith** section shows Favorites and your song lists from your Rocksmith profile, the same lists you'd otherwise build inside the game.

- Drag songs onto a list, or right-click songs → **Add to Rocksmith**.
- Open a list and press Delete to remove songs from it.
- Build a setlist in Stagehand, then right-click it → **Send to Rocksmith** → pick a list to replace it.
- Right-click a list to clear it, fill it from a setlist, or copy it into a new Stagehand setlist.
- Songs in a list that Stagehand has no file for (on-disc songs, for example) are kept as they are.

**Up to 20 lists.** Press **+** next to In Rocksmith to add a song list and name it straight away; you can have up to 20. Right-click the last extra list to remove it (the game's first six always stay; its songs stay installed). Lists beyond six are an [RSMods](https://github.com/Lovrom8/RSMods) feature: RSMods names them and adds them to Non-Stop Play, and Stagehand asks first if RSMods isn't installed. The section collapses like Tunings and Artists, and long menus scroll.

**Renaming lists.** Double-click a song list in the sidebar (or right-click → Rename). Plain Rocksmith always calls its lists SONG LIST 1 to 6; custom names are shown in the game by the free [RSMods](https://github.com/Lovrom8/RSMods) mod, which reads them from `RSMods.ini` in your Rocksmith folder. Stagehand writes the names there, changing only the `SongListTitle_N` lines (the rest of your RSMods settings stay as they are, and the file is backed up first). Without RSMods installed the names show in Stagehand only, and appear in the game once you install it. Names can be up to 25 characters; Favorites can't be renamed.

**Close Rocksmith before making changes.** The game writes its profile when it saves, so changes made while it's running would be lost; Stagehand refuses and tells you. Changes show up the next time you start the game.

How it's kept safe:

1. Stagehand finds your profile in `Steam\userdata\<id>\221680\remote` (Settings → Rocksmith lets you pick the profile, or point at your Steam or Rocksmith folder).
2. It first proves it can rebuild your exact profile from what it read, or it won't touch it.
3. It backs up the profile, `LocalProfiles.json` and Steam's `remotecache.vdf`.
4. It changes only the song list entries. Every other byte of your profile's data stays exactly as Rocksmith wrote it, in Rocksmith's own layout.
5. It reads the new file back before and after swapping it in, and puts the backup back if anything doesn't match.
6. It updates Steam Cloud's records for the profile so Steam uploads the new lists instead of restoring the old ones.

Every change has **Undo** in its notification, and Settings → Rocksmith lists the last 20 profile backups with **Restore**. The file format and approach follow [rsrtools](https://github.com/BuongiornoTexas/rsrtools), which has edited these lists since 2019, and [Rocksmith2014.NET](https://github.com/iminashi/Rocksmith2014.NET).

## Tab view

Press **Tab** in the player (or **T**) to see the song's part as tablature, read from the song file itself, scrolling under a fixed playhead in time with the music.

- **Parts.** Lead, Rhythm and Bass (and bonus parts), each with its tuning and capo. Notes are shown at Rocksmith's hardest level, with chord names, hammer-ons and pull-offs, slides, bends, vibrato, palm mutes, harmonics, taps, slaps and pops, sustain bars, bar numbers, section names and where the song changes tone. Lyrics run underneath.
- **Your part.** The whole song plays while you play. With stems split, **Take my part out** in the Mix panel turns your instrument's stem off (guitar for Lead and Rhythm, bass for Bass), and the mix is remembered for the song.
- **Practice speed.** 50% to 100% without changing pitch; stems stay in sync.
- **Options** (the sliders button): low E on top (the default) or high e on top, scrolling or pages (pages show the next lines below so you can read ahead) and lyrics on or off. Zoom with + and −.

**Your guitar.** Plug in the Rocksmith Real Tone Cable and Stagehand starts it by itself and plays it through a real amp rig, on the same speakers or headphones as the song. The rig, tones and tuner are on **Play**; input, output, sound engine, buffer and calibration are in **Settings › Guitar & audio**.

- **The sound engine.** Stagehand opens the cable and your speakers or headphones directly, the way Rocksmith does, so your guitar doesn't go through Windows' shared sound mixer, which is where most of the delay used to come from. It runs the amp and plays the song too, and the panel shows the delay it works out for your devices. Other sounds on your PC (Discord, the browser) go quiet while your guitar is on and come back when you turn it off.
  - **Engine** choices: *Fastest* (takes over your output; the default), *Shared* (other apps keep playing; a little more delay) and *In-app* (the amp runs inside Stagehand like before; use it if the others don't work). If Stagehand can't take over your output, for example because another program is using it, it shares it instead and tells you.
  - **Buffer:** *Smallest delay*, *Small delay* (default) or *Safe*. If you hear crackles, pick a safer one.
  - **Output** picks the speakers or headphones; it starts on your Windows default.
  - **Set level** works like Rocksmith's calibration: press it and strum as hard as you play for 4 seconds, and Stagehand sets the input level.
  - Close Rocksmith (and anything else using ASIO4ALL or the cable) before turning your guitar on in Stagehand, since only one program can have the devices.
- **Song tone** is the song's actual Rocksmith rig: its amp, pedals, cabinet and mic, and rack effects, with every knob where the song's author set it. All of Rocksmith 2014's 63 amps, 83 pedals, 17 rack units and 450 cabinet and mic combinations are supported, each modelled on the kind of circuit or speaker it's based on, and the panel lists the chain (for example *Super Drive → Cali-100 → CA-412C*). Tone switches in the song happen with a short crossfade, and a song's tones are prepared ahead so they switch instantly. Pick any other tone for a song and Stagehand remembers it for that song; press Song tone to go back.
- **Tones:** Clean, Crunch, Overdrive, Metal, Fuzz and Lead, plus Bass clean and Bass grit, each built from Rocksmith gear too. Every tone works on any part. Gain, Bass, Mid, Treble, Effects, Volume and Input level are adjustable; on a song tone the sliders start in the middle, which means exactly as the song has it. Each preset keeps its own settings. Double-click a slider to reset it.
- **Tuner.** Accurate to about a tenth of a cent, with a strobe, needle and the frequency you're playing next to the target. It tunes to the song's tuning and reference pitch (including A432-style songs) by default, or pick any of E/E♭/D/C♯/C/B/F Standard, Drop D/C♯/C/B/B♭/A, Open G/D/E/A/C, DADGAD, or chromatic, and A = 432–446 Hz. Click a string to lock the tuner to it.
- If you hear yourself twice, turn off "Listen to this device" for the cable in Windows sound settings.

## Note highway

Press **Highway** in the player (or **H**) for the Rocksmith-style view, full screen. **Back** or **Esc** returns to Stagehand.

- **Laid out like Rocksmith (3.1: a real 3D scene).** An upright neck at the bottom (real fret spacing, inlays, strings in Rocksmith's colours, **low E on top**), seen from behind and above, with the highway floor running from its foot into the distance. Every string has its own height, so notes fly in at the height of their string. Hand positions are lit troughs with glowing rails that step across the floor as they come; the one you're in is framed on the neck by a glowing bracket and its fret numbers glow gold under the neck. The camera follows your hand position and zooms with its width.
- **Readable.** Every note carries its fret number in large white type with a dark outline, and has a stem down to its lane. As a note arrives, its spot on the neck lights up. Notes are small glowing boxes; sustains trail behind them as ribbons at the string's height. Chords come as glowing boxes standing on the highway with coloured bars for their strings and their name (a repeated chord is just the box), the next chord's name shows large on the left, and the fingering appears on the neck as the chord arrives. Open strings are a bar across your hand position. Hammer-ons, pull-offs, slides, bends, palm mutes, vibrato, harmonics, taps, slaps and pops are marked on the note.
- **Calm.** Notes appear 4 seconds ahead by default (3–6 in the options). The board moves on a steady clock, and the camera glides between hand positions on a spring that eases in and out, zooming out a little when a big shift is coming so the notes you're still playing never slide off screen.
- **Game feel (3.1).** Pick a **venue** in the options (Arena, Club, Neon, Studio); its lights move with the song's beat. Play 8 notes in a row and the highway heats up: the rails glow orange, embers drift off the bottom of the neck (never over the notes) and your streak counts up on the right. Bends rise along the song's real bend curve with ↑½/↑full labels, slides travel to their fret, vibrato shakes for exactly as long as it lasts, and accented notes and chords get a white outline.
- **Section strip** across the top: click to jump to a section (1 s early), double-click to loop it. ← / → skip 5 s, Space plays and pauses.
- **Mix** (or the MIX tab on the right edge) slides out the song mix, and collapses back to the edge: each stem with an on/off switch, a volume slider and solo (split stems from there if the song hasn't been split yet). practice speed runs 50–100%, and **Guitar on** mutes or unmutes your guitar; **Tone** picks the song's own tone or any tone, guitar or bass tones on either part. With your guitar on, Stagehand scores what you play: notes light up as you hit them, misses fade grey, and accuracy and streak show at the bottom. Turn scoring off in the options.

## Discover

The sidebar's **Discover** section finds the songs you don't have yet. Artist and album details come from [MusicBrainz](https://musicbrainz.org), the open music encyclopedia, and covers come from the Cover Art Archive.

- **Search.** In Discover, the search box at the top searches MusicBrainz instead of your library. Type an artist, a song title, or `Artist - Song`. Results show **In library**, **Wanted** or **Missing** for every song. If a library search finds nothing, one click repeats it on MusicBrainz.
- **Artist pages.** Every studio album and EP, original track lists (deluxe bonus tracks, live albums, compilations and remixes are left out), what you have from each, and an overall percentage. Remastered, live and "feat." versions of a title count as the same song. Tick songs, use **Select missing** on an album, or **Missing only** to hide what you have. Songs of theirs that aren't on those albums (covers, live cuts) are listed under *Also in your library*. Right-click any song in your library → **What's missing from …** to get here.
- **Collection gaps.** Checks every artist in your library in the background and ranks them by how many album songs you're missing. When several artists share a name, you pick the right one once and Stagehand remembers it.
- **Wanted.** Your shopping list, grouped by artist. **Find** (or **Find next**) copies "Artist Title" and opens CustomsForge's Ignition site in your browser, so you paste it into the search box, sign in and download as usual. Songs are ticked off automatically when they arrive.
- **Imports.** Turn on **Watch for downloads** and every finished `.psarc` download in your Downloads folder is checked and moved into Rocksmith's `dlc` folder. Half-finished downloads are left alone, and ZIPs are never touched by the watcher (drop a ZIP on the window or use **Import files…** when it holds songs). Stagehand rejects files that aren't songs or are the Mac version (it explains why), recognises songs you already have, and replaces an older version of the same song (the old file goes to Backups, and favorites, ratings and setlists move to the new one). It can also add every new song to an in-game list of your choice; if Rocksmith is open, it waits until you close it. Each import has **Undo**. You can also drop `.psarc` files, or ZIPs with songs inside, anywhere on the window, or press **Import files…**.

**About CustomsForge.** CustomsForge's rules don't allow apps to search or download from Ignition for you, so Stagehand never does: it copies the search, opens the site in your browser, and picks the file up once you've downloaded it. MusicBrainz asks apps to make at most one request a second, so a big discography takes a moment the first time; everything is cached for a month after that.

## Stem storage

Stems are big as plain WAV files (about 250–300 MB for a 4-minute song). **Settings › Stems › Store stems as** offers **Lossless (FLAC)**, a perfect copy at about half the size, and **Opus** at 256, 192 or 128 kbps, compressed to roughly a sixth to a tenth. **Compare formats…** makes a 12-second preview of one of your songs in every format: flip between them while it plays (keys 1–5), solo a stem, try a blind test, and see the size per song and for your whole library. New stems are stored in the format you choose; **Shrink my stems** converts the ones you already have in the background.

## Stem separation

The first time you split a song, Stagehand offers a one-click setup. It downloads [uv](https://github.com/astral-sh/uv), a private Python 3.12, PyTorch and [Demucs](https://github.com/facebookresearch/demucs) into `%LOCALAPPDATA%\Stagehand\Engine`. It never touches any Python you already have.

| Your PC | Download | Time per song |
| --- | --- | --- |
| NVIDIA GPU, GTX 10 series or newer (detected automatically) | about 3 GB | well under a minute |
| AMD, Intel or no graphics card | about 1 GB | a few minutes |

**Is my GPU being used?** Settings → Stems shows where separation runs, and the player says "Splitting instruments on your GPU/CPU" while it works. If you have an NVIDIA card but it says CPU, Stagehand explains why and offers the fix:

- *CPU-only PyTorch installed* (setup didn't recognize the card): press **Switch to GPU**. It swaps in the GPU version of PyTorch (about 2.5 GB); everything else is kept.
- *Driver too old*: press **Get NVIDIA driver**, install it, restart, then **Check again**.

If the GPU fails partway through a song (out of memory, driver hiccup), that song finishes on the CPU instead of failing.

**Running cooler on the CPU.** Separation always runs at low priority so other apps stay responsive. Settings → Stems → *CPU load* limits it to half or a quarter of your cores, which runs cooler and slower. A CPU running hot under full load is normal: it slows itself down before it gets too hot. On a GPU the CPU stays mostly idle.

Settings → Stems also lets you pick the model (6-stem is the only one with guitar and keys), quality, and whether songs split automatically when opened. Stems are cached by the song's audio, so editing or renaming a file keeps them.

## Audio decoding

Rocksmith audio is Wwise `.wem`. Stagehand uses [vgmstream](https://github.com/vgmstream/vgmstream) to decode it and installs it with one click the first time you play a song (or point it at your own `vgmstream-cli.exe`).

## Keyboard

| Key | Action |
| --- | --- |
| Space | Play / pause |
| ← / → | Back / forward 5 s (Shift: 15 s) |
| Enter | Open the selected song |
| 1–9 | Switch to the tone in that slot |
| Shift+1–6 | Turn a stem off or on (Shift+Alt: solo) |
| M | Switch between the original mix and stems |
| Esc | Leave Now playing |
| L | Loop the current section; Esc clears the loop |
| D | Turn the Drop on or off |
| + / − / 0 | Zoom in / out / whole song |
| F2 or Ctrl+E | Edit details |
| T | Tab view / waveform view |
| H | Note highway (Esc to go back) |
| Ctrl+F | Search (MusicBrainz while in Discover) |
| Ctrl+A | Select all |
| Ctrl+, | Settings |

## Where things are kept

| What | Where |
| --- | --- |
| Library, setlists, settings | `%APPDATA%\Stagehand` |
| Wanted list, import history | `%APPDATA%\Stagehand` |
| Real amp captures (`Captures\`) | `%APPDATA%\Stagehand` |
| Decoded audio, album art, stems, backups (songs, replaced songs and Rocksmith profiles), MusicBrainz cache, tools, stem engine | `%LOCALAPPDATA%\Stagehand` |

Settings → Storage shows sizes and clears caches.

## Development

```
src/main/core        PSARC reader/writer, Rocksmith metadata, JSON/XML patching, DDS→PNG,
                     .sng arrangements and XML (tab), song tones
src/main/services    library scanning, audio decode, stem queue, tools/engine setup, renaming,
                     MusicBrainz client, Discover (gaps, wanted), download importer
src/main/main.js     window, stagehand:// protocol, IPC
src/renderer         UI (plain ES modules, no build step), AudioWorklet player, waveform drawing
native/dsp           the amp engine in C: amps, tone stacks, cabinets, pedals, racks, NAM captures
                     (sh_nam.c: LSTM and WaveNet A1/A2 inference; also built to WebAssembly)
native/host          stagehand-audio.exe: WASAPI in/out, song mixing, drift correction, the protocol
native/build.sh      builds bin/stagehand-audio.exe, the WebAssembly engine and Linux test tools
engine/              the Demucs worker the app runs with its private Python
windows/             the no-admin installer and uninstaller
test/                core tests (npm test) and Playwright end-to-end scripts
```

`npm test` runs the GPU detection, engine self-check, Rocksmith profile, song list name and Discover/import tests (MusicBrainz-shaped fixtures in `test/fixtures/musicbrainz`, made by `test/make_mb_fixtures.py`) (the profile tests check Stagehand's output with a separate Python decoder), plus the PSARC tests against real Rocksmith archives in `test/fixtures` (from the MIT-licensed [Rocksmith2014.NET](https://github.com/iminashi/Rocksmith2014.NET) test suite), including byte-identical round trips, edits that leave every untouched file identical, and failure paths that must leave the original alone. It also builds every preset and a real song tone in the amp engine.

`test/e2e/rig-chromium.js` and `test/e2e/ui-chromium.js` run the guitar rig end to end in Chromium, against the real main-process relay and a Linux build of the sound engine with a pretend cable and speakers (`native/build.sh` makes it). `native/test/slip_test.c` checks the song stays at exact pitch when clocks drift. `native/test/nam_test.c` renders a file through a NAM capture (compare with NeuralAmpModelerCore's output; the example models in `test/fixtures/nam` match it to about one part in a million), and `test/captures.test.js` runs the TONE3000 sign-in and download against a stand-in server.

## Credits

vgmstream (ISC), Demucs (MIT, Meta AI), uv (MIT/Apache-2.0), Electron (MIT), Archivo typeface (SIL OFL, Omnibus-Type). Artist and album data from MusicBrainz (CC0); covers from the Cover Art Archive. Rocksmith save-file format as documented by rsrtools (MIT) and Rocksmith2014.NET (MIT). Song list names follow the `RSMods.ini` format used by RSMods. The NAM engine is a C port of [NeuralAmpModelerCore](https://github.com/sdatkinson/NeuralAmpModelerCore) (MIT, Steven Atkinson). Real amp captures are made by their creators and shared on [TONE3000](https://www.tone3000.com) (powered by TONE3000).
