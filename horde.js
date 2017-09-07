'use strict';

const cmd = {};

cmd['slave.add'] = function* (msg, resp) {
  const horde = require ('.');

  try {
    yield horde.add (resp);
    resp.events.send (`horde.slave.add.${msg.id}.finished`);
  } catch (ex) {
    resp.events.send (`horde.slave.add.${msg.id}.error`);
  }
};

cmd['slave.remove'] = function (msg, resp) {
  const horde = require ('.');

  try {
    horde.remove (msg.data.pid, resp);
    resp.events.send (`horde.slave.remove.${msg.id}.finished`);
  } catch (ex) {
    resp.events.send (`horde.slave.remove.${msg.id}.error`);
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
