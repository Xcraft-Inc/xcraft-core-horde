'use strict';

/**
 * Retrieve the inquirer definition for xcraft-core-etc
 */
module.exports = [
  {
    type: 'checkbox',
    name: 'hordes',
    message: 'autoloaded hordes',
    default: [],
  },
  {
    type: 'input',
    name: 'topology',
    message: 'topology settings JSON',
    default: '',
  },
];
