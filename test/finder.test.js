/* The song finder keeps to song sites (4.12). `node test/finder.test.js` */
const assert = require('assert');
const { allowed } = require('../src/main/services/finder');

const yes = ['https://ignition4.customsforge.com/', 'https://customsforge.com/index.php?/login/', 'https://drive.google.com/file/d/x/view', 'https://drive.usercontent.google.com/download?id=x', 'https://www.dropbox.com/s/x/song.zip?dl=0', 'https://dl.dropboxusercontent.com/s/x', 'https://www.mediafire.com/file/x', 'https://download1234.mediafire.com/x/song.zip', 'https://mega.nz/file/x', 'about:blank'];
const no = ['https://example.com/', 'http://customsforge.com/', 'https://customsforge.com.evil.example/', 'https://notcustomsforge.com/', 'file:///C:/Windows', 'javascript:alert(1)', 'not a link'];
for (const u of yes) assert.ok(allowed(u), `allowed: ${u}`);
for (const u of no) assert.ok(!allowed(u), `not allowed: ${u}`);
assert.ok(allowed('http://127.0.0.1:4000/x', ['127.0.0.1:4000']), 'a test site when asked');
assert.ok(!allowed('http://127.0.0.1:4001/x', ['127.0.0.1:4000']), 'only that one');
console.log('finder: ok');

