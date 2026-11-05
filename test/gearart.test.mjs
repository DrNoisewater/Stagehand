// 4.1.7: every piece of gear gets a picture (Stagehand's own drawings), cabinets show their speakers.
import fs from 'node:fs';
const spec = await import('../src/renderer/js/gearspec.js');
const art = await import('../src/renderer/js/gearart.js');
const db = JSON.parse(fs.readFileSync(new URL('../src/renderer/data/gear2014.json', import.meta.url)));
spec.setGear(db);
let bad = 0;
const ok = (c, msg) => { console.log(c ? 'ok  ' : 'FAIL', msg); if (!c) bad++; };
const slotOf = (k) => (/^(Bass_)?Amp_/.test(k) ? 'amp' : /^(Bass_)?Cab_/.test(k) ? 'cab' : /^(Bass_)?Rack_/.test(k) ? 'rack' : 'pre');
const keys = Object.keys(db);
const broken = keys.filter((k) => { const s = art.gearArt({ slot: slotOf(k), key: k }); return !/^<svg[\s\S]*<\/svg>\s*$/.test(s.trim()) || /NaN|undefined/.test(s); });
ok(!broken.length, `all ${keys.length} pieces of gear get a picture${broken.length ? `; broken: ${broken.slice(0, 5)}` : ''}`);
const speakers = (k) => (art.cabArt(k).match(/r="[\d.]+" fill="rgba\(0,0,0,.28\)"/g) || []).length;
ok(speakers('4x12_straight') === 4 && speakers('2x12_closed') === 2 && speakers('1x12_open') === 1 && speakers('bass-810') === 8 && speakers('bass-115') === 1 && speakers('bass-410') === 4, 'cabinets show their speakers (4×12, 2×12, 1×12, 8×10, 1×15, 4×10)');
ok(speakers('Cab_Marshall1960AX_57_Cone') === 4 && speakers('Bass_Cab_AT810BC_57_Cone') === 8, 'and so do the game’s cabinets');
ok(/viewBox="0 0 120 92"/.test(art.ampArt('Amp_TW22')) && /viewBox="0 0 120 64"/.test(art.ampArt('Amp_MarshallJCM800')), 'combos and heads are drawn as such');
ok(art.pedalArt('Pedal_Chorus20') !== art.pedalArt('Pedal_SuperDrive'), 'pedals are coloured by what they do');
if (bad) process.exit(1);
console.log('all ok');
