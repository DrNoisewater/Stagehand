// The app's bridge to the main process. Only tabs are real here; anything else other
// modules call when they load (api.on(...), api.settings.get(), ...) quietly does nothing.
const real = { stems: { status: async () => window.__stems || null }, stats: { log: async (x) => ((window.__statsLogs = window.__statsLogs || []).push(x), x) }, app: { fullscreen: async () => {} }, tab: { list: async () => window.__parts, load: async (id, part) => (window.__tabs && window.__tabs[part]) || window.__tab } };
const quiet = (path) => new Proxy(function () {}, {
  get(_, k) {
    if (k === 'then') return undefined; // not a promise
    if (k === 'on' || k === 'off' || k === 'once') return () => () => {};
    return quiet(path + '.' + String(k));
  },
  apply: () => Promise.resolve(null),
});
const wrap = (obj, path) => new Proxy(obj, { get: (o, k) => (k in o ? (typeof o[k] === 'object' && o[k] ? wrap(o[k], path + '.' + String(k)) : o[k]) : k === 'then' ? undefined : k === 'on' || k === 'off' ? () => () => {} : quiet(path + '.' + String(k))) });
export const api = wrap(real, 'api');
