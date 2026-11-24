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

Checks: `node --test test/hwlooks.test.mjs` (in npm test); `THEMES=1 … shoot.js` checks every look against Classic (points, labels and label sizes, limit 1 px; all 0.000) and writes `themes-sheet.png`; `HWTHEME=<look>` works in `shoot.js` and `ui3-chromium.js`.

Unknown until the user's PC: how the looks feel on a real screen, and what bloom and the mirror floor cost on a real graphics card (here only a slow software one).
