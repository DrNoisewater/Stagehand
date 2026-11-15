# The Lab: forty-four pedals

The Lab is the group of strange pedals (it was called Wacky in 4.19, with four pedals; fourteen in
4.19.0; forty-four in 4.20.0). Every pedal works off the playing itself: no recordings and no song
chart. The sound is in `native/dsp/sh_wacky.h` (the first fourteen) and `sh_labcore.h` +
`sh_lab1.h`/`sh_lab2.h`/`sh_lab3.h` (the thirty that followed), all included only by `sh_fx.c`; ids
are `Pedal_<Name>`. Each pedal works for guitar and bass (bass moves the voice and filter ranges down)
and has its own picture with every printed control working on it. Echoes and rooms go after the amp
when added; the rest in front of it.

Seven of the 37 pedals in the second pack (Ghost Trap, Bedrock, Obelisk, Slifer, Ra, Exodia,
Infinity) were left out on purpose: their pictures carry other companies' logos and characters. The
user chose to skip them for now.

## The sections

The Lab is shelved in seven little sections (`sec` on each pedal in `gear2014.json`, labels in
`LAB_SECTIONS`, `gearbench.js`), on the Gear page, in Create a tone and in step by step's Pedals:

| Section | Pedals |
|---|---|
| Voices and mouths | Quack, Croak, Gobble, Blorp, Caterwaul, Who Are You, Mimic |
| Synths and monsters | Gremlin, Invader, Parasite, Fenrir, Olympus, Wukong |
| Pitch and harmony | Boing, Charmer, Haunt, Veles, Long, Kukulkan |
| Echoes and loops | Confetti, Ouroboros, Molt, Event Horizon, Janus, Kitsune, Shango, Seance, Deja Vu |
| Freezes, slices and slowdowns | Fossil, Blender, Apoptosis, Annwn, Maui |
| Rooms and skies | Reliquary, Bifrost, Blue Prince, Duat, Inanna, Tezcatl |
| Rhythm and shape | Slug, Claude, Nataraja, Severed, Nothing |

## The first fourteen (4.19.0)

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

## The thirty that followed (4.20.0)

Footswitch kinds: **held** (plays while down), **press** (acts once on the press), **lit** (stays on
until pressed again). Every one has Trim beside the picture; Mix too where it means "how much effect"
(pedals with their own balance control use that instead).

