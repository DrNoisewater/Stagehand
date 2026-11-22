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
ok(e.some((x) => x.kind === 'tuningcard' && x.items[0].id === 'E♭ Standard'), 'tunings are suggested');
const e2 = m.suggest('standard', songs);
ok(e2.some((x) => x.kind === 'tuning'), 'a half-typed tuning is still a plain tuning suggestion');
const sl = m.suggest('road', songs, [{ id: 's1', name: 'Road trip', songIds: [1, 2] }]);
ok(sl.some((x) => x.kind === 'setlist' && x.items[0].id === 's1'), 'setlists are suggested');
ok(m.normText('C♯ Standard') === m.normText('c# standard'), 'C♯ and C# are the same');
ok(m.suggest('', songs).length === 0, 'an empty box suggests nothing (recent searches come from the page)');
// 4.26: tuning words
const tw = (q) => { const r = m.tuningFromWords(q); return r && r.name; };
const cases = {
  'e flat': 'Eb Standard', 'E♭': 'Eb Standard', 'Eb': 'Eb Standard', 'eb standard': 'Eb Standard', 'E flat standard': 'Eb Standard', 'e♭ tuning': 'Eb Standard',
  'half step down': 'Eb Standard', 'Half-step down': 'Eb Standard', 'halfstep down': 'Eb Standard', 'd sharp standard': 'Eb Standard',
  'd standard': 'D Standard', 'D std': 'D Standard', 'whole step down': 'D Standard', 'full step down': 'D Standard',
  'e standard': 'E Standard', 'standard': 'E Standard', 'standard tuning': 'E Standard',
  'c standard': 'C Standard', 'c# standard': 'C# Standard', 'c sharp standard': 'C# Standard', 'Db standard': 'C# Standard', 'b standard': 'B Standard', 'bb standard': 'Bb Standard', 'b flat standard': 'Bb Standard',
  'drop d': 'Drop D', 'dropped d': 'Drop D', 'Drop D tuning': 'Drop D', 'drop c': 'Drop C', 'drop c#': 'Drop C#', 'drop c sharp': 'Drop C#', 'drop db': 'Drop C#', 'drop b': 'Drop B', 'drop a': 'Drop A', 'double drop d': 'Double Drop D',
  'open g': 'Open G', 'open d': 'Open D', 'open e': 'Open E', 'open c6': 'Open C6',
  'dadgad': 'DADGAD', 'DADGAD tuning': 'DADGAD', 'd a d g a d': 'DADGAD',
};
for (const [q, want] of Object.entries(cases)) ok(tw(q) === want, `"${q}" is ${want} (got ${tw(q)})`);
for (const q of ['', 'black', 'drop', 'open', 'back in black', 'e', 'a', 'drop x', 'open h', 'step', 'the eb band', 'standard time']) ok(tw(q) === null, `"${q}" is not a tuning`);
ok(m.tuningFromWords('e flat').label === 'E♭ Standard' && m.tuningFromWords('drop c#').label === 'Drop C♯' && m.tuningFromWords('c# standard').label === 'C♯ Standard', 'cards read E♭, C♯');
ok(m.tuningFromWords('eb').strict === false && m.tuningFromWords('eb standard').strict === true, 'a bare "eb" is loose, "eb standard" is strict');
const tsongs = [...songs, { id: 7, title: 'Hysteria', artist: 'Muse', tuning: 'Eb Standard' }, { id: 8, title: 'Holiday', artist: 'Green Day', tuning: 'Drop D' }];
const card = m.suggest('e flat', tsongs);
ok(card[0].kind === 'tuningcard' && card[0].items[0].n === 3 && card[0].items[0].label === 'Tuning: E♭ Standard' && card[0].items[0].sub === '3 songs', `the tuning card comes first with the count (${JSON.stringify(card[0])})`);
ok(!card.some((x) => x.kind === 'tuning' && x.items.some((i) => m.normText(i.id) === 'eb standard')), 'the same tuning is not listed twice');
ok(m.suggest('drop d', tsongs)[0].items[0].n === 1, 'drop d counts 1 song');
ok(m.suggest('drop c', tsongs)[0].items[0].n === 0, 'a tuning with no songs says 0');
ok(m.suggest('metallica', tsongs).every((x) => x.kind !== 'tuningcard'), 'no card for ordinary words');
ok(m.inTuning(songs[4], 'Eb Standard') && !m.inTuning(songs[0], 'Eb Standard'), 'songs are found by tuning, E♭ or Eb');
if (bad) process.exit(1);
console.log('all ok');
