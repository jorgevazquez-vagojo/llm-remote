import { spawn, execSync } from 'node:child_process';
import { BaseProvider } from './base.js';
import { log } from '../utils/logger.js';

/**
 * Claude Code CLI provider (local).
 *
 * Executes the `claude` CLI binary installed on the same machine.
 * This is the most powerful option — full agentic Claude with file access,
 * code editing, terminal commands, and multi-turn reasoning.
 *
 * Authentication: Claude CLI uses OAuth (Claude Pro/Max subscription)
 * or API key (ANTHROPIC_API_KEY). No separate auth needed here —
 * the CLI handles it.
 *
 * Config:
 *   CLAUDE_BIN         — path to claude binary (default: "claude")
 *   CLAUDE_MAX_TURNS   — max agentic turns per request (default: 25)
 *   CLAUDE_TIMEOUT_SEC — max execution time in seconds (default: 300)
 */
export class ClaudeProvider extends BaseProvider {
  #running = new Map();
  #available = null; // cached availability check

  constructor(config) {
    super(config.name || 'claude', config);
  }

  get displayName() {
    return '🟣 Claude Code (local)';
  }

  get isConfigured() {
    if (this.#available !== null) return this.#available;

    const bin = this.config.bin || 'claude';
    try {
      execSync(`which ${bin} 2>/dev/null || where ${bin} 2>/dev/null`, { stdio: 'ignore' });
      this.#available = true;
    } catch {
      // Also check npx availability
      try {
        execSync('npx @anthropic-ai/claude-code --version 2>/dev/null', { stdio: 'ignore', timeout: 15000 });
        this.#available = true;
        if (!this.config.bin) this.config.bin = 'npx';
        if (!this.config.binArgs) this.config.binArgs = ['@anthropic-ai/claude-code'];
      } catch {
        this.#available = false;
      }
    }

    log.info(`[claude] Local CLI: ${this.#available ? 'available' : 'not found'}`);
    return this.#available;
  }

  async execute(prompt, context = {}) {
    const { workDir, userId, onChunk, systemPrompt } = context;
    const maxTurns = String(this.config.maxTurns || 25);
    const timeoutMs = (this.config.timeoutSec || 300) * 1000;

    this.kill(userId);

    return new Promise((resolve, reject) => {
      const bin = this.config.bin || 'claude';
      const binArgs = this.config.binArgs || [];

      const args = [
        ...binArgs,
        '-p', prompt,
        '--output-format', 'text',
        '--max-turns', maxTurns,
        '--verbose',
      ];

      // Append system prompt if provided
      if (systemPrompt) {
        args.push('--system-prompt', systemPrompt);
      }

      log.info(`[claude] Executing locally in ${workDir || '(default)'}`);

      const proc = spawn(bin, args, {
        cwd: workDir || undefined,
        env: { ...process.env, FORCE_COLOR: '0' },
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: timeoutMs,
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

        const output = stdout.trim() || stderr.trim() || '(empty)';

        // Detect specific error conditions
        if (output.includes('Credit balance is too low')) {
          resolve({
            ok: false,
            output: 'Sin créditos en la cuenta de Anthropic. Usa tu suscripción Claude Pro/Max o añade créditos.',
            model: 'claude-code-local',
          });
          return;
        }

        resolve({
          ok: code === 0,
          output,
          stderr: stderr.trim(),
          code,
          model: 'claude-code-local',
        });
      });

      proc.on('error', (err) => {
        clearInterval(chunkTimer);
        this.#running.delete(userId);

        if (err.code === 'ENOENT') {
          resolve({
            ok: false,
            output: `Claude CLI no encontrado ("${bin}"). Instálalo con: npm install -g @anthropic-ai/claude-code`,
            model: 'claude-code-local',
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
