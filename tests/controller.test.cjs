'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { Controller } = require('../bridge/controller.cjs');
const { tone, gap, join, wavToPCM48 } = require('../bridge/audio.cjs');
const { validate } = require('../bridge/direct.cjs');
const frame = { clientId: 8, codec: 4, data: Buffer.from([1, 2, 3]) };

test('A naar B wordt doorgestuurd', () => {
  const c = new Controller({ hangMs: 450 });
  const r = c.ingest('A', frame, 1000);
  assert.equal(r.kind, 'forward'); assert.equal(r.dir, 'A2B');
});
test('Andere richting mag een actieve uitzending niet verstoren', () => {
  const c = new Controller(); c.ingest('A', frame, 1000);
  assert.equal(c.ingest('B', frame, 1010).kind, 'drop');
  assert.equal(c.ingest('A', { ...frame, clientId: 9 }, 1020).kind, 'drop');
  assert.equal(c.route, 'A2B');
});
test('Na afvaltijd wordt B naar A weer toegelaten', () => {
  const c = new Controller({ hangMs: 300, courtesy: true });
  c.ingest('A', frame, 1000);
  assert.equal(c.tick(1301).kind, 'end');
  assert.equal(c.ingest('B', frame, 1310).kind, 'forward');
});
test('TX-timeout blokkeert de spreker tot stilte', () => {
  const c = new Controller({ hangMs: 300, timeoutSeconds: 1 });
  c.ingest('A', frame, 1000);
  const event = c.ingest('A', frame, 2100);
  assert.equal(event.kind, 'end'); assert.equal(event.timeout, true);
  assert.equal(c.ingest('A', frame, 2150).kind, 'drop');
  c.tick(2500);
  assert.equal(c.ingest('A', frame, 2510).kind, 'forward');
});
test('Een systeemmelding blokkeert inkomende spraak', () => {
  const c = new Controller(); assert.equal(c.beginSystem(), true);
  assert.equal(c.ingest('A', frame, 1000).kind, 'drop');
  c.endSystem(); assert.equal(c.ingest('A', frame, 1010).kind, 'forward');
});
test('Andere codec en ongeldige input worden geweigerd', () => {
  const c = new Controller();
  assert.equal(c.ingest('A', { ...frame, codec: 1 }).kind, 'drop');
  assert.equal(c.ingest('X', frame).kind, 'drop');
});
test('Server A en B mogen niet dezelfde bestemming zijn', () => {
  assert.throws(() => validate({ aHost: 'mijnserver.nl', bHost: 'mijnserver.nl', aChannel: '', bChannel: '' }));
  assert.equal(validate({ aHost: 'mijnserver.nl', bHost: 'serverb.nl' }).bHost, 'serverb.nl');
});
test('Afvalpiep is hoorbaar maar begrensd in amplitude', () => {
  const t = tone(880, 180);
  assert.ok(t.length > 8000);
  assert.ok(t.some(v => v !== 0));
  assert.ok(t.every(v => Math.abs(v) <= .25));
  assert.equal(join(t, gap(100)).length, t.length + 4800);
});
test('16-bit PCM WAV resampling naar 48k werkt', () => {
  const rate = 24000, samples = 240;
  const b = Buffer.alloc(44 + samples * 2);
  b.write('RIFF', 0); b.writeUInt32LE(b.length - 8, 4); b.write('WAVEfmt ', 8);
  b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22);
  b.writeUInt32LE(rate, 24); b.writeUInt32LE(rate * 2, 28);
  b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36);
  b.writeUInt32LE(samples * 2, 40);
  for (let i = 0; i < samples; i++) b.writeInt16LE(i % 3 ? 8000 : -8000, 44 + i * 2);
  assert.equal(wavToPCM48(b).length, 480);
});
test('Opus-pakketten blijven gecodeerd en gaan uitsluitend naar de andere server', () => {
  const { DirectBridge } = require('../bridge/direct.cjs');
  const calls = { A: [], B: [] };
  const d = new DirectBridge('/tmp/ptt-crosslink-test');
  d.running = true;
  d.online = { A: true, B: true };
  d.conn = { A: { sendVoice: (data, codec) => calls.A.push([data, codec]) },
             B: { sendVoice: (data, codec) => calls.B.push([data, codec]) } };
  d.onVoice('A', frame);
  assert.equal(calls.B.length, 1);
  assert.strictEqual(calls.B[0][0], frame.data);
  assert.equal(calls.A.length, 0);
  d.onVoice('B', { ...frame, clientId: 23 });
  assert.equal(calls.A.length, 0);
});

const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const { DirectBridge, DEFAULTS } = require('../bridge/direct.cjs');
const { resolveTtsScript } = require('../bridge/audio.cjs');

test('Ingebouwd Windows TTS-script wordt buiten app.asar gevonden', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ptt-resource-test-'));
  try {
    const installed = path.join(tmp, 'tts_windows.ps1');
    fs.writeFileSync(installed, 'test');
    assert.equal(resolveTtsScript(tmp, '/somewhere/app.asar/tts_windows.ps1'), installed);
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});

