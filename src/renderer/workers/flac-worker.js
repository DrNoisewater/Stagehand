// Encodes stems to FLAC off the page's main thread, so the app (and the
// highway) stays smooth. Takes a WAV file's bytes as they are (3.7: the
// unpacking happens here too) or ready Int16 left/right.
import { encodeFlac } from '../js/codec.js';

function wavLR(buffer) {
  const dv = new DataView(buffer);
  let p = 12;
  let fmt = null;
  while (p + 8 <= buffer.byteLength) {
    const id = String.fromCharCode(dv.getUint8(p), dv.getUint8(p + 1), dv.getUint8(p + 2), dv.getUint8(p + 3));
    const size = dv.getUint32(p + 4, true);
    if (id === 'fmt ') fmt = { channels: dv.getUint16(p + 10, true), rate: dv.getUint32(p + 12, true), bits: dv.getUint16(p + 22, true) };
    else if (id === 'data') {
      if (!fmt || fmt.bits !== 16) throw new Error('Only 16-bit WAV stems can be converted');
      const ch = fmt.channels;
      const frames = Math.floor(Math.min(size, buffer.byteLength - (p + 8)) / (2 * ch));
      const off = p + 8;
      const src = off % 2 === 0 ? new Int16Array(buffer, off, frames * ch) : new Int16Array(buffer.slice(off, off + frames * ch * 2));
      const l = new Int16Array(frames);
      const r = new Int16Array(frames);
      for (let i = 0, j = 0; i < frames; i++, j += ch) {
        l[i] = src[j];
        r[i] = ch > 1 ? src[j + 1] : src[j];
      }
      return { l, r, rate: fmt.rate };
    }
    p += 8 + size + (size & 1);
  }
  throw new Error('WAV has no data');
}

self.onmessage = (e) => {
  const { id } = e.data;
  try {
    let { l, r, rate } = e.data;
    if (e.data.wav) ({ l, r, rate } = wavLR(e.data.wav));
    const bytes = encodeFlac(l, r, rate);
    const buf = bytes.buffer.byteLength === bytes.byteLength ? bytes.buffer : bytes.slice().buffer;
    self.postMessage({ id, bytes: buf }, [buf]);
  } catch (err) {
    self.postMessage({ id, error: String((err && err.message) || err) });
  }
};
