# Screen and state inventory

“Rendered” means actual renderer with fixture services. “Shared styling” means inspected in source and covered by the shared presentation layer, not an end-to-end workflow claim.

| Area | Existing features / states | Implementation and evidence |
| --- | --- | --- |
| Shell | Navigation, search, now playing, sidebar, focus, disabled | New brand, neutral tokens, section headers and art; rendered |
| Jam | Rigs, slots, tuner, Drop, drums, metronome, looper | Flight-case panels; rendered disconnected/disabled state; hardware untested |
| Visualizers | Fluid, Nebula, Swarm, Mandala, Strings; shared tools | Chrome restyled; controls rendered; GPU blocked by unavailable WebGL |
| Songs | Virtual rows, tiles, search, instrument filters, tuning/artist folders | Responsive columns, cyan selection, art header; list/tiles/empty search rendered |
| Song details | Arrangements, rating, favorite, edit, stems, metadata | Inspector styling; populated inspector rendered; edit/save inherits dialogs |
| Setlists | Create, drag/drop, add, ordering, play | Shared sidebar/menu/dialog styling; real persistence tests retained; drag not interactively checked |
| Tones | Your tones, song tones, presets, shortcuts, protected Slot 1 | Workbench layout and palette; list/editor rendered |
| Tone editing | Amp/cabinet/effects, knobs, demo riff, save, key assignment | Existing code-native gear retained; dialogs and controls restyled; sound untested |
| Discover | Search, artist/album pages, collection gaps | Warm header/margins; search landing rendered; external catalog not exercised |
| Wanted | Empty list, queued songs, manual acquisition guidance | Empty/disabled rendered; acquisition workflow unchanged |
| Imports | Watch folder, destination, update policy, recent imports | Missing-folder/error and empty states rendered; real filesystem imports untested |
| Progress | Practice guidance, session results, charts, goals, badges, levels/titles | Lime mood, reward decoration, clearer cards; sample progress rendered; long content scrollable |
| Backstage | Profile/pass, Everyone, clips, My clips, messages | Pink/charcoal visual system; sample feed rendered; real identities never rotated; network untested |
| Highway | Real guitar/bass strings/frets, section strip, timing/scoring | No gameplay changes; Lead and Bass rendered; new Soundcheck venue captured |
| Highway tools | Speed/repeat, tuner, mix, tone panel, scoring options | Shared restrained chrome; options and venue menu exercised; live scoring untested |
| Tab/wave/stems | Tablature, waveform, mixing, mute/solo, transport | Shared controls and neutral surfaces; existing algorithms untouched; not all states captured |
| Settings | Library, Appearance, Guitar/audio, Real amps, Playback, Stems, Saving, Storage, About | Shared modal styling; new Appearance exercised; native settings untested |
| Onboarding | Fifteen-step setup and feature tour | Shared cards/sidebar typography; first step rendered |
| Dialogs and status | Menus, errors, toasts, confirmations, loading, empty | Shared contrast/focus/layering; settings, loading, toast, empty and missing-folder observed |
| Responsive | Desktop and compact windows | 1363×936, 1280×800, 1024×768, 800×700 inspected; song details move below table at ≤800 |
| Motion/accessibility | Focus outlines, disabled states, reduced motion | CSS reduced-motion rule plus Appearance toggle; toggle DOM state verified; no accessibility certification |

Follow-up Windows acceptance: play guitar and bass through a full song; verify scoring/calibration/timing, all tone keys, volumes between songs, tuner/Drop, drums/looper, GPU venues, stem queue, record/export with sound, native dialogs and Backstage networking. This redesign intentionally does not claim to repair earlier audio/scoring issues.
