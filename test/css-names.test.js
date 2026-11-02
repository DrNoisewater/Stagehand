// 4.0.8: "empty" is the name of the page-wide "nothing here yet" message (app.css: it fills
// the whole page). An empty key on Tones used it too and covered the whole window like one
// big button. Only that message may use it; anything else that is empty is "vacant".
const fs = require('fs');
const path = require('path');
const dir = path.join(__dirname, '..', 'src', 'renderer', 'js');
const bad = [];
for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.js'))) {
  fs.readFileSync(path.join(dir, f), 'utf8').split('\n').forEach((line, i) => {
    // h('tag.something.empty…'), `….empty'` added to another class, classList.add('empty')
    if (/\.empty['`$]/.test(line) && !/h\(['`]div\.empty['`]/.test(line)) bad.push(`${f}:${i + 1}: ${line.trim().slice(0, 100)}`);
    if (/classList\.(add|toggle)\(['"]empty['"]/.test(line)) bad.push(`${f}:${i + 1}: ${line.trim().slice(0, 100)}`);
  });
}
if (bad.length) {
  console.error('FAIL these use the page-wide "empty" style (it covers the whole page):\n' + bad.join('\n'));
  process.exit(1);
}
console.log('ok   only the page-wide message is called "empty"');