test('Windows build kopieert het TTS-script als echt extraResource', () => {
  const pkg = require('../package.json');
  assert.ok(pkg.build.extraResources.some(x => x.from === 'tts_windows.ps1' && x.to === 'tts_windows.ps1'));
});

test('Callgever en tijdmelder kunnen handmatig in de wachtrij', () => {
  const d = new DirectBridge(os.tmpdir());
  d.config = DEFAULTS;
  d.announceCall('Testbericht Crosslink');
  d.announceTime();
  assert.equal(d.queue.length, 2);
  assert.equal(d.queue[0].text, 'Testbericht Crosslink');
  assert.match(d.queue[1].text, /Tijdmelding/);
});

test('Automatische callgever en tijdmelder worden op interval ingepland', () => {
  const d = new DirectBridge(os.tmpdir());
  d.config = { ...DEFAULTS, callMinutes: 1, timeMinutes: 1 };
  d.running = true; d.online = { A: true, B: true };
  d.busy = true; // Laat alleen de automatische planning lopen, niet Windows TTS.
  d.lastCall = d.lastTime = Date.now() - 70_000;
  d.tick();
  assert.deepEqual(d.queue.map(x => x.kind), ['Callgever', 'Tijdmelder']);
});

test('Channel Commander schakelt op de gekozen server aan en uit', async () => {
  const d = new DirectBridge(os.tmpdir());
  const commands = [];
  d.running = true; d.online = { A: true, B: true };
  d.conn = { A: { execCommand: async v => commands.push(['A', v]) },
             B: { execCommand: async v => commands.push(['B', v]) } };
  assert.equal(await d.toggleCommander('A'), true);
  assert.equal(d.commander.A, true);
  assert.equal(d.commander.B, false);
  assert.equal(await d.toggleCommander('A'), false);
  assert.equal(await d.toggleCommander('B'), true);
  assert.deepEqual(commands, [
    ['A', 'clientupdate client_is_channel_commander=1'],
    ['A', 'clientupdate client_is_channel_commander=0'],
    ['B', 'clientupdate client_is_channel_commander=1']
  ]);
});

test('Mislukte Channel Commander opdracht meldt een fout en behoudt UIT-status', async () => {
  const d = new DirectBridge(os.tmpdir());
  d.running = true; d.online = { A: true, B: true };
  d.conn = { A: { execCommand: async () => { throw Error('Geen permissie'); } } };
  await assert.rejects(d.toggleCommander('A'), /Geen permissie/);
  assert.equal(d.commander.A, false);
  assert.equal(d.commanderPending.A, false);
  await assert.rejects(d.toggleCommander('X'), /Ongeldige server/);
});

test('Live repeaterinstellingen bijwerken werkt zonder nieuwe verbinding', () => {
  const d = new DirectBridge(os.tmpdir());
  d.config = { ...DEFAULTS, bHost:'serverb.nl' };
  d.updateSettings({ bHost:'serverb.nl', callMinutes:2, timeMinutes:3, courtesy:false, hangMs:600 });
  assert.equal(d.config.callMinutes, 2);
  assert.equal(d.controller.options.hangMs, 600);
  assert.equal(d.controller.options.courtesy, false);
});

// v0.2.2: announcements only on actual entry to the bot's channel.
const { WelcomeTracker } = require('../bridge/welcome.cjs');

const clientInfo = (id, nickname, channelID, type = 0) => ({
  id, nickname, channelID: BigInt(channelID), type
});

test('Binnenkomst bij starten spreekt bestaande gebruikers niet uit', () => {
  const w = new WelcomeTracker();
  assert.equal(w.enter('A', clientInfo(18, 'Jan', 42), 4, 42n), null);
  assert.equal(w.enter('A', clientInfo(19, 'Els', 42), 4, 42n), null);
  w.arm('A');
  assert.equal(w.enter('A', clientInfo(18, 'Jan', 42), 4, 42n), null);
  assert.deepEqual(w.enter('A', clientInfo(20, 'Piet', 42), 4, 42n), {
    side: 'A', clientId: 20, nickname: 'Piet'
  });
});

test('Kanaal wisselen geeft één melding per echte binnenkomst', () => {
  const w = new WelcomeTracker();
  w.enter('A', clientInfo(11, 'Marieke', 12), 4, 42n);
  w.arm('A');
  assert.deepEqual(w.moved('A', { id: 11, targetChannelID: 42n }, 4, 42n), {
    side: 'A', clientId: 11, nickname: 'Marieke'
  });
  assert.equal(w.enter('A', clientInfo(11, 'Marieke', 42), 4, 42n), null);
  assert.equal(w.moved('A', { id: 11, targetChannelID: 42n }, 4, 42n), null);
  assert.equal(w.moved('A', { id: 11, targetChannelID: 12n }, 4, 42n), null);
  assert.deepEqual(w.moved('A', { id: 11, targetChannelID: 42n }, 4, 42n), {
    side: 'A', clientId: 11, nickname: 'Marieke'
  });
});

