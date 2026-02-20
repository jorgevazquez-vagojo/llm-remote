import { Bot } from 'grammy';
import { config } from './utils/config.js';
import { log } from './utils/logger.js';
import { SessionManager } from './auth/session.js';
import { guardMiddleware, recordFailedAuth, clearFailedAuth } from './auth/guard.js';
import { checkRateLimit } from './security/ratelimit.js';
import { logAudit, queryAudit } from './security/audit.js';
import { ProviderManager } from './providers/manager.js';
import { formatOutput, formatStatus } from './claude/formatter.js';
import { existsSync } from 'node:fs';

export function createBot() {
  const bot = new Bot(config.telegram.token);
  const sessionManager = new SessionManager();
  const providers = new ProviderManager();

  // Global middleware: auth guard
  bot.use(guardMiddleware(sessionManager));

  // /start
  bot.command('start', async (ctx) => {
    const configured = providers.listConfigured();
    const providerList = configured.map(p => `  ${p.displayName}`).join('\n');

    await ctx.reply(
      '🤖 LLM Remote — Telegram ↔ IA Bridge\n\n' +
      'Autenticarse: /auth <PIN>\n\n' +
      'Comandos:\n' +
      '  /ask <prompt> — Enviar prompt\n' +
      '  /ia — Cambiar proveedor IA\n' +
      '  /project <ruta> — Cambiar directorio\n' +
      '  /status — Info de sesión\n' +
      '  /history — Historial\n' +
      '  /kill — Parar proceso\n' +
      '  /lock — Bloquear sesión\n\n' +
      `Proveedores disponibles:\n${providerList}`
    );
  });

  // /auth <pin>
  bot.command('auth', async (ctx) => {
    const pin = ctx.match?.trim();
    if (!pin) {
      await ctx.reply('Uso: /auth <PIN>');
      return;
    }

    const result = sessionManager.authenticate(ctx.from.id, pin);

    if (result.ok) {
      clearFailedAuth(ctx.from.id);
      logAudit(ctx.from.id, 'auth_success');
      log.info(`User ${ctx.from.id} authenticated`);
      try { await ctx.deleteMessage(); } catch {}

      const provider = providers.getForUser(ctx.from.id);
      await ctx.reply(
        '✅ Sesión iniciada.\n' +
        `📁 Directorio: ${sessionManager.getWorkDir(ctx.from.id)}\n` +
        `🤖 Proveedor: ${provider.displayName}\n` +
        `⏱ Timeout: ${config.auth.sessionTimeoutMs / 60000} min\n\n` +
        'Escribe cualquier mensaje o usa /ask'
      );
    } else {
      const failCount = recordFailedAuth(ctx.from.id);
      logAudit(ctx.from.id, 'auth_failed', { attempt: failCount });
      log.warn(`Auth failed for user ${ctx.from.id} (attempt ${failCount})`);
      try { await ctx.deleteMessage(); } catch {}

      if (failCount >= 5) {
        await ctx.reply('🔒 Demasiados intentos. Bloqueado 15 min.');
      } else {
        await ctx.reply(`❌ PIN incorrecto. (${failCount}/5 intentos)`);
      }
    }
  });

  // /ia — switch provider
  bot.command('ia', async (ctx) => {
    const arg = ctx.match?.trim().toLowerCase();

    if (!arg) {
      // Show provider list
      const current = providers.getUserProviderName(ctx.from.id);
      const all = providers.listAll();

      const lines = all.map(p => {
        const mark = p.name === current ? ' ← activo' : '';
        const status = p.configured ? '✅' : '❌ (sin API key)';
        return `  ${status} ${p.displayName}${mark}`;
      });

      await ctx.reply(
        '🤖 Proveedores de IA:\n\n' +
        lines.join('\n') +
        '\n\nUso: /ia <nombre>\n' +
        'Nombres: claude, openai, gemini, anthropic'
      );
      return;
    }

    const result = providers.setForUser(ctx.from.id, arg);
    if (result.ok) {
      logAudit(ctx.from.id, 'provider_changed', { provider: arg });
      await ctx.reply(`🤖 Proveedor cambiado a: ${result.provider.displayName}`);
    } else {
      await ctx.reply(`❌ ${result.reason}`);
    }
  });

  // /lock
  bot.command('lock', async (ctx) => {
    sessionManager.lock(ctx.from.id);
    logAudit(ctx.from.id, 'session_locked');
    await ctx.reply('🔒 Sesión bloqueada. Usa /auth <PIN> para volver.');
  });

  // /status
  bot.command('status', async (ctx) => {
    const info = sessionManager.getInfo(ctx.from.id);
    if (!info) {
      await ctx.reply('Sin sesión activa.');
      return;
    }
    const provider = providers.getForUser(ctx.from.id);
    const providerStatus = provider.isRunning?.(ctx.from.id) ? '⚡ Ejecutando' : '💤 Idle';
    await ctx.reply(
      formatStatus(info) +
      `\n\n🤖 ${provider.displayName}\n${providerStatus}`
    );
  });

  // /project <path>
  bot.command('project', async (ctx) => {
    const dir = ctx.match?.trim();
    if (!dir) {
      await ctx.reply(`📁 Actual: ${sessionManager.getWorkDir(ctx.from.id)}\n\nUso: /project <ruta>`);
      return;
    }

    if (!existsSync(dir)) {
      await ctx.reply(`❌ Directorio no encontrado: ${dir}`);
      return;
    }

    sessionManager.setWorkDir(ctx.from.id, dir);
    logAudit(ctx.from.id, 'project_changed', { dir });
    await ctx.reply(`📁 Directorio: ${dir}`);
  });

  // /kill
  bot.command('kill', async (ctx) => {
    const provider = providers.getForUser(ctx.from.id);
    if (provider.kill?.(ctx.from.id)) {
      logAudit(ctx.from.id, 'process_killed');
      await ctx.reply('☠️ Proceso terminado.');
    } else {
      await ctx.reply('No hay proceso en ejecución.');
    }
  });

  // /history
  bot.command('history', async (ctx) => {
    const entries = queryAudit(ctx.from.id, 15);
    if (entries.length === 0) {
      await ctx.reply('Sin historial.');
      return;
    }

    const lines = entries.map(e => {
      const time = e.timestamp.substring(11, 19);
      const detail = e.data?.prompt ? ` — ${e.data.prompt.substring(0, 50)}` : '';
      const prov = e.data?.provider ? ` [${e.data.provider}]` : '';
      return `${time} ${e.action}${prov}${detail}`;
    });

    await ctx.reply('📜 Historial reciente:\n\n' + lines.join('\n'));
  });

  // /help
  bot.command('help', async (ctx) => {
    await ctx.reply(
      '🤖 LLM Remote — Comandos:\n\n' +
      '/auth <PIN> — Autenticarse\n' +
      '/ask <prompt> — Enviar prompt\n' +
      '/ia [nombre] — Ver/cambiar proveedor IA\n' +
      '/project <ruta> — Directorio de trabajo\n' +
      '/status — Info de sesión\n' +
      '/history — Historial cifrado\n' +
      '/kill — Parar proceso\n' +
      '/lock — Bloquear sesión\n\n' +
      'O escribe directamente — va al proveedor activo.\n\n' +
      'Proveedores: claude, openai, gemini, anthropic'
    );
  });

  // /ask <prompt> or plain text
  bot.command('ask', handlePrompt(providers, sessionManager));
  bot.on('message:text', handlePrompt(providers, sessionManager));

  return bot;
}

