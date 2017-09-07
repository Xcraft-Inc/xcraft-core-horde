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

  *start (next) {
    this._daemon = new Daemon (this._name, host, false, false, this._resp);
    this._daemon.start ();

    /* TODO: add loading of running xcraft instance by PID
    const busConfig = xConfig (null, this._resp).load ('xcraft-core-bus');

    this._busClient = new BusClient (busConfig);
    yield this._busClient.connect ('axon', null, next);
    */
  }

  stop () {
    this._daemon.stop ();
  }
}

class Horde {
  constructor () {
    this._slaves = {};

    watt.wrapAll (this);
  }

  *add (resp) {
    const slave = new Slave (resp);
    yield slave.start ();
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
