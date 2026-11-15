# The Lab: fourteen pedals

The Lab is the group of strange pedals (it was called Wacky in 4.19, with four pedals). Every pedal
works off the playing itself: no recordings and no song chart. The sound is in
`native/dsp/sh_wacky.h` (included only by `sh_fx.c`); ids are `Pedal_<Name>`. Each pedal sits before
the amp, works for guitar and bass (bass moves the voice and filter ranges down), and has its own
picture with every printed control working on it.

Every pedal also has **Mix** (how much effect against your own sound; 0 is the input exactly, checked
to the bit) and **Trim** (−18 to +6 dB) beside the picture. Footswitches and Boing's lever are played
live: they never go into a tone and never rebuild it, and they all let go when the window loses focus,
the app is hidden, the tone changes or the guitar goes away.

| Pedal | On the picture | What it does |
|---|---|---|
| Quack | Beak, Sens, Low/Band/High, ON, HONK | Envelope filter: a pick sweeps it open (300 Hz to 2.5 kHz) and it closes as the note dies. Honk (held) opens the mouth wide with more bite. |
| Croak | Throat, Hop, Depth slider, Low/High, ON | Two throat resonances that open with your picking and pulse at Hop; each new note restarts the pulse. |
| Gobble | Vowel (AH/OW/EE), Sens, Rate, Auto/Hold, ON | Three vowel resonances. Auto: the pick moves the mouth toward the vowel and Rate wobbles it, wider the harder you pick. Hold: the vowel stays put (Rate dims). |
| Slug | Rise and Tail faders, Sens, Single/Flow, ON | Volume swells: the attack is taken away, each note fades in over Rise and out over Tail once it has dropped to about a third of its peak. Flow keeps one swell through legato playing. |
| Blorp | Orbit, Wobble, the Mouth pad, Talk/Auto, ON | Two vowel resonances placed by the pad (across 250 Hz–1 kHz, up 800 Hz–3 kHz). Auto circles round the spot at Orbit (Orbit dims in Talk). Wobble: up to about ±50 cents, only while you play. |
| Boing | Interval (−12/+7/+12/+24), Rise, Fall, JUMP, Bend lever | Pitch jump on a footswitch, or by hand on the spring-back lever (the bigger wins). At rest it is your own sound exactly, with no delay. |
| Caterwaul | Meow, Purr, Hiss, Tail fader, Up/Down, ON | Each new note slides up (or down) by Meow semitones and back within Tail, through a nasal mouth gliding m-ee-ah-ow. Purr: a 25-a-second flutter. Hiss: noise that follows your playing only. |
| Gremlin | Bite, Glide, Sub/Root/Fifth sliders, ON | Synth fuzz from the note you play (one at a time): an octave below, the note, a fifth above. Chords and muted strings give it nothing to follow: it fades and your own sound stays. |
| Invader | BASS/LEAD/LASER/STEP buttons, Filter, Speed, Sync, ON, HOLD | Single-note synth. Speed is the filter sweep (Bass, Lead), the zap length (Laser) or steps a second (Step: 0, +7, +12, +7). Sync snaps Speed to the song's beat (or the drums'). Hold keeps the note. |
| Confetti | Pitch, Echo, Chaos slider, ON, BURST | Echoes shifted in pitch on every repeat. Chaos: more repeats (feedback 0.15–0.75) and a little drift. Burst (held) eases the feedback up to 0.88; the loop is filtered and rounded off every time round so it cannot run away. Follows the FX knob like the other echoes. |
| Blender | Mode (Chop/Reverse/Scatter), Size, Mix, ON, JAM | Slices Size long: Chop plays each twice, Reverse backwards, Scatter from anywhere in the last 1.5 s, slightly sharp or flat. Jam (held) stops listening and keeps chopping what it has. |
| Fossil | Fade, Level, Hold/Latch, CAPTURE | Capture freezes the last 0.6 s into a drone played by overlapping pieces from random places (no loop, no buzz), on top of your normal playing. Hold: while held. Latch: press, press again to let go. Nothing is saved. |
| Charmer | Key, Buzz, Drone, Min/Maj, ON (Shift beside it) | Sitar-like: a bright bridge buzz, a short metallic ring, and five drone strings tuned to Key (root, third, fifth, octave, octave and fifth) that ring only when your notes excite them. |
| Haunt | Low/Mid/High drawbars, Spin, Slow/Fast, ON | An organ-like blend (octave below, your note, octave above) through a spinning speaker. Slow/Fast is played live: it takes about 0.6 s to spin up or down. Mono before the rack, so the swirl is a throb and warble, not left and right. |

