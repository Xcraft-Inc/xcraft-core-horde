'use strict';

const cmd = {};

cmd.load = function* (msg, resp) {
  const horde = require('.');

  try {
    yield horde.autoload(resp);
    resp.events.send(`horde.load.${msg.id}.finished`, true);
  } catch (ex) {
    resp.events.send(`horde.load.${msg.id}.error`, {
      code: ex.code,
      message: ex.message,
      stack: ex.stack,
    });
  }
};

cmd.reload = function* (msg, resp) {
  const horde = require('.');

  try {
    yield horde.unload(resp);
    yield horde.autoload(resp);
    resp.events.send(`horde.reload.${msg.id}.finished`, true);
  } catch (ex) {
    resp.events.send(`horde.reload.${msg.id}.error`, {
      code: ex.code,
      message: ex.message,
      stack: ex.stack,
    });
  }
};

cmd['slave.add'] = function* (msg, resp) {
  const horde = require('.');
  const {appId} = msg.data;
  try {
    const slaveId = yield horde.add(resp, appId, null);
    resp.events.send(`horde.slave.add.${msg.id}.finished`, {slaveId});
  } catch (ex) {
    resp.events.send(`horde.slave.add.${msg.id}.error`, {
      code: ex.code,
      message: ex.message,
      stack: ex.stack,
    });
  }
};

cmd['slave.remove'] = function (msg, resp) {
  const horde = require('.');

  try {
    horde.remove(msg.data.slaveId, resp);
    resp.events.send(`horde.slave.remove.${msg.id}.finished`);
  } catch (ex) {
    resp.events.send(`horde.slave.remove.${msg.id}.error`, {
      code: ex.code,
      message: ex.message,
      stack: ex.stack,
    });
  }
};

/**
 * Retrieve the list of available commands.
 *
 * @returns {Object} The list and definitions of commands.
 */
exports.xcraftCommands = function () {
  return {
    handlers: cmd,
    rc: {
      'load': {
        parallel: true,
        desc: 'load the hordes',
      },
      'reload': {
        parallel: true,
        desc: 'reload the hordes',
      },
      'slave.add': {
        parallel: true,
        desc: 'add a slave in the Horde',
      },
      'slave.remove': {
        parallel: true,
        desc: 'remove a slave from the Horde',
        options: {
          params: {
            required: 'pid',
          },
        },
      },
    },
  };
};