function handlePrompt(providers, sessionManager) {
  return async (ctx) => {
    const text = ctx.match?.trim() || ctx.message?.text?.trim();
    if (!text || text.startsWith('/')) return;

    // Rate limit
    const rateCheck = checkRateLimit(ctx.from.id);
    if (!rateCheck.allowed) {
      await ctx.reply(`⏳ Rate limit. Espera ${rateCheck.waitSec}s.`);
      return;
    }

    const workDir = sessionManager.getWorkDir(ctx.from.id);
    const provider = providers.getForUser(ctx.from.id);
    const providerName = providers.getUserProviderName(ctx.from.id);

    logAudit(ctx.from.id, 'prompt', {
      provider: providerName,
      prompt: text.substring(0, 200),
      workDir,
    });

    const statusMsg = await ctx.reply(`⏳ ${provider.displayName}\n📁 ${workDir}`);

    try {
      let lastUpdate = Date.now();

      const result = await provider.execute(text, {
        workDir,
        userId: ctx.from.id,
        onChunk: async (chunk) => {
          if (Date.now() - lastUpdate > 3000) {
            try {
              await ctx.api.editMessageText(
                ctx.chat.id,
                statusMsg.message_id,
                `⚡ Trabajando...\n\n${chunk.substring(0, 200)}...`
              );
              lastUpdate = Date.now();
            } catch {}
          }
        },
      });

      try { await ctx.api.deleteMessage(ctx.chat.id, statusMsg.message_id); } catch {}

      if (result.ok) {
        const output = result.output || '(respuesta vacía)';
        const chunks = formatOutput(output);
        const footer = result.tokens ? `\n\n📊 ${result.model} · ${result.tokens} tokens` : '';

        for (let i = 0; i < chunks.length; i++) {
          const isLast = i === chunks.length - 1;
          await ctx.reply(chunks[i] + (isLast ? footer : ''));
          if (chunks.length > 1) await new Promise(r => setTimeout(r, 500));
        }

        logAudit(ctx.from.id, 'response', {
          provider: providerName,
          length: output.length,
          tokens: result.tokens,
        });
      } else {
        await ctx.reply(`❌ Error (${providerName}):\n\n${result.output?.substring(0, 1000)}`);
        logAudit(ctx.from.id, 'error', { provider: providerName, error: result.output?.substring(0, 500) });
      }
    } catch (err) {
      try { await ctx.api.deleteMessage(ctx.chat.id, statusMsg.message_id); } catch {}
      await ctx.reply(`❌ Error: ${err.message}`);
      log.error(`Execution error [${providerName}]: ${err.message}`);
      logAudit(ctx.from.id, 'exception', { provider: providerName, error: err.message });
    }

    if (config.security.autoDeleteSec > 0) {
      setTimeout(async () => {
        try { await ctx.deleteMessage(); } catch {}
      }, config.security.autoDeleteSec * 1000);
    }
  };
}
