# Stagehand

A Windows desktop app for your Rocksmith 2014 `.psarc` songs: browse and organize them, hear any song instantly with a detailed animated waveform, edit what Rocksmith shows for it, and split it into instrument stems you can mix independently.

## Install and update

Double-click **Stagehand-Setup-<version>.exe**. One file, no admin rights, nothing to download: the app runtime (Electron), Stagehand and the song audio decoder are inside it.

Before installing, Setup shows what's already on your PC and keeps it (green ticks): an installed runtime of the same version, the audio decoder, a stem splitter (Python + PyTorch + Demucs, Stagehand's own or one you installed yourself) and your library. It also offers to set up the **stem splitter** right away (about 3 GB from the internet for an NVIDIA card, 1 GB otherwise, plus Microsoft's Visual C++ runtime if it's missing); click that row to skip it and set it up later from inside Stagehand. Downloads show their size and time as they go, and **Skip** stops them.

**Updating:** run the newer Setup. The top right shows your version → the new one; your library, settings, stems, tones and the stem splitter stay. If Stagehand is open, Setup closes it for you.

**Removing:** Settings → Apps → Stagehand, or **Uninstall Stagehand** in the Start menu. Your data is kept unless you tick “Also delete my library data and stems” (your .psarc files are never touched).

Windows may show “Windows protected your PC” the first time (the installer isn't signed): click **More info → Run anyway**.

Backup: `Stagehand-Windows.zip` with **Install Stagehand.bat** still works (it downloads the runtime with progress).

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

- **Get a real amp:** on a tone's amp (Tones, click the amp), press **Get the real amp**. [TONE3000](https://www.tone3000.com) opens in your browser to confirm, and Stagehand downloads it. After that, every tone with that amp uses it. **Settings › Real amps** lists them all, the ones your songs use most first. (3.7: the Plexi, Rectifier and Tweed captures only come in TONE3000's newer A2 format; Stagehand now tells TONE3000 it plays A2, so they're no longer refused as “not compatible”.)
- **One-time setup:** TONE3000 asks free apps to connect with your own key. Settings › Real amps walks you through it in three steps (make a free account and key, add the address it shows, paste the key).
- **Real | Modelled** on the amp switches a tone back and forth; **Change** picks another capture, browses TONE3000, or adds captures you downloaded yourself (`.nam` files, or the `.zip` TONE3000's Download all gives; gain levels are read from the names). **REAL** marks every tone and amp that plays a capture.
- **Presets are built on real amps (3.2.1):** Clean (Fender Deluxe), Chime (Vox AC30), Crunch (Marshall Plexi), Overdrive (JCM800), Lead (Peavey 5150), Metal (Mesa Rectifier), Fuzz (Orange), Bass clean (Ampeg SVT) and Bass grit (Orange AD200), each set to land on one of the capture's gain settings. Slots still holding an old preset you never changed get the new version; your edited ones stay.
- **Get all (3.2.6):** Tones › From my songs and Settings › Real amps have a **Get all** button that fetches every real amp your songs use, one after another (stop any time).
- **On the highway (3.2.6):** the guitar and tone sit in one pill at the top; it says **REAL** when the tone is playing a captured amp, and its menu shows the real amp or offers to get it.
- Captures stay with their makers' names, as TONE3000 asks, and are only downloaded when you ask. Turn them all off in Settings › Real amps.

The whole song always plays while you play; turn your part down or off in the Mix panel if you want to fill it in yourself. Your guitar starts by itself when the Rocksmith cable is plugged in (also later), and the card at the bottom of the menu shows it working; its speaker button mutes it. Stagehand runs one copy at a time.

## What it does

- **Library.** Every song in your folders, including subfolders, with title, artist, album, year, tuning (with A432-style cent offsets), arrangements (lead, rhythm, bass, vocals) and length. Sort any column, filter by parts, search across everything, switch between list and cover views. Favorites, star ratings, play history, setlists (drag songs onto them), and automatic groups by tuning and artist. New or changed files are picked up while the app is open.
- **Instant preview.** Double-click a song and the full mix plays. The waveform shows peak and RMS detail at any zoom (Ctrl + wheel), with Rocksmith's own sections (Verse, Chorus, Solo…) on the timeline. Click a section to jump, double-click to loop it, or drag on the timeline to loop any range.
- **Stems.** Stored as lossless FLAC (3.1 cleared older stems once so you can remake them). One click splits a song into guitar, bass, drums, vocals, keys and other with Demucs, running locally. Each stem gets its own lane with a waveform drawn from that stem's actual audio, plus volume, mute and solo. Waveform height follows the fader, so what you see is what you hear. All stems play from one sample clock, so they never drift. Your mix is remembered for each song.
- **Safe editing.** Change title, artist, album, year, sort names (and Japanese names where present) for one song or many at once. See "How saving works" below.
- **Rename files.** Rename and optionally sort files into artist folders from a pattern like `{artist} - {title}`, with a full preview, clash detection and one-click undo. The `_p`/`_m` suffix is kept.
- **Setlists.** Your own lists of songs; bring your old Rocksmith lists over in one click. See below.
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

## 3.9.1

- **Songs with no audio don't freeze anymore:** double-clicking a song whose file has no audio used to open the highway with nothing playing. Now Stagehand says why, the song list marks such songs **no audio**, and the highway shows a **Back to your songs** button if a song can't load.
- **More official DLC plays:** Stagehand now also finds song audio that's named or stored differently in the file (inside its sound bank, or in the older Ogg format). Songs marked "no audio" are checked again once. If one still has none, the Activity log says what the file holds.
- **One stems loading screen:** while a song waits for its stems, only the floating progress card shows (there used to be two).

## 3.9

- **Back button:** your mouse's back button (or Alt+←) goes to the screen you were on before. On the highway or in Jam it leaves them, and it closes an open dialog or menu first.
- **Highway controls all at the top:** play/pause, the time and the practice speed now sit next to the song's name in the top bar.
- **Master Settings:** the pullout on the right edge of the highway has everything: Sync check, the mix (your guitar, the whole song, every stem), **the Drop and your tuning** (what the song needs, Match the song, −1…−7/Oct, which tuning your guitar is in), and the highway options (look ahead, strings, venue, switches). The separate options button is gone.
- **Score card:** when a song ends, a card shows your accuracy (and whether it's a new best), each section as a bar (click one to repeat it), what went best and what to work on (with Repeat it), and how you did on single notes, chords, bends, slides and hammer-ons. It sits to the side and never blocks: close it, Play again, or just carry on. Switch it off in Master Settings.
- **Progress:** your last song up top, big: score, change since last time, new best, longest streak, every section as a bar, what you nailed and what to work on, and how you did by kind of note. **Highlights** point out the songs that got better, your streak, your longest run and your strongest and weakest techniques. It updates live while it's open.

## 3.8.1

- **Opening a song is never stuck behind another split:** the song you double-click goes first; a split of another song that's running stops and goes back in line right after it.
- **Search from anywhere:** typing in the search box shows your songs straight away, filtered as you type (Discover still searches MusicBrainz).
- **A smarter, bigger song list:** rows are taller and easier to read; click an **artist**, **album**, **year** or **tuning** to list the songs that share it, a **part letter** to show only songs with that part, or **your best** to see the songs at that level. **Your level** in the menu: Mastered (90 %+), Getting there, Learning, Not played yet. A double-click on any of those still plays the song.

## 3.8

- **Jam:** the Jam button on Play (or **J**): full screen, no song, just the Fluid picture following what you play. The note you play picks the colour, how hard you play sets the size, and held notes keep streaming; the drums (Space) push from the corners. Esc leaves.
- **Fluid venue:** fills the whole picture (mirrored like a kaleidoscope, over the song's own fret range), keeps flowing between notes, drifts through the colours, softer bloom; it follows your playing as well as the song.
- **Smart tuning:** Stagehand knows what your guitar and your bass are tuned to (set it on the Drop card, or it learns: finish a song well with the Drop off and that's your tuning). When a song is the same tuning but lower (D Standard on an E Standard guitar, Drop C on Drop D…), it offers the Drop (or does it always); otherwise it says which strings to retune and to what.
- **Duplicate songs:** Songs › ⋯ › **Find duplicate songs**: each song you have more than once, with what each copy has (audio, parts, version, DD, stems). It keeps the copy with audio, the most parts and the newest version (click another to keep that instead) and moves the others to Stagehand's backups, with Undo. Favourites, plays and setlists move to the copy kept. Stagehand always plays the full part, so DD and non-DD copies play the same.
- **Progress:** the song you just played shows straight away, with the highway's score; your **best** shows on the highway next to your accuracy, and as a small badge next to each song's title.
- The version shows after Stagehand in the title bar.

## Setlists (3.7: Rocksmith's song lists retired)

Stagehand is where you play now, so your lists live here as **setlists**: drag songs onto one, or right-click songs → **Add to setlist**; press **+** next to Setlists for a new one. Stagehand no longer edits Rocksmith's own Favorites and Song Lists. If you had lists in Rocksmith, **Bring over Rocksmith lists** under Setlists copies them all into setlists in one click (✕ hides the offer). Your Rocksmith profile is never changed.

## Note highway

Press **Highway** in the player (or **H**), or **double-click a song** (3.2.6), for the Rocksmith-style view, full screen. If the song hasn't been split into stems yet, it waits for them first and shows the progress (Settings › Stems › Wait for the stems; **Play now with the full mix** skips the wait). A correct note flashes the hand bracket without making it taller. **Back** or **Esc** goes to your songs; **Tab | Highway | Waveform** at the top switches to another view of the same song (T for Tab).

- **3.7:** each technique has its own look: a **bend** climbs and glows warmer with ↑ and how far on the note; **vibrato** snakes side to side in a smooth wave (~ on the note); **tremolo picking** is cut into quick bright stripes (/// on the note). A note held into a slide or bend (Rocksmith's linked notes, like the slides in Sugar) is **one note**: no second gem, and you're not asked to pick it twice. Venue pictures are sharper. New venue: **Fluid**, ink that the song itself plays: every note splashes its string's colour from its fret, chords burst, held notes stream (vibrato swings, bends climb, tremolo puffs), bars and beats push in from the corners, your hits flare white, and a hot streak warms it up. After stems are made, their conversion to FLAC runs in the background without reloading the song, so the highway stays smooth.

- **3.6.2:** everything on the highway is now drawn by the graphics card (the venue picture, every number and label, the sparks), with nothing repainted on the processor each frame, so it stays at your screen's full frame rate. The glow effect is gone. **Lyrics** show under the song's title and light up as they're sung, as in Rocksmith, and the coming **chord name** is small and sits just above the strings at your hand position. Both can be switched off in the options.
- **3.6.1:** smoother motion (the picture runs on its own steady clock locked to the song, so fast notes no longer judder), nothing else in Stagehand draws while the highway is open, brighter notes, **venue pictures** (Warehouse, Jazz club, Cellar, Opera house, Studio, Rooftop, Festival, Canyon, Astral, or Plain) lined up so the highway lies on their floor, a simpler **options panel**, and a **Sync check**: tap Space on the clicks you hear and Stagehand sets the note timing for you. **Frame rate** in the options shows how fast it's drawing and on which graphics card.
- **Section strip:** click a section to jump there; hover it and press ⟲ to repeat it. While a part repeats, the strip marks it and **Repeating … ✕** in the bottom bar stops it.
- **Real 3D (3.6).** The highway is a true 3D scene drawn by your graphics card (WebGL), with a real camera, depth and a soft glow, laid out against your own Rocksmith videos: notes travel at the game's pace (3 seconds of preview by default, 2–4 in the options), chord frames reach only as high as the strings the chord uses (so a G-B-e double-stop is a short box), and the hand position shows as two bright posts at the neck. On a slow or software-only graphics setup Stagehand lowers the 3D resolution by itself. Without WebGL it falls back to the 2D highway.
- **Built from real Rocksmith gameplay (3.3).** The layout, camera and notes were measured off recordings of Rocksmith 2014 and redrawn sharper. The neck is a thin see-through strip near the bottom: strings in Rocksmith's colours (**low E on top**), dark fret wires, inlay panels that glow gold inside your hand position, gold fret numbers for your hand position under the neck. Frets are nearly even in width, as in the game, so fret 20 is as easy to read as fret 3. The neck stands upright at the bottom, with the highway floor running from it up to a vanishing point; every fret's line runs off into the distance and your hand positions are dark blue channels with cyan edges that step across it. When a new hand position comes, its fret numbers are written across the floor where it starts.
- **Camera like the game.** It frames every hand position in the next few seconds: close in on one spot (about 11 frets across), pulled right back to show the whole neck when a part roams or a big jump is coming, panning across in between. It pulls back quickly and closes in gently.
- **Notes.** Each note is an upright glassy block in its string's colour riding in at its string's height (every string's notes land at the same instant), with a thin stem and its fret number in gold on the floor; nothing stops at the neck: notes and chord frames carry on through it toward you and fade, as in the game. Open strings are bars across the hand position. Chords are upright glowing glass frames standing across the hand position (the first with its notes inside, repeats just the box, so the strumming rhythm reads at a glance), with the chord's name large on the left; the fingering stays on the neck while you hold the shape. Sustains are ribbons that follow bends, slides and vibrato. Hammer-ons, pull-offs, palm mutes, harmonics, taps, slaps and pops are tagged on the note; accents get a white outline.
- **You can feel every note you hit.** Hit one and its string blazes along the whole neck, light posts stand at its fret, the note flares and sparks fly; hold a sustain and the string stays lit. Off the beat, a small EARLY or LATE shows. Miss it and nothing lights: the note carries on past the neck grey, and MISS shows. Without scoring, notes still land with a soft flash. Your streak heats the highway (8 in a row warms it, 40 is on fire); score sits at the top.
- **Note timing** in the options: if notes look early or late against the music on your speakers, nudge them 30–90 ms either way (scoring isn't affected).
- **Venues** in the options (Arena, Club, Neon, Studio), lit by the song's beat.
- **Section strip** across the top: click to jump to a section (1 s early); ⟲ on a section repeats it. ← / → skip 5 s, Space plays and pauses.
- **Mix** (or the MIX tab on the right edge) slides out the song mix, and collapses back to the edge: each stem with an on/off switch, a volume slider and solo (split stems from there if the song hasn't been split yet). practice speed runs 50–100%, and **Guitar on** mutes or unmutes your guitar; **Tone** picks the song's own tone or any tone, guitar or bass tones on either part. With your guitar on, Stagehand scores what you play; accuracy and streak show at the top. Turn scoring off in the options.

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

vgmstream (ISC), Demucs (MIT, Meta AI), uv (MIT/Apache-2.0), Electron (MIT), Archivo typeface (SIL OFL, Omnibus-Type). Artist and album data from MusicBrainz (CC0); covers from the Cover Art Archive. Rocksmith save-file format as documented by rsrtools (MIT) and Rocksmith2014.NET (MIT). The NAM engine is a C port of [NeuralAmpModelerCore](https://github.com/sdatkinson/NeuralAmpModelerCore) (MIT, Steven Atkinson). The Fluid venue uses Pavel Dobryakov's [WebGL Fluid Simulation](https://github.com/PavelDoGreat/WebGL-Fluid-Simulation) (MIT). Real amp captures are made by their creators and shared on [TONE3000](https://www.tone3000.com) (powered by TONE3000).
