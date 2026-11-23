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

Status: in progress.
