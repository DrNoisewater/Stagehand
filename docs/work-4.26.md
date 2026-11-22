# 4.26 work notes (in progress)

The user's asks (2026-11-22, after 4.25.0), and who builds what. Keep this up to date; it survives a new session.

## Asks
1. **Major bug**: the finder searches, "sees" a song is unavailable, skips, searches the next, over and over.
   Cause (found): after a search with no results the page says "No matching CDLC"; the next search's reader
   sees that old page before the new results load (empty + steady for 600 ms counts as settled), so every
   following song is marked Not available and the run moves on, in a chain. → helper "Finder fixer".
2. In the finder: recognise a song isn't listed, mark it Not available by itself AND by hand (a button). → "Finder fixer" (bar), "Discover redesigner" (page side).
3. Collection gaps must work with Wanted: search a gap, start collecting. Adding to Wanted → Open Wanted → Get songs
   is confusing: simplify and redesign. → "Discover redesigner".
4. The Lab: footswitches you must hold can't be held while playing: make them toggles. (Later: the tone setup in a
   menu on the highway, to adjust on the fly.) → "Pedal fixer".
5. The fold with the pedal's info sits just under the visible area: make it visible / better; pedal art is key. → "Pedal fixer".
6. Official DLC: no per-song requests, no picking files. Show them all, ONE request for all of them (Noisewater Labs
   sends every file). Facelift: hard to tell songs from artists. → "Discover redesigner".
7. Mouse cursor hides after a few seconds still on the highway. → "Highway helper".
8. A preview of a song when you click it in the Songs list. → "Songs helper".
9. Can't change tones while the Settings menu is open. → "Highway helper".
10. Capo: "Requires capo · Capo on 2nd fret". → "Songs helper".
11. Search bar: typing a tuning (e flat, d standard…) shows a smart card for that tuning; click → songs in it. → "Songs helper".
12. A new animation for where Discover reads MusicBrainz (artist and song shown live). The animation file did NOT
    come through (only a screenshot): build the spot with a stand-in, ask the user to resend. → "Discover redesigner".
13. Facelift for all Discover pages. → "Discover redesigner".

14. (later) Arrow keys move the song only on highway/waveform/tab view; on pedals they navigate. → lead.

## Status
- helpers started 2026-11-22, each in its own worktree branch; merged into claude/clever-volta-zpv64h by the lead.
- [x] all five merged (Highway helper, Songs helper, Finder fixer, Pedal fixer, Discover redesigner) + arrows (lead).
- [x] README, HANDOFF, version 4.26.0. Not released (waiting for the user).
