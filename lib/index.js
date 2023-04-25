'use strict';

const path = require('path');
const watt = require('gigawatts');
const EventEmitter = require('events');
const {v4: uuidV4} = require('uuid');
const {performance} = require('perf_hooks');

const xEtc = require('xcraft-core-etc');
const Daemon = require('xcraft-core-daemon');
const xTransport = require('xcraft-core-transport');
const xBusClient = require('xcraft-core-busclient');
const {clearInterval} = require('timers');
const {BusClient} = xBusClient;

const _host = require.resolve('xcraft-core-host');
const host = _host.replace(/(.*[\\/]xcraft-core-host[\\/]).*/, (match, dir) =>
  path.join(dir, 'bin/host')
);

let _port = 9229;

class Slave extends EventEmitter {
  constructor(horde, resp, hordeId, tribe) {
    super();

    this._resp = resp;
    this._horde = horde;
    this._hordeId = hordeId;
    this._tribe = tribe;
    this._totalTribes;
    this._routingKey = tribe ? `${hordeId}-${tribe}` : hordeId;
    this._name = uuidV4();
    this._daemon = null;
    this._busClient = null;
    this._commands = [];

    watt.wrapAll(this);
  }

  get id() {
    return this._daemon ? this._daemon.proc.pid : this._name;
  }

  get horde() {
    return this._hordeId;
  }

  get routingKey() {
    return this._routingKey;
  }

  get commands() {
    return this._commands;
  }

  get busClient() {
    return this._busClient;
  }

  get isDaemon() {
    return !!this._daemon;
  }

  get isConnected() {
    return this._busClient?.isConnected();
  }

  get tribe() {
    return this._tribe;
  }

  set totalTribes(totalTribes) {
    this._totalTribes = totalTribes;
  }

  get isPassive() {
    return this._passive;
  }

  /**
   * Connect to an existing slave.
   *
   * It's possible to just connect to an existing slave which was not started
   * here.
   *
   * @yields
   * @param {object} busConfig - Settings for connecting to the buses.
   * @param {Function} next - Watt's callback.
   */
  *connect(busConfig, next) {
    this._noForwarding = !!busConfig.noForwarding;
    this._passive = !!busConfig.passive;
    this._busClient = new BusClient(
      busConfig,
      this._noForwarding ? null : ['*::*']
    );
    this._busClient.once('commands.registry', next.parallel());
    this._busClient.connect('axon', null, next.parallel());
    yield next.sync();

    this._commands = this._busClient.getCommandsRegistry();

    this._busClient.on('commands.registry', (_, {token, time}) => {
      if (
        token === this._busClient.getToken() &&
        time === this._busClient.getCommandsRegistryTime()
      ) {
        return;
      }
      this._commands = this._busClient.getCommandsRegistry();
      this.emit('commands.registry', null, {token, time});
    });

    this._busClient
      .on('token.changed', () => {
        this.emit('token.changed');
      })
      .on('orcname.changed', (...args) => {
        this.emit('orcname.changed', ...args);
      })
      .on('reconnect', () => {
        this.emit('reconnect');
      })
      .on('reconnect attempt', () => {
        this.emit('reconnect attempt');
      });

    if (this._noForwarding) {
      return;
    }

    /* This catchAll is used as proxy. The Xcraft data are not deserialized. */
    this._busClient.events.catchAll((topic, msg) => {
      if (topic.startsWith('greathall::')) {
        return;
      }

      if (!msg) {
        this._resp.log.warn(`undefined message received via ${topic}`);
        return;
      }

      if (msg._xcraftBroadcasted) {
        return;
      }

      const _msg = msg._xcraftRawMessage ? msg._xcraftRawMessage : msg;
      let sent = false;

      let routingKey;
      if (_msg.forwarding && _msg.forwarding.route) {
        /* Replace forwarding by usual orcName/lines/broadcast dispatching */
        if (_msg.forwarding.route.includes(this._horde.routingKey)) {
          delete _msg.forwarding;
        } else {
          routingKey = _msg.forwarding.route[0];
        }
      }

      const isCmdEvent =
        topic.endsWith('.finished') || topic.endsWith('.error');
      if (isCmdEvent) {
        const isNoForwarding = !!_msg.forwarding;
        if (isNoForwarding) {
          try {
            sent = this._horde.fwcast(routingKey, topic, _msg);
          } catch (ex) {
            this._resp.log.err(
              `horde.fwcast has failed for ${topic}: ${
                ex.stack || ex.message || ex
              }\n... we try to continue by broadcasting`
            );
          }
        } else {
          try {
            sent = this._horde.unicast(topic, _msg);
          } catch (ex) {
            this._resp.log.err(
              `horde.unicast has failed for ${topic}: ${
                ex.stack || ex.message || ex
              }\n... we try to continue by broadcasting`
            );
          }
        }
      }

      if (!sent) {
        if (_msg.forwarding && _msg.forwarding.appId) {
          try {
            sent = this._horde.fwcast(routingKey, topic, _msg);
          } catch (ex) {
            this._resp.log.err(
              `horde.fwcast has failed for ${topic}: ${
                ex.stack || ex.message || ex
              }\n... we try to continue by broadcasting`
            );
          }
        }
      }

      if (!sent) {
        try {
          this._horde.broadcast(this.id, topic, _msg);
        } catch (ex) {
          this._resp.log.err(
            `horde.broadcast has failed for ${topic}: ${
              ex.stack || ex.message || ex
            }\n... the message is lost`
          );
        }
      }
    }, true);
  }

