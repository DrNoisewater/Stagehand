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
