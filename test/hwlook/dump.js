const { Psarc } = require('../../src/main/core/psarc');
const { readSongs } = require('../../src/main/core/rocksmith');
const { TabService } = require('../../src/main/services/tabs');
(async () => {
  const f = process.argv[2];
  const p = await Psarc.open(f);
  const songs = await readSongs(p);
  await p.close();
  const song = { ...songs[0], path: f, mtimeMs: 1 };
  const ts = new TabService();
  const parts = ts.list(song);
  const out = {};
  for (const part of parts) out[part.type] = await ts.load(song, part.id, { withLyrics: false });
  require('fs').writeFileSync(process.argv[3], JSON.stringify(out));
  console.log(parts.map((x) => x.type), Object.values(out).map((t) => [t.strings, t.notes.length, t.chordEvents.length, t.anchors.length, t.notes[0] && t.notes[0].t]));
})();
