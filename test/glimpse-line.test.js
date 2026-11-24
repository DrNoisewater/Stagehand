'use strict';
// TEMPORARY (4.32): Glimpse gets Stagehand's sound over a local line (glimpse-line.js).
const assert = require('assert');
const net = require('net');
const os = require('os');
const path = require('path');
const { EventEmitter } = require('events');
const { GlimpseLine, MAGIC } = require('../src/main/services/glimpse-line');
const { RigAudio } = require('../src/main/services/rigaudio');

let passed = 0;
const ok = (name) => { passed++; console.log('ok -', name); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// RigAudio with a pretend helper: records the commands it would send
function fakeRig() {
  const rig = new RigAudio({ appRoot: __dirname });
  const sent = [];
  rig.child = { stdin: { write(b) { if (b.length > 8) sent.push(JSON.parse(b.subarray(8).toString())); }, writableLength: 0 } };
  rig.ensure = () => true;
  return { rig, sent };
}
const frame = (type, f32) => {
  const h = Buffer.alloc(8);
  h.writeUInt32LE(type, 0);
  h.writeUInt32LE(f32.byteLength, 4);
  return Buffer.concat([h, Buffer.from(f32.buffer)]);
};

(async () => {
  {
    const { rig, sent } = fakeRig();
    rig.send({ cmd: 'monitor', on: 1 });
    rig.setGlimpseMonitor(true);
    rig.send({ cmd: 'monitor', on: 0 }); // the page is done; Glimpse still listens
    assert.deepStrictEqual(sent.map((c) => c.on), [1, 1, 1]);
    rig.setGlimpseMonitor(false);
    assert.strictEqual(sent.at(-1).on, 0);
    ok('the page and Glimpse share the engine switch: on while either wants it');
  }
  {
    const { rig, sent } = fakeRig();
    rig.setGlimpseMonitor(true);
    sent.length = 0;
    rig._event({ ev: 'started', rate: 44100, mode: 'exclusive' });
    assert.deepStrictEqual(sent, [{ cmd: 'monitor', on: 1 }]);
    ok('a restarted engine is asked again while Glimpse listens');
  }
  {
    const { rig } = fakeRig();
    const toPage = [];
    rig.ports.add({ kind: 'control', port: { postMessage: (m) => toPage.push(m.t) } });
    const mixes = [];
    rig.on('mix', (f, r) => mixes.push([f.length, r]));
    rig.lastStarted = { rate: 44100 };
    rig.setGlimpseMonitor(true);
    rig._data(Buffer.concat([frame(5, new Float32Array(8)), frame(4, new Float32Array(8)), frame(3, new Float32Array(4))]));
    assert.deepStrictEqual(mixes, [[8, 44100]]);
    assert.deepStrictEqual(toPage, ['in']);
    rig.send({ cmd: 'monitor', on: 1 });
    rig._data(frame(5, new Float32Array(8)));
    assert.deepStrictEqual(toPage, ['in', 'mixed']);
    ok('the mix goes to Glimpse; the page only gets it when it asked');
  }
  {
    const rig = new EventEmitter();
    const asks = [];
    rig.setGlimpseMonitor = (on) => asks.push(on);
    const pipe = path.join(os.tmpdir(), `sh-glimpse-test-${process.pid}.sock`);
    const line = new GlimpseLine({ rigAudio: rig, pipe });
    line.start();
    await wait(50);
    rig.emit('mix', new Float32Array([0.5, -0.5]), 48000); // nobody listening: nothing happens
    const got = [];
    const sock = net.connect(pipe);
    sock.on('data', (d) => got.push(d));
    await wait(100);
    assert.deepStrictEqual(asks, [true]);
    rig.emit('mix', new Float32Array([0.25, -0.25, 0.5, -0.5]), 44100);
    await wait(100);
    const b = Buffer.concat(got);
    assert.strictEqual(b.length, 16 + 16);
    assert.strictEqual(b.readUInt32LE(0), MAGIC);
    assert.strictEqual(b.readUInt32LE(4), 44100);
    assert.strictEqual(b.readUInt32LE(8), 2);
    assert.strictEqual(b.readFloatLE(16), 0.25);
    assert.strictEqual(b.readFloatLE(28), -0.5);
    sock.destroy();
    await wait(100);
    assert.deepStrictEqual(asks, [true, false]);
    line.stop();
    ok('Glimpse connects, gets the sound as packets, and the engine is let off when it goes');
  }
  console.log(`glimpse-line: ${passed} passed`);
})().catch((e) => { console.error(e); process.exit(1); });
