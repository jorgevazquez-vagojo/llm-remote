import { Bot } from 'grammy';
import { config } from './utils/config.js';
import { log } from './utils/logger.js';
import { SessionManager } from './auth/session.js';
import { guardMiddleware, recordFailedAuth, clearFailedAuth } from './auth/guard.js';
import { checkRateLimit } from './security/ratelimit.js';
import { logAudit, queryAudit } from './security/audit.js';
import { ClaudeExecutor } from './claude/executor.js';
import { formatOutput, formatStatus } from './claude/formatter.js';
import { existsSync } from 'node:fs';

export function createBot() {
  const bot = new Bot(config.telegram.token);
  const sessionManager = new SessionManager();
  const executor = new ClaudeExecutor();

  // Global middleware: auth guard
  bot.use(guardMiddleware(sessionManager));

  // /start
  bot.command('start', async (ctx) => {
    await ctx.reply(
      '🤖 Claude Remote — Encrypted Claude Code Bridge\n\n' +
      'Authenticate with: /auth <PIN>\n\n' +
      'Commands after auth:\n' +
      '  /ask <prompt> — Send to Claude Code\n' +
      '  /project <path> — Change work directory\n' +
      '  /status — Session info\n' +
      '  /history — Command history\n' +
      '  /kill — Stop running process\n' +
      '  /lock — Lock session\n' +
      '  /help — Show this message'
    );
  });

  // /auth <pin>
  bot.command('auth', async (ctx) => {
    const pin = ctx.match?.trim();
    if (!pin) {
      await ctx.reply('Usage: /auth <PIN>');
      return;
    }

    const result = sessionManager.authenticate(ctx.from.id, pin);

    if (result.ok) {
      clearFailedAuth(ctx.from.id);
      logAudit(ctx.from.id, 'auth_success');
      log.info(`User ${ctx.from.id} authenticated`);

      // Delete the auth message (contains PIN)
      try { await ctx.deleteMessage(); } catch {}

      await ctx.reply(
        '✅ Authenticated successfully.\n' +
        `Work directory: ${sessionManager.getWorkDir(ctx.from.id)}\n` +
        `Session timeout: ${config.auth.sessionTimeoutMs / 60000} min\n\n` +
        'Send any message or use /ask <prompt>'
      );
    } else {
      const failCount = recordFailedAuth(ctx.from.id);
      logAudit(ctx.from.id, 'auth_failed', { attempt: failCount });
      log.warn(`Auth failed for user ${ctx.from.id} (attempt ${failCount})`);

      try { await ctx.deleteMessage(); } catch {}

      if (failCount >= 5) {
        await ctx.reply('🔒 Too many failed attempts. Locked for 15 min.');
      } else {
        await ctx.reply(`❌ Invalid PIN. (${failCount}/5 attempts)`);
      }
    }
  });

  // /lock
  bot.command('lock', async (ctx) => {
    sessionManager.lock(ctx.from.id);
    logAudit(ctx.from.id, 'session_locked');
    await ctx.reply('🔒 Session locked. Use /auth <PIN> to re-authenticate.');
  });

  // /status
  bot.command('status', async (ctx) => {
    const info = sessionManager.getInfo(ctx.from.id);
    if (!info) {
      await ctx.reply('No active session.');
      return;
    }
    const running = executor.isRunning(ctx.from.id) ? '⚡ Claude running' : '💤 Idle';
    await ctx.reply(formatStatus(info) + `\n\n${running}`);
  });

  // /project <path>
  bot.command('project', async (ctx) => {
    const dir = ctx.match?.trim();
    if (!dir) {
      await ctx.reply(`Current: ${sessionManager.getWorkDir(ctx.from.id)}\n\nUsage: /project <path>`);
      return;
    }

    if (!existsSync(dir)) {
      await ctx.reply(`❌ Directory not found: ${dir}`);
      return;
    }

    sessionManager.setWorkDir(ctx.from.id, dir);
    logAudit(ctx.from.id, 'project_changed', { dir });
    await ctx.reply(`📁 Work directory set to: ${dir}`);
  });

  // /kill
  bot.command('kill', async (ctx) => {
    if (executor.kill(ctx.from.id)) {
      logAudit(ctx.from.id, 'process_killed');
      await ctx.reply('☠️ Claude process terminated.');
    } else {
      await ctx.reply('No running process.');
    }
  });

  // /history
  bot.command('history', async (ctx) => {
    const entries = queryAudit(ctx.from.id, 15);
    if (entries.length === 0) {
      await ctx.reply('No history yet.');
      return;
    }

    const lines = entries.map(e => {
      const time = e.timestamp.substring(11, 19);
      const detail = e.data?.prompt ? ` — ${e.data.prompt.substring(0, 50)}` : '';
      return `${time} ${e.action}${detail}`;
    });

    await ctx.reply('📜 Recent history:\n\n' + lines.join('\n'));
  });

  // /help
  bot.command('help', async (ctx) => {
    await ctx.reply(
      '🤖 Claude Remote Commands:\n\n' +
      '/auth <PIN> — Authenticate session\n' +
      '/ask <prompt> — Send prompt to Claude Code\n' +
      '/project <path> — Set working directory\n' +
      '/status — Session & process info\n' +
      '/history — Command audit log\n' +
      '/kill — Stop running Claude process\n' +
      '/lock — Lock session\n\n' +
      'Or just type a message — it goes to Claude Code directly.'
    );
  });

  // /ask <prompt> or plain text
  bot.command('ask', handlePrompt(executor, sessionManager));
  bot.on('message:text', handlePrompt(executor, sessionManager));

  return bot;
}

