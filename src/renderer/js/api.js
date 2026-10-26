/** Bridge to the main process (exposed by preload.js), unwrapping result envelopes. */
function unwrap(fn) {
  return async (...args) => {
    const r = await fn(...args);
    if (!r || !r.__sh) return r;
    if (r.ok) return r.value;
    const e = new Error(r.error || 'Something went wrong');
    e.code = r.code || null;
    e.field = r.field || null;
    throw e;
  };
}

function wrap(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (typeof v === 'function') out[k] = k === 'on' || k === 'artUrl' || k === 'coverUrl' || k === 'pathFor' || k === 'takeUrl' ? v : unwrap(v);
    else if (v && typeof v === 'object') out[k] = wrap(v);
    else out[k] = v;
  }
  return out;
}

export const api = wrap(window.stagehand);
