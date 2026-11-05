
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { Controller } = require('./controller.cjs');
const { tone, gap, join, textToSamples, createEncoder } = require('./audio.cjs');

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const DEFAULTS = Object.freeze({
  aHost: 'Heerlen.MIJNTS3.NL', aChannel: '', aNick: 'PTT-Crosslink A',
  bHost: '', bChannel: '', bNick: 'PTT-Crosslink B',
  hangMs: 450, timeoutSeconds: 180, courtesy: true,
  beepHz: 880, beepMs: 180, callMinutes: 15, timeMinutes: 60,
  callText: 'Dit is de PTT Crosslink repeater. Beide TeamSpeak servers zijn gekoppeld.'
});

function validate(data) {
  const c = { ...DEFAULTS, ...data };
  for (const x of ['aHost', 'bHost']) {
    if (typeof c[x] !== 'string' || !/^[^\s/?#]{3,255}$/.test(c[x])) {
      throw Error('Vul geldige serveradressen in (A en B)');
    }
  }
  for (const x of ['aChannel', 'bChannel', 'aNick', 'bNick', 'callText']) {
    if (typeof c[x] !== 'string' || c[x].length > 300) {
      throw Error('Ongeldige tekst bij ' + x);
    }
  }
  if (c.aHost.toLowerCase() === c.bHost.toLowerCase() &&
      c.aChannel.toLowerCase() === c.bChannel.toLowerCase()) {
    throw Error('Gebruik twee verschillende server- of kanaalbestemmingen, anders ontstaat een audiolus');
  }
  for (const [k, min, max] of [
    ['hangMs', 100, 4000], ['timeoutSeconds', 0, 3600], ['beepHz', 200, 3000],
    ['beepMs', 30, 1500], ['callMinutes', 0, 1440], ['timeMinutes', 0, 1440]
  ]) {
    c[k] = Number(c[k]);
    if (!Number.isFinite(c[k]) || c[k] < min || c[k] > max) {
      throw Error('Ongeldige waarde voor ' + k);
    }
  }
  c.courtesy = c.courtesy === true;
  return c;
}

class DirectBridge {
  constructor(userPath, sendEvent = () => {}) {
    this.userPath = userPath;
    this.emit = sendEvent;
    this.config = DEFAULTS;
    this.running = false;
    this.conn = { A: null, B: null };
    this.online = { A: false, B: false };
    this.commander = { A: false, B: false };
    this.commanderPending = { A: false, B: false };
    this.controller = new Controller({}, e => this.onRouter(e));
    this.queue = [];
    this.loop = null;
    this.busy = false;
    this.encoder = null;
    this.lastCall = 0;
    this.lastTime = 0;
    this.lastStateAt = 0;
  }

  log(message) {
    this.emit('log', {
      message,
      at: new Date().toLocaleTimeString('nl-NL')
    });
  }

  state() {
    this.emit('state', {
      running: this.running,
      online: { ...this.online },
      commander: { ...this.commander },
      commanderPending: { ...this.commanderPending },
      route: this.controller.route,
      totalAB: this.controller.totals.A2B,
      totalBA: this.controller.totals.B2A,
      busy: this.busy
    });
  }

  onRouter(e) {
    if (e.type === 'route') {
      this.log(`RX ${e.dir === 'A2B' ? 'A' : 'B'} → TX ${e.dir === 'A2B' ? 'B' : 'A'} (gebruiker ${e.clientId})`);
    }
    if (e.type === 'timeout') this.log('TX-timeout: ' + e.dir);
    if (e.type === 'idle') this.log('Einde uitzending: ' + e.dir);
    if (e.type === 'rearmed') this.log('TX weer vrij: ' + e.dir);
    this.state();
  }

  identity(side, sdk) {
    const file = path.join(this.userPath, `identity-${side}.txt`);
    try {
      return sdk.identityFromString(fs.readFileSync(file, 'utf8').trim());
    } catch (e) {
      if (e.code && e.code !== 'ENOENT') throw e;
      const id = sdk.generateIdentity(8);
      fs.mkdirSync(this.userPath, { recursive: true });
      fs.writeFileSync(file, id.toString(), { mode: 0o600 });
      return id;
    }
  }

  async start(data) {
    if (this.running) return;
    this.config = validate(data);
    this.controller = new Controller(this.config, e => this.onRouter(e));
    this.queue = [];
    this.running = true;
    this.online = { A: false, B: false };
    this.commander = { A: false, B: false };
    this.commanderPending = { A: false, B: false };
    this.log('Start directe TeamSpeak-audiobrug (zonder virtuele kabels)');
    this.state();

    try {
      const sdk = await import('@honeybbq/teamspeak-client');
      this.encoder = createEncoder();

      for (const side of ['A', 'B']) {
        if (!this.running) throw Error('Start onderbroken');

        const prefix = side.toLowerCase();
        const client = new sdk.Client(
          this.identity(side, sdk),
          this.config[`${prefix}Host`],
          this.config[`${prefix}Nick`],
          {
            defaultChannel: this.config[`${prefix}Channel`],
            serverPassword: this.config[`${prefix}Password`] || '',
            defaultChannelPassword: this.config[`${prefix}ChannelPassword`] || '',
            logger: {
              debug() {}, info() {}, warn() {}, error() {}
            }
          }
        );

        this.conn[side] = client;
        client.on('voiceData', p => this.onVoice(side, p));

        client.on('connected', () => {
          if (!this.running) return;
          this.online[side] = true;
          this.log(`TeamSpeak-server ${side}: verbonden`);
          this.state();
        });

        client.on('disconnected', err => {
          if (!this.running) return;
          this.online[side] = false;
          this.commander[side] = false;
          this.commanderPending[side] = false;
          this.log(`TeamSpeak-server ${side}: verbinding verbroken${err ? ' (' + err.message + ')' : ''}`);
          this.state();
          this.controller.reset();
        });

        await client.connect();
        await client.waitConnected(AbortSignal.timeout(18000));
      }

      if (!this.running) throw Error('Start onderbroken');
      this.log('Beide TeamSpeak-verbindingen zijn actief');
      this.lastCall = this.lastTime = Date.now();
      this.loop = setInterval(() => this.tick(), 50);
      this.state();

    } catch (e) {
      this.log('Verbindingsfout: ' + (e?.message || String(e)));
      await this.stop();
      throw e;
    }
  }

  onVoice(side, packet) {
    if (!this.running || !this.online.A || !this.online.B) return;

    const result = this.controller.ingest(side, packet);

    if (result.kind === 'forward') {
      const dest = result.dir === 'A2B' ? 'B' : 'A';
      try {
        this.conn[dest].sendVoice(result.data, result.codec);
      } catch (e) {
        this.log('Voice-uitvoer mislukt: ' + e.message);
      }
    }

    if (result.kind === 'end') this.endTransmission(result);
  }

  endTransmission(result) {
    const dest = result.dir === 'A2B' ? 'B' : 'A';

    if (this.online[dest]) {
      try {
        this.conn[dest]?.sendVoice(Buffer.alloc(0), result.codec || 4);
      } catch (_) {}
    }

    if (result.courtesy && this.online[dest]) {
      this.enqueueMessage({
        sides: [dest],
        kind: 'Afvalpiep',
        samples: join(
          gap(110),
          tone(this.config.beepHz, this.config.beepMs),
          gap(100)
        )
      });
    }
    this.state();
  }

  tick() {
    if (!this.running) return;

    const now = Date.now();
    if (now - this.lastStateAt > 250) {
      this.lastStateAt = now;
      this.state();
    }

    const ended = this.controller.tick(now);
    if (ended.kind === 'end') this.endTransmission(ended);

    if (this.online.A && this.online.B) {
      if (
        this.config.callMinutes > 0 &&
        now - this.lastCall > this.config.callMinutes * 60000
      ) {
        this.lastCall = now;
        this.announceCall();
      }

      if (
        this.config.timeMinutes > 0 &&
        now - this.lastTime > this.config.timeMinutes * 60000
      ) {
        this.lastTime = now;
        this.announceTime();
      }

      if (
        this.queue.length &&
        !this.busy &&
        this.controller.beginSystem()
      ) {
        const next = this.queue.shift();
        this.play(next).catch(
          e => this.log('Melding mislukt: ' + e.message)
        );
      }
    }
  }

  enqueueMessage(job) {
    if (this.queue.length >= 24) {
      throw new Error('Meldingenwachtrij is vol; probeer opnieuw');
    }
    this.queue.push(job);
  }

  announceCall(text = this.config.callText) {
    if (
      typeof text !== 'string' ||
      !text.trim() ||
      text.length > 300
    ) {
      throw new Error(
        'Vul een geldige callgever-tekst in (maximaal 300 tekens)'
      );
    }

    this.enqueueMessage({
      kind: 'Callgever',
      sides: ['A', 'B'],
      text: text.trim()
    });
    this.log('Callgever in wachtrij: uitzending op beide servers zodra de verbinding vrij is');
    this.lastCall = Date.now();
  }

  announceTime() {
    const now = new Date();
    const hh = now.getHours();
    const mm = now.getMinutes();

    const text = mm === 0
      ? `Tijdmelding. Het is ${hh} uur.`
      : `Tijdmelding. Het is ${hh} uur en ${mm} minuten.`;

    this.enqueueMessage({
      kind: 'Tijdmelder',
      sides: ['A', 'B'],
      text
    });
    this.log('Tijdmelder in wachtrij: ' + text);
    this.lastTime = Date.now();
  }

  updateSettings(values) {
    const next = validate(values);

    for (const key of [
      'hangMs',
      'timeoutSeconds',
      'courtesy',
      'beepHz',
      'beepMs',
      'callMinutes',
      'timeMinutes',
      'callText'
    ]) {
      this.config[key] = next[key];
    }

    Object.assign(this.controller.options, {
      hangMs: next.hangMs,
      timeoutSeconds: next.timeoutSeconds,
      courtesy: next.courtesy
    });
    this.log('Repeaterinstellingen tijdens gebruik bijgewerkt');
  }

  async toggleCommander(side) {
    if (side !== 'A' && side !== 'B') {
      throw new Error('Ongeldige server voor Channel Commander');
    }
    if (!this.running || !this.online[side] || !this.conn[side]) {
      throw new Error(`TeamSpeak-server ${side} is niet verbonden`);
    }
    if (this.commanderPending[side]) {
      throw new Error('Channel Commander opdracht loopt al');
    }

    const client = this.conn[side];
    const enabled = !this.commander[side];

    this.commanderPending[side] = true;
    this.state();

    try {
      await client.execCommand(
        `clientupdate client_is_channel_commander=${enabled ? 1 : 0}`
      );

      if (
        !this.running ||
        !this.online[side] ||
        this.conn[side] !== client
      ) {
        throw new Error(
          'Verbinding verbroken tijdens wijziging van Channel Commander'
        );
      }

      this.commander[side] = enabled;
      this.log(`Channel Commander server ${side}: ${enabled ? 'AAN' : 'UIT'}`);
      return enabled;

    } catch (err) {
      this.log(`Channel Commander server ${side} mislukt: ${err.message}`);
      throw err;

    } finally {
      this.commanderPending[side] = false;
      this.state();
    }
  }

  testBeep(side) {
    const sides = side === 'A' || side === 'B'
      ? [side]
      : ['A', 'B'];

    this.enqueueMessage({
      kind: 'Testpiep',
      sides,
      samples: join(tone(740, 330), gap(150))
    });
    this.log('Testpiep in wachtrij naar ' + sides.join('+'));
  }

  async play(job) {
    this.busy = true;
    this.state();

    try {
      if (!this.running) return;

      const samples = job.samples || await textToSamples(job.text);
      const packets = this.encoder.encode(samples);

      if (!packets.length) {
        throw new Error('Geen Opus-audio gemaakt voor de melding');
      }

      this.log(`${job.kind} wordt uitgezonden via ${job.sides.join(' + ')}`);

      let next = performance.now();

      for (const packet of packets) {
        if (
          !this.running ||
          !this.online.A ||
          !this.online.B
        ) break;

        for (const side of job.sides) {
          this.conn[side].sendVoice(packet, 4);
        }

        next += 20;
        await sleep(Math.max(0, next - performance.now()));
      }

      for (const side of job.sides) {
        try {
          if (this.online[side]) {
            this.conn[side].sendVoice(Buffer.alloc(0), 4);
          }
        } catch (_) {}
      }

      this.log(`${job.kind} voltooid`);

    } finally {
      this.busy = false;
      this.controller.endSystem();
      this.state();
    }
  }

  async stop() {
    this.running = false;

    if (this.loop) clearInterval(this.loop);
    this.loop = null;
    this.queue = [];
    this.controller.reset();

    const old = this.conn;
    this.conn = { A: null, B: null };
    this.online = { A: false, B: false };
    this.commander = { A: false, B: false };
    this.commanderPending = { A: false, B: false };

    await Promise.allSettled(
      Object.values(old).filter(Boolean).map(c => c.disconnect())
    );

    this.encoder?.close();
    this.encoder = null;
    this.busy = false;
    this.log('Crosslink gestopt');
    this.state();
  }
}

module.exports = { DirectBridge, DEFAULTS, validate };