| Pedal | On the picture | What it does |
|---|---|---|
| Annwn | Mist/Hound/Hollow buttons, the Veil pad (round), Return, CROSS (held) | Grains from the last two seconds: across the Veil is how far back they reach, up how far their pitch scatters. Cross freezes the recording. |
| Apoptosis | Body/Bone/Dust/Air sliders, Lifespan, Fall/Bloom, RELEASE (press) | Release captures the last moment as a drone in four bands, each living its slider's share of Lifespan (Fall: dies away; Bloom: grows, then fades). On top of your playing. |
| Bifrost | Realm, Frost, Rift slider, Midgard/Helheim, CROSS (held) | Shimmer reverb (climbs an octave each time round) against a dark ambience (an octave down on Helheim). Cross swings the rift over. |
| Blue Prince | Depth, Study/Hall/Cellar buttons, Steps slider, DRAFT (held), ENTER (on) | Three reverb rooms; the sound walks between them over Steps. The room is played live (no rebuild). Draft walks to the next room. |
| Claude | HEAR/SHAPE/REPEAT (lit) and CLEAR (press) buttons, Context, RECALL (press) | Learns a phrase's loudness over time (200 a second, up to Context) and puts later phrases through it, once (Shape) or round and round (Repeat). |
| Deja Vu | 1/2/4/8 beat buttons, Real/Sim, Fracture fader, ENTER (press), REPEAT (lit) | Enter catches the last beats (song tempo, or 120); Repeat loops them in sixteenths with glitches (again, backwards, half speed, skipped). Sim is crunchy. |
| Duat | Balance beam, Gate I–IV sliders, Passage selector, DESCEND (held) | Four reverbs: a room, a hall, the hall an octave down, two octaves down and very long. Descend plays only the one Passage points to. |
| Event Horizon | Time, Redshift, the Gravity pad (round), COLLAPSE (held) | Echoes stretched by grains and dropped by Redshift each time round. Collapse: more pull, twice the drop. |
| Fenrir | Bite, Growl, Howl, Restrain wheel, Bind fader, CHAIN (on), BREAK (held) | Fuzz with an octave-down growl and a gate; Break raises the pitch by Howl. |
| Inanna | Seven band sliders I–VII, Star/Earth/Both, Descent, RETURN (held), Echoes beside | Seven bands that add up exactly to your sound; Descent removes them from the top; echoes of the bright or dark side. |
| Janus | Reverse, Age, Fade, Delay and Repeats sliders, Crossing fader, THRESHOLD (lit) | Backwards pieces (the past, aged) against a plain echo (the future); Threshold swaps them. |
| Kitsune | Nine tail buttons, Mask, Drift fader, TRICK (press) | Up to nine copies 40–340 ms behind, gently detuned, through a vowel; Trick turns the pattern. |
| Kukulkan | Six step sliders (−12..+12), Wind, 1/4 1/8 1/16 buttons, RISE (lit) | A six-step pitch sequence on the song's beat; Wind feeds each step into the next. |
| Long | Breath ribbon, Wind, Rain, Thunder, Cloud, Pearl, ASCEND (held) | Singing filter, vibrato, echo, octave below, reverb and a second voice (double, fifth, octave). Ascend: up an octave. |
| Maui | Sun I–V buttons, Tide and Horizon faders, Drag hook (lever), HAUL (held) | Tape slow-down to the Sun's speed over Horizon (pitch drops with it); let go and it speeds up and catches up. Drag does it by hand. |
| Mimic | CATCH/CLEAR (press) buttons, Inherit, Rhythm/Tone/Both, LISTEN (held), SPEAK (lit) | Learns a phrase's loudness and colour (8 bands, 100 a second, up to 4 s) and puts them on your playing, looped. |
| Molt | Age and Shed sliders, Decay, Up/Down, ON | Echoes that thin and drift a few cents sharp or flat each time round. |
| Nataraja | Eight step buttons round the wheel, Tempo, Create/Hold/Change/Rest sliders, DANCE (lit), RESET (press) | An eight-step gate with a filter that opens on each step. Off, your sound passes as it is. |
| Nothing | — | Does nothing. Your sound passes exactly. |
| Olympus | Thunder lever, Sky, Storm, Echo, Cloud fader, STRIKE (held), HOLD (lit) | Octave fuzz with throb, echo and reverb; Hold freezes the reverb tail. |
| Ouroboros | Digest, Acid and Memory sliders, Shed/Devour, WAKE (on), SWALLOW (held) | An echo filtered, burned and moved 2 semitones each time round; Swallow keeps it going (bounded). |
| Parasite | Host and Creature sliders, Hunger, Voice selector, Tame/Feral, FEED (held) | A synth on your note (or a fifth or octave up) that grows the longer a note rings. One note at a time. |
| Reliquary | Choir and Dust sliders, Incense censer, AMEN (on) | A cathedral (1.5–9 s) with a choir an octave and a fifth above. |
| Seance | Memory selector (1/2/4/8 s), Distance, Decay, Reverse fader, LISTEN (lit), SUMMON (press) | When you stop, your last phrase answers back from far away, sometimes backwards, fading; quiet while you play. |
| Severed | Memory, WORK/HOME buttons, Innie/Outie fader, the footswitch (lit) with OVERTIME | Two set sounds (tight and bright with a slap; warm with chorus and a room); the footswitch swaps, Innie/Outie lets the other leak in. |
| Shango | Fire, Tone, Length, Delay, Pitch, Repeats, Balance fader, CALL (held), ANSWER (press) | Catches a call while held, sends it back on Answer after Delay, moved by Pitch, repeating. |
| Tezcatl | Smoke, Shadow, Ash, the Mirror pad (round), four arrows, REVEAL (on), VANISH (held) | A frequency shifter (±600 Hz, none in the middle) with grains, a filter and grit; the arrows move it by themselves (press the lit one to stop). |
| Veles | Root/Earth/Dream/Night drawbars, Wander, Still/Drift/Turn, UNDERWORLD (lit) | Four voices (octave below, yours, fifth, octave above) that stay, drift or take turns; Underworld becomes a drone. |
| Who Are You | Size and Smoke mushrooms, Wonder slider, Grow/Shrink, WHO? (on) | Vowels that wander and notes that sink (Grow) or float up (Shrink) as you hold them. |
| Wukong | Ruyi staff (lever), five clone buttons, Defiance, Cloud, Earth/Heaven/Havoc, AWAKEN (on), UPROAR (held) | Raised pitch, octave fuzz and up to five delayed clones in other voices; Uproar brings them all in. |

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

