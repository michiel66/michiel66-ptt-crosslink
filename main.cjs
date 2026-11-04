'use strict';
const { app, BrowserWindow, ipcMain } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { DirectBridge, DEFAULTS, validate } = require('./bridge/direct.cjs');

let window = null;
let bridge = null;
let quitting = false;
const allowed = new Set(Object.keys(DEFAULTS));
const keepConfig = raw => Object.fromEntries(Object.entries(raw || {}).filter(([key]) => allowed.has(key)));

function preferencesFile() { return path.join(app.getPath('userData'), 'settings.json'); }
function getSettings() {
  try { return { ...DEFAULTS, ...keepConfig(JSON.parse(fs.readFileSync(preferencesFile(), 'utf8'))) }; }
  catch (_) { return { ...DEFAULTS }; }
}
function saveSettings(data) {
  const settings = validate(data);
  const file = preferencesFile();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(keepConfig(settings), null, 2), { mode: 0o600 });
  fs.renameSync(tmp, file);
  return true;
}
function sendEvent(type, payload) {
  if (window && !window.isDestroyed()) window.webContents.send('bridge:event', { type, payload });
}
function createWindow() {
  bridge = new DirectBridge(app.getPath('userData'), sendEvent);
  window = new BrowserWindow({
    title: 'PTT-Crosslink v0.2 | Direct TeamSpeak Gateway',
    width: 1210, height: 850, minWidth: 920, minHeight: 680,
    backgroundColor: '#101923', show: false, autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true, nodeIntegration: false, sandbox: false
    }
  });
  window.setMenuBarVisibility(false);
  window.once('ready-to-show', () => window.show());
  window.loadFile(path.join(__dirname, 'ui', 'index.html'));
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', e => e.preventDefault());
  window.on('closed', () => { window = null; if (!quitting) app.quit(); });
}

function trusted(event) {
  const url = event.sender.getURL();
  if (!url.startsWith('file://') || event.sender !== window?.webContents) throw Error('Niet toegestaan');
}

app.whenReady().then(() => {
  ipcMain.handle('bridge:getSettings', e => { trusted(e); return getSettings(); });
  ipcMain.handle('bridge:saveSettings', (e, values) => { trusted(e); return saveSettings(values); });
  ipcMain.handle('bridge:start', async (e, values) => {
    trusted(e);
    const valid = validate(values);
    await bridge.start({ ...valid,
      aPassword: typeof values.aPassword === 'string' ? values.aPassword : '',
      bPassword: typeof values.bPassword === 'string' ? values.bPassword : '',
      aChannelPassword: typeof values.aChannelPassword === 'string' ? values.aChannelPassword : '',
      bChannelPassword: typeof values.bChannelPassword === 'string' ? values.bChannelPassword : '' });
    saveSettings(valid);
    return true;
  });
  ipcMain.handle('bridge:stop', async e => { trusted(e); await bridge.stop(); return true; });
  ipcMain.handle('bridge:call', e => { trusted(e); if (bridge.running) bridge.announceCall(); return bridge.running; });
  ipcMain.handle('bridge:time', e => { trusted(e); if (bridge.running) bridge.announceTime(); return bridge.running; });
  ipcMain.handle('bridge:beep', (e, side) => { trusted(e); if (bridge.running) bridge.testBeep(side); return bridge.running; });
  createWindow();
}).catch(error => console.error('Start fout', error));

app.on('before-quit', () => { quitting = true; if (bridge) void bridge.stop(); });
app.on('window-all-closed', () => app.quit());
