'use strict';

const path = require ('path');
const watt = require ('watt');
const uuidV4 = require ('uuid/v4');

const xEtc = require ('xcraft-core-etc');
const Daemon = require ('xcraft-core-daemon');
const xBusClient = require ('xcraft-core-busclient');
const {BusClient} = xBusClient;

const xHost = require.resolve ('xcraft-core-host');
const host = xHost.replace (/(.*[\\/]xcraft-core-host[\\/]).*/, (match, dir) =>
  path.join (dir, 'bin/host')
);

let _port = 9229;

class Slave {
  constructor (resp, horde) {
    this._resp = resp;
    this._horde = horde;
    this._company = 'epsitec'; // FIXME
    this._name = uuidV4 ();
    this._daemon = null;
    this._busClient = null;
    this._commands = [];

    watt.wrapAll (this);
  }

  get id () {
    return this._daemon ? this._daemon.proc.pid : this._name;
  }

  get horde () {
    return this._horde;
  }

  get commands () {
    return this._commands;
  }

  get busClient () {
    return this._busClient;
  }

  get isDaemon () {
    return !!this._daemon;
  }

  *connect (busConfig, next) {
    const subs = ['*::*'];

    this._busClient = new BusClient (busConfig, subs);
    this._busClient.on ('commands.registry', next.parallel ());
    this._busClient.connect ('axon', null, next.parallel ());
    yield next.sync ();

    this._commands = this._busClient.getCommandsRegistry ();

    this._busClient.events.catchAll ((topic, ...args) => {
      if (/^greathall::/.test (topic)) {
        return;
      }
      xBusClient.getGlobal ().events.send (topic, ...args);
    });
  }

  start (next) {
    /* FIXME: replace the WESTEROS_APP environment variable by something
     * better like command line.
     */
    const env = Object.assign ({}, process.env);
    env.WESTEROS_APP = this._horde;

    this._daemon = new Daemon (
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
    this._daemon.start ();

    let retries = 0;

    /* The settings file is not available immediatly. For connecting to the
     * daemon, we must have this file. Then we retry several times (10x100ms).
     *
     * FIXME: replace this stuff by a file watcher in xEtc.load.
     */
    const interval = setInterval (() => {
      let busConfig = null;

      try {
        const xUtils = require ('xcraft-core-utils');
        const root = path.join (
          xUtils.os.getAppData (),
          this._company,
          this._horde
        );
        busConfig = new xEtc.Etc (root, this._resp).load (
          'xcraft-core-bus',
          this.id
        );
      } catch (ex) {
        ++retries;
        if (retries === 10) {
          clearInterval (interval);
          next (ex);
        }
        return;
      }

      try {
        this.connect (busConfig, next);
      } catch (ex) {
        next (ex);
      } finally {
        clearInterval (interval);
      }
    }, 100);
  }

  *stop (next) {
    if (this._busClient) {
      this._busClient.command.send ('shutdown');
      yield this._busClient.stop (next);
    }

    this._daemon.stop ();
  }
}

class Horde {
  constructor () {
    this._config = require ('xcraft-core-etc') ().load ('xcraft-core-horde');
    this._slaves = {};

    this._topology = this._config.topology
      ? typeof this._config.topology === 'string'
          ? JSON.parse (this._config.topology)
          : this._config.topology
      : {};

    watt.wrapAll (this);
  }

  get commands () {
    return Object.assign (
      {},
      ...Object.keys (this._slaves).map (id => {
        return {[this._slaves[id].horde]: this._slaves[id].commands};
      })
    );
  }

  get busClient () {
    const command = {
      send: (horde, cmd, msg) => {
        for (const id in this._slaves) {
          const slave = this._slaves[id];
          if (slave.horde === horde) {
            slave.busClient.command.send (cmd, msg);
            return;
          }
        }
      },
    };

    return {
      command,
    };
  }

  *autoload (resp, next) {
    if (!this._config.hordes || !this._config.hordes.length) {
      return;
    }

    for (const horde of this._config.hordes) {
      this.add (resp, horde, next.parallel ());
    }

    yield next.sync ();
  }

  *add (resp, horde, next) {
    const slave = new Slave (resp, horde);

    if (this._topology[horde]) {
      yield slave.connect (this._topology[horde]);
    } else {
      yield slave.start (next);
    }

    this._slaves[slave.id] = slave;

    const xBus = require ('xcraft-core-bus');
    xBus.notifyCmdsRegistry ();

    return slave.id;
  }

  remove (id, resp) {
    if (!this._slaves[id]) {
      resp.log.warn (`slave ${id} is not alive`);
      return;
    }
    this._slaves[id].stop ();
    delete this._slaves[id];
  }

  stop (all = false) {
    for (const id in this._slaves) {
      const slave = this._slaves[id];
      if (all || slave.isDaemon) {
        slave.stop ();
      }
    }
  }
}

module.exports = new Horde ();
