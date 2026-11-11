# Stagehand — Soundcheck identity

Implemented against Stagehand 4.4.1, upstream commit `26a02e6fcc99c6a6269ce14df9e2b08dad120e5e`, on isolated branch `design/stagehand-identity`.

## Direction

A working musician’s rehearsal room: charcoal flight cases, confident condensed lettering, brightly illustrated gear and occasional paper ephemera. The supplied 44 reference images were reviewed as exploration, not a layout specification. Earlier demon/red-and-cream imagery was rejected. Existing illustrated gear, album art, interface icons and nine venue images remain useful parts of the app.

The app gets a new Stagehand wordmark/monogram in its header, a shared readable chrome, section-specific moods, individual transparent illustrations, and a new Soundcheck venue. Interface text and controls are real HTML; no screen is flattened into an image. The Noisewater Labs splash and existing OS installer icon remain unchanged.

## Visual system

| Role | Value / treatment |
| --- | --- |
| Main surface | #131517 |
| Panels | #1A1D20, #22262A |
| Main / secondary text | #F3F5F3 / #BAC3C7 |
| Tertiary text | #97A3AA |
| Selection / focus | #66DFDC / #83E9E5 |
| Jam | Lime, violet; rehearsal gear |
| Songs | Cyan, orange; records and instruments |
| Tones | Violet, lime; pedal bench |
| Discover | Orange, cyan; crate digging |
| Progress | Lime, violet; patches and emblems |
| Backstage | Pink, charcoal; passes and community |
| Typography | Existing bundled Archivo; condensed heavy display, readable regular controls |
| Geometry | 5–8px corner radii; 8px spacing rhythm; quiet separators |

Page mood colors are decorative. Existing warnings, recording red, string colors, instrument colors, score semantics, and tone-slot colors are preserved. Artwork never becomes a status indicator. Illustrations sit in a fixed header reservation; the central highway remains clear. Player changes are chrome and venue selection only: no note timing, judging, fret geometry, camera, audio processing, or stem logic was rewritten.

## Artwork and variation

`src/renderer/art/manifest.json` is the asset/placement inventory. `identity-art.js` mirrors its decorative entries for synchronous renderer loading. Update both when expanding the catalog. Twenty transparent props/labels/emblems ship as optimized WebP (about 1.3 MB combined), plus the Soundcheck JPEG and thumbnail. Original PNGs are in `docs/identity/art-masters` in the complete source and artwork package.

Six original generated assets: vinyl-crate, pedal-bloom, bass-orbit, pick-rescue, encore-patch, soundcheck. Fifteen suitable props/paper/pass elements were selected from the supplied modern rock art pack. Original reference mockups are not shipping backgrounds. Most paper masters deliberately leave text areas blank; labels are rendered in code.

Each major section has at least three curated header choices. `ArtDirector` persists a shuffled bag and last selection locally, and stores the chosen image in session storage. Renders, searches, hovers and playback never advance it. Reloads within the same session retain it. A fresh session consumes the next item; a bag avoids immediate repeats when alternatives exist. Pinning persists across sessions. Storage failure falls back to stable in-memory selection.

Settings → Appearance offers pin/unpin, Try another illustration, Less decoration, Calmer interface, and optional venue rotation. Reduced decoration hides art while preserving layout. Calmer interface and OS reduced motion disable CSS transitions/animations; performance canvas and music visualizers keep their existing timing and motion. Select Plain in the highway for minimal atmosphere.

Venue rotation is opt-in and chooses only unlocked photo venues when a different song ID loads. Switching guitar/bass parts or reloading the same song does not change the venue. Manual venue selection takes effect immediately because the player requested it. Nothing rotates actual album covers or user identities.

### Placement guidance

- Header props: vinyl-crate, bass-orbit, pedal-bloom, pedal-tower, blue-ticket, access-pass. Render `object-fit: contain`; never crop to fill.
- Reward decorations: encore-patch, winged-pick, chrome-bolt, tour-patch. These are decorative emblems, not replacements for the earned-medal data.
- Empty states: pick-rescue and pedal-bloom. Keep adjacent explanation and recovery controls as text.
- Margin accents: cyan-paper and pink-paper for kickers, orange-tape for warm sections. Setlist-paper, lime-note and checker-tape remain reusable reserves rather than filling every surface.
- Soundcheck: horizon 0.45, center reserved for the real-instrument highway. Existing venue renderer darkens and aligns the room.

## Running and building

On Windows, use the included Windows installer ZIP and `Install Stagehand.bat` (downloads the runtime), or install Node and run `npm install` then `npm start` from the source folder. The existing committed Windows audio helper and WASM are included unchanged. `scripts/optimize-identity-art.py` regenerates shipping images from the masters with Pillow. `npm run dist` / `npm run dist:portable` use the existing Electron Builder configuration. No standalone Windows EXE was produced or tested in this Linux environment.

`npm test` runs the existing suite plus `test/identity.test.mjs`. All existing tests passed in this environment; rotation tests and JS syntax/diff checks also passed after final changes. Native hardware audio, encoder export and networking require Windows acceptance testing.

The renderer preview is the real HTML/CSS/JS with a fixture preload and real Library/Tab/Tone/Stats services, not a prototype. To reproduce it, install Playwright for the existing e2e harness, build the fake helper using CLAUDE.md, then run:

```sh
SH_IDENTITY_SERVE=1 node test/e2e/ui3-chromium.js native/build/stagehand-audio-fake /tmp/stagehand-preview --port 4173
```

Open `/src/renderer/index.html` on the local server. `/test/e2e/identity-viewport.html` embeds it at 1024×768, 1280×800 or 800×700 for layout checks. Preview fixture APIs are test-only and do not participate in packaged Electron builds. Never expose this development server publicly.

## Evidence and limits

The delivered screenshots are actual application renderer captures using two synthetic fixture songs and sample progress/community data. `before/` shows pristine upstream renderer source; `after/` shows implemented source. No proposed mockup is presented as implementation evidence. The additional browser-size frame in compact screenshots is a test harness, not app UI.

Verified interactively: six main screens; song list and tiles; song selection/details; empty search; Lead/Bass highway switching; Soundcheck venue selection; appearance pin/unpin and disabled Next; reduced-decoration/calm attributes; Wanted and Imports empty/missing-folder states; onboarding; 1024/1280/800 layouts. A cramped score bar at 1024 was corrected and recaptured.

The GPU fluid visualizer opens with its controls, but WebGL is unavailable in this browser; it logs initialization errors and its animation is not validated. Do not use its screenshot as proof of working GPU rendering. Real WASAPI latency, Drop sound, looper fidelity, stem splitting, recording/export audio, real multiplayer, physical shortcut devices and full Windows installer execution were not validated. Secondary forms inherit the shared system but not every combination has an interactive screenshot; see COVERAGE.md. Automated browser audit scaffolding is supplied but was not run successfully here because direct Chromium launch was sandbox-blocked; interactive checks used the supported browser instead.
