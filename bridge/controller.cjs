'use strict';

/** Pure, transport-independent half duplex repeater controller. */
class Controller {
  constructor(options = {}, events = () => {}) {
    this.options = {
      hangMs: 450,
      timeoutSeconds: 180,
      courtesy: true,
      ...options,
    };
    this.events = events;
    this.route = null;
    this.clientId = null;
    this.lastCodec = 4;
    this.lastPacketAt = 0;
    this.startedAt = 0;
    this.blocked = null;
    this.systemBusy = false;
    this.totals = { A2B: 0, B2A: 0 };
  }

  ingest(side, packet, now = Date.now()) {
    if (side !== 'A' && side !== 'B') return { kind: 'drop' };
    const { clientId, codec, data } = packet || {};
    if (![4, 5].includes(codec) || !data || !Number.isInteger(clientId)) return { kind: 'drop' };
    const dir = side === 'A' ? 'A2B' : 'B2A';
    // Incoming empty TeamSpeak packets denote end-of-transmission.
    if (data.length === 0) {
      if (this.route === dir && this.clientId === clientId) {
        this.lastPacketAt = now - Math.max(0, this.options.hangMs);
      }
      return { kind: 'drop' };
    }
    if (this.blocked && this.blocked.dir === dir) {
      this.blocked.lastAt = now;
      return { kind: 'drop' };
    }
    if (this.systemBusy) return { kind: 'drop' };
    if (this.route === null) {
      this.route = dir;
      this.clientId = clientId;
      this.startedAt = now;
      this.lastCodec = codec;
      this.events({ type: 'route', dir, clientId });
    }
    // Only one source client at a time; avoid mixing 2 unrelated Opus streams.
    if (this.route !== dir || this.clientId !== clientId) return { kind: 'drop' };
    if (this.options.timeoutSeconds > 0 && now - this.startedAt >= this.options.timeoutSeconds * 1000) {
      this.blocked = { dir, lastAt: now };
      this.route = null;
      this.clientId = null;
      this.events({ type: 'timeout', dir });
      return { kind: 'end', dir, codec: this.lastCodec, courtesy: false, timeout: true };
    }
    this.lastCodec = codec;
    this.lastPacketAt = now;
    this.totals[dir]++;
    return { kind: 'forward', dir, codec, data };
  }

  tick(now = Date.now()) {
    const hang = Math.max(40, this.options.hangMs);
    if (this.route && now - this.lastPacketAt >= hang) {
      const dir = this.route;
      this.route = null;
      this.clientId = null;
      this.events({ type: 'idle', dir });
      return { kind: 'end', dir, codec: this.lastCodec, courtesy: !!this.options.courtesy, timeout: false };
    }
    if (this.blocked && now - this.blocked.lastAt >= hang) {
      const dir = this.blocked.dir;
      this.blocked = null;
      this.events({ type: 'rearmed', dir });
    }
    return { kind: 'none' };
  }

  beginSystem() {
    if (this.systemBusy || this.route) return false;
    this.systemBusy = true;
    return true;
  }

  endSystem() {
    this.systemBusy = false;
  }

  reset() {
    this.route = null;
    this.clientId = null;
    this.blocked = null;
    this.systemBusy = false;
  }
}

module.exports = { Controller };
