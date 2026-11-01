# Stagehand 3.11 — unified Jam

Close Stagehand, then run Stagehand-Setup-3.11.0.exe. Your library and saved
custom tones remain in place. The old slot-1 tone stays in the tone library,
without a numbered assignment; slot 1 is now permanently reserved.

## Playing
- Jam replaces Play as the home dashboard. It does not open into a visualizer.
- Drums and Looper sit below Rig; Tuner and Drop remain alongside it. Guitar
  Ready is compact, with device details available on hover/focus.
- Open visualizer (or J) enters the fullscreen view. Back / Esc returns.
- Tones, Rig, Tuner, Drop, Drums and Looper open in a compact visualizer drawer.
  These are the same controls and audio instances as on the dashboard.
- Optional auto-visualizer starts after 60 seconds of playing; off by default.
- Record video remains MP4 with instrument and audible backing audio.

## Sound and timing
- Loops now record the already-processed stereo guitar. No offline tone
  recreation, second amp/cab pass, or forced minimum volume is applied.
- Overdub adds one pass at the loop boundary. A linear level reduction is used
  only if the combined layers exceed digital headroom.
- Drum-locked loops retain their original tempo to preserve pitch. Clear the
  loop before changing tempo. Free loops retain their recorded duration.
- 17 accompaniment choices: Click, Rock, Shuffle, Metal, Half-time, Funk,
  Disco, Soul, Reggae, Punk, Blues shuffle, Jazz ride, Bossa, Hip-hop,
  Drum & bass, Pop and Train beat. New open-hat, rim and ghost-note sounds.
- Hold +/- for repeated tempo changes, accelerating after a short hold.
- A correctly matched expected note stays matched even if another note follows.
  Extra notes do not create extra missed targets. Wrong-only playing still misses.
- Note-hit sparks and string flashes are substantially reduced.
- Playback updates retain the same album-art element.

## Tone keys
- 1: Automatic Song Tone. Follows the loaded arrangement's default tone and
  section changes at the current playback position, including after seeks.
- 2–9: saved tones. A manual selection stays active until you return to 1.
- Number-row and keypad keys work across playing screens, except while typing
  or interacting with a modal. Top-right notices confirm the tone or empty slot.
- Slot 1 cannot be assigned, overwritten or deleted. Automatic rig controls
  are read-only; choose another slot to edit your own tone.

## Visuals
The existing fluid and GPU scenes now respond more strongly to live output,
pitch, spectral bands and attacks, with more baseline motion and layered light.
The post-fader audio bus respects mute/solo and also responds to drums and loops.

## Focused validation
Checked: reserved-slot migration and protection, current-position automatic /
manual / return tone switching, expected-note scoring with and without an extra
note, wrong-note rejection, exact stereo sample preservation, native processed
loop capture/playback, shared controls, held tempo adjustment, stable artwork,
startup and shader rendering. Screenshots are from the running application.

Windows device latency, subjective live-versus-loop fidelity, long-session
stability and NVENC performance still need a real Windows hardware session.
No full regression suite was run, per the request to keep validation focused.