  get noForwarding() {
    return this._noForwarding;
  }

  busConfig(pid) {
    const xHost = require('xcraft-core-host');
    const goblinsApp = xHost.variantId
      ? `${this.horde}@${xHost.variantId}`
      : this.horde;
    const goblinsAppPath = xHost.variantId
      ? `${this.horde}-${xHost.variantId}`
      : this.horde;
    let prevGoblinsApp;

    try {
      prevGoblinsApp = process.env.GOBLINS_APP;
      process.env.GOBLINS_APP = goblinsApp;

      const root = path.join(xHost.appData, xHost.appCompany, goblinsAppPath);

      require('xcraft-server/lib/init-env.js').initEtc(
        path.resolve(xHost.appConfigPath, '..', goblinsAppPath),
        xHost.projectPath,
        this.horde
      );

      return new xEtc.Etc(root, this._resp).load('xcraft-core-bus', pid);
    } finally {
      process.env.GOBLINS_APP = prevGoblinsApp;
    }
  }

  /**
   * Start a new slave.
   *
   * When the slave is started, then it's connected on the way.
   *
   * @param {Function} next - Watt's callback.
   */
  start(next) {
    let appId = this.horde;

    const {variantId} = require('xcraft-core-host');
    if (variantId) {
      appId += `@${variantId}`;
    }

    if (!Number.isInteger(this._tribe)) {
      throw new Error('A slave cannot be started without tribe number');
    }

    const argv = [`--app=${appId}`, `--tribe=${this._tribe}`];
    if (this._totalTribes > 1) {
      argv.push(`--total-tribes=${this._totalTribes}`);
    }

    this._daemon = new Daemon(
      this._name,
      host,
      {
        detached: false,
        inspectPort: _port++,
        argv,
      },
      true,
      this._resp
    );
    this._daemon.start();

    let retries = 0;

    /* The settings file is not available immediatly. For connecting to the
     * daemon, we must have this file. Then we retry several times (10x5000ms).
     *
     * FIXME: replace this stuff by an announce.
     */
    const interval = setInterval(() => {
      let busConfig = null;

      try {
        busConfig = this.busConfig(this.id);
      } catch (ex) {
        ++retries;
        if (retries === 10) {
          clearInterval(interval);
          next(ex);
        }
        return;
      }

      try {
        this.connect(busConfig, next);
      } catch (ex) {
        next(ex);
      } finally {
        clearInterval(interval);
      }
    }, 5000);
  }

