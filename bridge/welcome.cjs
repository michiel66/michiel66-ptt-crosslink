'use strict';

/**
 * Tracks TeamSpeak's visible clients and detects an actual entry into the
 * channel occupied by the gateway account. Pure logic; no TeamSpeak or TTS I/O.
 *
 * The SDK emits `clientEnter` for its initial view on connect. The caller must
 * keep a side unarmed until the initial view has arrived, so those initial
 * occupants are seeded but not welcomed.
 */
class WelcomeTracker {
  constructor() {
    this.clients = { A: new Map(), B: new Map() };
    this.ready = { A: false, B: false };
  }

  reset(side) {
    if (side !== 'A' && side !== 'B') return;
    this.clients[side].clear();
    this.ready[side] = false;
  }

  arm(side) {
    if (side === 'A' || side === 'B') this.ready[side] = true;
  }

  static channelID(value) {
    try {
      if (value === null || value === undefined || value === '') return 0n;
      return BigInt(value);
    } catch (_) {
      return 0n;
    }
  }

  static spokenName(value) {
    if (typeof value !== 'string') return '';
    return value
      .replace(/[\x00-\x1f\x7f]/g, ' ')
      .replace(/[\u200b-\u200f\u2060\ufeff]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 70);
  }

  enter(side, info, ownClientID, ownChannelID) {
    if (!this.clients[side] || !info || !Number.isInteger(info.id) || info.id < 1) return null;
    const id = info.id;
    const target = WelcomeTracker.channelID(ownChannelID);
    const channel = WelcomeTracker.channelID(info.channelID);
    const previous = this.clients[side].get(id);
    const nickname = WelcomeTracker.spokenName(info.nickname || previous?.nickname);
    const type = Number(info.type ?? previous?.type ?? 0);

    this.clients[side].set(id, { id, nickname, type, channel });

    if (!this.ready[side] || !target || !channel || channel !== target ||
        previous?.channel === channel || id === ownClientID || type !== 0 || !nickname) return null;

    return { side, clientId: id, nickname };
  }

  moved(side, event, ownClientID, ownChannelID) {
    if (!this.clients[side] || !event || !Number.isInteger(event.id)) return null;
    const previous = this.clients[side].get(event.id);
    if (!previous) return null; // SDK move event has no nickname: wait for clientEnter.
    const target = WelcomeTracker.channelID(ownChannelID);
    const channel = WelcomeTracker.channelID(event.targetChannelID);
    this.clients[side].set(event.id, { ...previous, channel });

    if (!this.ready[side] || !target || !channel || channel !== target ||
        previous.channel === channel || event.id === ownClientID ||
        previous.type !== 0 || !previous.nickname) return null;

    return { side, clientId: event.id, nickname: previous.nickname };
  }

  leave(side, event) {
    if (!this.clients[side] || !event || !Number.isInteger(event.id)) return;
    this.clients[side].delete(event.id);
  }

  stillPresent(side, clientId, ownChannelID) {
    const user = this.clients[side]?.get(clientId);
    const target = WelcomeTracker.channelID(ownChannelID);
    return !!target && !!user && user.channel === target;
  }
}

module.exports = { WelcomeTracker };
