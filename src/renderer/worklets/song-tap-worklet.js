/* Sends the player's final mix to the native sound engine, which plays it
 * alongside your guitar.
 *   direct: straight from this thread to the main process over a MessagePort;
 *   relay:  through the page (this node's own port), in case a port can't
 *           reach the main process from here.
 * Audio is always copied, never transferred: the main process can't take
 * transferred buffers. */
const CHUNK = 512;

class StagehandSongTap extends AudioWorkletProcessor {
  constructor() {
    super();
    this.out = null;
    this.relay = false;
    this.buf = new Float32Array(CHUNK * 2);
    this.n = 0;
    this.port.onmessage = (e) => {
      const m = e.data;
      if (!m) return;
      if (m.type === 'port') {
        this.out = m.port || null;
        this.n = 0;
      } else if (m.type === 'relay') {
        this.relay = !!m.on;
        this.n = 0;
      }
    };
  }

  process(inputs) {
    if (!this.out && !this.relay) return true;
    const inp = inputs[0];
    const L = inp && inp[0];
    const R = inp && (inp[1] || inp[0]);
    const len = L ? L.length : 128;
    for (let i = 0; i < len; i++) {
      this.buf[this.n * 2] = L ? L[i] : 0;
      this.buf[this.n * 2 + 1] = R ? R[i] : 0;
      if (++this.n === CHUNK) {
        const d = this.buf;
        this.buf = new Float32Array(CHUNK * 2);
        this.n = 0;
        try {
          if (this.relay) this.port.postMessage({ type: 'song', d });
          else this.out.postMessage({ t: 'song', d });
        } catch (_) {
          this.out = null;
          this.relay = true;
        }
      }
    }
    return true;
  }
}

registerProcessor('stagehand-song-tap', StagehandSongTap);
