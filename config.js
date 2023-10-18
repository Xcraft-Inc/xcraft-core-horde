'use strict';

/**
 * Retrieve the inquirer definition for xcraft-core-etc
 */
module.exports = [
  {
    type: 'checkbox',
    name: 'hordes',
    message: 'autoloaded hordes',
    choices: [],
    default: [],
  },
  {
    type: 'input',
    name: 'topology',
    message: 'topology settings JSON',
    default: '',
  },
  {
    type: 'confirm',
    name: 'autoload',
    message: 'load automatically the topology',
    default: true,
  },
  {
    type: 'confirm',
    name: 'connection.useOverlay',
    message: 'Enable overlay on disconnection',
    default: true,
  },
];
