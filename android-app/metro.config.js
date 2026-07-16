'use strict';

const { getDefaultConfig } = require('expo/metro-config');
const { createGuardedResolveRequest } = require('./metro-worktree-guard');

const projectRoot = __dirname;
const config = getDefaultConfig(projectRoot);

config.resolver.resolveRequest = createGuardedResolveRequest(projectRoot);

module.exports = config;
