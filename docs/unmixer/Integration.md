# Compact Unmixer • Stagehand stem progress box

Replace the current stem-loading card and top-left sticker with this card. Its design size is 660 × 206, and it scales to its parent width. In a native implementation, keep the host's accessible text and playback action at native font sizes. A single forearm and hand rotate about the elbow, lift clear of the brass button, and press it before the emitter fires. The background contains the exposed button. Reduced motion holds the contact pose. The light train crosses the incoming span before the prism sends four pulses directly onto the CRT. The scope traces illustrate activity and carry no measurement data.

Load unmixer.js as a classic script. Place art/ alongside it. The previous standalone player used a different API. The compact card owns its animation clock. Connect the job event stream once per panel, as illustrated below.

~~~js
const rig = Unmixer.mount(panel, {
  onReport: report => showLatestJobStatus(report),
  onPlayFullMix: report => playOriginalMix(report.songId)
});
rig.start({jobId, songId, song, artist, sequence: 0, phase: 'queued'});
// In the existing separator's event handler, forward real measurements:
rig.update({jobId, songId, sequence, phase: 'splitting', completed, total});
// When writing outputs, report the backend's actual phase and progress.
rig.update({jobId, songId, sequence: nextSequence, phase: 'finalizing', progress: null});
// Only after the backend confirms the usable files are available:
rig.update({jobId, songId, sequence: readySequence, phase: 'ready'});
// Remove job subscriptions and dispose of the panel when leaving.
rig.destroy();
~~~

The host starts each selected song or retry with a unique job ID. Assign a strictly increasing nonnegative integer sequence at the event source. Route later events to update(), never start(). The player ignores mismatched IDs, duplicate or stale sequences, and changes to a terminal job. Use a new job ID to retry. The host owns file validation, queued jobs, playback, autoplay and cancellation.

Supply overall progress as a finite fraction from 0 to 1, or completed and total as a pair in the same units. Convert backend percentages to fractions first. An explicit progress field takes precedence. Omit progress fields for status-only updates to preserve the last measurement. Send progress: null when the current phase has no known total. The panel shows no numeric estimate for unknown work and can hold an exact measured value indefinitely. A measured 100% alone never declares readiness. Terminal phases are ready, error and cancelled. Send message with a backend status or error explanation. No progress is inferred from elapsed time, animation frames or output-channel count.

Optional stems is a complete snapshot of backend outputs, each with name and optional progress fraction, or completed/total, and status. Supply the exact names Stagehand returns, including “Other” if appropriate. All stems are returned in the report. The compact card has room for two detail lines. Overall percentage always comes from the overall job measurement. onReport receives a fresh snapshot for each accepted event. getReport() returns a copy on demand. The animation clock emits no reports. Do not feed onReport back into the source job stream.

Open Preview.html after extracting the ZIP. The expandable report is driven by the same callback used in production. demo-events.js is preview-only. The video deliberately holds at 42% while light keeps moving and shows a separate file-preparation stage before ready.
