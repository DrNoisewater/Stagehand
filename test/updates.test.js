// Updates (4.1.4): finding a newer release on GitHub, downloading its Setup (checked
// against GitHub's size and SHA-256), starting it with /update. A pretend GitHub.
const assert = require('assert');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { Updates, compareVersions, notesFrom } = require('../src/main/services/updates');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sh-updates-'));
let fails = 0;
const ok = (c, m) => (c ? console.log(`ok   ${m}`) : (fails++, console.log(`FAIL ${m}`)));

(async () => {
  // versions
  ok(compareVersions('4.1.10', '4.1.9') === 1 && compareVersions('v4.1.3', '4.1.3') === 0 && compareVersions('4.0.9', '4.1.0') === -1, 'versions compare as numbers (4.1.10 is newer than 4.1.9)');
  const notes = notesFrom("**Download Stagehand-Setup-4.1.4.exe below**\n\n## What's Changed\n* Stagehand 4.1.4: updates from inside Stagehand by @DrNoisewater in https://github.com/DrNoisewater/Stagehand/pull/19\n\n**Full Changelog**: x");
  ok(notes.length === 1 && notes[0] === 'updates from inside Stagehand', `what's new comes from the release notes, tidied (“${notes[0]}”)`);

  // a pretend GitHub: the release, and its Setup
  const setup = crypto.randomBytes(300 * 1024);
  let serve = setup;
  let hits = 0;
  const server = http.createServer((req, res) => {
    if (req.url === '/repos/DrNoisewater/Stagehand/releases/latest') {
      res.setHeader('Content-Type', 'application/json');
      return res.end(JSON.stringify({ tag_name: 'v4.1.4', html_url: 'https://github.com/DrNoisewater/Stagehand/releases/tag/v4.1.4', body: "## What's Changed\n* Stagehand 4.1.4: updates by @x in https://x/1", assets: [{ name: 'Stagehand-Setup-4.1.4.exe', size: setup.length, digest: `sha256:${crypto.createHash('sha256').update(setup).digest('hex')}`, browser_download_url: `http://127.0.0.1:${server.address().port}/dl/Stagehand-Setup-4.1.4.exe` }] }));
    }
    if (req.url.startsWith('/dl/')) {
      hits++;
      res.setHeader('Content-Length', serve.length);
      return res.end(serve);
    }
    res.writeHead(404).end();
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const fakeFetch = (url, opts) => fetch(url.replace('https://api.github.com', base), opts);
  const spawned = [];
  const make = (current, platform = 'win32') => new Updates({ current, dir: path.join(tmp, 'Updates'), fetchImpl: fakeFetch, platform, spawnImpl: (file, args, opts) => (spawned.push({ file, args, opts }), { unref() {} }) });

  const up = make('4.1.3');
  const st = await up.check();
  ok(st.available && st.latest === '4.1.4' && st.current === '4.1.3', 'a newer version is found (4.1.3 → 4.1.4)');
  ok(st.notes[0] === 'updates', 'with what’s new');
  const same = await make('4.1.4').check();
  ok(!same.available, 'the same version: nothing to update');
  const newer = await make('4.2.0').check();
  ok(!newer.available, 'a newer copy than GitHub’s: nothing to update');

  // download, checked
  const seen = [];
  const file = await up.download((p) => seen.push(p));
  ok(fs.readFileSync(file).equals(setup), 'the Setup downloads whole');
  ok(seen.length > 0 && seen[seen.length - 1] === 1, `progress reaches 100% (${seen.length} updates)`);
  await up.download();
  ok(hits === 1, 'a second time it uses the one already downloaded');

  // damaged on the way: thrown away
  fs.rmSync(file);
  serve = Buffer.concat([setup.subarray(0, 1000), Buffer.alloc(setup.length - 1000)]);
  let err = null;
  await up.download().catch((e) => (err = e));
  ok(err && /damaged/.test(err.message) && !fs.existsSync(file) && !fs.existsSync(`${file}.part`), `a damaged download is thrown away (“${err && err.message}”)`);
  serve = setup;

  // install: Setup on its own, with /update
  const got = await up.download();
  up.install(got);
  ok(spawned.length === 1 && spawned[0].args.join(' ') === '/update' && spawned[0].opts.detached, 'Setup starts on its own with /update (it closes Stagehand and opens the new one)');
  let threw = null;
  try {
    make('4.1.3', 'linux').install(got);
  } catch (e) {
    threw = e;
  }
  ok(threw && /Windows/.test(threw.message), 'only on Windows');
  const lin = await make('4.1.3', 'linux').check();
  ok(lin.available && !lin.canInstall, 'elsewhere it says there is an update, with the page to get it');

  // no internet: says so, never throws
  const off = new Updates({ current: '4.1.3', dir: tmp, fetchImpl: () => Promise.reject(new TypeError('fetch failed')) });
  const o = await off.check();
  ok(/internet/.test(o.error) && !o.available, `no internet: “${o.error}”`);

  // tidy: older Setups go, the newest stays
  fs.writeFileSync(path.join(tmp, 'Updates', 'Stagehand-Setup-4.1.2.exe'), 'old');
  await up.tidy();
  ok(!fs.existsSync(path.join(tmp, 'Updates', 'Stagehand-Setup-4.1.2.exe')) && fs.existsSync(got), 'older downloaded Setups are cleared, the newest kept');

  server.close();
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(fails ? `${fails} failed` : 'updates: all passed');
  process.exit(fails ? 1 : 0);
})().catch((e) => {
  console.error('FAIL', e);
  process.exit(1);
});
