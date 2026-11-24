// Quitting and starting the sound engine: the helper is stopped (and ended if it hangs),
// anything it started goes with it (Windows taskkill /T), a leftover helper from an earlier
// run is ended before a start on Windows only. No Electron needed; Windows is pretended.
const assert = require('assert');
const cp = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const realPlatform = Object.getOwnPropertyDescriptor(process, 'platform');
const setPlatform = (v) => Object.defineProperty(process, 'platform', { value: v });
const realSpawn = cp.spawn;
const realSpawnSync = cp.spawnSync;
// The pretend helpers are Node scripts: run them with Node, so the test works on Windows too.
const nodeSpawn = (cmd, args = [], o) => (String(cmd).endsWith('.fake.js') ? realSpawn(process.execPath, [cmd, ...args], o) : realSpawn(cmd, args, o));
cp.spawn = nodeSpawn;
const SLEEP = [process.execPath, ['-e', 'setTimeout(() => {}, 30000)']];

const proctree = require('../src/main/services/proctree');
const { RigAudio } = require('../src/main/services/rigaudio');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sh-shutdown-'));
// A pretend helper: starts a child of its own, and either leaves when asked or ignores everything.
const fake = (name, hangs) => {
  const f = path.join(tmp, name + '.fake.js');
  fs.writeFileSync(
    f,
    `const { spawn } = require('child_process');\nconst g = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 30000)'], { stdio: 'ignore' });\nprocess.stdout.write(String(g.pid) + '\\n');\n` +
      (hangs ? 'setInterval(() => {}, 1000);\n' : "process.stdin.on('end', () => { try { process.kill(g.pid); } catch (_) {} process.exit(0); });\nprocess.stdin.resume();\n"),
    { mode: 0o755 }
  );
  return f;
};
const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (_) {
    return false;
  }
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  // start-up cleanup: only on Windows, by image name, tree and force
  {
    const calls = [];
    cp.spawnSync = (...a) => (calls.push(a), { status: 0 });
    setPlatform('linux');
    assert.strictEqual(proctree.killLeftovers('stagehand-audio.exe'), false);
    setPlatform(realPlatform.value);
    assert.strictEqual(calls.length, 0, 'nothing is ended off Windows');
    setPlatform('win32');
    assert.strictEqual(proctree.killLeftovers('stagehand-audio.exe'), true);
    setPlatform(realPlatform.value);
    assert.strictEqual(calls.length, 1);
    assert.strictEqual(calls[0][0], 'taskkill');
    assert.deepStrictEqual(calls[0][1], ['/IM', 'stagehand-audio.exe', '/T', '/F']);
    cp.spawnSync = (...a) => {
      throw new Error('taskkill missing');
    };
    setPlatform('win32');
    assert.doesNotThrow(() => proctree.killLeftovers('x.exe'), 'a failed cleanup is ignored');
    setPlatform(realPlatform.value);
    cp.spawnSync = realSpawnSync;
    console.log('ok   leftover cleanup runs on Windows only');
  }

  // the first start cleans up once, before the helper starts; Linux never does
  for (const plat of ['linux', 'win32']) {
    const calls = [];
    cp.spawnSync = (...a) => (calls.push(a), { status: 0 });
    process.env.STAGEHAND_AUDIO_HELPER = fake('ok-' + plat, false);
    const r = new RigAudio({ appRoot: tmp });
    setPlatform(plat);
    assert.ok(r.ensure());
    assert.ok(r.ensure());
    setPlatform(realPlatform.value);
    cp.spawnSync = realSpawnSync;
    assert.strictEqual(calls.length, plat === 'win32' ? 1 : 0, plat + ' cleanup count');
    if (plat === 'win32') assert.ok(calls[0][1].includes('/IM'));
    await r.quit(1500);
    assert.strictEqual(r.child, null);
  }
  console.log('ok   start-up cleanup once, Windows only');

  // quit: a helper that leaves when asked is waited for; one that hangs is ended after the wait
  for (const hangs of [false, true]) {
    process.env.STAGEHAND_AUDIO_HELPER = fake('h' + hangs, hangs);
    const r = new RigAudio({ appRoot: tmp });
    assert.ok(r.ensure());
    const c = r.child;
    const gpid = await new Promise((res) => c.stdout.once('data', (d) => res(Number(String(d).trim()))));
    const t = Date.now();
    await r.quit(hangs ? 400 : 3000);
    const took = Date.now() - t;
    await wait(200);
    assert.ok(c.exitCode !== null || c.signalCode, 'helper is gone');
    assert.ok(hangs ? took >= 350 && took < 1500 : took < 2500, `quit took ${took} ms (hangs ${hangs})`);
    try {
      process.kill(gpid);
    } catch (_) {}
  }
  console.log('ok   quit stops or ends the helper');

  // on Windows the whole tree is ended with taskkill /T /F
  {
    const calls = [];
    cp.spawn = (cmd, args, o) => {
      calls.push([cmd, args]);
      const e = new (require('events'))();
      setImmediate(() => e.emit('exit', 0));
      return e;
    };
    const kills = [];
    const child = Object.assign(new (require('events'))(), { pid: 4242, exitCode: null, kill: () => kills.push(1) });
    setPlatform('win32');
    proctree.killTree(child);
    proctree.killTree(child); // a second call does nothing
    setPlatform(realPlatform.value);
    await wait(20);
    cp.spawn = nodeSpawn;
    assert.strictEqual(calls.length, 1);
    assert.deepStrictEqual(calls[0], ['taskkill', ['/PID', '4242', '/T', '/F']]);
    assert.ok(kills.length >= 1);
    console.log('ok   Windows kill takes the whole tree');
  }

  // tracked children (decoder, video saving) are all ended on quit, and forgotten when they exit
  {
    const a = realSpawn(...SLEEP, { stdio: 'ignore' });
    const b = realSpawn(...SLEEP, { stdio: 'ignore' });
    proctree.track(a);
    proctree.track(b);
    b.kill();
    await new Promise((r) => b.once('exit', r));
    proctree.killTracked();
    await new Promise((r) => a.once('exit', r));
    assert.ok(a.signalCode || a.exitCode !== null);
    console.log('ok   tracked children are ended on quit');
  }
  fs.rmSync(tmp, { recursive: true, force: true });
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