// 4.25: ads and trackers are stopped; the song site, Google sign-in and Drive, and file sites never are
const { isAdHost, AD_CSS } = require('../src/main/finder/adblock');
const ads = ['securepubads.g.doubleclick.net', 'pagead2.googlesyndication.com', 'www.googleadservices.com', 'adservice.google.com', 'www.google-analytics.com', 'c.amazon-adsystem.com', 'ib.adnxs.com', 'cdn.taboola.com', 'widgets.outbrain.com', 'static.criteo.net', 'ads.pubmatic.com', 'fastlane.rubiconproject.com', 'u.openx.net', 'contextual.media.net', 'cdn.propellerads.com', 'c1.popads.net', 'www.popcash.net', 'syndication.exoclick.com', 'https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js', 'DOUBLECLICK.NET', 'doubleclick.net.'];
const keep = ['ignition4.customsforge.com', 'customsforge.com', 'google.com', 'www.google.com', 'accounts.google.com', 'drive.google.com', 'drive.usercontent.google.com', 'docs.google.com', 'www.gstatic.com', 'fonts.googleapis.com', 'apis.google.com', 'lh3.googleusercontent.com', 'www.dropbox.com', 'www.mediafire.com', 'mega.nz', 'pixeldrain.com', 'notdoubleclick.net', 'doubleclick.net.example.com', 'media.network.com', 'mymedia.net.au', 'openx.network', '127.0.0.1', '', 'https://ignition4.customsforge.com/?q=doubleclick.net'];
for (const h of ads) assert.ok(isAdHost(h), `ad host: ${h}`);
for (const h of keep) assert.ok(!isAdHost(h), `not an ad host: ${h}`);
assert.ok(/ins\.adsbygoogle/.test(AD_CSS) && /:has\(table/.test(AD_CSS) && !/\[class\*="ad-slot"/.test(AD_CSS), 'ad boxes hidden, never one holding the song table, never "download-slot"');

// 4.25: what a results page says about the wanted song
const { verdict, simplerSearch, plainTitle } = require('../src/main/finder/results');
const want = { artist: 'The Rolling Stones', title: 'Paint It Black (Remastered 2011)' };
const row = (artist, title, official = false) => ({ artist, title, official });
assert.strictEqual(verdict(want, []), 'none');
assert.strictEqual(verdict(want, [row('Rolling Stones', 'Paint It, Black')]), 'match', 'loose names match');
assert.strictEqual(verdict(want, [row('Rolling Stones', 'Paint It Black', true)]), 'official', 'only official copies');
assert.strictEqual(verdict(want, [row('Rolling Stones', 'Paint It Black', true), row('Rolling Stones', 'Paint It Black')]), 'match', 'a custom one beside the official one');
assert.strictEqual(verdict(want, [row('Rolling Stones', 'Angie')]), 'some', 'the artist, another song');
assert.strictEqual(verdict(want, [row('Rolling Stones', 'Angie', true), row('The Rolling Stones', 'Start Me Up', true)]), 'official', 'everything shown is their official DLC');
assert.strictEqual(verdict(want, [row('Metallica', 'Paint It Black')], true), 'none', 'second search: another artist does not count');
assert.strictEqual(verdict(want, [row('Metallica', 'Paint It Black'), row('Rolling Stones', 'Paint It Black')], true), 'match');
assert.strictEqual(verdict({ artist: 'U2', title: 'One' }, [row('U2', 'One Tree Hill')]), 'some', 'a short title must match whole');
assert.strictEqual(plainTitle('Song 2 - Remastered 2011'), 'Song 2');
assert.strictEqual(plainTitle('Thing (Live at Wembley) feat. Someone'), 'Thing');
assert.strictEqual(simplerSearch(want, 'The Rolling Stones Paint It Black (Remastered 2011)'), 'Paint It Black', 'the title without its extras');
assert.strictEqual(simplerSearch({ artist: 'Blur', title: 'Up' }, 'Blur Up'), 'Blur', 'too short a title: the artist');
assert.strictEqual(simplerSearch({ artist: 'Sufjan Stevens', title: 'The Predatory Wasp of the Palisades Is Out to Get Us!' }, 'x'), 'Sufjan Stevens', 'a very long title: the artist');
assert.strictEqual(simplerSearch({ artist: '', title: 'Hello' }, 'Hello'), null, 'nothing simpler');
console.log('finder 4.25 (ads, results): ok');

// 4.26: a search's results only count once they are surely its own (the chain of false "Not available")
const { settler, STEADY } = require('../src/main/finder/results');
const EMPTY = JSON.stringify([true, []]);
const page = (o) => ({ empty: false, rows: [], fresh: false, box: null, ...o, sig: o.sig || JSON.stringify([!!o.empty, (o.rows || []).map((r) => `${r.artist}|${r.title}|`)]) });
/** Feeds readings every 300 ms for up to 15 s; returns what it settled on (or null: couldn't tell) and when. */
function run(opts, at) {
  const s = settler(opts);
  for (let t = 0; t <= 15000; t += 300) if (s.see(at(t), t)) return { rows: s.rows(), t };
  return { rows: s.rows(), t: null };
}
const oldEmpty = page({ empty: true }); // the last search's "No matching CDLC", still on screen (tagged)
const song = { artist: 'Slowpoke', title: 'Late Bloomer' };
// the bug: the old empty page sits still while a slow site looks: it must never count
let r = run({ before: EMPTY, text: 'Slowpoke Late Bloomer' }, () => oldEmpty);
assert.strictEqual(r.rows, null, 'the old "No matching CDLC", however still, is never this search\'s answer');
// …and when the slow site answers after 2.5 s, its rows are what count
r = run({ before: EMPTY, text: 'Slowpoke Late Bloomer' }, (t) => (t < 2500 ? oldEmpty : page({ rows: [{ ...song, official: false }], fresh: true })));
assert.ok(r.rows && r.rows.length === 1 && r.t >= 2500 + STEADY, `the slow answer counts, only once it shows (${r.t} ms)`);
assert.strictEqual(verdict(song, r.rows), 'match');
// a slow site with nothing either: a fresh "No matching CDLC" counts, after it shows
r = run({ before: EMPTY, text: 'Ghost' }, (t) => (t < 2500 ? oldEmpty : page({ empty: true, fresh: true })));
assert.ok(r.rows && r.rows.length === 0 && r.t >= 2500 + STEADY, `a new "No matching CDLC" counts (${r.t} ms)`);
// the site reuses its message (same tag) but shows "Loading…" between: that change is the evidence
r = run({ before: EMPTY, text: 'Ghost' }, (t) => (t < 900 ? oldEmpty : t < 2000 ? page({ sig: 'loading' }) : oldEmpty));
assert.ok(r.rows && r.rows.length === 0 && r.t >= 2000 + STEADY, `a change since Enter counts (${r.t} ms)`);
// "Loading…" (no rows, no message) never counts by itself
assert.strictEqual(run({ before: EMPTY, text: 'Ghost' }, () => page({ sig: 'loading', fresh: true })).rows, null, 'a page with neither rows nor the message: couldn\'t tell');
// the old rows of another search, still: never; the box holding someone else's words: not ours
const oldRows = page({ rows: [{ artist: 'Queen', title: 'Bohemian Rhapsody' }] });
assert.strictEqual(run({ before: oldRows.sig, text: 'Ghost' }, () => oldRows).rows, null, 'old rows sitting still are not this search\'s');
assert.strictEqual(run({ before: EMPTY, text: 'Ghost Song' }, () => page({ empty: true, fresh: true, box: 'something else' })).rows, null, 'a box with other words: not our search');
assert.ok(run({ before: EMPTY, text: 'Ghost Song' }, () => page({ empty: true, fresh: true, box: 'ghost song' })).rows, 'our words in the box (any case): ours');
assert.ok(run({ before: EMPTY, text: 'Ghost Song' }, () => page({ empty: true, fresh: true, box: '' })).rows, 'a box the site emptied: ours');
// nothing tagged (the page couldn't be read before Enter): fresh-looking means nothing
assert.strictEqual(run({ before: null, text: 'x', marked: false }, () => page({ empty: true, fresh: true })).rows, null, 'untagged page: couldn\'t tell');
// a page that keeps flickering never settles into "none"
r = run({ before: EMPTY, text: 'x' }, (t) => (Math.floor(t / 300) % 2 ? page({ empty: true, fresh: true }) : page({ sig: 'loading', fresh: true })));
assert.strictEqual(r.rows, null, 'a flickering page: couldn\'t tell');
// an earlier search's answer drawn late (after this Enter): its address names it, not this search
const lateG = page({ rows: [{ artist: 'Integration', title: 'Long Way Home' }], fresh: true, url: 'https://x.test/?q=Integration%20Long%20Way%20Home' });
const ownF = page({ empty: true, fresh: true, url: 'https://x.test/?q=Ghost+Foxtrot+Lost+Cause' });
r = run({ before: EMPTY, text: 'Ghost Foxtrot Lost Cause', others: ['Integration Long Way Home'] }, (t) => (t < 3000 ? lateG : ownF));
assert.ok(r.rows && r.rows.length === 0 && r.t >= 3000 + STEADY, `an earlier search's late answer isn't this one's (${r.t} ms)`);
assert.ok(run({ before: EMPTY, text: 'Paint It Black', others: ['The Rolling Stones Paint It Black'] }, () => page({ empty: true, fresh: true, url: 'https://x.test/?q=Paint+It+Black' })).rows, 'a shorter search after a longer one: its own address');
assert.ok(run({ before: EMPTY, text: 'Ghost', others: ['Other'] }, () => page({ empty: true, fresh: true, url: 'https://x.test/search' })).rows, 'an address naming no search: no help, no harm');
console.log('finder 4.26 (only this search\'s results count): ok');
