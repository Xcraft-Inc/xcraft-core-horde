'use strict';

const cmd = {};

cmd['_postload'] = function*(msg, resp) {
  const horde = require('.');

  try {
    yield horde.autoload(resp);
    resp.events.send(`horde._postload.${msg.id}.finished`);
  } catch (ex) {
    resp.events.send(`horde._postload.${msg.id}.error`, {
      code: ex.code,
      message: ex.message,
      stack: ex.stack,
    });
  }
};

cmd['use-topology'] = function(msg, resp) {
  const horde = require('.');
  const {topology} = msg.data;

  resp.events.send(
    `horde.use-topology.${msg.id}.finished`,
    horde.useTopology(topology)
  );
};

cmd.reload = function*(msg, resp) {
  const horde = require('.');
  const {topology} = msg.data;

  if (!horde.useTopology(topology)) {
    resp.log.err(`the topology "${topology}" is not defined, skip reload`);
    resp.events.send(`horde.reload.${msg.id}.finished`, false);
    return;
  }

  try {
    yield horde.unload(resp);
    yield horde.autoload(resp, topology);
    resp.events.send(`horde.reload.${msg.id}.finished`, true);
  } catch (ex) {
    resp.events.send(`horde.reload.${msg.id}.error`, {
      code: ex.code,
      message: ex.message,
      stack: ex.stack,
    });
  }
};

cmd['slave.add'] = function*(msg, resp) {
  const horde = require('.');

  try {
    yield horde.add(resp, null);
    resp.events.send(`horde.slave.add.${msg.id}.finished`);
  } catch (ex) {
    resp.events.send(`horde.slave.add.${msg.id}.error`, {
      code: ex.code,
      message: ex.message,
      stack: ex.stack,
    });
  }
};

cmd['slave.remove'] = function(msg, resp) {
  const horde = require('.');

  try {
    horde.remove(msg.data.pid, resp);
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
exports.xcraftCommands = function() {
  return {
    handlers: cmd,
    rc: {
      'use-topology': {
        parallel: true,
        desc: 'check if the specified topology is used by the horde',
        options: {
          params: {
            required: 'topology',
          },
        },
      },
      reload: {
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
