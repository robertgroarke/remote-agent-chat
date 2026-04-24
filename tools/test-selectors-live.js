#!/usr/bin/env node
'use strict';

const { main } = require('./cdp-regression-smoke');

main(process.argv.slice(2)).catch((error) => {
  console.error('FATAL:', error.message);
  process.exitCode = 1;
});