  /**
   * Stop the slave gracefully.
   *
   * @yields
   * @param {boolean} shutdown - True for killing the server.
   * @param {Function} next - Watt's callback.
   */
  *stop(shutdown, next) {
    if (this._busClient) {
      this._busClient.removeAllListeners();

      if (shutdown && !this.noForwarding) {
        this._busClient.command.send('shutdown');
      }
      yield this._busClient.stop(next);
    }

    if (shutdown && this._daemon) {
      this._daemon.stop();
    }
  }
}

class Horde {
  constructor(config) {
    const {appId, appArgs} = require('xcraft-core-host');
    const args = appArgs();

    this._xBus = require('xcraft-core-bus');
    this._appId = appId;
    this._tribe = args.tribe;
    this._config = config || xEtc().load('xcraft-core-horde');
    this._slaves = new Map();
    this._deltaInterval = new Map();
    this._tribeDispatcher = false;

    this._routingKey = this._tribe
      ? `${this._appId}-${this._tribe}`
      : this._appId;

    /* The topology can be expressed by a string or a real JSON object. The
     * mais reason is that Inquirer can not work with real object. The string
     * is only used in this case.
     */
    this._topology = this._config.topology
      ? typeof this._config.topology === 'string'
        ? JSON.parse(this._config.topology)
        : this._config.topology
      : {};

    if (args.topology) {
      const {modules} = require('xcraft-core-utils');
      const topology = JSON.parse(args.topology);
      modules.mergeOverloads(this._topology, topology);
    }

    watt.wrapAll(this);
  }

  get routingKey() {
    return this._routingKey;
  }

  _commands(full) {
    return Object.assign(
      {},
      ...Array.from(this._slaves.values())
        .filter((slave) => full || !slave.noForwarding)
        .map((slave) => {
          return {[slave.routingKey]: slave.commands};
        })
    );
  }

  isNoForwarding(hordeId) {
    for (const slave of this._slaves.values()) {
      if (slave.horde === hordeId) {
        return slave.noForwarding;
      }
    }
  }

  get isTribeDispatcher() {
    return this._tribeDispatcher;
  }

  get config() {
    return this._config;
  }

  get commands() {
    return this._commands(true);
  }

  get public() {
    return this._commands(false);
  }

  getTribe(routingKey) {
    for (const slave of this._slaves.values()) {
      if (slave.routingKey === routingKey) {
        return slave.tribe;
      }
    }
    return -1;
  }

  getSlave(routingKey) {
    for (const slave of this._slaves.values()) {
      if (slave.routingKey === routingKey) {
        return slave;
      }
    }
    return -1;
  }

  get busClient() {
    const command = {
      send: (routingKey, cmd, msg) => {
        const {appId, appArgs} = require('xcraft-core-host');
        const {tribe} = appArgs();
        const _routingKey = tribe ? `${appId}-${tribe}` : appId;

        for (const slave of this._slaves.values()) {
          if (slave.routingKey === routingKey) {
            if (slave.noForwarding && !msg.forwarding) {
              msg.forwarding = {router: 'ee', appId, tribe};
            }
            if (!msg.route) {
              msg.route = [];
            }
            msg.route.push(_routingKey);
            let nice =
              msg.arp && msg.arp[msg.orcName] ? msg.arp[msg.orcName].nice : 0;
            nice = nice || 0;
            const _nice = slave.busClient.getNice();
            msg.arp = {
              [msg.orcName]: {
                token: this._xBus.getToken(),
                nice: nice < _nice ? nice : _nice /* Use the higher priority */,
                noForwarding: slave.noForwarding,
                nodeName: _routingKey,
              },
            };
            msg.router = slave.busClient.command.connectedWith();
            slave.busClient.command.send(cmd, msg, null, null, {
              forceNested: true,
            });
            return;
          }
        }
      },
    };

    return {
      command,
    };
  }

