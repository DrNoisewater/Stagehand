'use strict';
/* Song list names in RSMods.ini: `node test/rsmods.test.js` */
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const ini = require('../src/main/core/rsmodsini');
const { RsProfiles } = require('../src/main/services/rsprofiles');

let passed = 0;
const tests = [];
const test = (name, fn) => tests.push({ name, fn });

// Laid out like RSMods' GUI writes it (WriteSettings.WriteINI): section, then "Key = Value", CRLF.
const GUI_INI =
  ['[SongListTitles]', ...Array.from({ length: 20 }, (_, i) => `SongListTitle_${i + 1} = Define Song List ${i + 1} Here`), '[Keybinds]', 'ToggleLoopKey = VK_F8', '[Toggle Switches]', 'ToggleLoft = off', 'CustomStringColors = 0', ''].join('\r\n');

test('placeholder names count as unnamed', () => {
  assert.deepStrictEqual(ini.readTitles(GUI_INI), new Array(20).fill(null));
  assert.deepStrictEqual(ini.readTitles(''), new Array(20).fill(null));
  assert.deepStrictEqual(ini.readTitles('[SongListTitles]\nSongListTitle_2 = SONG LIST\nSongListTitle_3 = Song List 3\n').slice(0, 3), [null, null, null]);
});

test('renaming changes only those lines and keeps CRLF', () => {
  const out = ini.setTitles(GUI_INI, { 0: 'Drop D', 2: '  B Standard   riffs ' });
  const a = GUI_INI.split('\r\n');
  const b = out.split('\r\n');
  assert.strictEqual(a.length, b.length);
  const diff = a.map((l, i) => (l === b[i] ? null : i)).filter((x) => x !== null);
  assert.deepStrictEqual(diff, [1, 3]);
  assert.strictEqual(b[1], 'SongListTitle_1 = Drop D');
  assert.strictEqual(b[3], 'SongListTitle_3 = B Standard riffs');
  assert.ok(!/[^\r]\n/.test(out), 'no bare LF');
  assert.deepStrictEqual(ini.readTitles(out).slice(0, 3), ['Drop D', null, 'B Standard riffs']);
});

test('clearing a name puts the stock name back', () => {
  const named = ini.setTitles(GUI_INI, { 1: 'Warmups' });
  const back = ini.setTitles(named, { 1: '' });
  assert.ok(back.includes('SongListTitle_2 = Song List 2\r\n'));
  assert.strictEqual(ini.readTitles(back)[1], null);
});

test('adds the section or keys when missing; creates a file from nothing', () => {
  const other = '[Keybinds]\nToggleLoopKey = VK_F8\n';
  const out = ini.setTitles(other, { 4: 'Gig night' });
  assert.ok(out.startsWith(other));
  assert.deepStrictEqual(ini.readTitles(out)[4], 'Gig night');
  const partial = '[SongListTitles]\nSongListTitle_1 = One\n[Keybinds]\nX = 1\n';
  const out2 = ini.setTitles(partial, { 5: 'Six' });
  assert.strictEqual(out2, '[SongListTitles]\nSongListTitle_1 = One\nSongListTitle_6 = Six\n[Keybinds]\nX = 1\n');
  assert.strictEqual(ini.setTitles('', { 0: 'A' }), '[SongListTitles]\r\nSongListTitle_1 = A\r\n');
});

test('rejects names too long for the game', () => {
  assert.throws(() => ini.setTitles(GUI_INI, { 0: 'x'.repeat(26) }), /25 characters/);
});

function fakeGame(withMods = true) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'stagehand-rsmods-'));
  const game = path.join(root, 'steamapps', 'common', 'Rocksmith2014');
  fs.mkdirSync(path.join(game, 'dlc'), { recursive: true });
  fs.writeFileSync(path.join(game, 'Rocksmith2014.exe'), 'x');
  if (withMods) {
    fs.writeFileSync(path.join(game, 'xinput1_3.dll'), Buffer.alloc(400000));
    fs.writeFileSync(path.join(game, 'RSMods.ini'), GUI_INI);
  }
  const data = { rocksmith: { profile: null, steamDir: null, gameDir: null } };
  const svc = new RsProfiles({ settings: { get: () => data, set() {} }, backupDir: path.join(root, 'Backups'), libraryFolders: () => [path.join(game, 'dlc')] });
  return { root, game, svc };
}

test('finds the game from the library folder and renames safely', async () => {
  const { game, svc, root } = fakeGame(true);
  const before = await svc.rsmods();
  assert.strictEqual(before.gameDir, game);
  assert.strictEqual(before.installed, true);
  const r = await svc.rename({ 1: 'Warmups', 3: 'B Standard' });
  assert.deepStrictEqual(r.names.slice(0, 6), [null, 'Warmups', null, 'B Standard', null, null]);
  assert.strictEqual(r.names.length, 20, 'names for all 20 possible lists');
  assert.strictEqual(r.rsmods.installed, true);
  const text = fs.readFileSync(path.join(game, 'RSMods.ini'), 'utf8');
  assert.ok(text.includes('ToggleLoft = off') && text.includes('[Keybinds]'));
  assert.strictEqual(fs.readdirSync(path.join(root, 'Backups', 'RSMods.ini')).length, 1, 'original backed up');
  assert.deepStrictEqual(fs.readdirSync(game).filter((f) => f.includes('stagehand')), []);
});

test('works without RSMods (creates RSMods.ini) and reports it is not installed', async () => {
  const { game, svc } = fakeGame(false);
  const r = await svc.rename({ 0: 'Drop D' });
  assert.strictEqual(r.rsmods.installed, false);
  assert.strictEqual(r.names[0], 'Drop D');
  assert.strictEqual(fs.readFileSync(path.join(game, 'RSMods.ini'), 'utf8'), '[SongListTitles]\r\nSongListTitle_1 = Drop D\r\n');
});

test('finds the game through Steam library folders; explains when it cannot', async () => {
  const { root, svc } = fakeGame(true);
  const steam = path.join(root, 'Steam');
  fs.mkdirSync(path.join(steam, 'userdata'), { recursive: true });
  fs.mkdirSync(path.join(steam, 'steamapps'), { recursive: true });
  fs.writeFileSync(path.join(steam, 'steamapps', 'libraryfolders.vdf'), `"libraryfolders"\n{\n\t"0"\n\t{\n\t\t"path"\t\t"${root.replace(/\\/g, '\\\\')}"\n\t}\n}\n`);
  svc.libraryFolders = () => [];
  svc.settings.get().rocksmith.steamDir = steam;
  assert.ok((await svc.gameDir()).endsWith('Rocksmith2014'));
  svc.settings.get().rocksmith.steamDir = path.join(root, 'nowhere');
  const env = process.env.STAGEHAND_STEAM_DIR;
  delete process.env.STAGEHAND_STEAM_DIR;
  const lost = new RsProfiles({ settings: { get: () => ({ rocksmith: { steamDir: path.join(root, 'nowhere') } }), set() {} }, backupDir: root });
  lost.steamDir = async () => null;
  await assert.rejects(() => lost.rename({ 0: 'x' }), (e) => e.code === 'RS_NO_GAME');
  if (env) process.env.STAGEHAND_STEAM_DIR = env;
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
