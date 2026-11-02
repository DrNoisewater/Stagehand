/* Finding song files on the PC that aren't in the library (songfinder.js). `node test/songfinder.test.js` */
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { findSongs } = require('../src/main/services/songfinder');

(async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sh-find-'));
  const dl = path.join(root, 'Downloads');
  const deep = path.join(dl, 'packs', 'rock', 'cd1');
  fs.mkdirSync(deep, { recursive: true });
  fs.mkdirSync(path.join(dl, 'node_modules'), { recursive: true });
  for (const f of [path.join(dl, 'new_p.psarc'), path.join(deep, 'deep_p.psarc'), path.join(dl, 'have_p.psarc'), path.join(dl, 'node_modules', 'skip_p.psarc'), path.join(dl, 'notes.txt'), path.join(deep, 'new_p.psarc')]) fs.writeFileSync(f, 'x');
  const found = await findSongs([dl, path.join(root, 'missing')], { have: new Set(), haveNames: new Set(['have_p.psarc']) });
  const names = found.map((f) => f.name).sort();
  assert.deepStrictEqual(names, ['deep_p.psarc', 'new_p.psarc'], `found ${names}`);
  const shallow = await findSongs([dl], { haveNames: new Set(), depth: 1 });
  assert.ok(!shallow.some((f) => f.name === 'deep_p.psarc'), 'stays within the depth');
  fs.rmSync(root, { recursive: true, force: true });
  console.log('PASS song finder: new songs found a few folders down, library songs, duplicates and tool folders skipped');
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
