'use strict';
const { contextBridge, ipcRenderer, webUtils } = require('electron');

// Errors lose their extra fields when they cross the context bridge, so
// results travel as plain envelopes and the page unwraps them (js/api.js).
async function call(channel, ...args) {
  const r = await ipcRenderer.invoke(channel, ...args);
  return { __sh: true, ...(r || { ok: false, error: 'Something went wrong' }) };
}

const EVENTS = new Set(['nav:back', 
  'library:reset',
  'library:songs',
  'scan:progress',
  'stems:update',
  'stems:done',
  'stems:model',
  'engine:progress',
  'tools:progress',
  'edit:progress',
  'engine:changed',
  'discover:progress',
  'discover:gaps',
  'import:update',
  'import:done',
  'rocksmith:changed',
  'captures:change',
  'tones:progress',
]);

contextBridge.exposeInMainWorld('stagehand', {
  app: {
    info: () => call('app:info'),
    log: () => call('app:log'),
    titleBar: (colors) => call('win:titlebar', colors),
    fullscreen: (on) => call('win:fullscreen', on),
  },
  library: {
    get: () => call('library:get'),
    addFolder: (p) => call('library:addFolder', p),
    removeFolder: (p) => call('library:removeFolder', p),
    rescan: (opts) => call('library:rescan', opts),
    detect: () => call('library:detect'),
    removeSongs: (ids) => call('library:removeSongs', ids),
    findDuplicates: (stemIds) => call('dupes:find', stemIds),
    removeDuplicates: (pairs) => call('dupes:remove', pairs),
    undoDuplicates: (id) => call('dupes:undo', id),
  },
  songs: {
    setUser: (id, patch) => call('song:setUser', id, patch),
    played: (id) => call('song:played', id),
  },
  setlists: {
    create: (name) => call('setlist:create', name),
    rename: (id, name) => call('setlist:rename', id, name),
    remove: (id) => call('setlist:delete', id),
    add: (id, songIds) => call('setlist:add', id, songIds),
    removeSongs: (id, songIds) => call('setlist:remove', id, songIds),
    reorder: (id, songIds) => call('setlist:reorder', id, songIds),
  },
  edit: {
    save: (items) => call('edit:save', items),
    backups: (songId) => call('edit:backups', songId),
    restore: (songId, backupPath) => call('edit:restore', songId, backupPath),
  },
  audio: {
    prepare: (songId) => call('audio:prepare', songId),
  },
  rig: {
    available: () => call('rig:available'),
    // The port arrives as a window message ('stagehand-rig-port'), since ports can't cross the bridge.
    connect: (kind) => ipcRenderer.send('rig:connect', kind),
  },
  cabs: {
    ensure: (id) => call('cabs:ensure',id),
    bytes: (id) => call('cabs:bytes',id),
  },
  captures: {
    get: () => call('captures:get'),
    assign: (ampKey, packId) => call('captures:assign', ampKey, packId),
    remove: (packId) => call('captures:remove', packId),
    setKind: (packId, kind) => call('captures:setKind', packId, kind),
    addFiles: (ampKey) => call('captures:addFiles', ampKey),
    setKey: (id) => call('captures:setKey', id),
    connect: () => call('captures:connect'),
    disconnect: () => call('captures:disconnect'),
    useBrowser: (on) => call('captures:useBrowser', on),
    get3k: (packKey, ampKey) => call('captures:get3k', packKey, ampKey),
    browse: (ampKey, opts) => call('captures:browse', ampKey, opts),
  },
  tones: {
    get: () => call('tones:get'),
    save: (tone) => call('tones:save', tone),
    remove: (id) => call('tones:remove', id),
    setSlot: (id, slot) => call('tones:setSlot', id, slot),
    seed: (list) => call('tones:seed', list),
    library: () => call('tones:library'),
  },
  stats: {
    log: (session) => call('stats:log', session),
    summary: (period) => call('stats:summary', period),
    best: () => call('stats:best'),
  },
  clips: {
    prepare: () => call('clips:prepare'),
    source: () => call('clips:source'),
    save: (data, meta) => call('clips:save', data, meta),
  },
  takes: {
    list: () => call('takes:list'),
    save: (take) => call('takes:save', take),
    remove: (id) => call('takes:remove', id),
    rename: (id, name) => call('takes:rename', id, name),
  },
  tab: {
    list: (songId) => call('tab:list', songId),
    load: (songId, arrId) => call('tab:load', songId, arrId),
  },
  stems: {
    status: (songId) => call('stems:status', songId),
    request: (songIds, opts) => call('stems:request', songIds, opts),
    prioritize: (id, opts) => call('stems:prioritize', id, opts),
    cancel: (songId) => call('stems:cancel', songId),
    remove: (songId) => call('stems:remove', songId),
    queue: () => call('stems:queue'),
    store: (songId, model, name, ext, bytes) => call('stems:store', songId, model, name, ext, bytes),
    finish: (songId, model, format) => call('stems:finish', songId, model, format),
    formats: () => call('stems:formats'),
  },
  engine: {
    status: (refresh) => call('engine:status', refresh),
    gpu: () => call('engine:gpu'),
    setup: (opts) => call('engine:setup', opts),
    cancel: () => call('engine:cancel'),
    remove: () => call('engine:remove'),
  },
  tools: {
    vgmstream: () => call('tools:vgmstream'),
    installVgmstream: () => call('tools:installVgmstream'),
  },
  settings: {
    get: () => call('settings:get'),
    set: (patch) => call('settings:set', patch),
  },
  rocksmith: {
    read: () => call('rs:read'),
    apply: (ops) => call('rs:apply', ops),
    backups: () => call('rs:backups'),
    restore: (id) => call('rs:restore', id),
    select: (id) => call('rs:select', id),
    pickSteam: () => call('rs:steamDir'),
    pickGame: () => call('rs:gameDir'),
    rename: (names) => call('rs:rename', names),
  },
  discover: {
    search: (q) => call('discover:search', q),
    recent: () => call('discover:recent'),
    clearRecent: () => call('discover:clearRecent'),
    artist: (opts) => call('discover:artist', opts),
    gaps: () => call('discover:gaps'),
    checkGaps: (opts) => call('discover:checkGaps', opts),
    cancelGaps: () => call('discover:cancelGaps'),
    wanted: () => call('discover:wanted'),
    addWanted: (items) => call('discover:addWanted', items),
    removeWanted: (ids) => call('discover:removeWanted', ids),
    clearFound: () => call('discover:clearFound'),
    copy: (text) => call('discover:copy', text),
    customsforge: (opts) => call('discover:customsforge', opts),
  },
  imports: {
    status: () => call('import:status'),
    configure: (patch) => call('import:configure', patch),
    files: (paths) => call('import:files', paths),
    waiting: (paths) => call('import:waiting', paths),
    undo: (id) => call('import:undo', id),
    retryLists: () => call('import:retryLists'),
    clearHistory: () => call('import:clearHistory'),
    pickFolder: (which) => call('import:pickFolder', which),
    scanPC: () => call('import:scanPC'),
  },
  // Paths of files dropped on the window (for importing songs).
  pathFor: (file) => {
    try {
      return webUtils.getPathForFile(file) || null;
    } catch (_) {
      return null;
    }
  },
  organize: {
    preview: (opts) => call('organize:preview', opts),
    apply: (items) => call('organize:apply', items),
    undo: () => call('organize:undo'),
    last: () => call('organize:last'),
  },
  shell: {
    showItem: (p) => call('shell:showItem', p),
    openPath: (p) => call('shell:openPath', p),
    openExternal: (url) => call('shell:openExternal', url),
  },
  dialog: {
    pickFile: (opts) => call('dialog:pickFile', opts),
  },
  cache: {
    info: () => call('cache:info'),
    clear: (which) => call('cache:clear', which),
  },
  coverUrl: (groupId, size = 250) => `stagehand://cover/${groupId}?size=${size}`,
  takeUrl: (id) => `stagehand://take/${id}`,
  artUrl: (song, size = 256) => `stagehand://art/${song.id}?size=${size}&v=${Math.round(song.mtimeMs || 0)}`,
  on(channel, cb) {
    if (!EVENTS.has(channel)) throw new Error(`Unknown event ${channel}`);
    const h = (_e, payload) => cb(payload);
    ipcRenderer.on(channel, h);
    return () => ipcRenderer.removeListener(channel, h);
  },
});

// Hand MessagePorts for the native rig to the page.
ipcRenderer.on('rig:port', (e, msg) => {
  window.postMessage({ type: 'stagehand-rig-port', kind: msg && msg.kind }, '*', e.ports);
});