The thirty that followed: most take 0.1–3% of a core at 48 kHz (up to 6% at 96 kHz). The heaviest
are Duat (6% / 18%, four reverbs and two octave shifters), Wukong (5% / 14%), Reliquary (4% / 13%),
Veles (4% / 16%) and Bifrost (3% / 11%), in line with Haunt. Annwn (about 0.5 s), Janus (the past
face) and Bifrost/Reliquary (the reverb's wait) come late by nature; the rest within 0–11 ms.

## Live controls

`SHP_WK_HOLD` (a bit per pedal, held footswitches), `SHP_WK_LEVER` (Boing, 0..1), `SHP_WK_LATCH`
(Haunt's Slow/Fast), `SHP_TEMPO` (beats a minute). In the app: `rig.live(name, v)`
(`labHold`, `labLever`, `labLatch`, `tempo`); `src/renderer/js/lablive.js` handles holding and
letting go; `labLatch(tone)` in `gearspec.js` reads Haunt's switch from the tone, and `toSpec`
leaves it out so it never rebuilds. Pedal numbers: `LAB_BITS` in `gearspec.js`, the same as the
enum in `sh_wacky.h`.

The thirty that followed (pedal numbers 15–44, `LAB_KINDS` in `gearspec.js`) each have two slots of
their own: `SHP_LABW0 + n` (their footswitches and buttons, one bit each in the order of the pedal's
`m` list: `[name, 'hold'|'tap'|'latch'|'lever', bit]`) and `SHP_LABV0 + n` (one live value: Maui's
Drag, or Blue Prince's Room, saved in the tone with `live: 'val'` and left out of the spec). In the
engine `lab_on(c, bit)` is a bit that is down, `lab_tap(c, bit)` a press (counted once per block).
In the app: `rig.labWord(n, bits)`, `rig.labVal(n, v)`; a new or changed tone keeps a lit button lit
while its pedal stays and lets held ones go; `rig.labLetGo()` (focus lost) lets held ones and levers
go but keeps lit ones. What a pedal has recorded (Deja Vu's loop, Claude's shape, Seance's memory…)
lives only while that tone plays: turning a saved knob rebuilds the tone and starts it empty.

While the engine measures a tone's loudness it plays the Lab pedals dry (`sh_block.meas`), so a
swell or a synth doesn't throw off the level match. The synths follow the clean input to the whole
chain (`sh_block.in0`), not the sound after earlier pedals.

## Picture controls

`tools/gear/audit.json` holds every control's place on each picture (`knobs`, `stops` for selectors'
printed positions, `sliders`, `hsliders`, `switches` and the `marks` of their printed words,
`stomps`, `leds`, `pad`, `buttons`, `lever`; 4.20.0 adds `toggles` (buttons that each turn one
control on and off), `fills`/`hfills` (a saved lever or ribbon that glows to its setting), knobs with
`'still'` (a mushroom, a wheel, a censer: a ring of light instead of a turning face), a `'round'` pad,
stomps with `'button'` (buttons printed on the pedal that act like footswitches), `buttons` with a
`null` place and `unpick` (Tezcatl: press the lit arrow again to stop), and sliders whose clear-slot
value is `{fill, slot, sw}` (no clear slot left on the photo: the slot is painted));
`python3 tools/gear/build_photos.py` writes
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
- 4.20.0: what the thirty record (loops, shapes, captures) is lost when a saved knob changes. Parasite
  and Shango's pitch follow one note at a time. Tezcatl's arrows only sweep the mirror's pitch and mix.

## Tests

- `node test/wacky-pedals.cjs` (in `npm test`): every pedal through the WebAssembly engine, guitar
  and bass at 44.1/48/96 kHz, silence, Mix 0, tails, every control audible, and each brief's own
  checks (pitches, swells, sync, freeze steadiness, drone tuning, spin-up…). `--wav <dir>` writes clips.
- `native/build/wacky_test` after `bash native/build.sh`: block sizes 16 and 1024, DC, peaks, CPU, delay.
- `node test/gear-controls.test.mjs` (in `npm test`): selectors, faders, switches and buttons on the picture.
- `SH_AUDIT=test/e2e/wacky-audit.js node test/e2e/ui3-chromium.js native/build/stagehand-audio-fake <outDir>`:
  all forty-four on the real page, writes `lab-*.png`.
- 4.20.0: `PLAY` in `wacky-pedals.cjs` says how each of the thirty is played in the shared checks
  (which footswitches are down when); each has its own checks at the end of the file.
