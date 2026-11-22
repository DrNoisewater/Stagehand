# Integrate The Reliquary into Stagehand Discover

Replace the small loading indicator beneath the artist header on Discover with this interactive illustration during MusicBrainz searches. Use the available panel width and preserve the 1983 × 793 aspect ratio. Center the scene vertically if the loading region is taller. Keep the existing navigation, search controls, cancellation and results workflow.

## Mount
For a DOM-based UI, copy art/, bones.js and reliquary.js into the same static directory. Load bones.js, then reliquary.js as classic scripts. Insert a full-width empty element into the loading view. After it is visible, mount once per search view.

~~~js
const rig = window.mountReliquary(element);
rig.start(artistDisplayName);
~~~

Use the existing search service's events. The player performs no requests. The following calls illustrate separate events.

~~~js
// The UI knows the current album and the number of albums processed.
rig.update({album: currentAlbum, song: '', completed: processedAlbums, total: albumCount});

// A recording was actually found on this album. Keep the existing album counter.
rig.result({song: recordingTitle});

// The service is now in a phase with no known total.
rig.update({completed: null, total: null, song: '', album: ''});

rig.update({state: 'complete'});  // Or 'cancelled' or 'error' as appropriate.
rig.destroy();                   // On unmount, after the results view takes over.
~~~

Updates merge with existing values. Clear song when switching to an album, since song takes display priority. start() clears previous artist data. Call it for a replacement query and ignore late events from the previous request using the host's search ID or cancellation token. Publish only the titles the service actually exposes. During an album-only crawl use the release readout. A moving stylus without a percentage means the total is unknown. Once known, use completed and total in the same unit. Pass live values directly, including Unicode. The screen shortens unusually long labels, retaining the full accessible description. Forward each result to the same mounted instance. Keep the host element keyed to the search session, never to the recording title or count. Song events update the readout while typing, the brain pulse, and drifting motes continue on a single clock. Cable brightness eases toward the actual completion fraction. With an unknown total it settles at a low glow. Reduced-motion preferences suppress typing and travel effects.

For a native host, bundle a local web view with an empty mount element and forward structured serialized events through the existing UI bridge. The demo timer and controls belong only in preview.html. Keep the existing short status text available as an accessible live region, and display host error details/retry controls as usual.

## Performances and progress

Call `rig.start(artist)` once at the beginning of each new search. The player draws from a shuffled set of three performances and avoids repeating the previous take at set boundaries. The sequence survives a view remount within the same browser tab when session storage is available. The first automatic search features one of the two record-based performances. For an explicit selection call `rig.start(artist, "vinyl")`, `"crate"` or `"typewriter"`. Updates and results preserve the selected character and motion phase.

The turntablist wears his headphones and cues a revolving record with one hand while the other rides the turntable control. The crate digger raises a sleeve, looks it over and rummages with his free arm. The original operator types at the pipe-organ keyboard. The two new takes each have an illustrated stage and three separately pivoted parts. The turntable also has a perspective-correct rotating label and a stationary spindle. Art assets and all joint placement data are supplied in art/ and bones.js.

The operator is the wardrobe reference. All three performances use its skull, lightning bolt and flame artwork, in that order, on the wearer’s right front panel. Keep cutouts in their recorded orientation. The turntable control panel and platter are part of the fixed illustrated stage. Only the printed label turns beneath the fixed spindle.

The progress display traces an amber spiral from the edge of a record toward its center. The numeric percent and completed/total count show the exact state. A scanning tip represents unknown progress. All takes share the CRT, brain pulse, and progress-driven cable glow.

Extract the ZIP and open preview.html. Use **New search** to shuffle or **Performance** to audition a specific take. Preview.mp4 shows three example searches. Take-comparison.jpg shows the three performances side by side.
