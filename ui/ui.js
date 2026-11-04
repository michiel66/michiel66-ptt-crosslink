'use strict';
const $ = id => document.getElementById(id);
const FIELDS = ['aHost','aChannel','aNick','bHost','bChannel','bNick',
  'aPassword','bPassword','aChannelPassword','bChannelPassword',
  'hangMs','timeoutSeconds','beepHz','beepMs','callMinutes','timeMinutes','callText'];
const numeric = new Set(['hangMs','timeoutSeconds','beepHz','beepMs','callMinutes','timeMinutes']);
let started = false;
let starting = false;

function gather() {
  const out = {};
  for (const name of FIELDS) out[name] = numeric.has(name) ? Number($(name).value) : $(name).value;
  out.courtesy = $('courtesy').checked;
  return out;
}
function setEnabled(online) {
  started = online;
  $('start').disabled = online || starting;
  $('stop').disabled = !online && !starting;
  for (const id of ['call','time','testA','testB']) $(id).disabled = !online;
}
function addLog(message, at = new Date().toLocaleTimeString('nl-NL')) {
  const box = $('logs');
  const line = document.createElement('div');
  const ts = document.createElement('span');
  ts.className = 'stamp'; ts.textContent = at;
  line.append(ts, document.createTextNode(message));
  box.append(line);
  if (box.childNodes.length > 250) box.firstChild.remove();
  box.scrollTop = box.scrollHeight;
}
function updateState(state) {
  const active = !!state.running;
  setEnabled(active);
  $('overall').textContent = active ? '● CROSSLINK ACTIEF' : '● UITGESCHAKELD';
  $('overall').classList.toggle('live', active);
  for (const side of ['A','B']) {
    const el = $('status' + side);
    el.textContent = state.online?.[side] ? 'VERBONDEN' : 'OFFLINE';
    el.className = 'pill ' + (state.online?.[side] ? 'on' : 'off');
  }
  const ab = state.route === 'A2B', ba = state.route === 'B2A';
  $('ab').className = 'signal ' + (ab ? 'active' : 'inactive');
  $('ba').className = 'signal ' + (ba ? 'active' : 'inactive');
  $('rxA').classList.toggle('live', ab);
  $('rxB').classList.toggle('live', ba);
  $('direction').textContent = ab ? 'RX A → TX B' : ba ? 'RX B → TX A' : state.busy ? 'MELDING' : active ? 'STANDBY' : 'STOP';
  $('countAB').textContent = state.totalAB || 0;
  $('countBA').textContent = state.totalBA || 0;
}
async function perform(action, message) {
  try { await action(); if (message) addLog(message); }
  catch (err) { addLog('FOUT: ' + (err?.message || String(err))); window.alert(err?.message || String(err)); }
}
window.ptt.onEvent(({ type, payload }) => {
  if (type === 'log') addLog(payload.message, payload.at);
  if (type === 'state') updateState(payload);
});
window.addEventListener('DOMContentLoaded', async () => {
  try {
    const defaults = await window.ptt.getSettings();
    for (const [key,value] of Object.entries(defaults)) {
      if (!$(key)) continue;
      if (key === 'courtesy') $(key).checked = value === true;
      else $(key).value = String(value ?? '');
    }
    addLog('Directe TeamSpeak-crosslink gereed voor configuratie.');
  } catch (err) { addLog('Instellingen laden mislukt: ' + err.message); }
});
$('start').addEventListener('click', async () => {
  starting = true; $('start').disabled = true;
  await perform(async () => {
    await window.ptt.start(gather());
    addLog('TeamSpeak-audiobrug gestart.');
  });
  starting = false; if (!started) setEnabled(false);
});
$('stop').addEventListener('click', () => perform(() => window.ptt.stop()));
$('save').addEventListener('click', () => perform(() => window.ptt.saveSettings(gather()), 'Instellingen opgeslagen (wachtwoorden niet opgeslagen).'));
$('call').addEventListener('click', () => perform(() => window.ptt.call()));
$('time').addEventListener('click', () => perform(() => window.ptt.time()));
$('testA').addEventListener('click', () => perform(() => window.ptt.beep('A')));
$('testB').addEventListener('click', () => perform(() => window.ptt.beep('B')));
$('clearlog').addEventListener('click', () => { $('logs').replaceChildren(); });
