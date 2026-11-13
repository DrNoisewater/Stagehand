# Stagehand TODO

Ideas and requests not built yet. Newest first.

## Sing along: what's left (the first version shipped in 4.12.0, see HANDOFF.md)

- The lane on the Tab view and Now playing (it is on the highway only).
- Karaoke (also 4.12.0, its own page on the left): a party list of songs to sing in a row, taking turns: only if asked.
- Tune it after the user has sung: the levels, the microphone's delay, notes read off real vocals stems.
- The voice through Stagehand (hearing yourself, the voice in clips), duets: only if asked.

The notes below are the 2026-11-12 write-up, kept for the reasoning.

## Sing along, as an add-on: vocals for you or a second player (asked 2026-11-12; built in 4.12.0)

**Can it be done? Yes.** What's already there and what it would take:

- **The words and their timing are already read** (`tabs.js` gives the highway its lyrics from each song's
  vocals part: time, length, syllable). The vocals part also carries a **pitch per syllable** (`sng.js`
  `vocals[].note`, a MIDI note), which Stagehand reads and currently throws away. Official songs have real
  pitches there; many custom songs leave it empty (254 or 0).
- **Where the chart has no pitches, take them from the audio:** split the stems (Stagehand already does), run
  the **vocals stem** through the pitch tracker (`pitch.js`, YIN) offline, and snap the result to each
  syllable's time span. That is "tracking based off the audio". Quality depends on the split (backing vocals
  and reverb blur it), so charted pitches win when present.
- **A second microphone works.** The Rocksmith cable is just one sound-input device; a USB mic, headset or
  webcam mic is another, and Windows lets both be open at once. The sound engine holds the *output*
  exclusively, which doesn't stop a second *input*. Two ways:
  1. the page listens to the mic itself (`getUserMedia`, shared mode): no engine change, fine for scoring;
     you wouldn't hear your voice through Stagehand (most singers don't want that in a room anyway);
  2. the engine opens a second capture device and mixes the voice in (with reverb, volume): needed only if
     the voice should come out of the speakers/headphones or go into recorded clips. More work
     (`io_wasapi.c`: a second capture stream on its own clock, drift handled like the guitar's).
  The guitar cable can't be the mic at the same time as the guitar; a second Real Tone Cable with a mic
  adapter would show up as a second input like any other.
- **Scoring:** pitch only has to be right relative to the octave (people sing in their own octave), judged
  over the time each syllable lasts. Easy: within about 2 semitones, half the syllable; Medium: 1 semitone,
  two thirds; Hard: half a semitone and on time, plus held notes scored for how steady they are. Talky/rap
  lines (no pitch) score on timing/any voice heard.
- **Where it shows:** its own lane (a strip above or below the highway with the words and pitch bars and
  a line for your voice), never on the highway's neck: the highway stays as it is. A second player just
  needs the mic picked in Settings › Guitar & audio and "Vocals" switched on for the song.
- **Progress/levels:** a vocals accuracy per song, XP like a guitar part, its own bests.

**The build plan is in `docs/vocals-handoff.md`** (one session to build, one to tune).

Suggested order: (1) keep the charted pitches and show the vocal lane with pitch bars; (2) mic input in the
page + scoring + difficulties; (3) pitches from the vocals stem for songs without them; (4) voice through
the engine (monitoring, clips) if wanted. Each is about a session.

Ask the user: one singer or duets too? Should the voice be heard through Stagehand? Which mic do they have?

## Guitar riff sounds for events (asked 2026-11-11, with the 4.9 art)

Short guitar riffs (about 1–3 s) that play at the moments the 4.9 cameos mark, in the Guitar Hero spirit:

- Level up (a rising lick), milestone levels (a bigger power-chord hit), level 100 (a full flourish)
- Achievement / trophy unlocked
- End of a song: new best (a victory riff), good run, okay run, rough run (a sad trombone on guitar, a dive bomb)
- Tuning check: every string in tune (a big open chord in the new tuning)
- Timing check result
- A tone saved in Create a Tone (the inspection sticker)
- Stems ready, update ready

Notes for whoever builds it:
- Play them through `engine.extraOut()` (the bus that reaches the native engine, like the drums and demos),
  never while a song is playing or the guitar is mid-take, and never over the highway during a song.
- Nice touch: render the riff through the tone you have on (`render.js` already plays demo riffs through
  a tone with the Karplus-Strong guitar), so the level-up riff sounds like your rig.
- A Settings › Appearance switch "Riffs for big moments" (on by default?) and a volume; off with Calmer interface?
  Ask the user.
- Keep them short and few: the same riff every time gets old; 2–3 variations per event.
