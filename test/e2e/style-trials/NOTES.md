# Style trials (2026-11-23, after 4.28.0)

The user reviewed Warm Club (4.28.0) and didn't like it: "not easy to read and kinda dark". The brown look (4.27, the
Rehearsal Room) was the best so far, but they want more variety and ideas "outside the box". Nothing in the app is changed yet.

Six trials, shown on a page of real-app pictures (Songs, Jam, Tones, Gear at 1440×900), with Brown and Warm Club to compare:
1. Tweed (light tan weave, brown tolex frame, gold, oxblood)
2. Studio Daylight (white track sheet, black ink, a coloured tape strip per menu part)
3. Record Shop '70s (cream, chocolate, mustard/orange/rust stripes, round buttons)
4. Gig Poster (off-white halftone, thick black lines, hard shadows, mustard/teal/red)
5. Mahogany (the brown look lifted: mid brown wood, bright cream, gold)
6. Blue Note (slate blue, cream, orange)

How they're made: each `.css` here is injected over the brown look (club.css switched off). The four light ones start with
`@use _light`, which puts `_light.css` first: it maps the colours the dark look hard-codes onto `--L-*` colours. Light looks are
the risky ones: many pages (Discover, Backstage, Progress, Settings, dialogs, Karaoke) were not checked yet. Run with
TRIAL_PROBE=1 and fix what it lists before shipping one.

Status: waiting for the user's pick.
