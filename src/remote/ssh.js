/**
 * SSH remote command execution.
 * Allows running commands on configured remote servers from Telegram.
 * Uses native ssh command — zero dependencies.
 */
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { log } from '../utils/logger.js';
import { config } from '../utils/config.js';

const SSH_CONFIG_FILE = resolve(config.paths.data, 'ssh-servers.json');
const COMMAND_TIMEOUT = 30000; // 30s max per command

// Blocked commands for safety
const BLOCKED_PATTERNS = [
  /rm\s+-rf\s+\/(?!\w)/,  // rm -rf /
  /mkfs/,
  /dd\s+if=/,
  />\s*\/dev\/sd/,
  /shutdown/,
  /reboot/,
  /init\s+0/,
];

let servers = {};

export class SSHManager {
  static load() {
    try {
      if (existsSync(SSH_CONFIG_FILE)) {
        servers = JSON.parse(readFileSync(SSH_CONFIG_FILE, 'utf-8'));
        log.info(`[ssh] Loaded ${Object.keys(servers).length} servers`);
      }
    } catch (err) {
      log.warn(`[ssh] Config load failed: ${err.message}`);
    }
  }

  static save() {
    try {
      if (!existsSync(config.paths.data)) mkdirSync(config.paths.data, { recursive: true });
      writeFileSync(SSH_CONFIG_FILE, JSON.stringify(servers, null, 2));
    } catch (err) {
      log.error(`[ssh] Save failed: ${err.message}`);
    }
  }

  static addServer(name, host, user, port = 22, keyPath = '') {
    servers[name] = { host, user, port, keyPath, addedAt: new Date().toISOString() };
    this.save();
    return servers[name];
  }

  static removeServer(name) {
    if (!servers[name]) return false;
    delete servers[name];
    this.save();
    return true;
  }

  static listServers() {
    return Object.entries(servers).map(([name, s]) => ({
      name,
      host: s.host,
      user: s.user,
      port: s.port,
    }));
  }

  static getServer(name) {
    return servers[name];
  }

  static async execute(serverName, command) {
    const server = servers[serverName];
    if (!server) {
      throw new Error(`Servidor '${serverName}' no configurado. Usa /ssh add <nombre> <user@host>`);
    }

    // Safety check
    for (const pattern of BLOCKED_PATTERNS) {
      if (pattern.test(command)) {
        throw new Error('Comando bloqueado por seguridad.');
      }
    }

    log.info(`[ssh] ${serverName} (${server.user}@${server.host}): ${command.substring(0, 100)}`);

    return new Promise((resolve, reject) => {
      const args = [
        '-o', 'StrictHostKeyChecking=accept-new',
        '-o', 'ConnectTimeout=10',
        '-o', 'BatchMode=yes',
        '-p', String(server.port || 22),
      ];

      if (server.keyPath) {
        args.push('-i', server.keyPath);
      }

      args.push(`${server.user}@${server.host}`, command);

      const proc = spawn('ssh', args, {
        timeout: COMMAND_TIMEOUT,
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      let stdout = '';
      let stderr = '';

      proc.stdout.on('data', (data) => { stdout += data.toString(); });
      proc.stderr.on('data', (data) => { stderr += data.toString(); });

      proc.on('close', (code) => {
        resolve({
          ok: code === 0,
          code,
          stdout: stdout.trim(),
          stderr: stderr.trim(),
          output: (stdout.trim() || stderr.trim() || '(sin salida)').substring(0, 4000),
        });
      });

      proc.on('error', (err) => {
        reject(new Error(`SSH error: ${err.message}`));
      });
    });
  }
}

// Load on import
SSHManager.load();
