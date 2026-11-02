'use strict';
/** 4.0.4: only songs on the official DLC list (and with no creator stamp) count as official. */
const assert = require('assert');
const { OfficialList, norm } = require('../src/main/services/officiallist');
const { songs } = require('../scripts/official-songs');

const list = new OfficialList();
assert.ok(list.count > 1400, `the built-in list has the DLC songs (${list.count})`);
const off = (artist, title, extra = {}) => list.isOfficial({ artist, title, ...extra });

assert.ok(off('3 Doors Down', 'Kryptonite'));
assert.ok(off('Jimi Hendrix Experience', 'Purple Haze'), 'without "The"');
assert.ok(off('Jimi Hendrix', 'Little Wing'), 'shorter artist name');
assert.ok(off('Blue Oyster Cult', '(Don’t Fear) The Reaper'), 'accents, curly quote and brackets');
assert.ok(off('Opeth', 'Ghost of Perdition'), 'the last pack');
console.log('  ok  official songs are found');

assert.ok(!off('3 Doors Down', 'Kryptonite', { toolkit: '2.9.2' }), 'a creator stamp means custom');
assert.ok(!off('3 Doors Down', 'Kryptonite', { author: 'someone' }));
assert.ok(!off('Metallica', 'Enter Sandman'), 'never official DLC');
assert.ok(!off('Tool', 'Schism'));
assert.ok(!off('Radiohead', 'Paranoid Android'), 'artist has DLC, song does not');
assert.ok(!off('Some Band', 'Creep'), 'title is DLC, artist is not');
assert.ok(!list.isOfficial(null));
console.log('  ok  custom songs are not');

assert.strictEqual(norm('The Black Keys'), 'blackkeys');
assert.strictEqual(norm('Santana feat. Rob Thomas'), 'santana');

// the wikitext reader: row and column spans, hidden sort keys, links, notes
const wiki = `{|class="wikitable sortable"
|-
! Song
! Artist(s)
! Release year
! Pack
|-
|"[[Jeremy (song)|Jeremy]]"
|rowspan="2"|<span style="display:none">Pearl Jam</span>[[Pearl Jam]]
|1991
|colspan="2" rowspan="2"|Pearl Jam Pack
|-
|"[[Black (Pearl Jam song)|Black]]"||1991
|-
|"[[Holy Diver (song)#KSE|Holy Diver]]" ([[Dio (band)|Dio]] cover)||Killswitch Engage||2007||{{n/a}}
|-
||"[[Fly Like an Eagle (song)|Fly Like an Eagle]]"
| [[Steve Miller Band]]
|}`;
assert.deepStrictEqual(songs(wiki), [
  ['Pearl Jam', 'Jeremy'],
  ['Pearl Jam', 'Black'],
  ['Killswitch Engage', 'Holy Diver (Dio cover)'],
  ['Steve Miller Band', 'Fly Like an Eagle'],
]);
console.log('  ok  the song list reader');
console.log('officiallist: all passed');
