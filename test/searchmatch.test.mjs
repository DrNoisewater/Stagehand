// 4.1.6: the search box's matching, ranking and suggestions.
const m = await import('../src/renderer/js/searchmatch.js');
let bad = 0;
const ok = (c, msg) => { console.log(c ? 'ok  ' : 'FAIL', msg); if (!c) bad++; };
const songs = [
  { id: 1, title: 'Back In Black', artist: 'AC/DC', album: 'Back In Black', tuning: 'E Standard', year: 1980, fileName: 'ACDC_Back-In-Black_v2_p.psarc' },
  { id: 2, title: 'Enter Sandman', artist: 'Metallica', album: 'Metallica', tuning: 'E Standard', year: 1991 },
  { id: 3, title: 'Smells Like Teen Spirit', artist: 'Nirvana', album: 'Nevermind', tuning: 'E Standard', year: 1991 },
  { id: 4, title: 'Black', artist: 'Pearl Jam', album: 'Ten', tuning: 'E Standard', year: 1991 },
  { id: 5, title: 'Kickstart My Heart', artist: 'Mötley Crüe', album: 'Dr. Feelgood', tuning: 'E♭ Standard', year: 1989 },
  { id: 6, title: 'Sweet Child O’ Mine', artist: "Guns N' Roses", album: 'Appetite for Destruction', tuning: 'E♭ Standard', year: 1987 },
];
const find = (q) => {
  const n = m.normText(q);
  const t = n.split(' ');
  return songs.map((s) => [s, m.matchSong(s, t, n)]).filter((x) => x[1] > 0).sort((a, b) => b[1] - a[1]).map((x) => x[0].id);
};
ok(m.normText('AC/DC') === 'ac dc' && m.normText('Mötley Crüe') === 'motley crue' && m.normText("Guns N' Roses") === 'guns n roses', 'accents and punctuation don’t matter');
ok(find('acdc')[0] === 1, 'run-together "acdc" finds AC/DC');
ok(find('motley')[0] === 5, 'no accents needed: "motley" finds Mötley Crüe');
ok(find('sweet child o mine')[0] === 6, 'curly apostrophes match plain typing');
ok(find('metalica').includes(2), 'a typo still finds Metallica');
ok(find('smels like')[0] === 3, 'typo in one word, the others exact');
ok(!find('xyzzy').length, 'nonsense finds nothing');
const b = find('black');
ok(b[0] === 4 && b[1] === 1, `the exact title ranks first ("Black" before "Back In Black": ${b})`);
ok(find('pearl black')[0] === 4 && find('pearl black').length === 1, 'artist + title words narrow it down');
ok(find('1991').length === 3, 'years match');
const g = m.suggest('meta', songs);
ok(g[0].kind === 'artist' && g[0].items[0].label === 'Metallica', `typing an artist puts the artist first (${g.map((x) => x.kind)})`);
ok(m.completion('meta', g) === 'llica', 'Tab would finish "meta" → "metallica"');
ok(m.completion('meta ', g) === '', 'nothing to finish after a space');
const e = m.suggest('eb', songs);
ok(e.some((x) => x.kind === 'tuning' && x.items[0].label === 'E♭ Standard'), 'tunings are suggested');
const sl = m.suggest('road', songs, [{ id: 's1', name: 'Road trip', songIds: [1, 2] }]);
ok(sl.some((x) => x.kind === 'setlist' && x.items[0].id === 's1'), 'setlists are suggested');
ok(m.normText('C♯ Standard') === m.normText('c# standard'), 'C♯ and C# are the same');
ok(m.suggest('', songs).length === 0, 'an empty box suggests nothing (recent searches come from the page)');
if (bad) process.exit(1);
console.log('all ok');
