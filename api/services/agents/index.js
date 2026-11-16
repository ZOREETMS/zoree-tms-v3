// Registers the five back-office agents with the shared runner.
'use strict';

const runner = require('./agentRunner');

[
  require('./quote'),
  require('./carrierSourcing'),
  require('./trackTrace'),
  require('./freightAudit'),
  require('./pod'),
].forEach(runner.registerAgent);

module.exports = runner;
