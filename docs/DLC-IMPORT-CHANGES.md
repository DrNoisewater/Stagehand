# Installed Rocksmith DLC import

## Use

Settings → Library → **Import Rocksmith DLC**. The existing `rocksmith.gameDir` setting is reused. A missing, empty or unreadable `songs.psarc` prompts for the installation folder. Scan, search, select songs and choose **Import Selected**. If the audio decoder is missing, use Stagehand's existing decoder setup and retry the affected rows.

The importer reads `songs.psarc` and installed PC archives below `dlc/`, including the compatibility packs. `originals/` is excluded. Songs are matched by song key / persistent arrangement IDs; repeat imports update existing records rather than creating another song. Existing entries that have not been verified by this importer offer repair/verification. Distinct Combo IDs remain separate parts. Different copies of the same song can contribute distinct arrangements, each retaining its chart source.

Sources remain in Rocksmith; they are never edited or copied wholesale. Keep those archives available. Full-song audio is resolved through the existing bank/event/media resolver, not the metadata reader's size fallback, and passed through the normal decoder and content-hash cache. Audio may come from a different archive than charts. Normal song selection, tabs/highway and stem requests use those same library records and audio hashes.

Imports validate all playable arrangements and decode audio before committing each song. Missing charts, archives, audio and decoder failures appear on the affected row; other songs continue. Changes to an archive after discovery require a rescan. Cancelling stops further imports and prevents an unfinished song from being committed. An already-running native decode may finish populating the shared audio cache in the background; it cannot commit the cancelled song. Successfully completed songs remain imported.

## Changed files

| File | Change |
| --- | --- |
| `src/main/services/dlc-importer.js` | New selective discovery/import service, installation-only audio index, duplicate checks, source tracking, repair, per-song validation/errors and cancellation. |
| `src/main/main.js` | Scan/import/cancel IPC, existing folder-setting reuse, folder validation/picker and progress events. |
| `src/main/preload.js` | Narrow importer bridge and progress event allowlist. |
| `src/renderer/js/dialogs.js` | Bottom-right import button in Library settings. |
| `src/renderer/js/dlc-import.js` | New importer dialog: progress, searchable song list, arrangements/status, select/deselect, import and cancel. |
| `src/main/core/rocksmith.js` | Optional metadata-only/cancellable read for this importer, bypassing legacy audio fallback; existing callers unchanged. |
| `src/main/services/audiofind.js` | Optional same-archive bank search for importer songs whose bank must be located by name/event; existing default unchanged. |
| `src/main/services/library.js` | Keep explicitly imported references independent of watched folders; preserve imported records/audio mappings and IDs during rescans. |
| `src/main/services/tabs.js` | Imported arrangement source paths and importer-only full-difficulty option/cache key. |
| `src/main/core/sng.js` | Reuse per-phrase authored maximum notes; importer-only strict missing-level check and per-phrase handshapes/arpeggios. |
| `src/main/core/xmlarr.js` | Same importer-only strict per-phrase handling for XML fallback. |
| `test/dlc-import.test.js` | Eight fixture test groups covering import and normal service integration. |
| `test/e2e/dlc-import-chromium.js` | Renderer harness for search, selection, progress, cancel, duplicate disabling and layout; not successfully run here. |
| `package.json` | Add `npm run test:dlc-import`. |
| `docs/DLC-IMPORT-CHANGES.md` | This change list and validation record. |

No audio processing, scoring, stem engine, adaptive difficulty, or unrelated screen behavior was changed. Existing full-difficulty conversion remains the default outside this feature; stricter imported-chart checks and phrase-specific shape handling are gated by `dlcImport`.

## Validation performed

- `node --test test/dlc-import.test.js`: **8/8 passed**. Synthetic Kryptonite and Killer Queen archives model the supplied findings: compatibility charts with shared banks/audio in `songs.psarc`; oversized previews and unrelated WEMs do not win. Also covers root-manifest songs, compatibility disc and ordinary DLC, duplicate `originals`, two Combo arrangements, arrangements split across duplicate packs, same-archive event lookup, zero-byte archive reporting, absent banks/media, missing decoder, per-song decoding errors, retry, changed/missing source files, cancellation (including decode in flight), persistence, preservation of existing IDs/favorites/history/setlists, and rescan protection.
- Importer integration exercises real PSARC extraction, AudioService.prepare content hashing/cache reuse, TabService chart loading, the normal StemService request queue and existing stem-cache reuse. Native decoding is stubbed in successful importer fixtures; a real missing-decoder error is also tested. Demucs execution is not performed.
- `node test/core.test.js`: **18/18 passed**.
- `node test/tab.test.js`: **5/5 passed**, including compiled SNG vs XML and technique preservation from existing fixtures.
- `node test/audiofind.test.js`: **passed**, including existing Kryptonite/Killer Queen shared-audio fixtures, embedded media, ambiguity and missing dependencies.
- `node test/stems-queue.test.js`: **passed**.
- Syntax checks for changed main/preload/importer/renderer JavaScript passed.
- Renderer harness launch was **blocked**: bundled Playwright browser absent; installed Chromium could not create its process socket (`Operation not permitted`). No successful interactive UI or visual-layout check is claimed.
- The entire unrelated `npm test` suite was not run.

## Still requires the user's Windows installation

Only the source ZIP and the diagnostic findings quoted in the request were available; the actual installed archives and diagnostic ZIP were not opened. Fixture song labels do not establish successful playback of the user's recordings or an exact song count.

1. Scan the real installation, including the 143 legacy DLC entries, 70 root song keys and 52 imported disc songs described in the findings; inspect discovered counts rather than assuming all are playable songs.
2. Import Kryptonite and available legacy Queen songs. Confirm vgmstream actually decodes each full recording, not its preview; listen from the beginning and near the end.
3. Select each distinct Combo arrangement, check highway timing/chords/techniques at full authored difficulty, and confirm normal automatic stem separation completes with the matching recording.
4. Retry previously failed entries and verify favorites, scores and play history remain attached.
5. Exercise the Settings button, folder picker, search/select controls, progress and cancellation in Electron on Windows.

To run the renderer harness where Playwright/Chromium are installed:
`node test/e2e/dlc-import-chromium.js` (optional `PLAYWRIGHT` module path and `CHROMIUM` executable path environment variables).
