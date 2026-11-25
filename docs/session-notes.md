# Session notes (4.29.0 → next), started 2026-11-23

Asked: preview sometimes silent or choppy; highway flicker after a split and when Settings opens;
the Drop button hard to spot on the retune card; does Stagehand fully close and start the sound engine fresh;
video mockups of a 2035 / Unreal-style highway (mockups only, the app's highway unchanged).

Helpers, each in its own worktree, merged here after checking:
- Preview fixer (Opus): preview.js / library.js / file server.
- Flicker hunter (Opus): highway*.js, stage.js, flicker-audit.js.
- Drop button fixer (Sonnet): tuning-check.js + its CSS.
- Shutdown checker (Sonnet): read-only report on quitting and the engine at start.
- Highway designer (Opus): test/visuals/highway-2035/ mockups; videos in the scratchpad, not committed.

Status: all five merged here (plus Shutdown fixer, Sonnet). Full npm test run at the end; drop.test.mjs needed its stand-in page to know `after()` and button words in pieces. Waiting on the user: try on the PC, pick a highway look.

## Highway looks and graphics settings (Highway builder, Opus; 2026-11-24)

Asked: build the highway looks for real (Studio first and marked New, Classic the default and unchanged, Chrome & glass and Neon depth toned down, two or three more "2035, clean, not too bright"), each look with its own settings and a Reset, plus a PC-game-style Graphics menu.

Decisions and why:
- `hwlooks.js` (no page code, tested in Node) holds the looks, the stored settings (`stagehand.hwlook.v1`) and `resolveLook()`; `hwlooks-pane.js` is the one block used in both places (the highway's Sound & settings, folded under "Look"; Settings › Display › Highway look and graphics).
- A look changes colours, light and after-effects only. Geometry code is untouched; the floor/lane colours come from a palette (Classic's palette is the old hex values, value for value), the glow layer's soft lights go to a separate "soft" layer so Glow can scale them. Shine on matte notes is drawn at 0 alpha rather than skipped, so every look draws the same quads.
- Classic is pixel-identical to before (T:17.2 and T:19.1 compared with the base commit: 0 differing pixels). It has no after-effects, so it costs what it always did.
- Mirror floor: the same geometry drawn a second time, flipped in the vertex shader (no extra render target). Bloom (three's UnrealBloomPass), FXAA, distance blur, vignette and grain run in the same frame, only when on; labels are drawn after them in their own scene, so nothing blurs or blooms a fret number. No frame of delay is added anywhere.
- Auto keeps the old sharpness steps (set before a frame is drawn) but first gives up mirror floor, then bloom size, then bloom and shadows (`budgetDrop`). Manual sharpness switches Auto off for sharpness only.
- Frame rate cap only skips drawing; the song clock, listening and scoring still run every frame.
- Left out on purpose: motion blur and temporal AA (smear notes), SMAA (FXAA and MSAA cover it), SSAO and shadow maps (nothing on a flat highway to gain), anisotropic filtering (no textures on the highway that need it). V-sync is always on in Electron.
- The old "Reflections" switch in the highway panel is gone; its "off" carries over to Classic's reflections.
- New looks: Studio, Road case (Stagehand's own: boards and gaffer-tape gold), Chrome & glass, Neon depth, Midnight, Clear view.

- Note finishes (second pass, after the coordinator saw the looks read as recolours): the notes keep their shape, size and place, but their faces, edges and rims are lit differently per look: Classic (as always), Satin (Studio, Midnight: smooth solid colour, soft edges, no light bar), Glass (Chrome: tinted glass in a chrome rim), Neon (dark inside, bright outline), Painted (Road case: worn paint, a strip of gold tape), Flat (Clear view: one colour, white outline). Same quads in every finish (the shine is drawn at 0 rather than skipped) so the accuracy check still compares point for point. The old "Matte" setting reads as Satin.
- Auto on a very slow graphics card (this container's software one: ~1 s a picture with bloom and the mirror floor): it used to count each slow picture as at most 100 ms and ignore the first 10, so dropping effects took ~12 s a step and the timing check failed on Studio (5 of 21 hits). While a look still has effects to give up, Auto now goes by the real wait (up to 250 ms a picture, slow pictures ignored for at most 1.5 s); with nothing left to give up (Classic) it behaves exactly as before, so Classic's stills stay pixel-identical.

Checks: `node --test test/hwlooks.test.mjs` (in npm test); `THEMES=1 … shoot.js` checks every look against Classic (points, labels and label sizes, limit 1 px; all 0.000) and writes `themes-sheet.png`; `HWTHEME=<look>` works in `shoot.js` and `ui3-chromium.js`.

Unknown until the user's PC: how the looks feel on a real screen, and what bloom and the mirror floor cost on a real graphics card (here only a slow software one).

# Session notes (4.30.0 → 4.31), started 2026-11-24

Asked: the highway looks all look alike, so overhaul that screen; venues and moving backgrounds should work with any highway style; too much in the graphics menus, clean it up; do the settings actually change anything; a click on a song still sometimes plays no preview (use the preview inside the psarc).

Helpers (each in its own worktree, merged here after checking):
- Preview fixer (Opus): why a click is sometimes silent; preview files only.
- Settings checker (Sonnet): GFXCHECK=1 in test/hwlook/shoot.js, measures what each setting changes on screen.
- Highway builder (Opus): styles apart from backgrounds, distinct styles, short drawer, full Settings › Display section.

- Background artist (Opus): about five new music-reactive moving backgrounds, higher quality than Mandala (visuals.js), asked mid-session.

Preview fixer: merged (420da1c). The psarc's own clip was already used; silences came from songs with no clip not yet opened, a failed decode with no retry, clips the scan missed (unnamed bank, clip inside the bank), a click ignored while a song plays, the engine's backup route only on during songs, hidden errors and a speaker output that never woke. test/preview.test.js (npm test), preview-electron.js extended.

Nearby-song preview preparation removed at the user's word (people click around and scroll, not down the list).

Settings checker: merged (1df8ab1). GFXCHECK=1 in shoot.js (C:7.0, ~20 min, alone). Brightness, glow, room, sharpness, edge smoothing and Low change the picture; fog, reflections, note finishes, sparks, shadows, distance blur, vignette, grain, half bloom, Medium vs High and 8x smoothing barely do (<0.5% of pixels). Classic, Chrome, Neon and Clear share the dark-blue room (7-11/255 apart). Findings sent to Highway builder: make each kept setting visible, drop the ones that can't be.

User then: fewer graphics options, more unique styles to pick from. Sent to Highway builder: graphics = quality presets (+ frame rate cap and counter), style tweaks at most brightness and one effects level; aim for 12-15 distinct styles.

Background artist: merged (82c578c). Five new scenes in src/renderer/js/scenes/hq.js, listed through SCENES: Liquid chrome, Light tunnel, Sunset drive, Northern lights, Light show. Calmer with reduced motion, drawn at 70-85% size. Not tried on a real graphics card (Sunset drive the costliest). Not in the Progress venue list.

Highway builder: merged (3674ad3). See its section below.

Then: Style polisher (Opus) gave the six look-alikes their own floors and made Effects visible; Check updater (Sonnet) rewrote GFXCHECK for the 4.31 settings; Preset fixer (Sonnet) made Medium draw at 85% and fixed the check's contact-sheet crash.

Status: done and checked (GFXCHECK, npm test, ui3 all passed). Waiting on the user to merge and release 4.31.0.

## 4.31 highway styles overhaul (Highway builder, 2026-11-24)

User: "The options look similar … Venues and bg animations should be able to be used with changing highway style. Menu overload … Do the different settings actually apply?"

Decisions and why:
- Style and background are separate. `looks.bg` is 'own' (the style's room) or 'venue' (the venue in Sound & settings, with its per-song rotation unchanged). Old saves: the per-style "back" of the style in use becomes `bg`; with none, Classic gets 'venue' and other styles 'own', so nobody sees a change. The old "Sparks" switch becomes Hit effect: None.
- After-effects over moving backgrounds: the scene's alpha is now kept through the post chain (bloom blends with dst alpha kept, the final pass outputs the texture's alpha, vignette darkens through alpha, grain scaled by alpha). No extra frame: it is the same single pass. So bloom, vignette, grain and distance blur work over Fluid and the scenes; the 4.30 rule that switched them off is gone.
- Each style has a `sig` (floor pattern, rails, light pool, beat, slow movement) and a hit effect, drawn by `hwstyle.js` only on the floor, soft and the new `fx` layer, never on solid/alpha/glow or text, so THEMES=1 stays at 0.000 px. Classic's tube rails stay in highway.js untouched; Classic is pixel-identical to 4.30.0 (T:17.2 and T:19.1 compared, difference 0). Sky patterns (stars, the striped sun, haze beams, embers, blueprint paper, cracks, gloss) are in the backdrop shader.
- New styles: Synthwave, Arena, Ember, Blueprint (only these four marked New). Movement in the room is gated by a new graphics option "Style effects" (Low = Simple), the per-style switch, and calm motion for hit effects.
- Menus: the drawer has style picture tiles, a Background fold (Style's room first, then every entry of VENUES, so new scenes appear by themselves), one Graphics quality row, "More highway settings" (opens Settings › Display scrolled to Highway: `settings('display', 'highway')`), and switches grouped Show / Effects / Scoring. The frame rate switch is only in Settings › Display › Advanced.
- Settings › Display › Highway: a big picture of the style, a gallery with one line each, Background, a "Fine-tune <style>" fold, presets and an Advanced fold.
- No live preview: it would need a second WebGL context in Settings (risky on weak cards). The pictures are rendered from the real highway (`HWBG=own THEMES=1 shoot.js T:17.2`, cropped with PIL) into `src/renderer/art/hwstyles/<id>.webp` (192×108, under 8 KB, packed in Setup) and `<id>-big.webp` (768×432, ~20 KB, downloaded through art-files.txt like other art).
- Moved out of the UI (was "Left out on purpose"): motion blur and temporal smoothing (they smear moving notes), ambient occlusion, shadow maps and texture filtering (nothing on the highway they would improve). V-sync is always on. None of the settings adds delay.

Checks: `node --test test/hwlooks.test.mjs` (new: signatures, background choice, migration, style effects); `THEMES=1` all 0.000; `HWMENU=1 shoot.js` (new) checks the drawer (11 picture tiles load, a style and the style's room can be picked, no frame rate switch) and writes pictures of both menus; `HWBG=own|venue` sets the background in `shoot.js`.

Unknown until the user's PC: how the new styles feel at full speed on a real card, and whether the floor patterns read well enough inside a narrow hand position.

Settings checker's findings (GFXCHECK) acted on:
- Fog now also fills the style's own room toward the horizon and starts nearer (was only far notes: ~0.05% of pixels).
- Reflections: the mirror floor is 2.4× stronger; a style that wants Full reflections gets a 2.4× clearer simple reflection too (Classic keeps its faint one).
- Vignette 28% → 50% at the corners, from nearer the middle; grain ±0.0175 → ±0.04; distance blur reaches down the far highway and blurs twice as wide.
- Removed from the menu: Shadows (no visible effect) and Bloom "Half size" (looked the same as Full; Auto still uses it to save work). MSAA 8× kept: the same as 4× here only because the software GPU caps at 4 samples.
- Rooms that looked alike: Chrome is now a light steel room, Neon teal with pink, Clear a neutral grey, Arena a warm hazy stage. Closest pair in the contact sheet (mean difference /255, highway area) went from 6.4 to 9.0.
- Not changed: the note finishes only differ on note faces (kept as they are; changing the gem drawing risked the THEMES check).

### 4.31 addendum: fewer settings, fifteen styles (user's direction)
- The user asked for fewer graphics options and more unique styles. Graphics is now only the five
  presets (Auto/Low/Medium/High/Ultra), a frame rate cap and the frame rate counter. No Advanced fold,
  no Custom mix. Per style: Brightness and Effects (Full / Calm / Off) only; the style decides fog,
  reflections, glow and note finish.
- Old saves: per-style settings other than brightness are dropped; Sparks off or hit 'none' becomes
  Effects Off, movement off becomes Calm; a custom graphics mix becomes Auto.
- Four new styles (hwstyle.js): Arcade (checkerboard floor, pixel rails, pixel hits), Deep sea
  (caustics, swaying rails, bubbles), Frozen lake (ice cracks, frost rails, snow, snowflake hits),
  Disco (lit beat tiles, rainbow rails, mirror-ball spots, confetti). 15 styles in all.
- Checks: THEMES=1 0.000 px for all 15; Classic identical to the base renders (T:17.2, T:19.1);
  closest style pair 9.3 (arena/clear); HWMENU passes with 15 tiles.
- GFXCHECK (cherry-picked) still names removed settings; it needs updating by its owner.

### 4.31 style polish (Style polisher, Opus; 2026-11-24)
- Asked: Studio, Clear view, Chrome & glass and Frozen lake looked alike (the room did the work);
  Deep sea and Disco only showed on the beat. Each now has its own highway floor, still or not:
  Studio a warm pale-grey matte floor with dark lines, shaded edges and three soft pools of light
  that stay put; Clear view a pure black highway, bright white lines, hard white rails on a black
  keyline, no glow; Chrome a polished floor brightening into the distance, bands of reflected light
  across it, a long highlight and bright chrome rails; Frozen lake pale ice, white branching cracks
  with a cold glow, frost glowing in from both edges; Deep sea a net of rippling light over the whole
  floor (always there, still when Effects isn't Full); Disco every tile glowing its own colour,
  brighter on the beat. Code: `hwstyle.js` (floors matte, mirror, ice, caustics, tiles; rails soft,
  chrome, crisp), palettes in `hwlooks.js`. Ember's cracks are its own case now (unchanged).
- Effects (coordinator, from GFXCHECK): Calm and Off barely showed. `resolveLook` gives `fxK`
  (Full 1, Calm 0.45, Off 0). Calm: hit effects fainter, smaller, half the pieces, the ring grows half
  as far, string blaze and fret posts at about half; room movement off as before. Off: no string
  blaze, posts, ring, sparks or style hit effect (the note's own flare stays). Full multiplies by 1,
  so Classic is unchanged. Every style now has something for Effects (a hit always lights the string,
  posts and ring), so the control stays on all of them, Midnight and Clear view included.
- Checks: THEMES=1 0.000 px for all 15; Classic T:17.2 and T:19.1 against b1ce3d6: 0 differing pixels;
  `node --test test/hwlooks.test.mjs` 12 pass (fxK added); GFXCHECK_ONLY=classic,studio,clear,chrome,
  ice,deepsea,disco,midnight: every Effects Calm/Off "works" (2.7–7.0% of pixels), exit 0.
- Pictures: the six styles' `<id>.webp` / `<id>-big.webp` re-rendered (HWBG=own THEMES=1 T:17.2,
  crop 240,176–1680,986 of 1920×1080, webp q80).
- Unknown until the user's PC: whether Disco's tiles and Studio's pale floor feel too busy or too
  bright under real playing.

## 4.33 (2026-11-25): smooth first, then six real styles

Asked (video of the highway): pauses and hitching; styles look silly and alike ("nothing like a frozen lake"), crooked jagged lines;
wants real HD graphics (gems, strings, highway, effects), aimed a bit under a GTX 1080 Ti; the sideways style strip is silly and
jumps back to the start when picking; everything smooth, no flicker.
User's answers: 6 great styles (Classic kept + Neon Crystal, Synthwave Drive, Inferno, Frozen Lake, Deep Ocean); kinds: sci-fi/neon,
fire/lava, ice/nature; style picker a grid of pictures; smoothness first, released on its own.

Video measured (ffmpeg freezedetect): highway froze 140–280 ms every 1–2 s in the first 5 s of the song, then every 2–10 s.

Done:
- Menu jump: picking a style rebuilt the strip, so it scrolled back to its start (the picture moved 1,300 px). Now a 3-wide grid in
  Sound & settings, blocks swap in place holding their height until pictures are ready (`hwlooks-pane.js` `swap`), the line above
  the grid has a fixed height, the switches under it flip in place (`highway.js` `toggle`). `HWMENU=1` checks the picked picture
  and the menu don't move (fails on the old code).
- Pauses: Stutter finder (Opus): the whole 4 MB label picture was sent on every new label; now only the new boxes (see HANDOFF 4.33).
