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

Status: helpers running.
