# The Road to 100 (4.5)

All numbers: `src/main/services/progression-config.js`. Check a change with
`node test/progression-sim.test.js` (or Developer menu › Validate XP balancing).

## Simulated year (real XP rules, seeded)

| Player | 1 week | 1 month | 3 months | 6 months | 9 months | 1 year | Level 100 |
|---|---|---|---|---|---|---|---|
| Casual (2 days/week, 30 min) | 3 | 7 | 16 | 27 | 36 | 44 | — |
| Regular, dedicated (4–5 days/week, 45 min) | 8 | 24 | 45 | 69 | 86 | 100 | day 364 |
| Heavy (6 days/week, 90 min) | 13 | 40 | 71 | 100 | — | — | day 168 |

XP per level: 540 at level 1, ~660 at 10, ~1,470 at 50, ~2,300 at 75, ~3,500 at 99.
Total to level 100: 166,064 XP.

## Where XP comes from
Minutes actually playing (1/min with a song, ½ free; ≤180 a day; scored-but-nothing-hit
sessions ×0.1), whole songs (25), accuracy on whole songs (15/40/70/150 at 80/90/95/100%),
new songs (20), new tunings (40), personal bests (+2 points or more: 30), song mastery
(Proficient 25, Expert 50, Mastered 100), achievements (20…750 per tier), challenges,
things tried once, songs added (10, five a day).

## Anti-farming
- A whole song with few notes earns notes/150 of the song bonuses (or seconds/150 unscored).
- The same song and part in full on one day: 100%, 60%, 35%, 20%, then 10%.
- Sessions under 30 s are not "playing a song"; idle sessions earn almost nothing.
- Past 60 minutes in a day, playing earns 50% (long days still count).

## No punishment for missing days
The old days-in-a-row multiplier (lost if you skipped a day) is replaced by a weekly rhythm:
days played in the last 7 → ×1.00/1.04/1.08/1.12/1.15. Missing a day never removes anything.

## Venues
1 Soundcheck, Warehouse, Plain · 3 Cellar · 5 Jazz club · 10 Studio · 15 Rooftop ·
20 Festival ★ · 25 Strings · 30 Opera house · 40 Swarm · 50 Fluid ★ · 60 Canyon ·
70 Astral · 80 Nebula ★ · 90 Mandala (rebuilt) · 100 Valhalla ★ (new, legendary).
Profiles from 4.4 keep every venue they could already use (`legacy` in levels.json) until
progression is reset.

## Two layers
- Career progression: `levels.json` (+ sessions since `resetAt`). Reset from the developer menu.
- Lifetime statistics: every session in `stats.json` plus its `archive`. Never reset by the above.
- Backups: `%LOCALAPPDATA%\Stagehand\Backups\Career\` (daily, before migrations, resets, restores).
