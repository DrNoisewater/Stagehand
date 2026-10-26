'use strict';
/* GPU detection and device advice: `node test/gpu.test.js` */
const assert = require('assert');
const gpu = require('../src/main/core/gpu');

let passed = 0;
const tests = [];
const test = (name, fn) => tests.push({ name, fn });

// What `Get-CimInstance Win32_VideoController | Select Name,AdapterCompatibility,DriverVersion | ConvertTo-Json -Compress` prints.
const CIM_1080TI = '{"Name":"NVIDIA GeForce GTX 1080 Ti","AdapterCompatibility":"NVIDIA","DriverVersion":"32.0.15.8129"}';
const CIM_TWO = '[{"Name":"Intel(R) UHD Graphics 630","AdapterCompatibility":"Intel Corporation","DriverVersion":"31.0.101.2111"},{"Name":"NVIDIA GeForce GTX 1080 Ti","AdapterCompatibility":"NVIDIA","DriverVersion":"27.21.14.6089"},{"Name":"Microsoft Basic Display Adapter","AdapterCompatibility":"(Standard display types)","DriverVersion":"10.0.19041.1"}]';
const CIM_AMD = '{"Name":"AMD Radeon RX 6800 XT","AdapterCompatibility":"Advanced Micro Devices, Inc.","DriverVersion":"31.0.24027.1012"}';
const SMI = 'NVIDIA GeForce GTX 1080 Ti, 6.1, 581.29\r\n';

test('Windows driver version converts to NVIDIA numbering', () => {
  assert.strictEqual(gpu.nvidiaDriverFromWindows('32.0.15.8129'), '581.29');
  assert.strictEqual(gpu.nvidiaDriverFromWindows('31.0.15.2849'), '528.49');
  assert.strictEqual(gpu.nvidiaDriverFromWindows('27.21.14.6089'), '460.89');
  assert.strictEqual(gpu.nvidiaDriverFromWindows('bad'), null);
});

test('parses single and multiple adapters, drops virtual ones', () => {
  const one = gpu.parseCim(CIM_1080TI);
  assert.deepStrictEqual(one.map((g) => [g.name, g.vendor, g.driver]), [['NVIDIA GeForce GTX 1080 Ti', 'nvidia', '581.29']]);
  const two = gpu.parseCim(CIM_TWO);
  assert.deepStrictEqual(two.map((g) => g.vendor), ['intel', 'nvidia']);
  assert.deepStrictEqual(gpu.parseCim('not json'), []);
});

test('parses nvidia-smi and merges compute capability', () => {
  const smi = gpu.parseSmi(SMI);
  assert.deepStrictEqual(smi[0], { name: 'NVIDIA GeForce GTX 1080 Ti', vendor: 'nvidia', computeCap: 6.1, driver: '581.29', source: 'nvidia-smi' });
  const merged = gpu.mergeGpus(gpu.parseCim(CIM_TWO), smi);
  assert.strictEqual(merged.length, 2);
  assert.strictEqual(merged[1].computeCap, 6.1);
  assert.strictEqual(merged[1].driver, '581.29');
});

test('without nvidia-smi the card name still gives the right build', () => {
  const merged = gpu.mergeGpus(gpu.parseCim(CIM_1080TI), []);
  assert.strictEqual(merged[0].computeCap, 6.1);
  assert.strictEqual(gpu.variantFor(merged[0]), 'cu126');
  assert.strictEqual(gpu.variantFor({ name: 'NVIDIA GeForce RTX 5080', computeCap: gpu.guessComputeCap('NVIDIA GeForce RTX 5080') }), 'cu128');
  assert.strictEqual(gpu.variantFor({ name: 'NVIDIA GeForce RTX 4070', computeCap: 8.9 }), 'cu126');
  assert.strictEqual(gpu.variantFor({ name: 'GTX 980', computeCap: 5.2 }), 'unsupported');
  assert.strictEqual(gpu.variantFor(null), 'cpu');
});

test('PyTorch 2.8 builds cover the 1080 Ti', () => {
  assert.ok(gpu.supportsCap('cu126', 6.1));
  assert.ok(gpu.supportsCap('cu126', 8.9)); // runs on 8.6 kernels
  assert.ok(!gpu.supportsCap('cu126', 12.0));
  assert.ok(gpu.supportsCap('cu128', 12.0));
});

const gpus1080 = gpu.mergeGpus(gpu.parseCim(CIM_1080TI), gpu.parseSmi(SMI));

test('CPU build installed with a 1080 Ti: offer the switch', () => {
  const a = gpu.advise({ installed: true, device: 'cpu', cudaBuild: null, variant: 'cpu' }, gpus1080);
  assert.strictEqual(a.kind, 'switch');
  assert.strictEqual(a.action, 'switch');
  assert.strictEqual(a.variant, 'cu126');
  assert.match(a.detail, /GTX 1080 Ti isn't being used/);
});

test('GPU build with an old driver: point at the driver', () => {
  const old = gpu.mergeGpus(gpu.parseCim(CIM_TWO), []); // driver 460.89
  const a = gpu.advise({ installed: true, device: 'cpu', cudaBuild: '12.6', variant: 'cu126', cudaError: 'The NVIDIA driver on your system is too old (found version 11020).' }, old);
  assert.strictEqual(a.kind, 'driver');
  assert.strictEqual(a.action, 'driver');
  assert.match(a.detail, /460\.89/);
});

test('working GPU, forced CPU, AMD only, and not installed', () => {
  assert.strictEqual(gpu.advise({ installed: true, device: 'cuda', deviceName: 'NVIDIA GeForce GTX 1080 Ti', cudaBuild: '12.6' }, gpus1080).kind, 'gpu');
  assert.strictEqual(gpu.advise({ installed: true, device: 'cpu', cudaBuild: '12.6' }, gpus1080, 'cpu').kind, 'cpu-chosen');
  const amd = gpu.advise({ installed: true, device: 'cpu', cudaBuild: null }, gpu.parseCim(CIM_AMD));
  assert.strictEqual(amd.kind, 'no-nvidia');
  assert.ok(!amd.action);
  assert.match(amd.detail, /RX 6800 XT/);
  assert.strictEqual(gpu.advise({ installed: false }, gpus1080).kind, 'not-installed');
});

test('GPU build that fails its test for another reason: offer a reinstall', () => {
  const a = gpu.advise({ installed: true, device: 'cpu', cudaBuild: '12.6', variant: 'cu126', cudaError: 'CUDA error: no kernel image is available for execution on the device' }, gpus1080);
  assert.strictEqual(a.kind, 'gpu-error');
  assert.strictEqual(a.action, 'switch');
});

(async () => {
  for (const t of tests) {
    try {
      await t.fn();
      passed++;
      console.log(`  ok  ${t.name}`);
    } catch (err) {
      console.log(`  FAIL ${t.name}\n       ${err.stack.split('\n').slice(0, 4).join('\n       ')}`);
      process.exitCode = 1;
    }
  }
  console.log(`\n${passed}/${tests.length} passed`);
})();