  /**
   * Broadcast a message to the horde.
   *
   * All slaves (excepted the slave which has sent the message) will receive
   * this event. Each server has a special handler 'broadcast' in order
   * to be able to send an event on it's bus.
   *
   * @param {string} hordeId - ID where the message come from.
   * @param {string} topic - Message's topic.
   * @param {object} msg - The message itself.
   */
  broadcast(hordeId, topic, msg) {
    xBusClient.getGlobal().events.send(topic, msg);

    const {Router} = require('xcraft-core-transport');

    let tokens = [];
    const lineId = Router.extractLineId(topic);
    if (lineId) {
      const lines = Router.getLines().remote;

      if (lines.has(lineId)) {
        tokens = lines
          .get(lineId)
          .keySeq()
          .map((entry) => entry.split('$')[1]);
      }
    }

    for (const id of this._slaves.keys()) {
      if (`${id}` === `${hordeId}`) {
        continue;
      }

      const slave = this._slaves.get(id);
      if (
        (tokens.length || tokens.size) &&
        !tokens.includes(slave.busClient.getToken())
      ) {
        continue;
      }

      slave.busClient.command.send(`broadcast`, {topic, msg});
    }
  }

  /**
   * Forward an event to a specific server.
   *
   * @param {string} routingKey - The destination horde (appId-tribe).
   * @param {string} topic - Message's topic.
   * @param {object} msg - The message itself.
   * @returns {boolean} True on success.
   */
  fwcast(routingKey, topic, msg) {
    for (const slave of this._slaves.values()) {
      if (slave.routingKey === routingKey) {
        slave.busClient.command.send(`broadcast`, {topic, msg});
        return true;
      }
    }
    return false;
  }

  /**
   * Unicast an event to a specific server.
   *
   * @param {string} topic - Message's topic.
   * @param {object} msg - The message itself.
   * @returns {boolean} True on success.
   */
  unicast(topic, msg) {
    const {orcName} = msg;

    /* Retrieve the routers associated to this orc */
    const routers = xTransport.Router.getRouters(orcName, 'axon');
    if (!routers) {
      return false;
    }

    /* An event can only be sent with a pub router */
    const router = routers.pub;
    if (!router) {
      return false;
    }

    // FIXME: factorize with patchMessage()
    const {token} = xTransport.Router.getRoute(orcName, 'axon');
    msg.token = token;
    router.send(topic, msg); // FIXME: select the right socket
    return true;
  }

  *_loadSingle(resp, horde) {
    /* tribe 0 (main) */
    const slave = new Slave(this, resp, horde, 0);

    let tribes = 0;
    if (!this._topology[horde]) {
      const busConfig = slave.busConfig(0);
      if (busConfig.tribes) {
        tribes = busConfig.tribes.length;
      }
    }

    slave.totalTribes = tribes + 1;
    yield this.add(slave, horde, null);

    for (let tribe = 1; tribe <= tribes; ++tribe) {
      const slave = new Slave(this, resp, horde, tribe);
      slave.totalTribes = tribes + 1;
      yield this.add(slave, horde, null);
    }
  }

  *_loadTribes(resp, horde) {
    const {appArgs} = require('xcraft-core-host');
    const tribe = appArgs().tribe || 0;

    const busConfig = require('xcraft-core-etc')().read('xcraft-core-bus');
    if (!busConfig.tribes || !busConfig.tribes.length) {
      throw new Error('no tribes configured in core-bus');
    }

    const tribes = [
      {
        commanderPort: busConfig.commanderPort,
        notifierPort: busConfig.notifierPort,
        tribe: 0,
      },
      ...busConfig.tribes.map((cfg, idx) => {
        return {...cfg, tribe: idx + 1};
      }),
    ];

    tribes.splice(tribe, 1);

    for (const tribeCfg of tribes) {
      const _busConfig = {
        ...busConfig,
        ...this._topology[horde],
        ...tribeCfg,
      };

      const slave = new Slave(this, resp, horde, tribeCfg.tribe);
      slave.totalTribes = tribes.length + 1;
      yield this.add(slave, horde, _busConfig);
    }
  }

  /**
   * Try to load the whole hordes accordingly to the topology.
   *
   * @yields
   * @param {*} resp - Response object for working with the buses.
   */
  *autoload(resp) {
    if (!this._config.hordes || !this._config.hordes.length) {
      return;
    }

    for (const horde of this._config.hordes) {
      if (this._topology[horde] && this._topology[horde].tribes) {
        if (this._appId === horde) {
          this._tribeDispatcher = true;
        }
        yield this._loadTribes(resp, horde);
      } else {
        yield this._loadSingle(resp, horde);
      }
    }
  }

