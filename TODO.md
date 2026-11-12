# Stagehand TODO

Ideas and requests not built yet. Newest first.

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
