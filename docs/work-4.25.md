# 4.25 work notes (in progress)

The user's asks (2026-11-18), and who builds what. Keep this up to date; it survives a new session.

## Asks
1. Wanted: mark a song **Not available** (nothing on CustomsForge). Its own list, can be tried again later.
2. Pop-up ads after a download opened Firefox (Opera, a Steam game): block them; keep the finder focused.
3. **Official DLC** (Ubisoft, cart button on the site): can't be wanted (can't be downloaded). Own section:
   official DLC the player doesn't have, "Contact Noisewater Labs" with a **Request** button that emails the
   owner (address in `src/main/services/officialrequest.js`, given by the user for this). One request per 12 hours.
4. The finder sees "No matching CDLC" by itself → Not available, next song. Also all-official results → Official.
5. First search after opening often says "no search box" (the site draws it late): fix.
6. Wanted list: select many / all, remove or mark in one go (Fleetwood Mac: 120 to clear one by one).
7. **Updates**: CustomsForge's "Updated CDLC" tab lists songs with newer versions. Stagehand shows them and gets them.
8. When the run is done: close the finder window (with the Roadie's celebration), not just a toast.
9. Hide the ads on the CustomsForge page.
10. Discover and its pages redesigned to match the rest (Songs, Gear look). 11. Tones too.
12. The Roadie animation pack in the finder bar (docs/roadie/CLAUDE-INTEGRATION.md), replacing the three steps.

## Decisions
- Reading the page the player is looking at is now allowed (the old rule was "never read the site"): only the page
  already on screen, after a search the player asked for, at human pace. One extra, simpler search when the first finds
  nothing. Never crawls, never downloads by itself.
- Pop-ups: a window.open to a site outside the song sites is dropped (never sent to the player's browser).
  A link the player clicks to another site: the bar offers "Open in my browser" instead of opening it.
- Ads: blocked by host in the finder's own session (`webRequest`), plus CSS hiding ad slots.
- Request email: no server of our own. Sent through ntfy.sh (already used by Backstage) with its e-mail header to a
  random topic; if ntfy refuses or fails, it is sent through FormSubmit (POST https://formsubmit.co/ajax/<address>,
  JSON). The user (2026-11-18): the player must NEVER be told to open a mail app or email client: no mailto at all.
  If both fail, the request is kept and retried by itself later (and the player is told it will go when online).
  FormSubmit sends a one-time activation email to the owner on the first use; ntfy's rules couldn't be checked from
  the cloud. Ask the user to send one test request and confirm FormSubmit's activation email.
- Roadie assets: `src/main/finder/roadie/` (clips/*.mp4 H.264 60 fps, art/keyframe-*.png posters, manifest.json).
  Reference: `docs/roadie/`.

## Contract between the finder (main process) and Wanted (renderer)
`finder:event` (finder → page), existing: `download` {state going|adding|added|had|failed, pct, name, want, job},
`downloaded`, `saved`, `skip`, `stop`, `closed`. New:
- `{ type: 'searched', want, text }` the search was typed (after waiting for the box).
- `{ type: 'results', want, verdict: 'none'|'official'|'match'|'some', rows: [{artist,title,official}] }`
  read once the results settle. 'none' only after the simpler second search also found nothing for this artist.
- `{ type: 'updates', rows: [{ artist, title, version, updated }] }` when the Updated CDLC list is on screen.
- `{ type: 'blocked', host }` a pop-up was stopped (for Activity/log only).
Page → finder (preload `api.discover`):
- `finder(item)` existing; `item.mode` may be 'update' (looking for a newer version of a song you have).
- `finderDone({ title, text })` → `finder:done`: the bar shows it, the Roadie finishes its celebration, the window
  closes about 3.5 s later (cancelled if a new song is opened meanwhile).
- `finderUpdates()` → `finder:updates`: opens the finder and shows the Updated CDLC tab (clicks the tab by its words).
Discover service (preload `api.discover`), new:
- `setStatus(ids, status)` status 'wanted'|'unavailable'|'official' → `discover:setStatus`
- `official()` → `discover:official`: official DLC not in the library [{artist,title,key}] + `{ lastRequestAt }`
- `requestOfficial({ songs:[{artist,title}], contact, note })` → `discover:requestOfficial` → { ok, via, nextAt }
- `updates()` → `discover:updates` (stored list, matched to library songs), `clearUpdates(keys)`.

## Status
- container restarted once mid-work (2026-11-18): partial work committed as WIP, helpers restarted to continue.
- [ ] Finder + bar + Roadie (helper "Finder fixer")
- [ ] Wanted / Official / Updates + Discover redesign (helper "Wanted fixer")
- [x] Tones page look (helper "Tones restyler"; ui3 134/134, famous/switch/sheet/gear audits pass; tones-electron.js not run, its tab names were already stale)
- [ ] integrate, npm test, e2e, HANDOFF, version 4.25.0
