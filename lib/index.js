'use strict';

const path = require('path');
const watt = require('gigawatts');
const EventEmitter = require('events');
const uuidV4 = require('uuid/v4');

const xEtc = require('xcraft-core-etc');
const Daemon = require('xcraft-core-daemon');
const xTransport = require('xcraft-core-transport');
const xBusClient = require('xcraft-core-busclient');
const {BusClient} = xBusClient;

const xHost = require('xcraft-core-host');
const _host = require.resolve('xcraft-core-host');
const host = _host.replace(/(.*[\\/]xcraft-core-host[\\/]).*/, (match, dir) =>
  path.join(dir, 'bin/host')
);

let _port = 9229;

class Slave extends EventEmitter {
  constructor(horde, resp, hordeId) {
    super();

    this._resp = resp;
    this._horde = horde;
    this._hordeId = hordeId;
    this._company = 'epsitec'; // FIXME
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

  get commands() {
    return this._commands;
  }

  get busClient() {
    return this._busClient;
  }

  get isDaemon() {
    return !!this._daemon;
  }

  /**
   * Connect to an existing slave.
   *
   * It's possible to just connect to an existing slave which was not started
   * here.
   *
   * @param {BusConfig} busConfig - Settings for connecting to the buses.
   * @param {function} next - Watt's callback.
   */
  *connect(busConfig, next) {
    this._noForwarding = !!busConfig.noForwarding;
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

    this._busClient.on('token.changed', () => {
      this.emit('token.changed');
    });

    if (this._noForwarding) {
      return;
    }

    this._busClient.events.catchAll((topic, msg) => {
      if (topic.startsWith('greathall::') || msg._xcraftBroadcasted) {
        return;
      }

      const _msg = msg._xcraftRawMessage ? msg._xcraftRawMessage : msg;
      let sent = false;

      const isCmdEvent =
        topic.endsWith('.finished') || topic.endsWith('.error');
      if (isCmdEvent) {
        const isNoForwarding = !!_msg.forwarding;
        if (isNoForwarding) {
          try {
            sent = this._horde.fwcast(_msg.forwarding.appId, topic, _msg);
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
    });
  }

  get noForwarding() {
    return this._noForwarding;
  }

  /**
   * Start a new slave.
   *
   * When the slave is started, then it's connected on the way.
   *
   * @param {function} next - Watt's callback.
   */
  start(next) {
    /* FIXME: replace the WESTEROS_APP environment variable by something
     * better like command line.
     */
    const env = Object.assign({}, process.env);
    env.WESTEROS_APP = this.horde;

    const {variantId} = xHost;
    if (variantId) {
      env.WESTEROS_APP += `@${variantId}`;
    }

    this._daemon = new Daemon(
      this._name,
      host,
      {
        detached: false,
        env,
        inspectPort: _port++,
      },
      true,
      this._resp
    );
    this._daemon.start();

    let retries = 0;

    /* The settings file is not available immediatly. For connecting to the
     * daemon, we must have this file. Then we retry several times (10x100ms).
     *
     * FIXME: replace this stuff by an announce.
     */
    const interval = setInterval(() => {
      let busConfig = null;

      try {
        const xHost = require('xcraft-core-host');
        const root = path.join(
          xHost.appData,
          this._company,
          xHost.variantId ? `${this.horde}-${xHost.variantId}` : this.horde
        );
        busConfig = new xEtc.Etc(root, this._resp).load(
          'xcraft-core-bus',
          this.id
        );
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
   * @param {Boolean} shutdown - True for killing the server.
   * @param {function} next - Watt's callback.
   */
  *stop(shutdown, next) {
    if (this._busClient) {
      this._busClient.removeAllListeners();

      if (shutdown) {
        this._busClient.command.send('shutdown');
      }
      yield this._busClient.stop(next);
    }

    if (shutdown) {
      this._daemon.stop();
    }
  }
}

class Horde {
  constructor(config) {
    this._xBus = require('xcraft-core-bus');
    this._config =
      config || require('xcraft-core-etc')().load('xcraft-core-horde');
    this._slaves = {};

    /* The topology can be expressed by a string or a real JSON object. The
     * mais reason is that Inquirer can not work with real object. The string
     * is only used in this case.
     */
    this._topology = this._config.topology
      ? typeof this._config.topology === 'string'
        ? JSON.parse(this._config.topology)
        : this._config.topology
      : {};

    watt.wrapAll(this);
  }

  _commands(full) {
    return Object.assign(
      {},
      ...Object.keys(this._slaves)
        .filter((id) => full || !this._slaves[id].noForwarding)
        .map((id) => {
          return {[this._slaves[id].horde]: this._slaves[id].commands};
        })
    );
  }

  isNoForwarding(hordeId) {
    for (const id in this._slaves) {
      if (this._slaves[id].horde === hordeId) {
        return this._slaves[id].noForwarding;
      }
    }
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

  get busClient() {
    const command = {
      send: (hordeId, cmd, msg) => {
        for (const id in this._slaves) {
          const slave = this._slaves[id];
          if (slave.horde === hordeId) {
            if (slave.noForwarding) {
              msg.forwarding = {
                router: 'ee',
                appId: xHost.appId,
              };
            }
            msg.arp = {[msg.orcName]: {token: this._xBus.getToken()}};
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
   * @param {Object} msg - The message itself.
   */
  broadcast(hordeId, topic, msg) {
    xBusClient.getGlobal().events.send(topic, msg);

    for (const id in this._slaves) {
      if (id === `${hordeId}`) {
        continue;
      }
      const slave = this._slaves[id];
      slave.busClient.command.send(`broadcast`, {topic, msg});
    }
  }

  /**
   * Forward an event to a specific server.
   *
   * @param {string} horde - The destination horde (appId).
   * @param {string} topic - Message's topic.
   * @param {Object} msg - The message itself.
   * @returns {boolean} True on success.
   */
  fwcast(horde, topic, msg) {
    for (const id in this._slaves) {
      const slave = this._slaves[id];
      if (slave.horde === horde) {
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
   * @param {Object} msg - The message itself.
   * @returns {boolean} True on success.
   */
  unicast(topic, msg) {
    const {orcName} = msg;

    /* Retrieve the routers associated to this orc */
    const routers = xTransport.Router.getRouters(orcName);
    if (!routers) {
      return false;
    }

    /* An event can only be sent with a pub router */
    const router = routers.pub;
    if (!router) {
      return false;
    }

    // FIXME: factorize with patchMessage()
    const {token} = xTransport.Router.getRoute(orcName);
    msg.token = token;
    router.send(topic, msg); // FIXME: select the right socket
    return true;
  }

  /**
   * Try to load the whole hordes accordingly to the topology.
   *
   * @param {Resp} resp - Response object for working with the buses.
   * @param {string} [topology] - Select the topology to use (can be undefined).
   * @param {function} next - Watt's callback.
   */
  *autoload(resp, topology, next) {
    if (!next) {
      next = topology;
      topology = undefined;
    }

    if (!this._config.hordes || !this._config.hordes.length) {
      return;
    }

    for (let horde of this._config.hordes) {
      this.add(resp, horde, topology, next.parallel());
    }

    yield next.sync();
  }

  *add(resp, horde, topology, next) {
    const slave = new Slave(this, resp, horde);

    const xBus = require('xcraft-core-bus');
    slave
      .on('commands.registry', () => {
        xBus.notifyCmdsRegistry();
      })
      .on('token.changed', () => {
        xBus.notifyTokenChanged();
      });

    const def = topology ? `${horde}#${topology}` : horde;
    if (this._topology[def]) {
      yield slave.connect(this._topology[def]);
    } else {
      yield slave.start(next);
    }

    this._slaves[slave.id] = slave;
    xBus.notifyCmdsRegistry();

    return slave.id;
  }

  *remove(id, resp) {
    if (!this._slaves[id]) {
      resp.log.warn(`slave ${id} is not alive`);
      return;
    }
    this._slaves[id].removeAllListeners();
    yield this._slaves[id].stop(false);
    delete this._slaves[id];
  }

  *stop(all, next) {
    if (!next) {
      next = all;
      all = false;
    }

    for (const id in this._slaves) {
      const slave = this._slaves[id];
      slave.removeAllListeners();
      slave.stop(all || slave.isDaemon, next.parallel());
    }

    yield next.sync();
  }

  *unload(resp, next) {
    for (const id in this._slaves) {
      this.remove(id, resp, next.parallel());
    }
    yield next.sync();
  }

  getSlaves() {
    return Object.values(this._slaves).map((slave) => slave.horde);
  }

  useTopology(topology) {
    return Object.keys(this._topology).some((def) => {
      const entry = def.split('#');
      return entry.length > 1 && entry[1] === topology;
    });
  }
}

module.exports = new Horde();
module.exports.Horde = Horde;
