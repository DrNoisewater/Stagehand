'use strict';
const { contextBridge, ipcRenderer, webUtils } = require('electron');

// Errors lose their extra fields when they cross the context bridge, so
// results travel as plain envelopes and the page unwraps them (js/api.js).
async function call(channel, ...args) {
  const r = await ipcRenderer.invoke(channel, ...args);
  return { __sh: true, ...(r || { ok: false, error: 'Something went wrong' }) };
}

const EVENTS = new Set(['nav:back', 'win:state', 'audio:search', 
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
  'dlc:progress',
  'captures:change',
  'tones:progress',
  'room:change',
  'room:offer',
  'room:progress',
  'room:message',
  'updates:change',
  'updates:progress',
  'app:recovered',
  'finder:event',
]);

contextBridge.exposeInMainWorld('stagehand', {
  app: {
    info: () => call('app:info'),
    log: () => call('app:log'),
    titleBar: (colors) => call('win:titlebar', colors),
    fullscreen: (on) => call('win:fullscreen', on),
    minimize: () => call('win:minimize'),
    maximize: () => call('win:maximize'),
    close: () => call('win:close'),
    winState: () => call('win:state'),
    activity: (text) => call('app:activity', text),
    crashNote: () => call('app:crashNote'),
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
  career: {
    lifetime: () => call('career:lifetime'),
    backups: () => call('career:backups'),
    backup: () => call('career:backup'),
    export: () => call('career:export'),
  },
  dev: {
    enabled: () => call('dev:enabled'),
    levels: (op, ...args) => call('dev:levels', op, ...args),
    integrity: (fix) => call('dev:integrity', fix),
    balance: (days) => call('dev:balance', days),
    restore: (id) => call('dev:restore', id),
    testRecovery: () => call('dev:testRecovery'),
    clearRecent: (minutes) => call('dev:clearRecent', minutes),
    eraseLifetime: (phrase) => call('dev:eraseLifetime', phrase),
  },
  levels: {
    state: () => call('levels:state'),
    did: (id) => call('levels:did', id),
    title: (id) => call('levels:title', id),
  },
  clips: {
    prepare: () => call('clips:prepare'),
    source: () => call('clips:source'),
    save: (data, meta) => call('clips:save', data, meta),
    begin: (meta) => call('clips:begin', meta),
    chunk: (id, kind, data) => call('clips:chunk', id, kind, data),
    finish: (id, meta) => call('clips:finish', id, meta),
    cancel: (id) => call('clips:cancel', id),
  },
  takes: {
    list: () => call('takes:list'),
    save: (take) => call('takes:save', take),
    remove: (id) => call('takes:remove', id),
    rename: (id, name) => call('takes:rename', id, name),
  },
  updates: {
    state: () => call('updates:state'),
    check: () => call('updates:check'),
    download: () => call('updates:download'),
    install: () => call('updates:install'),
  },
  room: {
    get: () => call('room:get'),
    setName: (name) => call('room:setName', name),
    leave: () => call('room:leave'),
    send: (to, text, about) => call('room:send', to, text, about),
    hide: (addr, on) => call('room:hide', addr, on),
    share: (id, on) => call('room:share', id, on),
    connect: (addr, sdp) => call('room:connect', addr, sdp),
    answer: (conn, sdp) => call('room:answer', conn, sdp),
    hostList: () => call('room:hostList'),
    hostRead: (id, part, offset, length) => call('room:hostRead', id, part, offset, length),
  },

  tab: {
    list: (songId) => call('tab:list', songId),
    load: (songId, arrId) => call('tab:load', songId, arrId),
    vocals: (songId) => call('tab:vocals', songId),
  },
  stems: {
    status: (songId) => call('stems:status', songId),
    request: (songIds, opts) => call('stems:request', songIds, opts),
    prioritize: (id, opts) => call('stems:prioritize', id, opts),
    ahead: (id) => call('stems:ahead', id),
    playing: (on) => call('stems:playing', on),
    note: (text) => call('stems:note', text),
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
  dlc: { scan: () => call('dlc:scan'), importSelected: (ids) => call('dlc:import', ids), cancel: () => call('dlc:cancel') },
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
    finder: (item) => call('finder:open', item),
    closeFinder: () => call('finder:close'),
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
    readySongs: () => call('guide:readySongs'),
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
