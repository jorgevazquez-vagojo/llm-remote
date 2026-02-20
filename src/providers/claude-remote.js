import { spawn } from 'node:child_process';
import { BaseProvider } from './base.js';
import { log } from '../utils/logger.js';

/**
 * Claude Code CLI provider (remote via SSH).
 *
 * Connects to a remote machine via SSH and executes the `claude` CLI there.
 * Use case: Claude CLI authenticated on a Mac/desktop, bot runs on a server.
 * The remote machine must have Claude CLI installed and authenticated.
 *
 * Connection: SSH tunnel or direct SSH. The bot spawns:
 *   ssh -p PORT USER@HOST "claude -p 'prompt' --output-format text"
 *
 * For security, prompts are passed via stdin (not as shell arguments)
 * to avoid shell injection and handle arbitrary prompt content safely.
 *
 * Config:
 *   CLAUDE_REMOTE_HOST       — SSH host (e.g., "localhost" for tunnel, or IP/hostname)
 *   CLAUDE_REMOTE_PORT       — SSH port (e.g., 2222 for tunnel, 22 for direct)
 *   CLAUDE_REMOTE_USER       — SSH username on the remote machine
 *   CLAUDE_REMOTE_KEY        — path to SSH private key (optional, uses ssh-agent if empty)
 *   CLAUDE_REMOTE_BIN        — claude binary on the remote machine (default: "claude")
 *   CLAUDE_REMOTE_WORK_DIR   — default working directory on the remote machine
 *   CLAUDE_MAX_TURNS         — max agentic turns (default: 25)
 *   CLAUDE_TIMEOUT_SEC       — max execution time in seconds (default: 300)
 */
export class ClaudeRemoteProvider extends BaseProvider {
  #running = new Map();

  constructor(config) {
    super(config.name || 'claude-remote', config);
  }

  get displayName() {
    const host = this.config.host || '?';
    const port = this.config.port || 22;
    return `🟣 Claude Code (remoto: ${host}:${port})`;
  }

  get isConfigured() {
    return !!(this.config.host && this.config.user);
  }

  async execute(prompt, context = {}) {
    const { workDir, userId, onChunk, systemPrompt } = context;
    const maxTurns = String(this.config.maxTurns || 25);
    const timeoutMs = (this.config.timeoutSec || 300) * 1000;

    this.kill(userId);

    return new Promise((resolve, reject) => {
      const remoteBin = this.config.remoteBin || 'claude';
      const remoteWorkDir = workDir || this.config.remoteWorkDir || '';

      // Build the remote claude command
      // Prompt is passed via stdin using a heredoc for safety (no shell escaping issues)
      const claudeArgs = [
        '-p', '-',  // read prompt from stdin
        '--output-format', 'text',
        '--max-turns', maxTurns,
        '--verbose',
      ];

      if (systemPrompt) {
        claudeArgs.push('--system-prompt', systemPrompt);
      }

      const claudeCmd = [remoteBin, ...claudeArgs.map(a => shellEscape(a))].join(' ');

      // Wrap in cd if workDir specified
      const fullCmd = remoteWorkDir
        ? `cd ${shellEscape(remoteWorkDir)} && ${claudeCmd}`
        : claudeCmd;

      // SSH args
      const sshArgs = [
        '-o', 'StrictHostKeyChecking=yes',
        '-o', 'ConnectTimeout=15',
        '-o', 'ServerAliveInterval=30',
        '-o', 'ServerAliveCountMax=3',
        '-p', String(this.config.port || 22),
      ];

      if (this.config.key) {
        sshArgs.push('-i', this.config.key);
      }

      sshArgs.push(`${this.config.user}@${this.config.host}`, fullCmd);

      log.info(`[claude-remote] Connecting to ${this.config.user}@${this.config.host}:${this.config.port || 22}`);
      log.info(`[claude-remote] Remote dir: ${remoteWorkDir || '(default)'}`);

      const proc = spawn('ssh', sshArgs, {
        env: { ...process.env },
        stdio: ['pipe', 'pipe', 'pipe'],
        timeout: timeoutMs,
      });

      this.#running.set(userId, proc);

      // Write prompt via stdin (safe: no shell escaping needed)
      proc.stdin.write(prompt);
      proc.stdin.end();

      let stdout = '';
      let stderr = '';
      let chunkBuffer = '';

      const chunkTimer = setInterval(() => {
        if (chunkBuffer.length > 0 && onChunk) {
          onChunk(chunkBuffer);
          chunkBuffer = '';
        }
      }, 2000);

      proc.stdout.on('data', (data) => {
        const text = data.toString();
        stdout += text;
        chunkBuffer += text;
      });

      proc.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      proc.on('close', (code) => {
        clearInterval(chunkTimer);
        this.#running.delete(userId);
        if (chunkBuffer.length > 0 && onChunk) onChunk(chunkBuffer);

        const output = stdout.trim() || stderr.trim() || '(empty)';

        // Detect connection errors
        if (code === 255 || stderr.includes('Connection refused') || stderr.includes('No route to host')) {
          resolve({
            ok: false,
            output: `No se pudo conectar a ${this.config.host}:${this.config.port || 22}. ` +
              'Verifica que el túnel SSH está activo y la máquina remota accesible.',
            model: 'claude-code-remote',
          });
          return;
        }

        if (stderr.includes('Host key verification failed')) {
          resolve({
            ok: false,
            output: 'Host key verification failed. Añade la clave del host remoto a known_hosts.',
            model: 'claude-code-remote',
          });
          return;
        }

        if (output.includes('Credit balance is too low')) {
          resolve({
            ok: false,
            output: 'Sin créditos en la máquina remota. Verifica la autenticación de Claude CLI.',
            model: 'claude-code-remote',
          });
          return;
        }

        if (output.includes('command not found') || output.includes('not found')) {
          resolve({
            ok: false,
            output: `Claude CLI no encontrado en la máquina remota ("${remoteBin}"). Instálalo en el host remoto.`,
            model: 'claude-code-remote',
          });
          return;
        }

        resolve({
          ok: code === 0,
          output,
          stderr: stderr.trim(),
          code,
          model: 'claude-code-remote',
        });
      });

      proc.on('error', (err) => {
        clearInterval(chunkTimer);
        this.#running.delete(userId);

        if (err.code === 'ENOENT') {
          resolve({
            ok: false,
            output: 'Comando "ssh" no disponible en este sistema.',
            model: 'claude-code-remote',
          });
        } else {
          reject(err);
        }
      });
    });
  }

  kill(userId) {
    const proc = this.#running.get(userId);
    if (proc) {
      proc.kill('SIGTERM');
      setTimeout(() => { try { if (!proc.killed) proc.kill('SIGKILL'); } catch {} }, 3000);
      this.#running.delete(userId);
      return true;
    }
    return false;
  }

  isRunning(userId) {
    return this.#running.has(userId);
  }
}

/**
 * Shell-escape a string for safe inclusion in a remote command.
 * Wraps in single quotes and escapes embedded single quotes.
 */
function shellEscape(str) {
  return "'" + str.replace(/'/g, "'\\''") + "'";
}