test('Verlaten en opnieuw binnenkomen geeft opnieuw melding', () => {
  const w = new WelcomeTracker();
  w.arm('B');
  assert.deepEqual(w.enter('B', clientInfo(22, 'Michel', 9), 1, 9n)?.nickname, 'Michel');
  w.leave('B', { id: 22 });
  assert.equal(w.stillPresent('B', 22, 9n), false);
  assert.equal(w.enter('B', clientInfo(22, 'Michel', 9), 1, 9n)?.nickname, 'Michel');
});

test('Andere kanalen, eigen bot en query-bot worden niet uitgesproken', () => {
  const w = new WelcomeTracker();
  w.arm('A');
  assert.equal(w.enter('A', clientInfo(4, 'PTT Bot', 42), 4, 42n), null);
  assert.equal(w.enter('A', clientInfo(5, 'BotServerQuery', 42, 1), 4, 42n), null);
  assert.equal(w.enter('A', clientInfo(6, 'Andere kamer', 44), 4, 42n), null);
  assert.equal(w.enter('A', clientInfo(7, 'Andere kamer', 42), 4, 0n), null);
});

test('Dubbelen uit twee servers worden onafhankelijk getrackt', () => {
  const w = new WelcomeTracker();
  w.arm('A'); w.arm('B');
  const left = w.enter('A', clientInfo(23, 'Theo', 12), 4, 12n);
  const right = w.enter('B', clientInfo(23, 'Theo', 99), 6, 99n);
  assert.equal(left.side, 'A');
  assert.equal(right.side, 'B');
});

test('Ongeldige en lange nicknames worden veilig afgehandeld', () => {
  assert.equal(WelcomeTracker.spokenName('  Pe\u200bter \n De  Vries\t'), 'Peter De Vries');
  assert.equal(WelcomeTracker.spokenName('a'.repeat(200)).length, 70);
  const w = new WelcomeTracker(); w.arm('A');
  assert.equal(w.enter('A', clientInfo(9, '   ', 42), 4, 42n), null);
  assert.equal(w.enter('A', clientInfo(10, 'Lisa', 42), 4, 'invalid'), null);
});

test('Welkomstmelding spreekt alleen uit op server van binnenkomst', () => {
  const d = new DirectBridge(os.tmpdir());
  d.running = true;
  d.online = { A: true, B: true };
  d.config = { ...DEFAULTS, welcomeEnabled: true };
  d.conn = {
    A: { clientID: () => 1, channelID: () => 77n },
    B: { clientID: () => 2, channelID: () => 88n }
  };
  d.welcome.arm('A'); d.welcome.arm('B');
  d.onClientEnter('A', clientInfo(10, 'Michiel', 77));
  assert.equal(d.queue.length, 1);
  assert.deepEqual(d.queue[0].sides, ['A']);
  assert.equal(d.queue[0].text, 'Welkom Michiel.');
  d.onClientEnter('A', clientInfo(10, 'Michiel', 77));
  assert.equal(d.queue.length, 1);
  d.onClientLeave('A', { id: 10 });
  assert.equal(d.queue.length, 0);
  d.onClientEnter('A', clientInfo(10, 'Michiel', 77));
  assert.equal(d.queue.length, 1);
});

test('Uit knop haalt wachtrij weg; bij opnieuw inschakelen alleen nieuwe binnenkomsten', () => {
  const d = new DirectBridge(os.tmpdir());
  d.running = true;
  d.online = { A: true, B: true };
  d.config = { ...DEFAULTS, welcomeEnabled: true };
  d.conn = { A: { clientID: () => 1, channelID: () => 77n } };
  d.welcome.arm('A');
  d.onClientEnter('A', clientInfo(10, 'Jos', 77));
  assert.equal(d.queue.length, 1);
  d.setWelcomeEnabled(false);
  assert.equal(d.queue.length, 0);
  d.onClientEnter('A', clientInfo(11, 'Jan', 77));
  assert.equal(d.queue.length, 0);
  d.setWelcomeEnabled(true);
  d.onClientEnter('A', clientInfo(11, 'Jan', 77));
  assert.equal(d.queue.length, 0);
  d.onClientMoved('A', { id: 11, targetChannelID: 99n });
  d.onClientMoved('A', { id: 11, targetChannelID: 77n });
  assert.equal(d.queue[0].text, 'Welkom Jan.');
  assert.equal(d.shouldPlayWelcome(d.queue[0]), true);
  d.onClientMoved('A', { id: 11, targetChannelID: 99n });
  assert.equal(d.shouldPlayWelcome(d.queue[0]), false);
});

test('Schakelstand van welkomfunctie is standaard UIT en wordt gevalideerd', () => {
  assert.equal(DEFAULTS.welcomeEnabled, false);
  assert.equal(validate({ aHost: 'serverA.nl', bHost: 'serverB.nl', welcomeEnabled: true }).welcomeEnabled, true);
  assert.equal(validate({ aHost: 'serverA.nl', bHost: 'serverB.nl', welcomeEnabled: 'true' }).welcomeEnabled, false);
});
