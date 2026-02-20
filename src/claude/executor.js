import { spawn } from 'node:child_process';
import { config } from '../utils/config.js';
import { log } from '../utils/logger.js';

const running = new Map();

export class ClaudeExecutor {
  #activeProcesses = 0;

  async execute(userId, prompt, workDir, onChunk) {
    if (this.#activeProcesses >= config.claude.maxConcurrent) {
      throw new Error(`Max concurrent processes (${config.claude.maxConcurrent}) reached. Wait or /kill.`);
    }

    // Kill existing process for this user if any
    this.kill(userId);

    return new Promise((resolve, reject) => {
      this.#activeProcesses++;

      const args = [
        '-p', prompt,          // print mode (non-interactive)
        '--output-format', 'text',
        '--max-turns', '25',
        '--verbose',
      ];

      log.info(`Executing claude for user ${userId} in ${workDir}`);

      const proc = spawn(config.claude.bin, args, {
        cwd: workDir,
        env: { ...process.env, FORCE_COLOR: '0' },
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: 5 * 60 * 1000, // 5 min max
      });

      running.set(userId, proc);

      let stdout = '';
      let stderr = '';
      let chunkBuffer = '';
      const CHUNK_INTERVAL = 2000; // Send updates every 2s

      const chunkTimer = setInterval(() => {
        if (chunkBuffer.length > 0 && onChunk) {
          onChunk(chunkBuffer);
          chunkBuffer = '';
        }
      }, CHUNK_INTERVAL);

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
        this.#activeProcesses--;
        running.delete(userId);

        // Send remaining buffer
        if (chunkBuffer.length > 0 && onChunk) {
          onChunk(chunkBuffer);
        }

        if (code === 0) {
          resolve({ ok: true, output: stdout.trim(), stderr: stderr.trim() });
        } else {
          resolve({ ok: false, output: stdout.trim(), stderr: stderr.trim(), code });
        }
      });

      proc.on('error', (err) => {
        clearInterval(chunkTimer);
        this.#activeProcesses--;
        running.delete(userId);
        reject(err);
      });
    });
  }

  kill(userId) {
    const proc = running.get(userId);
    if (proc) {
      proc.kill('SIGTERM');
      setTimeout(() => {
        if (!proc.killed) proc.kill('SIGKILL');
      }, 3000);
      running.delete(userId);
      return true;
    }
    return false;
  }

  isRunning(userId) {
    return running.has(userId);
  }

  get activeCount() {
    return this.#activeProcesses;
  }
}
