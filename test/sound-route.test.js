/**
 * 4.1.2 guard: every sound Stagehand plays must go through its own sound path
 * (engine.extraOut(), which reaches the sound engine like the song). Sound played the
 * ordinary way goes to Windows' default speakers, and while the sound engine has the
 * speakers to itself (fastest mode) it is shut out: recorded videos seemed to have no
 * sound, over and over. This test fails if a page plays a video or audio file without
 * sending it into that path, or makes its own audio player outside the known places.
 */
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const DIR = path.join(__dirname, '..', 'src', 'renderer', 'js');
const files = fs.readdirSync(DIR).filter((f) => f.endsWith('.js'));
let failures = 0;
const fail = (m) => {
  failures++;
  console.log('FAIL ' + m);
};

// places allowed to make their own audio player: the song player, the rig's own
// engines, and the hidden recording tap (sink "none", never heard)
const OWN_CONTEXT_OK = new Set(['audio-engine.js', 'rig.js']);
const MEDIA = /h\(\s*[^)]*['"](video|audio)['"]|createElement\(\s*['"](video|audio)['"]\)|new Audio\(/;

for (const f of files) {
  const src = fs.readFileSync(path.join(DIR, f), 'utf8');
  if (MEDIA.test(src)) {
    if (!/createMediaElementSource\(/.test(src) || !/extraOut\(/.test(src)) fail(`${f} plays a video or audio file without sending it through engine.extraOut()`);
    else if (!/crossOrigin/.test(src)) fail(`${f} sends a recording into the sound path without crossOrigin: the browser would pass silence`);
  }
  if (/new\s+\(?\s*(window\.)?(webkit)?AudioContext\b/.test(src) && !OWN_CONTEXT_OK.has(f)) fail(`${f} makes its own audio player; use engine.extraOut() so it reaches the sound engine`);
}

// the recordings server must let the app's page read the sound (else silence)
const main = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'main.js'), 'utf8');
assert(/u\.host === 'take'[\s\S]{0,400}Access-Control-Allow-Origin/.test(main), 'recordings are served with Access-Control-Allow-Origin');

if (failures) process.exit(1);
console.log('sound-route: every player goes through the sound engine');
