# HD highway styles (4.34)

A highway style can draw its own highway surface, notes, strings, sustains, sky and effects with real
shaders, instead of recolouring Classic. The engine is `src/renderer/js/hdstyle.js`; each style is one file,
`src/renderer/js/styles/<id>.js`. Inferno (`styles/inferno.js`) is the full worked example; Neon Crystal,
Synthwave Drive, Frozen Lake and Deep Ocean are built the same way.

## Switching a style on

1. Write `styles/<id>.js` (below).
2. In `hwlooks.js` THEMES, give the style `hd: '<id>'`. Its `pal`, `sky` and `sig` stay as fallbacks
   (what shows for the instant before the style's programs are built, and for anything it leaves out).
3. Make its pictures (see "Pictures") and run the checks.

Classic and any style without `hd` never touch the engine: Classic stays pixel-identical.

## How it fits into the highway

- `highway.js` builds the frame exactly as before. Where a style draws a part itself, the old pieces are
  still made (same positions, same count) but flagged "muted" (alpha −1), so the vertex shader drops them.
  The THEMES=1 check compares those positions, so nothing can drift.
- The highway hands the engine what it knows: hand-position lanes (`HX.lane`), beat lines (`HX.beat`),
  every gem (`HX.gem`: kind 0 note, 1 open string bar, 2 chord frame bar), every string, fret, nut and
  light post as a tube (`HX.tube`), sustains and slides as a ribbon (`HX.trail`), and each hit once
  (`HX.hit`).
- Labels (fret numbers, chord names, fingers) are drawn last, in their own pass, and are never touched.
- Everything a style leaves out is drawn the Classic way in the style's palette.
- `R3.mute`, `R3.skyOwn`, `R3.setHaze` and `R3.seeThrough` in `highway3d.js` are the hooks it uses.

## A style file

```js
export default function build(K) {
  const sparks = K.emitter({ max: 1600, life: [0.4, 0.95], speed: [3.5, 8], spread: 2.3, accel: [0, -9.5, 0],
    drag: 1.2, size: [0.05, 0.022], shape: 1, stretch: 0.06, colA: [1.8, 1.5, 1.1], colB: [1, 0.28, 0.02] });
  K.field({ count: 900, box: [-16, 16, -0.2, 7, -2, 46], vel: [0.12, 0.5, -0.45], size: [0.018, 0.045],
    colA: '#ffb347', colB: '#ff3a0a', alpha: 0.85 });
  return {
    floor: { glsl: FLOOR },   // vec4 hdFloor(HDFloor f)
    sky:   { glsl: SKY },     // vec3 hdSky(HDSky s)
    gem:   { glsl: GEM },     // vec4 hdGem(HDGem g)
    tube:  { glsl: TUBE },    // vec4 hdTube(HDTube t)
    trail: { glsl: TRAIL },   // vec4 hdTrail(HDTrail r); add: true for light-only ribbons
    sprite: { glsl },         // vec4 hdSprite(HDSprite p), optional particle look
    haze: 0.85,               // heat shimmer over hits (needs after-effects)
    chordGlass: ['#2a0702', '#3d0e04'],
    onHit(e) { sparks.burst(e.x, e.y, e.z, 26, e.rgb, e.dead ? 1.25 : 1); },
    frame(F) { /* once a frame: F.dt, F.holdN, F.holds (x, y, z of each held note) */ },
  };
}
```

Each hook may also pass `uniforms` of its own. The structs (`HDFloor`, `HDSky`, `HDGem`, `HDTube`,
`HDTrail`, `HDSprite`) are documented field by field in `hdstyle.js`.

Shared uniforms: `uTime`, `uSong`, `uZs` (units per song second), `uPulse` (beat), `uHeat` (streak),
`uFx` (Effects: Full 1, Calm 0.45, Off 0), `uMotion` (0 with reduced motion), `uQ` (0 Low … 3 Ultra),
`uZFar`, `uHits[8]` and `uHitN`, `uOwn` (1 when the style's own room is behind; 0 over a venue, so keep the
sides clear). Helpers: `hdHash`, `hdHash2`, `hdHash3`, `hdNoise`, `hdNoise3`, `hdFbm(p, octaves)`,
`hdVoronoi` (centre distance, border distance, cell id), `hdFresnel`, `hdFade`, `hdFog`, and on the floor
`hdLine(d, w, fw)`.

World axes: x along the neck (fret f sits at (1 − 0.982^f) / 0.018), y up, z = time ahead × `uZs`.

## Gems in 3D (4.34.1)

Every HD style's notes, open-string bars and chord frame bars are now a real bevelled block: the edges
round off with the corner radius across the face (and as far as the depth allows front to back), with true
normals, so light runs over the bevel. The footprint is unchanged. `HDGem` keeps every old field and adds:

| field | what it is |
| --- | --- |
| `uv` | across the face toward you, 0..1 (left to right, bottom to top) |
| `edgeD`, `edge` | distance to the outline in world units (x and y, and the smaller one) |
| `bevel` | 0 on the flat of the face, 1 where the bevel turns into the side |
| `face` | 1 on the flat face toward you (soft), 0 on bevel and sides |
| `top` | how much the point faces up (0..1) |
| `hit` | the hit's glow (same as `flare`: 0, up to about 0.5 as it is hit) |
| `hold` | 1 while the note is held on the neck (a ringing sustain) |
| `key`, `lit`, `spec`, `sheen`, `fres` | the shared key light (view space) and its diffuse (0..1), tight and broad highlights, and the rim term |

`n` now includes the bevel. `hdGemLit(g, base, shine)` gives the usual lit block (body, rim, highlight);
add your own glow on top. Keep a note's string colour clearly readable: players find strings by colour.
Keep emissive peaks small; a block brighter than about 1 everywhere blooms into a white blob.

```glsl
vec4 hdGem(HDGem g) {
  if (g.missed > 0.5) return vec4(hdGemLit(g, vec3(0.15), 0.4), 1.0);
  vec3 c = hdGemLit(g, g.col * 0.5, 1.0);                       // a lit, bevelled block
  c += g.col * g.face * (0.35 + 0.4 * g.near + 1.5 * g.hit);    // the face glows as it lands
  c += mix(g.col, vec3(1.0), 0.4) * smoothstep(0.6, 1.0, g.bevel) * (0.3 + g.hit);  // a lit edge
  return vec4(c, 1.0);
}
```

Hits: when a style has `onHit`, it owns the whole look of a hit. Classic's white flash, the string's blaze
and the hit ring are left out (the note's own flare, `g.hit`, still draws). `e.burst` in `onHit` is false
when the player turned Hit burst off (or calm motion is on): leave out the style's ring or shock wave then.
Bursts already scale with Effects (`F.fxK`); a burst of 1 (a ring, a flare) still shows at Calm and Low.
The light posts at a hit use the palette's `railHot` (or `postA`) instead of white.

`:H` on a still (`T:17.3::H`) hits the notes of the last 0.15 s dead on with the clock stopped, so a hit
looks the same however busy the machine is; add `HWGFX=high` (Auto may pick Low in software rendering).

## Rules

- **Same places, same sizes.** Positions come from the highway; never move a note, string or fret.
- **Smooth, not jagged.** Every line uses its change per pixel (`f.fw`, `fwidth`) to soften its edge, and
  fades to an even glow when it gets thinner than a pixel. No hard noise thresholds.
- **Nothing built mid-song.** `use()` loads the file and compiles every program (`compileAsync`) on a
  scratch scene before the style shows; until then the fallback look draws.
- **No garbage per frame.** Emitters, fields and arrays are made in `build`; `onHit` and `frame` only write
  numbers. Particles are born into a ring buffer and moved entirely on the graphics card.
- **Effects and motion.** Bursts scale with Effects (`F.fxK`) and quality; fields stop with reduced motion
  (`uMotion` 0) and scale with quality (a quarter at Low, 1.5× at Ultra). Shaders should still move slowly
  with `uMotion` and calm down with `uFx`.
- **Additive light** (`add`, particles, fields): the shader's colour is added as it is; alpha is ignored.

## Budget

At High on a GTX 1070 at 1920×1080: about 4 ms of graphics time for the whole style. Floor shader up to
about 250 operations per pixel, at most 4000 live particles, at most 15 extra draw calls. Low: a quarter of
the particles, the simplest surface (`uQ` 0), no shimmer. Inferno uses 8 draw calls (floor, sky, gems,
tubes, ribbon, particles, two ember fields).

## Pictures

`src/renderer/art/hwstyles/<id>.webp` (192×108, under 8 KB) and `<id>-big.webp` (768×432, about 20 KB),
WebP quality 80, cut from `HWBG=own THEMES=1 PLAYWRIGHT=playwright node test/hwlook/shoot.js <out> T:17.2`
(`theme-<id>.png`, crop 240,176 to 1680,986).

## Checks

```sh
HWBG=own THEMES=1 PLAYWRIGHT=playwright node test/hwlook/shoot.js <out> T:17.2   # nothing moved, every style
HWMENU=1 PLAYWRIGHT=playwright node test/hwlook/shoot.js <out> T:3
ATLAS=1 PLAYWRIGHT=playwright node test/hwlook/shoot.js <out> T:3
STUTTER=1 HWTHEME=inferno HWGFX=ultra VW=960 VH=540 PLAYWRIGHT=playwright node test/hwlook/shoot.js <out> A:0
HWTHEME=inferno PLAYWRIGHT=playwright node test/hwlook/shoot.js <out> T:19.1 A:2.5:p:h   # stills, with hits
HXINFO=1 ...   # prints what the style drew in the last frame (gems, tubes, live particles, fields)
```

With hits (`:h`) the stills stop the clock and age the newest sparks a quarter of a second, since a frame
here takes far longer than on a real graphics card. Headless Chromium renders in software, so frame times
here say nothing about a real card; judge the cost from draw calls and shader size, and ask the user.
