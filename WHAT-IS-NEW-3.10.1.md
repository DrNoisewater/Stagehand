# Stagehand 3.10.1 — repair release

Run Stagehand-Setup-3.10.1.exe. This is the actual bundled Windows installer,
not the fallback batch script. Close Stagehand before updating.

- Guitar and whole-song master levels now carry between songs. Old per-song
  master snapshots no longer override them. Stem mix memory is retained.
- Deferred mix saves capture the correct song's mix rather than a later song's.
- Routine tone parameter updates no longer reset the highway's note judge.
  The selected arrangement explicitly sets the scoring Drop offset.
- Jam has two properly spaced control rows and truncated long tone names.
- Highway Drop uses the original circular switch and eight-button styling.
- Tone match shows Off / Listening / On, offers On/Off comparison and Undo,
  and restores the original adjustment on highway exit. It remains beta.
- Cabinets show their automatic pairing; manual import and modeled controls
  are under Advanced. Download amp + cab remains the one-button workflow.
- Aurora, Orbital and Prism are GPU shader scenes rather than simple 2D shapes.
  They use post-fader song audio and live instrument output, respecting mutes.
- Recording requests up to 1080p at 60 fps, prefers H.264 capture over VP9,
  uses a higher capture bitrate, and exports H.264/AAC MP4. Export tries NVIDIA
  NVENC and falls back to CPU. This is not a guarantee of GPU desktop capture.
  The verified FFmpeg encoder downloads automatically on first recording.
  Recording is limited to three minutes / 600 MB to bound memory consumption.

Focused validation only, as requested: changed JavaScript syntax, audio monitor
with raw-input pitch preserved, 60 fps H.264/AAC export using CPU fallback,
UI/shader compilation, song-switch master levels, and judge identity preserved
on tone parameter updates. Installer payload structure checked.

Windows installation, NVENC on a GTX 1080 Ti, real-time desktop capture frame
pacing and cable-to-video synchronization need a Windows hardware check. The
all-notes-missing report was not reproduced on hardware; the concrete judge
reset and tuning initialization bugs were corrected without loosening scoring.
