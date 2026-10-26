/* The Stagehand amp engine (WebAssembly build of native/dsp) inside an
 * AudioWorklet: used when the native sound engine isn't available. */
const MAXN = 4096;

class StagehandRigDsp extends AudioWorkletProcessor {
  constructor() {
    super();
    this.x = null;
    this.q = 0;
    this.port.onmessage = (e) => this.onMessage(e.data);
  }

  views() {
    const b = this.x.memory.buffer;
    if (this.mem !== b) {
      this.mem = b;
      this.inb = new Float32Array(b, this.x.buf_in(), MAXN);
      this.L = new Float32Array(b, this.x.buf_l(), MAXN);
      this.R = new Float32Array(b, this.x.buf_r(), MAXN);
      this.M = new Float32Array(b, this.x.buf_meter(), 5);
    }
  }

  onMessage(m) {
    try {
      if (m.type === 'init') {
        // Modules can't always be posted into a worklet, so it arrives as bytes.
        const mod = m.module || new WebAssembly.Module(m.bytes);
        const inst = new WebAssembly.Instance(mod, {});
        const x = inst.exports;
        const need = x.mem_needed();
        const have = x.memory.buffer.byteLength;
        if (need > have) x.memory.grow(Math.ceil((need - have) / 65536));
        if (!x.init(sampleRate)) throw new Error('init failed');
        this.x = x;
        this.port.postMessage({ type: 'ready', rate: sampleRate });
        return;
      }
      if (!this.x) return;
      const x = this.x;
      if (m.type === 'build') {
        const bytes = m.bytes; /* UTF-8, encoded on the page */
        const mem = new Uint8Array(x.memory.buffer, x.buf_spec(), 16384);
        mem.set(bytes.subarray(0, 16383));
        mem[Math.min(bytes.length, 16383)] = 0;
        const ok = x.build(m.slot);
        this.port.postMessage({ type: 'built', slot: m.slot, ok: !!ok, id: m.id });
      } else if (m.type === 'select') x.select(m.slot);
      else if (m.type === 'param') x.param(m.id, m.v);
      else if (m.type === 'nam') {
        // a real amp capture (.nam text) for a slot, before it's built
        const n = m.bytes ? m.bytes.length : 0;
        let ok = 0;
        let error = '';
        if (n > x.buf_nam_size()) error = 'That capture is too large.';
        else {
          if (n) new Uint8Array(x.memory.buffer, x.buf_nam(), n).set(m.bytes);
          ok = x.set_nam(m.slot, n, m.fullRig ? 1 : 0, m.gainRef ?? 0.5, m.trim || 0);
          if (!ok) {
            const p = x.nam_error();
            const b = new Uint8Array(x.memory.buffer, p, 200);
            let e = 0;
            while (e < 200 && b[e]) e++;
            error = new TextDecoder().decode(b.subarray(0, e));
            x.set_nam(m.slot, 0, 0, 0.5, 0);
          }
        }
        this.port.postMessage({ type: 'nam', slot: m.slot, id: m.id, ok: !!ok, error });
      } else if (m.type === 'ir') {
        const n = m.data ? Math.min(8192, m.data.length) : 0;
        if (n) new Float32Array(x.memory.buffer, x.buf_ir(), 8192).set(m.data.subarray(0, n));
        x.set_ir(m.slot, n);
      }
    } catch (err) {
      this.port.postMessage({ type: 'error', message: String((err && err.message) || err) });
    }
  }

  process(inputs, outputs) {
    const out = outputs[0];
    if (!this.x) return true;
    this.views();
    const inp = inputs[0] && inputs[0][0];
    const n = out[0].length;
    if (inp) this.inb.set(inp);
    else this.inb.fill(0, 0, n);
    this.x.process(n);
    out[0].set(this.L.subarray(0, n));
    if (out[1]) out[1].set(this.R.subarray(0, n));
    if (++this.q >= 18) {
      this.q = 0;
      this.x.meters();
      this.port.postMessage({ type: 'meters', m: Array.from(this.M) });
    }
    return true;
  }
}

registerProcessor('stagehand-rig-dsp', StagehandRigDsp);
