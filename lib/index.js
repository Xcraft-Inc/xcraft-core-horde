'use strict';

const path = require ('path');
const watt = require ('watt');
const uuidV4 = require ('uuid/v4');

const xEtc = require ('xcraft-core-etc');
const Daemon = require ('xcraft-core-daemon');
const {BusClient} = require ('xcraft-core-busclient');

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

  get pid () {
    return this._daemon ? this._daemon.proc.pid : -1;
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
          this.pid
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
        watt (function* (_next) {
          this._busClient = new BusClient (busConfig);
          this._busClient.on ('commands.registry', _next.parallel ());
          this._busClient.connect ('axon', null, _next.parallel ());
          yield _next.sync ();

          this._commands = this._busClient.getCommandsRegistry ();
          next ();
        }).bind (this) ();
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

    watt.wrapAll (this);
  }

  get commands () {
    return Object.assign (
      {},
      ...Object.keys (this._slaves).map (pid => {
        return {[this._slaves[pid].horde]: this._slaves[pid].commands};
      })
    );
  }

  get busClient () {
    const command = {
      send: (horde, cmd, msg) => {
        for (const pid in this._slaves) {
          const slave = this._slaves[pid];
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
    yield slave.start (next);
    this._slaves[slave.pid] = slave;

    const xBus = require ('xcraft-core-bus');
    xBus.notifyCmdsRegistry ();

    return slave.pid;
  }

  remove (pid, resp) {
    if (!this._slaves[pid]) {
      resp.log.warn (`slave ${pid} is not alive`);
      return;
    }
    this._slaves[pid].stop ();
    delete this._slaves[pid];
  }
}

module.exports = new Horde ();
