// Duplicate songs: grouping and which copy is kept.
const assert = require('assert');
const os = require('os');
const fs = require('fs');
const path = require('path');
const { findDuplicates, normTitle, Dupes } = require('../src/main/services/dupes');
let bad = 0;
const ok = (c, m) => { console.log(c ? 'ok  ' : 'FAIL', m); if (!c) bad++; };
const arr = (...t) => t.map((type) => ({ type }));
const songs = [
  { id: 'a', title: 'Sugar', artist: 'System Of A Down', fileName: 'System-Of-A-Down_Sugar_v1_p.psarc', audioEntry: 'x.wem', arrangements: arr('lead', 'bass'), packageVersion: '1' },
  { id: 'b', title: 'Sugar (DD)', artist: 'System of a Down', fileName: 'SOAD_Sugar_v3_DD_p.psarc', audioEntry: 'y.wem', arrangements: arr('lead', 'bass', 'rhythm'), packageVersion: '3' },
  { id: 'c', title: 'Sugar', artist: 'System Of A Down', fileName: 'broken_p.psarc', audioEntry: null, arrangements: arr('lead', 'rhythm', 'bass', 'vocals'), packageVersion: '9' },
  { id: 'd', title: 'Sugar (Live)', artist: 'System Of A Down', fileName: 'live_p.psarc', audioEntry: 'z.wem', arrangements: arr('lead') },
  { id: 'e', title: 'Toxicity', artist: 'System Of A Down', fileName: 't_p.psarc', audioEntry: 'z.wem', arrangements: arr('lead') },
];
const g = findDuplicates(songs);
ok(g.length === 1 && g[0].items.length === 3, `the three copies of Sugar are one group (Live and Toxicity aren't): ${g.map((x) => x.items.map((i) => i.id).join(',')).join(' | ')}`);
ok(g[0].keep === 'b', 'keeps the copy with audio and the most parts, newest version');
ok(g[0].items.find((i) => i.id === 'c').remove && !g[0].items.find((i) => i.id === 'c').audio, 'the copy without audio goes, even with more parts');
ok(normTitle('The Song (Remastered 2011) [DD]') === 'song' && normTitle('Song (Live)') === 'song live', 'version noise is ignored, real words kept');

// moving aside and undo
(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dupes-'));
  const f1 = path.join(tmp, 'dlc', 'a_p.psarc');
  const f2 = path.join(tmp, 'dlc', 'b_p.psarc');
  fs.mkdirSync(path.dirname(f1), { recursive: true });
  fs.writeFileSync(f1, 'A');
  fs.writeFileSync(f2, 'B');
  const data = { songs: { a: { id: 'a', path: f1, user: { fav: true, plays: 3 } }, b: { id: 'b', path: f2, user: { plays: 1 } } }, setlists: [{ id: 's', songIds: ['a'] }] };
  const forgot = [];
  const refreshed = [];
  const lib = {
    data,
    get: (id) => data.songs[id],
    songsInFile: (p) => Object.values(data.songs).filter((s) => s.path === p),
    setUser: (id, p) => (data.songs[id].user = { ...data.songs[id].user, ...p }),
    forgetFile: (p) => (forgot.push(p), Object.keys(data.songs).forEach((k) => data.songs[k].path === p && delete data.songs[k])),
    refreshFile: async (p) => refreshed.push(p),
    saveSoon() {},
  };
  const d = new Dupes({ library: lib, dir: path.join(tmp, 'Duplicates') });
  const r = await d.remove([{ remove: 'a', keep: 'b' }]);
  ok(r.moved === 1 && !fs.existsSync(f1) && forgot[0] === f1, 'the extra copy is moved out of the song folder');
  ok(data.songs.b.user.fav && data.songs.b.user.plays === 4 && data.setlists[0].songIds[0] === 'b', 'favourite, plays and setlist place carry over to the copy kept');
  const u = await d.undo(r.id);
  ok(u.restored === 1 && fs.readFileSync(f1, 'utf8') === 'A' && refreshed[0] === f1, 'Undo puts it back');
  fs.rmSync(tmp, { recursive: true, force: true });
  if (bad) process.exit(1);
  console.log('all ok');
})();
