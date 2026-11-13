'use strict';
// The song finder's top bar: it only hears the finder's news and sends its button presses.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('finderBar', {
  onState: (fn) => ipcRenderer.on('finder-bar:state', (_e, st) => fn(st)),
  act: (name) => ipcRenderer.send('finder-bar:act', String(name)),
});
