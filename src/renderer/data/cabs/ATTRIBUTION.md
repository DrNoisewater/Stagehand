# Bundled Cabinet IRs

These WAV impulse responses ship as the default cab tones in 0xFX.

**Source**: From the "650 Assorted Cabinet Impulses" pack on musical-artifacts.com
(https://musical-artifacts.com/artifacts/252) — released into the **public domain**
by the original contributor (zoyd). The four files chosen here use original
geographic names (no trademarked brand names), matching the 0xFX naming
convention.

| File              | Source name          | Maps to       |
| ----------------- | -------------------- | ------------- |
| 1x12_open.wav     | cambridge 1x12       | FX_CAB_1X12_OPEN |
| 2x12_closed.wav   | allston 2x12         | FX_CAB_2X12_CLOSED |
| 4x12_straight.wav | northbridge 4x12     | FX_CAB_4X12_STRAIGHT |
| 4x12_slant.wav    | worcester stack      | FX_CAB_4X12_SLANT |

Format: IEEE float, stereo, 44.1 kHz. Loaded via `fx_cab_load_ir()` and
downmixed to mono by the engine.

Pinned source revision: 5b248779c96dce6e64d0ed29cfa598014dc4d3c4
Stagehand uses these as recommended generic cabinets, not exact brand/model matches. Original WAVs are retained.

## Bass cabinets (download only)
Shift Line Bass IR Pack: https://shift-line.com/irpackbass
Recorded by Shift Line. Stagehand downloads these directly from the publisher to the user's computer; no Shift Line audio is redistributed in this source or installer. Personal use is supported by the publisher's free pack. Their terms require permission for commercial incorporation in third-party hardware/software. Obtain permission before commercially distributing this integration.
Recommended matches: EBS PL410, Ampeg B15, Sunn 200s, Ampeg SVT810, Orange PPC212 bass edition. They are compatible recommendations, not claims to duplicate every amp's original cabinet.
