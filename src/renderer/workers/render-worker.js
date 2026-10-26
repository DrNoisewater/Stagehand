/* Runs the amp engine (WebAssembly) over a recording, off the page's main
 * thread: tone demos and recorded takes. See js/render.js. */
const MAXN = 4096;
let modP = null;

self.onmessage = async (e) => {
  const { id, wasmUrl, spec, di, rate, params, nam } = e.data;
  try {
    if (!modP) modP = fetch(wasmUrl).then((r) => r.arrayBuffer()).then((b) => WebAssembly.compile(b));
    const mod = await modP;
    const inst = await WebAssembly.instantiate(mod, {});
    const x = inst.exports;
    const need = x.mem_needed();
    const have = x.memory.buffer.byteLength;
    if (need > have) x.memory.grow(Math.ceil((need - have) / 65536));
    if (!x.init(rate)) throw new Error('The amp engine didn’t start.');
    if (nam && nam.bytes && nam.bytes.length <= x.buf_nam_size()) {
      // the real amp capture, if the tone has one (falls back to the modelled amp)
      new Uint8Array(x.memory.buffer, x.buf_nam(), nam.bytes.length).set(nam.bytes);
      if (!x.set_nam(0, nam.bytes.length, nam.fullRig ? 1 : 0, nam.gainRef ?? 0.5, 0)) x.set_nam(0, 0, 0, 0.5, 0);
    }
    const bytes = new TextEncoder().encode(spec);
    const sp = new Uint8Array(x.memory.buffer, x.buf_spec(), 16384);
    sp.set(bytes.subarray(0, 16383));
    sp[Math.min(bytes.length, 16383)] = 0;
    if (!x.build(0)) throw new Error('That tone couldn’t be built.');
    x.select(0);
    for (const [pid, v] of params) x.param(pid, v);
    const L = new Float32Array(di.length);
    const R = new Float32Array(di.length);
    for (let w = 0; w < 4; w++) {
      new Float32Array(x.memory.buffer, x.buf_in(), MAXN).fill(0, 0, 512);
      x.process(512);
    }
    for (let i = 0; i < di.length; i += MAXN) {
      const n = Math.min(MAXN, di.length - i);
      new Float32Array(x.memory.buffer, x.buf_in(), MAXN).set(di.subarray(i, i + n));
      x.process(n);
      const b2 = x.memory.buffer;
      L.set(new Float32Array(b2, x.buf_l(), n), i);
      R.set(new Float32Array(b2, x.buf_r(), n), i);
    }
    self.postMessage({ id, L, R }, [L.buffer, R.buffer]);
  } catch (err) {
    self.postMessage({ id, error: String((err && err.message) || err) });
  }
};
