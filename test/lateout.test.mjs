// 4.18: outputs that play the guitar late (a TV over HDMI, Bluetooth) are named in the rig.
import assert from 'node:assert/strict';
import { lateKind, lateWarning } from '../src/renderer/js/lateout.js';

const cases = [
  ['LG TV (NVIDIA High Definition Audio)', 'tv'],
  ['SAMSUNG (Intel(R) Display Audio)', 'tv'],
  ['Q80 (AMD High Definition Audio Device)', 'tv'],
  ['TV (HDMI)', 'tv'],
  ['Headphones (WH-1000XM4 Hands-Free AG Audio)', 'bluetooth'],
  ['Headphones (Galaxy Buds2 Pro)', 'bluetooth'],
  ['Speakers (Realtek(R) Audio)', ''],
  ['Speakers (Realtek High Definition Audio)', ''],
  ['Headphones (Rocksmith USB Guitar Adapter)', ''],
  ['Speakers (Focusrite USB Audio)', ''],
  ['Line Out (Sound Blaster Z)', ''],
  ['', ''],
];
for (const [name, want] of cases) assert.equal(lateKind(name), want, name);
assert.match(lateWarning('LG TV (NVIDIA High Definition Audio)'), /LG TV.*Game Mode/);
assert.match(lateWarning('Headphones (Galaxy Buds2 Pro)'), /^Galaxy Buds2 Pro is Bluetooth/);
assert.equal(lateWarning('Speakers (Realtek(R) Audio)'), '');
console.log('lateout: all passed');
