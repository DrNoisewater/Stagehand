# Stagehand — The Roadie / Song Finder

This package preserves the approved illustrated skeleton roadie animation. Use this version instead of the earlier vector badge or fast storyboard GIF.

## Deliverables
- `art/approved-original.gif`: exact approved artwork, all 16 keyframes (original pacing is NOT the production timing).
- `art/keyframe-00.png` … `keyframe-15.png`: extracted originals, 618 × 147.
- `clips/*.mp4`: silent H.264, 618 × 148 (one padding row), constant 60 fps, separate sequences and holds.
- `manifest.json`: clip dimensions, lengths, poster paths.
- `roadie-player.js`: dependency-free web reference for state switching; port to native UI if appropriate.
- `preview.html`: local interactive demo; serve from a local web server (e.g. `python -m http.server 8000`) to work around module/file URL restrictions. Open http://localhost:8000/preview.html.
- `CLAUDE-INTEGRATION.md`: complete implementation brief.
- `reference/keyframes.png`: original pose sheet for review.

## Important qualification
The MP4s contain actual 60 fps video frames generated from the approved illustrated keyframes using bidirectional optical-flow interpolation, eased motion, selective hard cuts and subtle drift on persistent poses. This is not a newly hand-animated or skeletal 60 fps character rig; substantial pose changes are comic-panel cuts, and interpolation can introduce minor ghosting. The download/import holds are intentionally restrained instead of repeating the physical action. The original artwork is included for refinement. Video frame rate is verified by ffprobe; actual native playback performance must be profiled inside Stagehand. No red screenshot annotation or screenshot is present in the production asset.

## Timing / state map
| Backend state | Entry | Persistent clip | Behavior |
|---|---|---|---|
| Idle | idle | idle | Neutral roadie |
| Searching | search-loop | search-loop | Slow 4.65 s scan and exaggerated eyes; until the real event changes |
| Found (optional) | found | found-hold | Triumphantly holds up vinyl; only when a matching result is confirmed |
| Downloading | download-enter | download-loop | Record seats in the retro computer; wait on actual download, progress from real bytes |
| Importing | import-enter | import-loop | Machine produces sheet music; hold until library import completes |
| Imported | success | success-hold | Toss sheet into pile, swivel-chair satisfaction; 3.1 s minimum target if practical, interrupt for newer download/import |
| Next search | reset | search-loop | Short reset only if a real new search is active |
| Failure | keyframe-15 | static | Existing error and retry controls remain visible; do not celebrate |

Do not block or artificially slow real work just to play a clip. If an operation completes very quickly, skip or cut the entry animation. Distinguish latest actual backend state from the displayed celebration. Handle cancellation, errors, retries, and rapid transitions without showing stale success or progress.
