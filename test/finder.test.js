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
