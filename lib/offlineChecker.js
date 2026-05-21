'use strict';

class OfflineChecker {
  #hordeId;
  #connected = false;

  constructor(quest, hordeId, callback) {
    const xHorde = require('./index.js');

    const slave = xHorde.getSlave(hordeId);

    this.#hordeId = hordeId;
    this.#connected = slave === -1 ? false : slave.isConnected;

    quest.goblin.defer(
      quest.sub.local(
        'greathall::<perf>',
        async (err, {msg}) => await this.#monitorPerf(msg.data, callback)
      )
    );
  }

  async #monitorPerf(data, callback) {
    const {
      noSocket, // true if no more socket available
      syncing,
      horde,
    } = data;

    /* skip because it's not related to our socket changes */
    if (syncing || horde !== this.#hordeId) {
      return;
    }

    const previous = this.#connected;
    this.#connected = !noSocket;

    if (previous && !this.#connected) {
      await callback(false);
    } else if (!previous && this.#connected) {
      await callback(true);
    }
  }
}

module.exports = OfflineChecker;
