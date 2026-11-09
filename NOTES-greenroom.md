# Green Room work notes (branch claude/recording-section-overhaul-5iywzp)

Working notes for this change; fold into HANDOFF.md at the end, then delete.

## What the user asked
Replace Recordings + Friends (codes) with "The Green Room": a menu item at the very bottom.
Mark a clip shareable and everyone with Stagehand sees it there. Clips carry the song,
part and tone; you can try/keep the tone and find the song. Messages stay, codes go.
User picked the simple plan: no server; clips can only be watched while the sharer's
Stagehand is open. Keep old messages to read, drop codes.

## Decisions
- One shared meeting point topic for everyone (well-known key, so only junk is filtered;
  it is public by design). Each Stagehand announces "here" with its name and a short list
  of shared clips every 10 min (ntfy.sh allows ~250 messages a day per PC), and "bye" on close.
  Newcomers read the last 30 min of the topic, so the room fills at once. Gone after 25 min quiet.
- Each person gets a new random hidden address (26 letters, never shown). It replaces the
  code: their personal topic for messages and video offers. Old codes are not reused because
  people picked phrases ("dominos2496") that might be used elsewhere; announcing them publicly is wrong.
- You only appear (and can share or message) after picking a name. Browsing needs no name.
- Videos only are shared (as before). Watching = the same direct PC-to-PC link (friendlink.js).
- Clip details (song, artist, official, part, tuning, guitar/bass, speed, tone) are stored on the
  take when it's recorded. Full tone travels over the direct link (no size limit); the announcement
  has just names. A tone's own IR file path is dropped (it's a file on the sharer's PC).
- Songs are never sent: "Play this song" if you have it (title + artist match), else
  "Find it on CustomsForge" (existing Discover hand-off), or "Official song" for paid DLC.
- Hide a person: their clips and messages are ignored on this PC.

## Status
- [ ] main service, takes details, IPC  - [ ] page  - [ ] tests  - [ ] docs + version
