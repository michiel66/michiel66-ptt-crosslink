'use strict';
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('ptt', {
  getSettings: () => ipcRenderer.invoke('bridge:getSettings'),
  saveSettings: values => ipcRenderer.invoke('bridge:saveSettings', values),
  start: values => ipcRenderer.invoke('bridge:start', values),
  stop: () => ipcRenderer.invoke('bridge:stop'),
  call: text => ipcRenderer.invoke('bridge:call', text),
  time: () => ipcRenderer.invoke('bridge:time'),
  beep: side => ipcRenderer.invoke('bridge:beep', side),
  commander: side => ipcRenderer.invoke('bridge:commander', side),
  setWelcome: enabled => ipcRenderer.invoke('bridge:setWelcome', enabled),
  onEvent: handler => ipcRenderer.on('bridge:event', (_e, message) => handler(message))
});
