# Roadshow visual pass — 2026-11-10

This pass extends Soundcheck into a rugged illustrated rock identity across Jam, Songs, Tones, Discover, Progress, Backstage, settings, dialogs and the splash. Highway rendering and native DSP were not redesigned.

## Implemented

- Seven original character illustrations, roadcase texture, poster typography, page-specific color accents, sidebar and settings decoration; reduced-decoration and reduced-motion support.
- Forty realistic worn gear portraits and a separate DigiTech Drop reconstruction based on the user's actual reference photo. Catalog variants share the appropriate cabinet image; missing portraits retain legacy SVG art.
- Live image knobs in the selected Jam rig, advanced tone editor, pedalboard and tone wizard, plus an enlarged editor. Image controls and labeled controls synchronize, retain read-only restrictions and support keyboard adjustment/reset. Unmapped parameters remain in the labeled control row.
- Drop selector, LEDs, bypass footswitch and hold-to-engage momentary UI. Supported pitch steps remain 1–7 semitones and octave down. OCT + DRY is not implemented; this is Stagehand's existing DSP, not a model of DigiTech's algorithm.

## Validation and remaining work

The existing npm test suite passed; the new gear-controls test passed and is now included in npm test. Tests cover synchronization, callbacks, bounds, reset, disabled controls, finite input, metadata and asset paths. Syntax checks passed for the edited renderer modules.

Full rendered visual QA and Windows/audio hardware testing could not be completed in this environment: local Chromium could not create its required socket, and the separate preview browser could not access local files/server. The e2e faceplate harness is included for follow-up. Verify pointer drag, alignment at multiple screen sizes, momentary release, live audio, and saved-tone behavior on Windows before release.

This is not complete photographic coverage: the catalog has 613 entries representing roughly 221 distinct gear items, many fictional. Forty portraits plus Drop are included. Generated reconstructions can contain label/layout inaccuracies and generic catalog mappings are approximate. See gear-art.json for provenance. Remaining catalog art and manufacturer-by-manufacturer verification are still required.

The Windows ZIP uses the existing script installer and downloads runtime dependencies. No new standalone Setup EXE was built, and the existing native audio binary is unchanged.