function handlePrompt(executor, sessionManager) {
  return async (ctx) => {
    const text = ctx.match?.trim() || ctx.message?.text?.trim();
    if (!text || text.startsWith('/')) return;

    // Rate limit
    const rateCheck = checkRateLimit(ctx.from.id);
    if (!rateCheck.allowed) {
      await ctx.reply(`⏳ Rate limited. Wait ${rateCheck.waitSec}s.`);
      return;
    }

    const workDir = sessionManager.getWorkDir(ctx.from.id);
    logAudit(ctx.from.id, 'claude_prompt', { prompt: text.substring(0, 200), workDir });

    // Show typing indicator
    const statusMsg = await ctx.reply(`⏳ Processing in ${workDir}...`);

    try {
      let lastUpdate = Date.now();

      const result = await executor.execute(ctx.from.id, text, workDir, async (chunk) => {
        // Throttle live updates to avoid Telegram rate limits
        if (Date.now() - lastUpdate > 3000) {
          try {
            await ctx.api.editMessageText(
              ctx.chat.id,
              statusMsg.message_id,
              `⚡ Working...\n\n${chunk.substring(0, 200)}...`
            );
            lastUpdate = Date.now();
          } catch {}
        }
      });

      // Delete the status message
      try { await ctx.api.deleteMessage(ctx.chat.id, statusMsg.message_id); } catch {}

      if (result.ok) {
        const output = result.output || '(empty response)';
        const chunks = formatOutput(output);

        for (const chunk of chunks) {
          await ctx.reply(chunk);
          // Small delay between chunks to avoid rate limit
          if (chunks.length > 1) {
            await new Promise(r => setTimeout(r, 500));
          }
        }

        logAudit(ctx.from.id, 'claude_response', {
          length: output.length,
          exitCode: 0,
        });
      } else {
        const errMsg = result.stderr || result.output || 'Unknown error';
        await ctx.reply(`❌ Claude exited with code ${result.code}:\n\n${errMsg.substring(0, 1000)}`);
        logAudit(ctx.from.id, 'claude_error', { code: result.code, error: errMsg.substring(0, 500) });
      }
    } catch (err) {
      try { await ctx.api.deleteMessage(ctx.chat.id, statusMsg.message_id); } catch {}
      await ctx.reply(`❌ Error: ${err.message}`);
      log.error(`Claude execution error: ${err.message}`);
      logAudit(ctx.from.id, 'claude_exception', { error: err.message });
    }

    // Auto-delete if configured
    if (config.security.autoDeleteSec > 0) {
      setTimeout(async () => {
        try { await ctx.deleteMessage(); } catch {}
      }, config.security.autoDeleteSec * 1000);
    }
  };
}
