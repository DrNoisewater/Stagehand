// Encodes stems to FLAC off the page's main thread, so the app stays smooth.
import { encodeFlac } from '../js/codec.js';

self.onmessage = (e) => {
  const { id, l, r, rate } = e.data;
  try {
    const bytes = encodeFlac(l, r, rate);
    const buf = bytes.buffer.byteLength === bytes.byteLength ? bytes.buffer : bytes.slice().buffer;
    self.postMessage({ id, bytes: buf }, [buf]);
  } catch (err) {
    self.postMessage({ id, error: String((err && err.message) || err) });
  }
};
