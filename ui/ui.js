'use strict';
const $ = id => document.getElementById(id);
const FIELDS = ['aHost','aChannel','aNick','bHost','bChannel','bNick',
  'aPassword','bPassword','aChannelPassword','bChannelPassword',
  'hangMs','timeoutSeconds','beepHz','beepMs','callMinutes','timeMinutes','callText'];
const numeric = new Set(['hangMs','timeoutSeconds','beepHz','beepMs','callMinutes','timeMinutes']);
let started = false;
let starting = false;
let welcomeEnabled = false;
let welcomePending = false;

function gather() {
  const out = {};
  for (const name of FIELDS) out[name] = numeric.has(name) ? Number($(name).value) : $(name).value;
  out.courtesy = $('courtesy').checked;
  out.welcomeEnabled = welcomeEnabled;
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
function updateWelcomeButton() {
  const button = $('welcomeToggle');
  button.disabled = welcomePending;
  button.textContent = welcomeEnabled
    ? '🔊 GEBRUIKERSNAAM OMROEPEN: AAN'
    : '🔇 GEBRUIKERSNAAM OMROEPEN: UIT';
  button.classList.toggle('enabled', welcomeEnabled);
  button.setAttribute('aria-pressed', String(welcomeEnabled));
}
function updateState(state) {
  if (typeof state.welcomeEnabled === 'boolean' && !welcomePending) {
    welcomeEnabled = state.welcomeEnabled;
    updateWelcomeButton();
  }
  const active = !!state.running;
  setEnabled(active);
  const ready = active && state.online?.A && state.online?.B;
  for (const id of ['call','time','testA','testB']) $(id).disabled = !ready;
  for (const side of ['A','B']) {
    const button = $('commander' + side);
    const enabled = !!state.commander?.[side];
    button.disabled = !active || !state.online?.[side] || !!state.commanderPending?.[side];
    button.textContent = (enabled ? '★ CHANNEL COMMANDER ' + side + ': AAN' :
      '☆ CHANNEL COMMANDER ' + side + ': UIT');
    button.classList.toggle('enabled', enabled);
    button.setAttribute('aria-pressed', String(enabled));
  }
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
    welcomeEnabled = defaults.welcomeEnabled === true;
    updateWelcomeButton();
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
$('call').addEventListener('click', () => perform(() => window.ptt.call($('callText').value)));
$('time').addEventListener('click', () => perform(() => window.ptt.time()));
$('testA').addEventListener('click', () => perform(() => window.ptt.beep('A')));
$('testB').addEventListener('click', () => perform(() => window.ptt.beep('B')));
for (const side of ['A','B']) {
  $('commander'+side).addEventListener('click', () => perform(() => window.ptt.commander(side)));
}
$('welcomeToggle').addEventListener('click', async () => {
  if (welcomePending) return;
  welcomePending = true;
  updateWelcomeButton();
  try {
    welcomeEnabled = await window.ptt.setWelcome(!welcomeEnabled);
    addLog('Gebruikersnaam omroepen ' + (welcomeEnabled ? 'AAN' : 'UIT'));
  } catch (err) {
    addLog('FOUT: Welkom-meldingen: ' + (err?.message || err));
  } finally {
    welcomePending = false;
    updateWelcomeButton();
  }
});
$('clearlog').addEventListener('click', () => { $('logs').replaceChildren(); });
