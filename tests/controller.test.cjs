
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { Controller } = require('../bridge/controller.cjs');
const {
  tone, gap, join, wavToPCM48, resolveTtsScript
} = require('../bridge/audio.cjs');
const {
  DirectBridge, DEFAULTS, validate
} = require('../bridge/direct.cjs');

const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

const frame = {
  clientId: 8,
  codec: 4,
  data: Buffer.from([1, 2, 3])
};

test('A naar B wordt doorgestuurd', () => {
  const c = new Controller({ hangMs: 450 });
  const r = c.ingest('A', frame, 1000);
  assert.equal(r.kind, 'forward');
  assert.equal(r.dir, 'A2B');
});

test('Andere richting mag een actieve uitzending niet verstoren', () => {
  const c = new Controller();
  c.ingest('A', frame, 1000);
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
  assert.equal(event.kind, 'end');
  assert.equal(event.timeout, true);
  assert.equal(c.ingest('A', frame, 2150).kind, 'drop');
  c.tick(2500);
  assert.equal(c.ingest('A', frame, 2510).kind, 'forward');
});

test('Een systeemmelding blokkeert inkomende spraak', () => {
  const c = new Controller();
  assert.equal(c.beginSystem(), true);
  assert.equal(c.ingest('A', frame, 1000).kind, 'drop');
  c.endSystem();
  assert.equal(c.ingest('A', frame, 1010).kind, 'forward');
});

test('Andere codec en ongeldige input worden geweigerd', () => {
  const c = new Controller();
  assert.equal(c.ingest('A', { ...frame, codec: 1 }).kind, 'drop');
  assert.equal(c.ingest('X', frame).kind, 'drop');
});

test('Server A en B mogen niet dezelfde bestemming zijn', () => {
  assert.throws(() =>
    validate({
      aHost: 'mijnserver.nl',
      bHost: 'mijnserver.nl',
      aChannel: '',
      bChannel: ''
    })
  );
  assert.equal(
    validate({
      aHost: 'mijnserver.nl',
      bHost: 'serverb.nl'
    }).bHost,
    'serverb.nl'
  );
});

test('Afvalpiep is hoorbaar maar begrensd in amplitude', () => {
  const t = tone(880, 180);
  assert.ok(t.length > 8000);
  assert.ok(t.some(v => v !== 0));
  assert.ok(t.every(v => Math.abs(v) <= .25));
  assert.equal(join(t, gap(100)).length, t.length + 4800);
});

test('16-bit PCM WAV resampling naar 48k werkt', () => {
  const rate = 24000;
  const samples = 240;
  const b = Buffer.alloc(44 + samples * 2);

  b.write('RIFF', 0);
  b.writeUInt32LE(b.length - 8, 4);
  b.write('WAVEfmt ', 8);
  b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20);
  b.writeUInt16LE(1, 22);
  b.writeUInt32LE(rate, 24);
  b.writeUInt32LE(rate * 2, 28);
  b.writeUInt16LE(2, 32);
  b.writeUInt16LE(16, 34);
  b.write('data', 36);
  b.writeUInt32LE(samples * 2, 40);

  for (let i = 0; i < samples; i++) {
    b.writeInt16LE(i % 3 ? 8000 : -8000, 44 + i * 2);
  }
  assert.equal(wavToPCM48(b).length, 480);
});

test('Opus-pakketten blijven gecodeerd en gaan naar de andere server', () => {
  const calls = { A: [], B: [] };
  const d = new DirectBridge(os.tmpdir());

  d.running = true;
  d.online = { A: true, B: true };
  d.conn = {
    A: { sendVoice: (data, codec) => calls.A.push([data, codec]) },
    B: { sendVoice: (data, codec) => calls.B.push([data, codec]) }
  };

  d.onVoice('A', frame);
  assert.equal(calls.B.length, 1);
  assert.strictEqual(calls.B[0][0], frame.data);
  assert.equal(calls.A.length, 0);

  d.onVoice('B', { ...frame, clientId: 23 });
  assert.equal(calls.A.length, 0);
});

test('Windows TTS-script wordt buiten app.asar gevonden', () => {
  const tmp = fs.mkdtempSync(
    path.join(os.tmpdir(), 'ptt-resource-test-')
  );
  try {
    const installed = path.join(tmp, 'tts_windows.ps1');
    fs.writeFileSync(installed, 'test');

    assert.equal(
      resolveTtsScript(
        tmp,
        '/somewhere/app.asar/tts_windows.ps1'
      ),
      installed
    );
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('Windows build kopieert TTS-script als extraResource', () => {
  const pkg = require('../package.json');

  assert.ok(
    pkg.build.extraResources.some(
      x => x.from === 'tts_windows.ps1' &&
           x.to === 'tts_windows.ps1'
    )
  );
});

test('Callgever en tijdmelder kunnen in de wachtrij', () => {
  const d = new DirectBridge(os.tmpdir());
  d.config = DEFAULTS;

  d.announceCall('Testbericht Crosslink');
  d.announceTime();

  assert.equal(d.queue.length, 2);
  assert.equal(d.queue[0].text, 'Testbericht Crosslink');
  assert.match(d.queue[1].text, /Tijdmelding/);
});

test('Automatische meldingen worden op interval ingepland', () => {
  const d = new DirectBridge(os.tmpdir());

  d.config = {
    ...DEFAULTS,
    callMinutes: 1,
    timeMinutes: 1
  };
  d.running = true;
  d.online = { A: true, B: true };
  d.busy = true;
  d.lastCall = d.lastTime = Date.now() - 70000;

  d.tick();

  assert.deepEqual(
    d.queue.map(x => x.kind),
    ['Callgever', 'Tijdmelder']
  );
});

test('Channel Commander A en B schakelen aan en uit', async () => {
  const d = new DirectBridge(os.tmpdir());
  const commands = [];

  d.running = true;
  d.online = { A: true, B: true };

  d.conn = {
    A: {
      execCommand: async v => commands.push(['A', v])
    },
    B: {
      execCommand: async v => commands.push(['B', v])
    }
  };

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

test('Mislukte Channel Commander opdracht behoudt UIT-status', async () => {
  const d = new DirectBridge(os.tmpdir());

  d.running = true;
  d.online = { A: true, B: true };
  d.conn = {
    A: {
      execCommand: async () => {
        throw Error('Geen permissie');
      }
    }
  };

  await assert.rejects(
    d.toggleCommander('A'),
    /Geen permissie/
  );

  assert.equal(d.commander.A, false);
  assert.equal(d.commanderPending.A, false);

  await assert.rejects(
    d.toggleCommander('X'),
    /Ongeldige server/
  );
});

test('Live repeaterinstellingen bijwerken zonder herstart', () => {
  const d = new DirectBridge(os.tmpdir());

  d.config = {
    ...DEFAULTS,
    bHost: 'serverb.nl'
  };

  d.updateSettings({
    bHost: 'serverb.nl',
    callMinutes: 2,
    timeMinutes: 3,
    courtesy: false,
    hangMs: 600
  });

  assert.equal(d.config.callMinutes, 2);
  assert.equal(d.controller.options.hangMs, 600);
  assert.equal(d.controller.options.courtesy, false);
});
