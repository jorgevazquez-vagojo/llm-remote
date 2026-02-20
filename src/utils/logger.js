import { config } from '../utils/config.js';

const LEVELS = { debug: 0, info: 1, warn: 2, error: 3 };

function shouldLog(level) {
  return LEVELS[level] >= LEVELS[config.log.level];
}

function fmt(level, msg) {
  return `[${new Date().toISOString()}] [${level.toUpperCase()}] ${msg}`;
}

export const log = {
  debug: (msg) => shouldLog('debug') && console.log(fmt('debug', msg)),
  info: (msg) => shouldLog('info') && console.log(fmt('info', msg)),
  warn: (msg) => shouldLog('warn') && console.warn(fmt('warn', msg)),
  error: (msg) => shouldLog('error') && console.error(fmt('error', msg)),
};
