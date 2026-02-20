/**
 * SSH remote command execution.
 * Allows running commands on configured remote servers from Telegram.
 * Uses native ssh command — zero dependencies.
 *
 * Security: commands are validated against a blocklist of dangerous patterns
 * AND shell metacharacters that could enable injection.
 */
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { log } from '../utils/logger.js';
import { config } from '../utils/config.js';

const SSH_CONFIG_FILE = resolve(config.paths.data, 'ssh-servers.json');
const COMMAND_TIMEOUT = 30000; // 30s max per command

// Dangerous commands — blocked regardless of context
const BLOCKED_COMMANDS = [
  'rm', 'mkfs', 'dd', 'shutdown', 'reboot', 'init', 'halt', 'poweroff',
  'fdisk', 'parted', 'wipefs', 'shred', 'passwd', 'useradd', 'userdel',
  'chmod', 'chown', 'chattr', 'iptables', 'nft', 'systemctl',
  'crontab', 'at', 'nohup', 'screen', 'tmux',
];

// Shell metacharacters that enable injection — block all of them
const SHELL_INJECTION_PATTERN = /[;|&`$(){}\\<>!\n\r]/;

// Dangerous redirects
const REDIRECT_PATTERN = />\s*\/dev\//;

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

  /**
   * Validate command safety. Returns error message or null if safe.
   */
  static validateCommand(command) {
    const trimmed = command.trim();

    // Block shell metacharacters (prevents injection via $(), ``, ;, |, &&, etc.)
    if (SHELL_INJECTION_PATTERN.test(trimmed)) {
      return 'Comando bloqueado: caracteres de shell no permitidos (;|&`$(){}\\<>!). Usa comandos simples.';
    }

    // Block dangerous redirects
    if (REDIRECT_PATTERN.test(trimmed)) {
      return 'Comando bloqueado: redirección a /dev/ no permitida.';
    }

    // Extract base command (first word, ignoring flags)
    const baseCmd = trimmed.split(/\s+/)[0].split('/').pop().toLowerCase();

    if (BLOCKED_COMMANDS.includes(baseCmd)) {
      return `Comando bloqueado por seguridad: "${baseCmd}" no está permitido.`;
    }

    // Block wget/curl writing to files (download + execute patterns)
    if (/^(wget|curl)\b/.test(baseCmd) && /(-o\b|-O\b|--output)/.test(trimmed)) {
      return 'Comando bloqueado: descarga a archivo no permitida. Usa curl sin -o/-O para ver contenido.';
    }

    return null; // safe
  }

  static async execute(serverName, command) {
    const server = servers[serverName];
    if (!server) {
      throw new Error(`Servidor '${serverName}' no configurado. Usa /ssh add <nombre> <user@host>`);
    }

    // Safety check
    const validationError = this.validateCommand(command);
    if (validationError) {
      throw new Error(validationError);
    }

    log.info(`[ssh] ${serverName} (${server.user}@${server.host}): ${command.substring(0, 100)}`);

    return new Promise((resolve, reject) => {
      const args = [
        '-o', 'StrictHostKeyChecking=yes',
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
