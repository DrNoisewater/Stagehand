'use strict';
/* Rocksmith song lists: `node test/rsprofile.test.js` (needs python3 + cryptography). */
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');
const rs = require('../src/main/core/rssave');
const { RsProfiles } = require('../src/main/services/rsprofiles');

const TOOL = path.join(__dirname, 'rs_profile_tool.py');
const py = (...args) => JSON.parse(execFileSync(process.env.PYTHON || 'python3', [TOOL, ...args], { encoding: 'utf8' }).trim());

let passed = 0;
const tests = [];
const test = (name, fn) => tests.push({ name, fn });

function fresh() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'stagehand-rs-'));
  const steam = path.join(root, 'Steam');
  const { profile } = py('make', steam);
  const data = { rocksmith: { profile: null, steamDir: steam } };
  const settings = { get: () => data, set() {} };
  const svc = new RsProfiles({ settings, backupDir: path.join(root, 'Backups') });
  return { root, steam, profile, svc, vdf: path.join(path.dirname(path.dirname(profile)), 'remotecache.vdf'), lp: path.join(path.dirname(profile), 'LocalProfiles.json') };
}

test('decodes a profile written by an independent encoder', async () => {
  const { profile } = fresh();
  const save = rs.decode(fs.readFileSync(profile));
  const lists = rs.readLists(save.text);
  assert.deepStrictEqual(lists.lists, [['BlitzkriegBop', 'IntegrationTest'], ['CallMe'], [], [], [], []]);
  assert.deepStrictEqual(lists.favorites, ['CallMe']);
  // Stagehand's encoder reproduces it, and Python can read Stagehand's output.
  const again = rs.decode(rs.encode(save.header, save.text));
  assert.strictEqual(again.text, save.text);
});

test('finds the profile, player name and Steam account', async () => {
  const { svc } = fresh();
  const r = await svc.read();
  assert.strictEqual(r.profiles.length, 1);
  assert.strictEqual(r.profile.name, 'Jamie');
  assert.strictEqual(r.profile.accountName, 'TestPlayer');
  assert.strictEqual(r.lists[0].length, 2);
});

test('edits lists; every other byte of the profile JSON is untouched and layout stays Rocksmith-style', async () => {
  const { svc, profile } = fresh();
  const before = py('dump', profile);
  assert.ok(before.ubisoftLayout, 'fixture has Rocksmith layout');
  const r = await svc.apply([
    { list: 2, add: ['IntegrationTest', 'Señorita', 'Testtest'] },
    { list: 0, remove: ['blitzkriegbop'] },
    { list: 'favorites', add: ['IntegrationTest', 'CallMe'] },
  ]);
  assert.ok(r.changed);
  assert.strictEqual(r.added, 4); // CallMe was already a favorite
  assert.strictEqual(r.removed, 1);
  const after = py('dump', profile);
  assert.strictEqual(after.header, before.header, 'header (profile id) kept');
  assert.ok(after.ubisoftLayout, 'written text matches the layout rules exactly');
  assert.deepStrictEqual(after.json.SongListsRoot.SongLists, [['IntegrationTest'], ['CallMe'], ['IntegrationTest', 'Señorita', 'Testtest'], [], [], []]);
  assert.deepStrictEqual(after.json.FavoritesListRoot.FavoritesList, ['CallMe', 'IntegrationTest']);
  assert.ok(after.text.includes('"Se\\u00f1orita"'), 'non-ASCII written as \\u escapes like Rocksmith');
  const strip = (o) => {
    const c = JSON.parse(JSON.stringify(o));
    delete c.SongListsRoot;
    delete c.FavoritesListRoot;
    return c;
  };
  assert.deepStrictEqual(strip(after.json), strip(before.json));
  assert.ok(after.text.includes('1700000000.000000') && after.text.includes('0.500000'), 'number formatting preserved');
  assert.ok(after.text.includes('"Caf\\u00e9 Crunch"'));
});

test('updates Steam Cloud metadata and LocalProfiles to match the new file', async () => {
  const { svc, profile, vdf, lp } = fresh();
  await svc.apply([{ list: 5, set: ['A', 'B'] }]);
  const buf = fs.readFileSync(profile);
  const text = fs.readFileSync(vdf, 'utf8');
  const block = new RegExp(`"${path.basename(profile)}"\\s*\\{([^}]*)\\}`).exec(text)[1];
  assert.ok(block.includes(`"size"\t\t"${buf.length}"`));
  assert.ok(block.includes(`"sha"\t\t"${crypto.createHash('sha1').update(buf).digest('hex')}"`));
  const mtime = Math.floor(fs.statSync(profile).mtimeMs / 1000);
  assert.ok(block.includes(`"localtime"\t\t"${mtime}"`) && block.includes(`"time"\t\t"${mtime}"`));
  assert.ok(block.includes('"remotetime"\t\t"1700000000"'), 'remote time left for Steam');
  const lpDump = py('dump', lp);
  assert.strictEqual(lpDump.json.Profiles[0].LastModified, mtime);
  assert.ok(lpDump.text.includes(`${mtime}.000000`));
  const lpBlock = /"LocalProfiles\.json"\s*\{([^}]*)\}/.exec(fs.readFileSync(vdf, 'utf8'))[1];
  assert.ok(lpBlock.includes(`"sha"\t\t"${crypto.createHash('sha1').update(fs.readFileSync(lp)).digest('hex')}"`));
  assert.deepStrictEqual(fs.readdirSync(path.dirname(path.dirname(profile))).filter((f) => f.includes('stagehand')), [], 'no temp files left');
});