## Measured (native/build/wacky_test, Mix 100, 48 kHz)

How late the sound of a pick comes through, and the share of one core (desktop, 48 and 96 kHz):

| Pedal | Late | CPU 48k / 96k |
|---|---|---|
| Quack, Croak, Gobble, Blorp, Charmer | 2–5 ms (filter) | 2–3% / 3–5% |
| Caterwaul | 14–16 ms while it meows (pitch shifter) | 5% / 11–12% |
| Haunt | 10 ms guitar, 23 ms bass (the octave voices) | 6% / 18–20% |
| Boing, Confetti, Fossil | 0 (Boing at rest is your sound; Confetti and Fossil add on top) | ≤ 2% / ≤ 6% |
| Gremlin, Invader | about 36–39 ms guitar, 72–79 ms bass to find the note | 2% / 3–4% |
| Slug | about 90 ms by nature (the swell) | under 1% |
| Blender | about Size (90 ms) by nature | under 0.1% |

At the default Mix your own sound carries the attack for the synths and the shifters.

## Live controls

`SHP_WK_HOLD` (a bit per pedal, held footswitches), `SHP_WK_LEVER` (Boing, 0..1), `SHP_WK_LATCH`
(Haunt's Slow/Fast), `SHP_TEMPO` (beats a minute). In the app: `rig.live(name, v)`
(`labHold`, `labLever`, `labLatch`, `tempo`); `src/renderer/js/lablive.js` handles holding and
letting go; `labLatch(tone)` in `gearspec.js` reads Haunt's switch from the tone, and `toSpec`
leaves it out so it never rebuilds. Pedal numbers: `LAB_BITS` in `gearspec.js`, the same as the
enum in `sh_wacky.h`.

While the engine measures a tone's loudness it plays the Lab pedals dry (`sh_block.meas`), so a
swell or a synth doesn't throw off the level match. The synths follow the clean input to the whole
chain (`sh_block.in0`), not the sound after earlier pedals.

## Picture controls

`tools/gear/audit.json` holds every control's place on each picture (`knobs`, `stops` for selectors'
printed positions, `sliders`, `hsliders`, `switches` and the `marks` of their printed words,
`stomps`, `leds`, `pad`, `buttons`, `lever`); `python3 tools/gear/build_photos.py` writes
`gear-photos.js`. The pictures are `art/gear/full/Pedal_*.avif` and `thumb/Pedal_*.webp`, cropped to
the pedal.

## Limits

- Changing a saved control rebuilds the tone (a 30 ms crossfade, as for all gear): Fossil's drone,
  Confetti's echoes and Blender's slices start empty again. Footswitches, the lever and Haunt's
  Slow/Fast don't.
- Gremlin and Invader follow one note at a time; fast runs and very low bass notes are followed a
  little late.
- Time-domain pitch shifting (Boing, Caterwaul, Confetti, Haunt) warbles a little on dense chords.
- Nobody has heard them yet: everything was checked on made-up playing and measurements.

## Tests

- `node test/wacky-pedals.cjs` (in `npm test`): every pedal through the WebAssembly engine, guitar
  and bass at 44.1/48/96 kHz, silence, Mix 0, tails, every control audible, and each brief's own
  checks (pitches, swells, sync, freeze steadiness, drone tuning, spin-up…). `--wav <dir>` writes clips.
- `native/build/wacky_test` after `bash native/build.sh`: block sizes 16 and 1024, DC, peaks, CPU, delay.
- `node test/gear-controls.test.mjs` (in `npm test`): selectors, faders, switches and buttons on the picture.
- `SH_AUDIT=test/e2e/wacky-audit.js node test/e2e/ui3-chromium.js native/build/stagehand-audio-fake <outDir>`:
  all fourteen on the real page (150 checks), writes `lab-*.png`.
