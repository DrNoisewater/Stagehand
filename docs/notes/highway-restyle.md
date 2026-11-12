# Highway restyle + Drop pedal (working notes, 2026-11-12)

User asked (4.7.0 on GitHub; they call it 4.7.1):
1. Banner pictures reach up into the empty top-bar stretch again (both looks). -> helper "Banner fixer" (identity.js/css).
2. Image flicker at times. -> Banner fixer (banner art) + "Speed finder" (lists, tiles).
3. Speed up Discover, Progress, etc. -> Speed finder.
4. Drop on the highway: real DigiTech Drop photo (art/gear/full/digitech-drop.webp), round button works the
   footswitch, knob sets the amount, keep Match the song / Hold to drop / your tuning. Option to switch the look
   (photo pedal or the 4.5 console). Collapsible, nested in Sound & settings; opens by itself when in use;
   pops open on its own on the highway (without opening all of Sound & settings); can be closed.
5. Highway chrome (top bar, Tools, Sound & settings, cards) in the app's style. The 3D highway itself: untouched.
6. Tab view and Waveform view in the same style.

Decisions:
- Highway chrome style lives in its own file css/stagechrome.css (loaded last), scoped to the highway, tab and
  wave views only; no canvas/3D changes.
- Drop look pref: localStorage 'stagehand.dropLook' = 'pedal' (default) | 'console'.

Status: done in 4.8.0 (merged). See HANDOFF.md for what to ask the user.

Progress (me):
- Drop: dropui.js has pedalPhoto (controls laid over the photo), dropSection (the fold), the look switch.
  highway.js: fold in Sound & settings + .hw-droppop pop-out (× closes it until the Drop starts again).
- Highway chrome, pop-ups (Tools menu, speed, tone) and the Tab/Waveform page (np-*) restyled in
  stagechrome.css. Tab canvas (tab.js), ruler (stage.js) and wave.js colors moved from navy to warm.
- Dead end: the full-app screenshot run (ui3-chromium + SH_AUDIT) is slow here (~10-15 min per run);
  keep steps few. test/hwlook needed .mjs served as JS.
- npm test passes (drop.test.mjs updated for the fold/pop-out).