test('refuses while Rocksmith is running and changes nothing', async () => {
  const { svc, profile } = fresh();
  const before = fs.readFileSync(profile);
  process.env.STAGEHAND_FAKE_RS_RUNNING = '1';
  try {
    await assert.rejects(() => svc.apply([{ list: 0, add: ['X'] }]), (e) => e.code === 'RS_RUNNING');
  } finally {
    delete process.env.STAGEHAND_FAKE_RS_RUNNING;
  }
  assert.ok(fs.readFileSync(profile).equals(before));
});

test('backs up before each edit and restores exactly', async () => {
  const { svc, profile } = fresh();
  const original = fs.readFileSync(profile);
  const r1 = await svc.apply([{ list: 0, set: [] }]);
  await svc.apply([{ list: 'favorites', set: [] }]);
  const list = await svc.backups();
  assert.strictEqual(list.length, 2);
  assert.deepStrictEqual(list[1].counts.lists.slice(0, 2), [2, 1]);
  const restored = await svc.restore(r1.backupId);
  assert.deepStrictEqual(restored.lists[0], ['BlitzkriegBop', 'IntegrationTest']);
  assert.deepStrictEqual(restored.favorites, ['CallMe']);
  assert.strictEqual(rs.decode(fs.readFileSync(profile)).text, rs.decode(original).text);
  assert.strictEqual((await svc.backups()).length, 3, 'restore itself is backed up');
});

test('no-op edits write nothing', async () => {
  const { svc, profile } = fresh();
  const before = fs.readFileSync(profile);
  const r = await svc.apply([{ list: 1, add: ['callme'] }]);
  assert.strictEqual(r.changed, false);
  assert.ok(fs.readFileSync(profile).equals(before));
});

test('rejects a damaged profile without touching it', async () => {
  const { svc, profile } = fresh();
  const buf = fs.readFileSync(profile);
  buf[40] ^= 0xff;
  fs.writeFileSync(profile, buf);
  await assert.rejects(() => svc.apply([{ list: 0, add: ['X'] }]));
  assert.ok(fs.readFileSync(profile).equals(buf));
});

test('concurrent edits are applied one after another', async () => {
  const { svc } = fresh();
  await Promise.all([svc.apply([{ list: 3, add: ['A'] }]), svc.apply([{ list: 3, add: ['B'] }]), svc.apply([{ list: 4, add: ['C'] }])]);
  const r = await svc.read();
  assert.deepStrictEqual(r.lists[3], ['A', 'B']);
  assert.deepStrictEqual(r.lists[4], ['C']);
});

test('grows to 20 lists, fills list 20, refuses a 21st; layout stays Rocksmith-style', async () => {
  const { svc, profile } = fresh();
  let r;
  for (let i = 6; i < 20; i++) {
    r = await svc.apply([{ addList: true }]);
    assert.strictEqual(r.createdList, i);
  }
  assert.strictEqual(r.lists.length, 20);
  await svc.apply([{ list: 19, add: ['IntegrationTest', 'TestTest'] }, { list: 12, add: ['CallMe'] }]);
  await assert.rejects(() => svc.apply([{ addList: true }]), (e) => e.code === 'RS_MAX_LISTS');
  await assert.rejects(() => svc.apply([{ list: 20, add: ['X'] }]), (e) => e.code === 'RS_BAD_LIST');
  const d = py('dump', profile);
  assert.ok(d.ubisoftLayout, 'layout rules hold with 20 lists');
  assert.strictEqual(d.json.SongListsRoot.SongLists.length, 20);
  assert.deepStrictEqual(d.json.SongListsRoot.SongLists[19], ['IntegrationTest', 'TestTest']);
  assert.deepStrictEqual(d.json.SongListsRoot.SongLists[12], ['CallMe']);
  assert.deepStrictEqual(d.json.SongListsRoot.SongLists[0], ['BlitzkriegBop', 'IntegrationTest'], 'stock lists untouched');
  assert.strictEqual(d.json.Stats.SessionCount, 42);
});

test('removes only the last extra list; the first six always stay', async () => {
  const { svc, profile } = fresh();
  await svc.apply([{ addList: true }]);
  await svc.apply([{ addList: true }]);
  await svc.apply([{ list: 7, add: ['A'] }]);
  await assert.rejects(() => svc.apply([{ removeList: 6 }]), (e) => e.code === 'RS_BAD_LIST');
  const r = await svc.apply([{ removeList: 7 }]);
  assert.strictEqual(r.removedList, 7);
  assert.strictEqual(r.lists.length, 7);
  await svc.apply([{ removeList: 6 }]);
  await assert.rejects(() => svc.apply([{ removeList: 5 }]), (e) => e.code === 'RS_BAD_LIST');
  const d = py('dump', profile);
  assert.strictEqual(d.json.SongListsRoot.SongLists.length, 6);
  assert.ok(d.ubisoftLayout);
});

test('removing a list clears its RSMods name so a new list starts fresh', async () => {
  const { svc, root } = fresh();
  const game = path.join(root, 'Rocksmith2014');
  fs.mkdirSync(game, { recursive: true });
  fs.writeFileSync(path.join(game, 'Rocksmith2014.exe'), 'x');
  svc.settings.get().rocksmith.gameDir = game;
  await svc.apply([{ addList: true }]);
  await svc.rename({ 6: 'Extras' });
  assert.strictEqual((await svc.read()).names[6], 'Extras');
  await svc.apply([{ removeList: 6 }]);
  assert.strictEqual((await svc.read()).names[6], null);
});

(async () => {
  for (const t of tests) {
    try {
      await t.fn();
      passed++;
      console.log(`  ok  ${t.name}`);
    } catch (err) {
      console.log(`  FAIL ${t.name}\n       ${String(err.stack).split('\n').slice(0, 5).join('\n       ')}`);
      process.exitCode = 1;
    }
  }
  console.log(`\n${passed}/${tests.length} passed`);
})();