  *add(slave, horde, busConfig, next) {
    const def = horde;

    if (!busConfig) {
      busConfig = this._topology[def];
    }

    const xBus = require('xcraft-core-bus');
    slave
      .on('commands.registry', () => {
        xBus.notifyCmdsRegistry();
      })
      .on('token.changed', () => {
        xBus.notifyTokenChanged();
      })
      .on('orcname.changed', (...args) => {
        xBus.notifyOrcnameChanged(...args);
      })
      .on('reconnect', () => {
        xBus.notifyReconnect('done');
      })
      .on('reconnect attempt', () => {
        xBus.notifyReconnect('attempt');
      });

    if (busConfig) {
      let lag = true;
      let prevPerf = 0;

      const deltaInterval = setInterval(() => {
        if (!slave.isConnected && lag) {
          return;
        }

        let noSocket = false;
        let overlay = false;
        let lastPerf = slave.busClient.events.lastPerf();
        if (lastPerf < 0) {
          lastPerf = prevPerf;
          noSocket = true;
          overlay = true;
        } else {
          prevPerf = lastPerf;
        }

        const newPerf = performance.now();
        const delta = newPerf - lastPerf;

        if (delta < 1000 && lag === true) {
          /* Everything is working fine; fired only one time */
          const payload = {horde, delta, lag: false, overlay, noSocket};
          xBusClient.getGlobal().events.send('greathall::<perf>', payload);
          lag = false;
        } else if (delta >= 1000 && delta < 10000) {
          /* Show lag without overlay */
          const payload = {horde, delta, lag: true, overlay, noSocket};
          xBusClient.getGlobal().events.send('greathall::<perf>', payload);
          lag = true;
        } else if (delta >= 10000) {
          /* Show overlay */
          overlay = true;
          const payload = {horde, delta, lag: true, overlay, noSocket};
          xBusClient.getGlobal().events.send('greathall::<perf>', payload);
          if (
            delta >= 20000 &&
            process.env.NODE_ENV !== 'development' &&
            !busConfig.optimistLag
          ) {
            /* Destroy socket and prepare for the restart */
            slave.busClient.destroyPushSocket();
          }
          lag = true;
        }
      }, 1000);
      this._deltaInterval.set(slave.id, deltaInterval);

      slave.connect(busConfig);

      const {horde} = xEtc().load('xcraft-core-bus');
      if (!busConfig.passive) {
        yield;
      }
    } else {
      yield slave.start(next);
    }

    this._slaves.set(slave.id, slave);
    xBus.notifyCmdsRegistry();

    return slave.id;
  }

  _deleteDeltaInterval(id) {
    if (!this._deltaInterval.has(id)) {
      return;
    }
    clearInterval(this._deltaInterval.get(id));
    this._deltaInterval.delete(id);
  }

  _deleteDeltaIntervals() {
    for (const deltaInterval of this._deltaInterval.values()) {
      clearInterval(deltaInterval);
    }
    this._deltaInterval.clear();
  }

  *remove(id, resp) {
    if (!this._slaves.has(id)) {
      resp.log.warn(`slave ${id} is not alive`);
      return;
    }
    this._deleteDeltaInterval(id);
    const slave = this._slaves.get(id);
    slave.removeAllListeners();
    yield slave.stop(false);
    this._slaves.delete(id);
  }

  *stop(all, next) {
    if (!next) {
      next = all;
      all = false;
    }

    this._deleteDeltaIntervals();
    for (const slave of this._slaves.values()) {
      slave.removeAllListeners();
      slave.stop(all || slave.isDaemon, next.parallel());
    }

    yield next.sync();
  }

  *unload(resp, next) {
    for (const id of this._slaves.keys()) {
      this.remove(id, resp, next.parallel());
    }
    yield next.sync();
  }

  getSlaves() {
    return Array.from(this._slaves.values()).map((slave) => slave.routingKey);
  }
}

module.exports = new Horde();
module.exports.Horde = Horde;
