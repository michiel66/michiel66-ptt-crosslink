'use strict';
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('ptt', {
  getSettings: () => ipcRenderer.invoke('bridge:getSettings'),
  saveSettings: values => ipcRenderer.invoke('bridge:saveSettings', values),
  start: values => ipcRenderer.invoke('bridge:start', values),
  stop: () => ipcRenderer.invoke('bridge:stop'),
  call: () => ipcRenderer.invoke('bridge:call'),
  time: () => ipcRenderer.invoke('bridge:time'),
  beep: side => ipcRenderer.invoke('bridge:beep', side),
  onEvent: handler => ipcRenderer.on('bridge:event', (_e, message) => handler(message))
});
