'use strict';

const path = require ('path');
const watt = require ('watt');
const uuidV4 = require ('uuid/v4');

const xConfig = require ('xcraft-core-etc');
const Daemon = require ('xcraft-core-daemon');
const {BusClient} = require ('xcraft-core-busclient');

const xHost = require.resolve ('xcraft-core-host');
const host = xHost.replace (/(.*[\/]xcraft-core-host[\/]).*/, (match, dir) =>
  path.join (dir, 'bin/host')
);

class Slave {
  constructor (resp) {
    this._resp = resp;
    this._name = uuidV4 ();
    this._daemon = null;
    this._busClient = null;

    watt.wrapAll (this);
  }

  get pid () {
    return this._daemon ? this._daemon.proc.pid : -1;
  }

  start (next) {
    this._daemon = new Daemon (this._name, host, false, true, this._resp);
    this._daemon.start ();

    let retries = 0;

    /* The settings file is not available immediatly. For connecting to the
     * daemon, we must have this file. Then we retry several times (10x100ms).
     */
    const interval = setInterval (() => {
      let busConfig = null;

      try {
        busConfig = xConfig (null, this._resp).load (
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
        this._busClient = new BusClient (busConfig);
        this._busClient.connect ('axon', null, next);
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
    this._slaves = {};

    watt.wrapAll (this);
  }

  *add (resp, next) {
    const slave = new Slave (resp);
    yield slave.start (next);
    this._slaves[slave.pid] = slave;
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
