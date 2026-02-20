import { spawn } from 'node:child_process';
import { BaseProvider } from './base.js';
import { log } from '../utils/logger.js';

/**
 * Claude Code CLI provider.
 * Executes the `claude` CLI in print mode.
 * This is the most powerful option — full agentic Claude with file access.
 */
export class ClaudeProvider extends BaseProvider {
  #running = new Map();

  constructor(config) {
    super('claude', config);
  }

  get displayName() { return '🟣 Claude Code (agéntico, acceso total)'; }

  get isConfigured() {
    return true; // Assumes claude CLI is installed
  }

  async execute(prompt, context = {}) {
    const { workDir, userId, onChunk } = context;

    this.kill(userId);

    return new Promise((resolve, reject) => {
      const args = [
        '-p', prompt,
        '--output-format', 'text',
        '--max-turns', '25',
        '--verbose',
      ];

      log.info(`[claude] Executing in ${workDir}`);

      const proc = spawn(this.config.bin || 'claude', args, {
        cwd: workDir,
        env: { ...process.env, FORCE_COLOR: '0' },
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: 5 * 60 * 1000,
      });

      this.#running.set(userId, proc);

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

        resolve({
          ok: code === 0,
          output: stdout.trim() || stderr.trim() || '(empty)',
          stderr: stderr.trim(),
          code,
          model: 'claude-code',
        });
      });

      proc.on('error', (err) => {
        clearInterval(chunkTimer);
        this.#running.delete(userId);
        reject(err);
      });
    });
  }

  kill(userId) {
    const proc = this.#running.get(userId);
    if (proc) {
      proc.kill('SIGTERM');
      setTimeout(() => { if (!proc.killed) proc.kill('SIGKILL'); }, 3000);
      this.#running.delete(userId);
      return true;
    }
    return false;
  }

  isRunning(userId) {
    return this.#running.has(userId);
  }
}
