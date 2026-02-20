import { Bot } from 'grammy';
import { config } from './utils/config.js';
import { log } from './utils/logger.js';
import { SessionManager } from './auth/session.js';
import { guardMiddleware, recordFailedAuth, clearFailedAuth } from './auth/guard.js';
import { checkRateLimit } from './security/ratelimit.js';
import { logAudit, queryAudit } from './security/audit.js';
import { ProviderManager } from './providers/manager.js';
import { formatOutput, formatStatus } from './claude/formatter.js';
import { ConversationMemory } from './context/memory.js';
import { transcribeVoice } from './media/voice.js';
import { analyzeImage } from './media/vision.js';
import { canProcessFile, extractFileContent } from './media/files.js';
import { webSearch, formatSearchResults } from './search/web.js';
import { Scheduler } from './scheduler/scheduler.js';
import { MCPManager } from './mcp/client.js';
import { Pipeline } from './pipeline/pipeline.js';
import { SSHManager } from './remote/ssh.js';
import { Persona } from './context/persona.js';
import { SharedMemory } from './context/shared-memory.js';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Sanitize error messages — strip sensitive tokens/keys before showing to user.
 */
function sanitizeError(msg) {
  if (!msg) return '(error desconocido)';
  let safe = String(msg);
  // Strip Telegram bot token
  if (config.telegram.token) {
    safe = safe.replaceAll(config.telegram.token, '[TOKEN_REDACTED]');
  }
  // Strip API keys from URLs (Gemini key=XXX pattern)
  safe = safe.replace(/key=[A-Za-z0-9_-]{20,}/g, 'key=[REDACTED]');
  // Strip Bearer tokens
  safe = safe.replace(/Bearer\s+[A-Za-z0-9_-]{20,}/g, 'Bearer [REDACTED]');
  return safe;
}

export function createBot() {
  const bot = new Bot(config.telegram.token);
  const sessionManager = new SessionManager();
  const providers = new ProviderManager();

  // Init scheduler and MCP
  Scheduler.init(bot, providers);
  MCPManager.loadConfig().catch(err => log.warn(`[mcp] Init: ${sanitizeError(err.message)}`));

  // Global middleware: auth guard
  bot.use(guardMiddleware(sessionManager));

  // /start
  bot.command('start', async (ctx) => {
    const configured = providers.listConfigured();
    const providerList = configured.map(p => `  ${p.displayName}`).join('\n');

    const sharedInfo = SharedMemory.peerEnabled
      ? `\n\n🧠 Memoria compartida con ${SharedMemory.peerNames.join(', ')} (auto: ${SharedMemory.autoChat ? 'ON' : 'OFF'})`
      : '';

    await ctx.reply(
      '🤖 LLM Remote v2.5 — Telegram ↔ IA Bridge\n\n' +
      'Autenticarse: /auth <PIN>\n\n' +
      '📝 Comandos básicos:\n' +
      '  /ask <prompt> — Enviar prompt\n' +
      '  /ia — Cambiar proveedor IA\n' +
      '  /clear — Limpiar contexto\n' +
      '  /project <ruta> — Cambiar directorio\n' +
      '  /status — Info de sesión\n\n' +
      '🆕 Funciones:\n' +
      '  🎤 Audio → transcripción + IA\n' +
      '  📷 Foto → análisis visual\n' +
      '  📎 Archivo → análisis de contenido\n' +
      '  /voz — Respuestas también como nota de voz\n' +
      '  /modo — Personalizar el bot con lenguaje natural\n' +
      '  /web <query> — Búsqueda web + resumen\n' +
      '  /schedule <intervalo> <prompt> — Tareas programadas\n' +
      '  /pipe paso1 → paso2 → paso3 — Pipelines\n' +
      '  /mcp — Servidores MCP\n' +
      '  /ssh — Ejecutar comandos en servidores remotos\n\n' +
      '🧠 Inter-bot:\n' +
      '  /compartir <texto> — Compartir insight con el otro bot\n' +
      '  /mensaje <texto> — Enviar mensaje al otro bot\n' +
      '  /memoria — Ver memoria compartida\n\n' +
      '👥 Funciona en grupos (menciona @bot o responde).\n\n' +
      `Proveedores:\n${providerList}` +
      sharedInfo
    );
  });

  // /auth <pin>
  bot.command('auth', async (ctx) => {
    const pin = ctx.match?.trim();
    if (!pin) { await ctx.reply('Uso: /auth <PIN>'); return; }

    const result = sessionManager.authenticate(ctx.from.id, pin);

    if (result.ok) {
      clearFailedAuth(ctx.from.id);
      logAudit(ctx.from.id, 'auth_success');
      log.info(`User ${ctx.from.id} authenticated`);
      try { await ctx.deleteMessage(); } catch {}

      const provider = providers.getForUser(ctx.from.id);
      let pendingInfo = '';
      if (SharedMemory.peerEnabled) {
        const unread = SharedMemory.getUnreadMessages();
        if (unread.length > 0) {
          pendingInfo = `\n\n📨 ${unread.length} mensaje(s) pendiente(s):`;
          for (const msg of unread.slice(-3)) {
            pendingInfo += `\n  💬 ${msg.from}: "${msg.content.substring(0, 150)}"`;
          }
          pendingInfo += '\n\nUsa /memoria para ver todo.';
        }
      }

      await ctx.reply(
        '✅ Sesión iniciada.\n' +
        `📁 Directorio: ${sessionManager.getWorkDir(ctx.from.id)}\n` +
        `🤖 Proveedor: ${provider.displayName}\n` +
        `⏱ Timeout: ${config.auth.sessionTimeoutMs / 60000} min\n\n` +
        'Escribe texto, envía audio 🎤, foto 📷 o archivo 📎' +
        pendingInfo
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
      const current = providers.getUserProviderName(ctx.from.id);
      const all = providers.listAll();
      const lines = all.map(p => {
        const mark = p.name === current ? ' ← activo' : '';
        const status = p.configured ? '✅' : '❌ (sin API key)';
        return `  ${status} ${p.displayName}${mark}`;
      });

      await ctx.reply(
        '🤖 Proveedores de IA:\n\n' + lines.join('\n') +
        '\n\nUso: /ia <nombre>\nNombres: claude, claude-remote, openai, gemini, gemini-pro, anthropic, groq'
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

  // /clear — clear conversation context
  bot.command('clear', async (ctx) => {
    ConversationMemory.clear(ctx.from.id);
    await ctx.reply('🧹 Contexto de conversación limpiado.');
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
    if (!info) { await ctx.reply('Sin sesión activa.'); return; }

    const provider = providers.getForUser(ctx.from.id);
    const providerStatus = provider.isRunning?.(ctx.from.id) ? '⚡ Ejecutando' : '💤 Idle';
    const memStats = ConversationMemory.getStats(ctx.from.id);
    const schedules = Scheduler.list(ctx.from.id);
    const mcpServers = MCPManager.listServers();

    const sshServers = SSHManager.listServers();
    const personaInfo = Persona.getInfo(ctx.from.id);
    const personaStatus = personaInfo.isCustom ? `🎭 Modo: "${personaInfo.label}"` : '🎭 Modo: default';

    const sharedStatus = SharedMemory.peerEnabled
      ? `\n🧠 Peers: ${SharedMemory.peerNames.join(', ')} (auto: ${SharedMemory.autoChat ? 'ON' : 'OFF'})` +
        ` · ${SharedMemory.getUnreadMessages().length} sin leer`
      : '';

    await ctx.reply(
      formatStatus(info) +
      `\n\n🤖 ${provider.displayName}\n${providerStatus}` +
      `\n💬 Contexto: ${memStats.messages}/${memStats.maxMessages} mensajes` +
      `\n${personaStatus}` +
      sharedStatus +
      (schedules.length ? `\n⏰ Tareas programadas: ${schedules.length}` : '') +
      (mcpServers.length ? `\n🔌 MCP: ${mcpServers.filter(s => s.connected).length}/${mcpServers.length} conectados` : '') +
      (sshServers.length ? `\n🖥️ SSH: ${sshServers.length} servidores` : '')
    );
  });

  // /project <path> — change working directory (restricted to safe paths)
  bot.command('project', async (ctx) => {
    const dir = ctx.match?.trim();
    if (!dir) {
      await ctx.reply(`📁 Actual: ${sessionManager.getWorkDir(ctx.from.id)}\n\nUso: /project <ruta>`);
      return;
    }

    const resolved = resolve(dir);

    // Security: block sensitive system paths
    const BLOCKED_PATHS = ['/etc', '/dev', '/proc', '/sys', '/boot', '/sbin', '/usr/sbin', '/var/run'];
    const isBlocked = BLOCKED_PATHS.some(bp => resolved === bp || resolved.startsWith(bp + '/'));
    if (isBlocked) {
      await ctx.reply(`❌ Directorio bloqueado por seguridad: ${resolved}`);
      return;
    }

    if (!existsSync(resolved)) { await ctx.reply(`❌ Directorio no encontrado: ${resolved}`); return; }

    sessionManager.setWorkDir(ctx.from.id, resolved);
    logAudit(ctx.from.id, 'project_changed', { dir: resolved });
    await ctx.reply(`📁 Directorio: ${resolved}`);
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
    if (entries.length === 0) { await ctx.reply('Sin historial.'); return; }

    const lines = entries.map(e => {
      const time = e.timestamp.substring(11, 19);
      const detail = e.data?.prompt ? ` — ${e.data.prompt.substring(0, 50)}` : '';
      const prov = e.data?.provider ? ` [${e.data.provider}]` : '';
      return `${time} ${e.action}${prov}${detail}`;
    });

    await ctx.reply('📜 Historial reciente:\n\n' + lines.join('\n'));
  });

  // /web <query> — web search
  bot.command('web', async (ctx) => {
    const query = ctx.match?.trim();
    if (!query) { await ctx.reply('Uso: /web <búsqueda>\nEjemplo: /web novedades Node.js 22'); return; }

    const statusMsg = await ctx.reply(`🔍 Buscando: ${query}...`);

    try {
      const { results } = await webSearch(query);
      const formatted = formatSearchResults(results);

      try { await ctx.api.deleteMessage(ctx.chat.id, statusMsg.message_id); } catch {}

      if (results.length === 0) {
        await ctx.reply('No se encontraron resultados.');
        return;
      }

      // Also send to AI for summary
      const provider = providers.getForUser(ctx.from.id);
      const workDir = sessionManager.getWorkDir(ctx.from.id);
      const history = ConversationMemory.getForProvider(ctx.from.id);
      const webPersona = Persona.get(ctx.from.id);
      const webBasePrompt = webPersona || 'Eres un asistente experto. Responde de forma concisa en español.';
      const webSystemPrompt = `${webBasePrompt}\n\nDirectorio de trabajo: ${workDir}`;

      const summaryPrompt = `El usuario buscó "${query}". Resultados:\n\n${formatted}\n\nResume los resultados más relevantes en español. Incluye las URLs de las fuentes.`;

      const aiResult = await provider.execute(summaryPrompt, { workDir, userId: ctx.from.id, history, systemPrompt: webSystemPrompt });

      if (aiResult.ok) {
        ConversationMemory.add(ctx.from.id, 'user', `[búsqueda web: ${query}]`);
        ConversationMemory.add(ctx.from.id, 'assistant', aiResult.output);
        await ctx.reply(`🔍 Resultados para "${query}":\n\n${aiResult.output}`);
      } else {
        await ctx.reply(`🔍 Resultados:\n\n${formatted}`);
      }

      logAudit(ctx.from.id, 'web_search', { query, results: results.length });
    } catch (err) {
      try { await ctx.api.deleteMessage(ctx.chat.id, statusMsg.message_id); } catch {}
      await ctx.reply(`❌ Error en búsqueda: ${sanitizeError(err.message)}`);
    }
  });

  // /schedule <interval> <prompt>
  bot.command('schedule', async (ctx) => {
    const args = ctx.match?.trim();
    if (!args) {
      await ctx.reply(
        '⏰ Tareas programadas\n\n' +
        'Crear: /schedule <intervalo> <prompt>\n' +
        'Intervalos: 30m, 1h, 6h, 24h, 7d\n\n' +
        'Ejemplos:\n' +
        '  /schedule 24h Resume el estado de los repos\n' +
        '  /schedule 1h Revisa si hay errores en los logs\n\n' +
        'Listar: /schedules\n' +
        'Borrar: /unschedule <id>'
      );
      return;
    }

    const match = args.match(/^(\d+[smhd])\s+(.+)$/);
    if (!match) {
      await ctx.reply('Formato: /schedule <intervalo> <prompt>\nEjemplo: /schedule 24h Resume los cambios del repo');
      return;
    }

    const [, interval, prompt] = match;
    const providerName = providers.getUserProviderName(ctx.from.id);
    const workDir = sessionManager.getWorkDir(ctx.from.id);

    const result = Scheduler.add(ctx.from.id, interval, prompt, providerName, workDir);
    if (result.ok) {
      const humanInterval = formatInterval(result.intervalMs);
      logAudit(ctx.from.id, 'schedule_created', { id: result.id, interval, prompt: prompt.substring(0, 100) });
      await ctx.reply(`⏰ Tarea #${result.id} creada\n📝 ${prompt}\n🔄 Cada ${humanInterval}\n🤖 ${providerName}`);
    } else {
      await ctx.reply(`❌ ${result.reason}`);
    }
  });

  // /schedules
  bot.command('schedules', async (ctx) => {
    const list = Scheduler.list(ctx.from.id);
    if (list.length === 0) { await ctx.reply('No hay tareas programadas.\n\nUsa: /schedule <intervalo> <prompt>'); return; }

    const lines = list.map(s =>
      `#${s.id} — ${s.cron} — ${s.prompt}\n   🤖 ${s.provider}${s.lastRun ? ` · Último: ${s.lastRun.substring(11, 19)}` : ''}`
    );
    await ctx.reply('⏰ Tareas programadas:\n\n' + lines.join('\n\n'));
  });

  // /unschedule <id>
  bot.command('unschedule', async (ctx) => {
    const id = parseInt(ctx.match?.trim(), 10);
    if (!id) { await ctx.reply('Uso: /unschedule <id>'); return; }

    const result = Scheduler.remove(ctx.from.id, id);
    if (result.ok) {
      logAudit(ctx.from.id, 'schedule_removed', { id });
      await ctx.reply(`✅ Tarea #${id} eliminada.`);
    } else {
      await ctx.reply(`❌ ${result.reason}`);
    }
  });

  // /pipe step1 → step2 → step3
  bot.command('pipe', async (ctx) => {
    const text = ctx.match?.trim();
    if (!text) {
      await ctx.reply(
        '🔗 Pipelines\n\n' +
        'Uso: /pipe paso1 → paso2 → paso3\n\n' +
        'Ejemplos:\n' +
        '  /pipe busca tendencias React 2026 → resume en 3 puntos\n' +
        '  /pipe lee el README del proyecto → sugiere mejoras → redacta un PR\n' +
        '  /pipe analiza este CSV → genera estadísticas → formatea como tabla markdown'
      );
      return;
    }

    const statusMsg = await ctx.reply('🔗 Ejecutando pipeline...');

    const result = await Pipeline.execute(text, {
      providers,
      sessionManager,
      userId: ctx.from.id,
      bot,
      chatId: ctx.chat.id,
    });

    try { await ctx.api.deleteMessage(ctx.chat.id, statusMsg.message_id); } catch {}

    if (result.ok) {
      const chunks = formatOutput(result.output);
      for (let i = 0; i < chunks.length; i++) {
        const isLast = i === chunks.length - 1;
        await ctx.reply(chunks[i] + (isLast ? `\n\n🔗 Pipeline completado (${result.steps.length} pasos)` : ''));
      }
      logAudit(ctx.from.id, 'pipeline', { steps: result.steps.length });
    } else {
      await ctx.reply(`❌ ${result.output}`);
    }
  });

  // /mcp — MCP server management
  bot.command('mcp', async (ctx) => {
    const args = ctx.match?.trim();

    if (!args) {
      const servers = MCPManager.listServers();
      if (servers.length === 0) {
        await ctx.reply(
          '🔌 MCP Servers\n\nNo hay servidores MCP configurados.\n\n' +
          'Añadir: /mcp add <nombre> <comando> [args...]\n' +
          'Ejemplo: /mcp add github npx -y @modelcontextprotocol/server-github\n\n' +
          'Listar herramientas: /mcp tools\n' +
          'Ejecutar: /mcp call <servidor>/<herramienta> <args JSON>'
        );
        return;
      }

      const lines = servers.map(s => {
        const status = s.connected ? '🟢' : '🔴';
        return `${status} ${s.name} — ${s.tools.length} herramientas\n   ${s.tools.join(', ')}`;
      });
      await ctx.reply('🔌 MCP Servers:\n\n' + lines.join('\n\n'));
      return;
    }

    const parts = args.split(/\s+/);
    const subCmd = parts[0];

    if (subCmd === 'add' && parts.length >= 3) {
      const name = parts[1];
      const command = parts[2];
      const cmdArgs = parts.slice(3);
      const statusMsg = await ctx.reply(`🔌 Conectando a ${name}...`);
      try {
        const server = await MCPManager.addServer(name, command, cmdArgs);
        try { await ctx.api.deleteMessage(ctx.chat.id, statusMsg.message_id); } catch {}
        await ctx.reply(`🟢 ${name} conectado — ${server.tools.length} herramientas:\n${server.tools.map(t => `  · ${t.name}`).join('\n')}`);
        logAudit(ctx.from.id, 'mcp_add', { name, tools: server.tools.length });
      } catch (err) {
        try { await ctx.api.deleteMessage(ctx.chat.id, statusMsg.message_id); } catch {}
        await ctx.reply(`❌ Error conectando a ${name}: ${sanitizeError(err.message)}`);
      }
    } else if (subCmd === 'remove' && parts[1]) {
      if (MCPManager.removeServer(parts[1])) {
        await ctx.reply(`🔌 ${parts[1]} desconectado.`);
      } else {
        await ctx.reply(`❌ Servidor '${parts[1]}' no encontrado.`);
      }
    } else if (subCmd === 'tools') {
      const tools = MCPManager.getAllTools();
      if (tools.length === 0) { await ctx.reply('No hay herramientas MCP disponibles.'); return; }
      const lines = tools.map(t => `  ${t.server}/${t.name} — ${t.description || '(sin descripción)'}`);
      await ctx.reply('🔧 Herramientas MCP:\n\n' + lines.join('\n'));
    } else if (subCmd === 'call' && parts.length >= 2) {
      const [serverName, toolName] = parts[1].split('/');
      let toolArgs = {};
      try { toolArgs = JSON.parse(parts.slice(2).join(' ') || '{}'); } catch {}

      const statusMsg = await ctx.reply(`🔧 Ejecutando ${serverName}/${toolName}...`);
      try {
        const result = await MCPManager.callTool(serverName, toolName, toolArgs);
        try { await ctx.api.deleteMessage(ctx.chat.id, statusMsg.message_id); } catch {}
        const output = result?.content?.map(c => c.text || JSON.stringify(c)).join('\n') || JSON.stringify(result, null, 2);
        const chunks = formatOutput(output);
        for (const chunk of chunks) await ctx.reply(chunk);
      } catch (err) {
        try { await ctx.api.deleteMessage(ctx.chat.id, statusMsg.message_id); } catch {}
        await ctx.reply(`❌ Error: ${sanitizeError(err.message)}`);
      }
    } else {
      await ctx.reply('Uso: /mcp add|remove|tools|call');
    }
  });

  // /modo — configure bot persona with natural language
  bot.command('modo', async (ctx) => {
    const args = ctx.match?.trim();

    if (!args) {
      const info = Persona.getInfo(ctx.from.id);
      const current = info.isCustom
        ? `Personalizado: "${info.label}"\n\n${info.prompt.substring(0, 500)}`
        : (info.prompt ? `Default: ${info.prompt.substring(0, 300)}` : 'Sin personalizar');

      await ctx.reply(
        '🎭 Modo / Personalidad del bot\n\n' +
        `Estado actual:\n${current}\n\n` +
        'Comandos:\n' +
        '  /modo <instrucciones> — Configurar personalidad\n' +
        '  /modo + <instrucciones> — Anadir instrucciones\n' +
        '  /modo reset — Volver al default\n\n' +
        'Ejemplos:\n' +
        '  /modo Eres un experto en finanzas. Responde siempre con datos y fuentes.\n' +
        '  /modo + Cuando hables de mercados, incluye graficos ASCII.\n' +
        '  /modo Responde siempre en ingles y formato bullet points.'
      );
      return;
    }

    if (args.toLowerCase() === 'reset') {
      Persona.reset(ctx.from.id);
      logAudit(ctx.from.id, 'persona_reset');
      await ctx.reply('🎭 Personalidad reseteada al default.');
      return;
    }

    if (args.startsWith('+ ') || args.startsWith('+')) {
      const extra = args.replace(/^\+\s*/, '');
      Persona.append(ctx.from.id, extra);
      logAudit(ctx.from.id, 'persona_append', { extra: extra.substring(0, 100) });
      await ctx.reply(`🎭 Instrucciones anadidas:\n"${extra.substring(0, 200)}"`);
      return;
    }

    Persona.set(ctx.from.id, args);
    logAudit(ctx.from.id, 'persona_set', { prompt: args.substring(0, 100) });
    await ctx.reply(`🎭 Personalidad configurada:\n"${args.substring(0, 300)}"\n\nEl bot ahora respondera segun estas instrucciones.`);
  });

  // /voz — info about voice behavior
  bot.command('voz', async (ctx) => {
    await ctx.reply(
      '🎤 Modo Voz\n\n' +
      '📝 Texto → Respuesta en texto\n' +
      '🎤 Audio → Respuesta en texto + audio\n\n' +
      'Envía un mensaje de voz y el bot responderá con texto y nota de voz automáticamente.'
    );
  });

  // /ssh — remote server management
  bot.command('ssh', async (ctx) => {
    const args = ctx.match?.trim();

    if (!args) {
      const servers = SSHManager.listServers();
      if (servers.length === 0) {
        await ctx.reply(
          '🖥️ SSH Remote\n\nNo hay servidores configurados.\n\n' +
          'Añadir: /ssh add <nombre> <user@host> [puerto]\n' +
          'Ejemplo: /ssh add prod root@37.27.92.122\n\n' +
          'Ejecutar: /ssh <servidor> <comando>\n' +
          'Listar: /ssh list\n' +
          'Eliminar: /ssh remove <nombre>'
        );
        return;
      }

      const lines = servers.map(s => `  🖥️ ${s.name} — ${s.user}@${s.host}:${s.port}`);
      await ctx.reply(
        '🖥️ Servidores SSH:\n\n' + lines.join('\n') +
        '\n\nEjecutar: /ssh <servidor> <comando>'
      );
      return;
    }

    const parts = args.split(/\s+/);
    const subCmd = parts[0];

    if (subCmd === 'add' && parts.length >= 3) {
      const name = parts[1];
      const userHost = parts[2];
      const port = parseInt(parts[3], 10) || 22;
      const keyPath = parts[4] || '';

      const match = userHost.match(/^([^@]+)@(.+)$/);
      if (!match) {
        await ctx.reply('Formato: /ssh add <nombre> <user@host> [puerto] [keyPath]');
        return;
      }

      const [, user, host] = match;
      SSHManager.addServer(name, host, user, port, keyPath);
      logAudit(ctx.from.id, 'ssh_add', { name, host, user, port });
      await ctx.reply(`✅ Servidor "${name}" añadido: ${user}@${host}:${port}`);
    } else if (subCmd === 'remove' && parts[1]) {
      if (SSHManager.removeServer(parts[1])) {
        logAudit(ctx.from.id, 'ssh_remove', { name: parts[1] });
        await ctx.reply(`✅ Servidor "${parts[1]}" eliminado.`);
      } else {
        await ctx.reply(`❌ Servidor "${parts[1]}" no encontrado.`);
      }
    } else if (subCmd === 'list') {
      const servers = SSHManager.listServers();
      if (servers.length === 0) { await ctx.reply('No hay servidores SSH configurados.'); return; }
      const lines = servers.map(s => `  🖥️ ${s.name} — ${s.user}@${s.host}:${s.port}`);
      await ctx.reply('🖥️ Servidores SSH:\n\n' + lines.join('\n'));
    } else {
      // /ssh <server> <command>
      const sshRateCheck = checkRateLimit(ctx.from.id);
      if (!sshRateCheck.allowed) { await ctx.reply(`⏳ Rate limit. Espera ${sshRateCheck.waitSec}s.`); return; }

      const serverName = parts[0];
      const command = parts.slice(1).join(' ');

      if (!command) {
        await ctx.reply(`Uso: /ssh ${serverName} <comando>\nEjemplo: /ssh ${serverName} df -h`);
        return;
      }

      const server = SSHManager.getServer(serverName);
      if (!server) {
        await ctx.reply(`❌ Servidor "${serverName}" no encontrado.\nUsa /ssh list para ver servidores.`);
        return;
      }

      const statusMsg = await ctx.reply(`🖥️ ${serverName}: ${command.substring(0, 80)}...`);

      try {
        const result = await SSHManager.execute(serverName, command);
        try { await ctx.api.deleteMessage(ctx.chat.id, statusMsg.message_id); } catch {}

        const icon = result.ok ? '✅' : '⚠️';
        const exitCode = result.code !== 0 ? `\n\n📟 Exit code: ${result.code}` : '';
        const output = result.output || '(sin salida)';

        const chunks = formatOutput(output);
        for (let i = 0; i < chunks.length; i++) {
          const isFirst = i === 0;
          const isLast = i === chunks.length - 1;
          const header = isFirst ? `${icon} ${serverName}$ ${command.substring(0, 60)}\n\n` : '';
          const footer = isLast ? exitCode : '';
          await ctx.reply(header + chunks[i] + footer);
        }

        logAudit(ctx.from.id, 'ssh_exec', { server: serverName, command: command.substring(0, 100), exitCode: result.code });
      } catch (err) {
        try { await ctx.api.deleteMessage(ctx.chat.id, statusMsg.message_id); } catch {}
        await ctx.reply(`❌ SSH Error: ${sanitizeError(err.message)}`);
        log.error(`[ssh] ${serverName}: ${sanitizeError(err.message)}`);
      }
    }
  });

  // /compartir <text> — save insight to shared memory
  bot.command('compartir', async (ctx) => {
    const text = ctx.match?.trim();
    if (!text) {
      await ctx.reply('Uso: /compartir <insight>\nEjemplo: /compartir El precio de Bitcoin supera los 100k USD');
      return;
    }

    if (!SharedMemory.enabled) {
      await ctx.reply('❌ Memoria compartida no configurada (faltan BOT_NAME y SHARED_DATA_DIR).');
      return;
    }

    // Parse "topic: content" or just "content"
    let topic = 'general';
    let content = text;
    const colonIdx = text.indexOf(':');
    if (colonIdx > 0 && colonIdx < 30) {
      topic = text.substring(0, colonIdx).trim();
      content = text.substring(colonIdx + 1).trim();
    }

    const insight = SharedMemory.addInsight(topic, content);
    logAudit(ctx.from.id, 'shared_insight', { topic, content: content.substring(0, 100) });
    await ctx.reply(`🧠 Insight guardado:\n📌 ${topic}: ${content.substring(0, 300)}`);
  });

  // /mensaje [peer] <text> — send message to peer bot(s)
  bot.command('mensaje', async (ctx) => {
    const text = ctx.match?.trim();
    const peers = SharedMemory.peerNames;

    if (!text) {
      const peerList = peers.length > 0 ? peers.join(', ') : '(ninguno)';
      await ctx.reply(
        `Uso: /mensaje [peer] <texto>\n` +
        `Peers: ${peerList}\n\n` +
        `Ejemplos:\n` +
        (peers.length === 1
          ? `  /mensaje Revisa las cotizaciones\n`
          : `  /mensaje ${peers[0] || 'nombre'} Revisa las cotizaciones\n`) +
        `  /mensaje todos Hola a todos`
      );
      return;
    }

    if (!SharedMemory.peerEnabled) {
      await ctx.reply('❌ No hay peers configurados (faltan BOT_NAME, PEER_BOT_NAMES y SHARED_DATA_DIR).');
      return;
    }

    // Parse: first word might be a peer name or "todos"
    const firstWord = text.split(/\s+/)[0].toLowerCase();
    let targetPeers;
    let content;

    if (firstWord === 'todos' || firstWord === 'all') {
      targetPeers = peers;
      content = text.substring(firstWord.length).trim();
    } else if (peers.includes(firstWord)) {
      targetPeers = [firstWord];
      content = text.substring(firstWord.length).trim();
    } else if (peers.length === 1) {
      // Single peer: no need to specify name
      targetPeers = peers;
      content = text;
    } else {
      // Multiple peers but no name specified — send to all
      targetPeers = peers;
      content = text;
    }

    if (!content) {
      await ctx.reply('❌ Escribe un mensaje después del nombre del peer.');
      return;
    }

    for (const peer of targetPeers) {
      SharedMemory.sendMessage(peer, content);
    }
    logAudit(ctx.from.id, 'shared_message', { to: targetPeers.join(','), content: content.substring(0, 100) });
    await ctx.reply(`💬 Mensaje enviado a ${targetPeers.join(', ')}:\n"${content.substring(0, 300)}"`);
  });

  // /memoria — view shared memory status
  bot.command('memoria', async (ctx) => {
    const summary = SharedMemory.getSummary();

    let details = '';
    if (SharedMemory.peerEnabled) {
      const peerInsights = SharedMemory.getPeerInsights(5);
      if (peerInsights.length > 0) {
        details += '\n\n📚 Últimos insights de peers:';
        for (const i of peerInsights) {
          const time = i.timestamp.substring(5, 16).replace('T', ' ');
          details += `\n  [${time}] ${i.from}/${i.topic}: ${i.content.substring(0, 120)}`;
        }
      }

      const unread = SharedMemory.getUnreadMessages();
      if (unread.length > 0) {
        details += '\n\n📨 Mensajes sin leer:';
        for (const m of unread) {
          const time = m.timestamp.substring(5, 16).replace('T', ' ');
          details += `\n  [${time}] ${m.from}: "${m.content.substring(0, 150)}"`;
        }
        details += '\n\nSe marcarán como leídos.';
        SharedMemory.markAllRead();
      }
    }

    await ctx.reply(summary + details);
  });

  // /help
  bot.command('help', async (ctx) => {
    await ctx.reply(
      '🤖 LLM Remote v2.5 — Comandos:\n\n' +
      '🔐 Sesión:\n' +
      '  /auth <PIN> — Autenticarse\n' +
      '  /lock — Bloquear sesión\n' +
      '  /status — Info de sesión\n' +
      '  /history — Historial cifrado\n\n' +
      '🤖 IA:\n' +
      '  /ask <prompt> — Enviar prompt\n' +
      '  /ia [nombre] — Ver/cambiar proveedor\n' +
      '  /modo — Personalizar personalidad del bot\n' +
      '  /clear — Limpiar contexto conversación\n' +
      '  /project <ruta> — Directorio de trabajo\n' +
      '  /kill — Parar proceso\n\n' +
      '🆕 Multimedia:\n' +
      '  🎤 Audio → Transcripción + IA + respuesta por voz\n' +
      '  📷 Foto — Análisis visual con IA\n' +
      '  📎 Archivo — Análisis de contenido\n\n' +
      '🔍 Herramientas:\n' +
      '  /web <query> — Búsqueda web + resumen IA\n' +
      '  /schedule <intervalo> <prompt> — Tarea programada\n' +
      '  /schedules — Ver tareas programadas\n' +
      '  /unschedule <id> — Eliminar tarea\n' +
      '  /pipe paso1 → paso2 — Pipeline\n' +
      '  /mcp — Servidores MCP\n\n' +
      '🧠 Inter-bot:\n' +
      '  /compartir <texto> — Compartir insight\n' +
      '  /mensaje <texto> — Mensaje al otro bot\n' +
      '  /memoria — Ver memoria compartida\n\n' +
      '🖥️ Remoto:\n' +
      '  /ssh add <nombre> <user@host> — Añadir servidor\n' +
      '  /ssh <servidor> <comando> — Ejecutar comando\n' +
      '  /ssh list — Ver servidores\n\n' +
      '👥 Grupos: responde a comandos, menciones @bot y respuestas.\n\n' +
      'O escribe directamente — va al proveedor activo.'
    );
  });

  // /ask <prompt> or plain text
  bot.command('ask', handlePrompt(providers, sessionManager));
  bot.on('message:text', handlePrompt(providers, sessionManager));

  // 🎤 Voice messages
  bot.on(['message:voice', 'message:audio'], async (ctx) => {
    const rateCheck = checkRateLimit(ctx.from.id);
    if (!rateCheck.allowed) { await ctx.reply(`⏳ Rate limit. Espera ${rateCheck.waitSec}s.`); return; }

    const statusMsg = await ctx.reply('🎤 Transcribiendo audio...');

    try {
      const file = await ctx.getFile();
      const fileUrl = `https://api.telegram.org/file/bot${config.telegram.token}/${file.file_path}`;
      const res = await fetch(fileUrl);
      const buffer = Buffer.from(await res.arrayBuffer());

      const transcription = await transcribeVoice(buffer, file.file_path || 'audio.ogg');

      if (!transcription || transcription.trim().length === 0) {
        try { await ctx.api.deleteMessage(ctx.chat.id, statusMsg.message_id); } catch {}
        await ctx.reply('🎤 No se detectó habla en el audio.');
        return;
      }

      // Update status
      try {
        await ctx.api.editMessageText(ctx.chat.id, statusMsg.message_id, `🎤 "${transcription.substring(0, 100)}..."\n\n⏳ Procesando con IA...`);
      } catch {}

      // Send transcription to active provider
      const workDir = sessionManager.getWorkDir(ctx.from.id);
      const provider = providers.getForUser(ctx.from.id);
      const providerName = providers.getUserProviderName(ctx.from.id);
      const history = ConversationMemory.getForProvider(ctx.from.id);

      // Build system prompt from persona
      const persona = Persona.get(ctx.from.id);
      const voiceBasePrompt = persona || 'Eres un asistente experto en ingeniería de software. Responde de forma concisa en español. Código en inglés.';
      const voiceSystemPrompt = `${voiceBasePrompt}\n\nDirectorio de trabajo: ${workDir}`;

      ConversationMemory.add(ctx.from.id, 'user', transcription);
      logAudit(ctx.from.id, 'voice_prompt', { provider: providerName, prompt: transcription.substring(0, 200) });

      const result = await provider.execute(transcription, { workDir, userId: ctx.from.id, history, systemPrompt: voiceSystemPrompt });

      try { await ctx.api.deleteMessage(ctx.chat.id, statusMsg.message_id); } catch {}

      if (result.ok) {
        ConversationMemory.add(ctx.from.id, 'assistant', result.output);
        const header = `🎤 "${transcription.substring(0, 80)}"\n\n`;
        const chunks = formatOutput(result.output);
        const footer = result.tokens ? `\n\n📊 ${result.model} · ${result.tokens} tokens` : '';

        for (let i = 0; i < chunks.length; i++) {
          const isLast = i === chunks.length - 1;
          await ctx.reply((i === 0 ? header : '') + chunks[i] + (isLast ? footer : ''));
        }

        // TTS disabled by default — use /voz to enable voice responses

      } else {
        await ctx.reply(`🎤 "${transcription.substring(0, 100)}"\n\n❌ Error: ${sanitizeError(result.output?.substring(0, 500))}`);
      }
    } catch (err) {
      try { await ctx.api.deleteMessage(ctx.chat.id, statusMsg.message_id); } catch {}
      await ctx.reply(`❌ Error transcribiendo audio: ${sanitizeError(err.message)}`);
      log.error(`[voice] Error: ${sanitizeError(err.message)}`);
    }
  });

  // 📷 Photos
  bot.on('message:photo', async (ctx) => {
    const rateCheck = checkRateLimit(ctx.from.id);
    if (!rateCheck.allowed) { await ctx.reply(`⏳ Rate limit. Espera ${rateCheck.waitSec}s.`); return; }

    const statusMsg = await ctx.reply('📷 Analizando imagen...');

    try {
      // Get largest photo
      const photos = ctx.message.photo;
      const photo = photos[photos.length - 1];
      const file = await ctx.api.getFile(photo.file_id);
      const fileUrl = `https://api.telegram.org/file/bot${config.telegram.token}/${file.file_path}`;
      const res = await fetch(fileUrl);
      const buffer = Buffer.from(await res.arrayBuffer());
      const base64 = buffer.toString('base64');

      const mimeType = file.file_path?.endsWith('.png') ? 'image/png' : 'image/jpeg';
      const caption = ctx.message.caption || '';
      const history = ConversationMemory.getForProvider(ctx.from.id);

      const result = await analyzeImage(base64, mimeType, caption, history);

      try { await ctx.api.deleteMessage(ctx.chat.id, statusMsg.message_id); } catch {}

      ConversationMemory.add(ctx.from.id, 'user', `[imagen: ${caption || 'sin descripción'}]`);
      ConversationMemory.add(ctx.from.id, 'assistant', result.output);

      const header = caption ? `📷 "${caption}"\n\n` : '📷 Análisis de imagen:\n\n';
      const chunks = formatOutput(result.output);
      const footer = result.tokens ? `\n\n📊 ${result.model} (${result.provider}) · ${result.tokens} tokens` : '';

      for (let i = 0; i < chunks.length; i++) {
        const isLast = i === chunks.length - 1;
        await ctx.reply((i === 0 ? header : '') + chunks[i] + (isLast ? footer : ''));
      }

      logAudit(ctx.from.id, 'vision', { provider: result.provider, caption: caption.substring(0, 100) });
    } catch (err) {
      try { await ctx.api.deleteMessage(ctx.chat.id, statusMsg.message_id); } catch {}
      await ctx.reply(`❌ Error analizando imagen: ${sanitizeError(err.message)}`);
      log.error(`[vision] Error: ${sanitizeError(err.message)}`);
    }
  });

  // Start auto-chat loop if enabled (needs bot + providers)
  bot._autoChatInterval = startAutoChatLoop(bot, providers);

  // 📎 Documents/Files
  bot.on('message:document', async (ctx) => {
    const rateCheck = checkRateLimit(ctx.from.id);
    if (!rateCheck.allowed) { await ctx.reply(`⏳ Rate limit. Espera ${rateCheck.waitSec}s.`); return; }

    const doc = ctx.message.document;
    const fileName = doc.file_name || 'file';
    const fileSize = doc.file_size || 0;

    // Check if it's an image disguised as document
    if (doc.mime_type?.startsWith('image/')) {
      const statusMsg = await ctx.reply('📷 Analizando imagen...');
      try {
        const file = await ctx.getFile();
        const fileUrl = `https://api.telegram.org/file/bot${config.telegram.token}/${file.file_path}`;
        const res = await fetch(fileUrl);
        const buffer = Buffer.from(await res.arrayBuffer());
        const base64 = buffer.toString('base64');
        const caption = ctx.message.caption || '';
        const history = ConversationMemory.getForProvider(ctx.from.id);

        const result = await analyzeImage(base64, doc.mime_type, caption, history);
        try { await ctx.api.deleteMessage(ctx.chat.id, statusMsg.message_id); } catch {}

        ConversationMemory.add(ctx.from.id, 'user', `[imagen: ${fileName}]`);
        ConversationMemory.add(ctx.from.id, 'assistant', result.output);

        const chunks = formatOutput(result.output);
        for (const chunk of chunks) await ctx.reply(chunk);
        logAudit(ctx.from.id, 'vision_file', { file: fileName });
        return;
      } catch (err) {
        try { await ctx.api.deleteMessage(ctx.chat.id, statusMsg.message_id); } catch {}
        await ctx.reply(`❌ Error: ${sanitizeError(err.message)}`);
        return;
      }
    }

    if (!canProcessFile(fileName, fileSize)) {
      await ctx.reply(`❌ No puedo procesar "${fileName}" (${(fileSize / 1024).toFixed(0)}KB).\nFormatos: código, texto, CSV, PDF (max 5MB)`);
      return;
    }

    const statusMsg = await ctx.reply(`📎 Procesando ${fileName}...`);

    try {
      const file = await ctx.getFile();
      const fileUrl = `https://api.telegram.org/file/bot${config.telegram.token}/${file.file_path}`;
      const res = await fetch(fileUrl);
      const buffer = Buffer.from(await res.arrayBuffer());

      const content = await extractFileContent(buffer, fileName);
      const caption = ctx.message.caption || `Analiza este archivo: ${fileName}`;

      // Send to AI provider
      const provider = providers.getForUser(ctx.from.id);
      const providerName = providers.getUserProviderName(ctx.from.id);
      const workDir = sessionManager.getWorkDir(ctx.from.id);
      const history = ConversationMemory.getForProvider(ctx.from.id);
      const filePersona = Persona.get(ctx.from.id);
      const fileBasePrompt = filePersona || 'Eres un asistente experto en ingeniería de software. Responde de forma concisa en español. Código en inglés.';
      const fileSystemPrompt = `${fileBasePrompt}\n\nDirectorio de trabajo: ${workDir}`;

      const prompt = `El usuario envió el archivo "${fileName}":\n\n\`\`\`\n${content.substring(0, 10000)}\n\`\`\`\n\n${caption}`;

      ConversationMemory.add(ctx.from.id, 'user', `[archivo: ${fileName}] ${caption}`);
      logAudit(ctx.from.id, 'file_prompt', { provider: providerName, file: fileName });

      const result = await provider.execute(prompt, { workDir, userId: ctx.from.id, history, systemPrompt: fileSystemPrompt });

      try { await ctx.api.deleteMessage(ctx.chat.id, statusMsg.message_id); } catch {}

      if (result.ok) {
        ConversationMemory.add(ctx.from.id, 'assistant', result.output);
        const header = `📎 ${fileName}\n\n`;
        const chunks = formatOutput(result.output);
        const footer = result.tokens ? `\n\n📊 ${result.model} · ${result.tokens} tokens` : '';

        for (let i = 0; i < chunks.length; i++) {
          const isLast = i === chunks.length - 1;
          await ctx.reply((i === 0 ? header : '') + chunks[i] + (isLast ? footer : ''));
        }
      } else {
        await ctx.reply(`❌ Error (${providerName}):\n\n${result.output?.substring(0, 1000)}`);
      }
    } catch (err) {
      try { await ctx.api.deleteMessage(ctx.chat.id, statusMsg.message_id); } catch {}
      await ctx.reply(`❌ Error procesando archivo: ${sanitizeError(err.message)}`);
      log.error(`[files] Error: ${sanitizeError(err.message)}`);
    }
  });

  return { bot, sessionManager };
}

function handlePrompt(providers, sessionManager) {
  return async (ctx) => {
    const text = ctx.match?.trim() || ctx.message?.text?.trim();
    if (!text || text.startsWith('/')) return;

    const rateCheck = checkRateLimit(ctx.from.id);
    if (!rateCheck.allowed) { await ctx.reply(`⏳ Rate limit. Espera ${rateCheck.waitSec}s.`); return; }

    const workDir = sessionManager.getWorkDir(ctx.from.id);
    const provider = providers.getForUser(ctx.from.id);
    const providerName = providers.getUserProviderName(ctx.from.id);
    const history = ConversationMemory.getForProvider(ctx.from.id);

    // Build system prompt from persona + workDir context + shared memory
    const persona = Persona.get(ctx.from.id);
    const basePrompt = persona || 'Eres un asistente experto en ingeniería de software. Responde de forma concisa en español. Código en inglés.';
    const sharedContext = SharedMemory.getContext();
    const systemPrompt = `${basePrompt}\n\nDirectorio de trabajo: ${workDir}${sharedContext}`;

    // Add MCP tools description to context
    const mcpToolsDesc = MCPManager.getToolsDescription();

    ConversationMemory.add(ctx.from.id, 'user', text);
    logAudit(ctx.from.id, 'prompt', {
      provider: providerName,
      prompt: text.substring(0, 200),
      workDir,
    });

    const statusMsg = await ctx.reply(`⏳ ${provider.displayName}\n📁 ${workDir}`);

    try {
      let lastUpdate = Date.now();

      const fullPrompt = mcpToolsDesc ? text + mcpToolsDesc : text;

      const result = await provider.execute(fullPrompt, {
        workDir,
        userId: ctx.from.id,
        history,
        systemPrompt,
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
        ConversationMemory.add(ctx.from.id, 'assistant', output);

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

        // Auto-learn: silently extract and save insights (no notification to user)
        if (SharedMemory.enabled && output.length > 200) {
          extractInsight(text, output, providers, ctx.from.id).catch(() => {});
        }
      } else {
        await ctx.reply(`❌ Error (${providerName}):\n\n${result.output?.substring(0, 1000)}`);
        logAudit(ctx.from.id, 'error', { provider: providerName, error: result.output?.substring(0, 500) });
      }
    } catch (err) {
      try { await ctx.api.deleteMessage(ctx.chat.id, statusMsg.message_id); } catch {}
      await ctx.reply(`❌ Error: ${sanitizeError(err.message)}`);
      log.error(`Execution error [${providerName}]: ${sanitizeError(err.message)}`);
      logAudit(ctx.from.id, 'exception', { provider: providerName, error: err.message });
    }

    if (config.security.autoDeleteSec > 0) {
      setTimeout(async () => { try { await ctx.deleteMessage(); } catch {} }, config.security.autoDeleteSec * 1000);
    }
  };
}

function formatInterval(ms) {
  if (ms >= 86400000) return `${ms / 86400000}d`;
  if (ms >= 3600000) return `${ms / 3600000}h`;
  if (ms >= 60000) return `${ms / 60000}m`;
  return `${ms / 1000}s`;
}

/**
 * Auto-learn: silently extract insights from conversations.
 * No user notification — insights are shared via auto-chat loop to the peer.
 */
async function extractInsight(userMsg, botResponse, providers, userId) {
  try {
    const cheapProvider = pickCheapProvider(providers);
    if (!cheapProvider) return;

    const extractPrompt =
      'De la siguiente conversación, ¿hay algún dato, hecho o insight clave que valga la pena recordar ' +
      'para futuras conversaciones? Solo datos factuales, no opiniones.\n' +
      'Si sí, responde EXACTAMENTE con: INSIGHT:tema|contenido\n' +
      'Si no hay nada notable, responde: NONE\n\n' +
      `User: ${userMsg.substring(0, 500)}\nBot: ${botResponse.substring(0, 1000)}`;

    const result = await cheapProvider.execute(extractPrompt, {
      systemPrompt: 'Eres un extractor de conocimiento. Solo responde INSIGHT:tema|contenido o NONE. Nada más.',
      userId,
    });

    if (result.ok && result.output) {
      const match = result.output.match(/INSIGHT:\s*([^|]+)\|(.+)/s);
      if (match) {
        const topic = match[1].trim().substring(0, 50);
        const content = match[2].trim().substring(0, 500);
        SharedMemory.addInsight(topic, content);
        log.info(`[shared] Auto-insight: ${topic} — ${content.substring(0, 60)}`);
      }
    }
  } catch (err) {
    log.debug(`[shared] Insight extraction failed: ${sanitizeError(err.message)}`);
  }
}

/**
 * Pick the cheapest available provider for lightweight tasks.
 * Preference: gemini (free) > groq (free) > fallback to any configured.
 */
function pickCheapProvider(providers) {
  for (const name of ['gemini', 'groq', 'openai', 'anthropic']) {
    const p = providers.get(name);
    if (p?.isConfigured) return p;
  }
  return null;
}

/**
 * Start the autonomous inter-bot loop.
 * Every 30s:
 *   1. Notify users of new peer insights (visible on screen, no commands needed)
 *   2. Auto-respond to unread messages from peers (autonomous conversation)
 */
export function startAutoChatLoop(bot, providers) {
  if (!SharedMemory.autoChat) {
    log.info('[shared] Auto-chat disabled (INTER_BOT_AUTO != true)');
    return null;
  }

  const peers = SharedMemory.peerNames;
  log.info(`[shared] Auto-chat enabled: ${SharedMemory.botName} ↔ ${peers.join(', ')}`);
  const authorizedUsers = config.auth.authorizedUsers;

  async function notifyUsers(text) {
    for (const userId of authorizedUsers) {
      try { await bot.api.sendMessage(userId, text); } catch {}
    }
  }

  const interval = setInterval(async () => {
    try {
      // 1. Show new peer insights on screen automatically
      const newInsights = SharedMemory.getNewPeerInsights();
      for (const insight of newInsights) {
        await notifyUsers(
          `🧠 ${insight.from} aprendió:\n` +
          `📌 [${insight.topic}] ${insight.content.substring(0, 400)}`
        );
        log.info(`[shared] Notified insight from ${insight.from}: ${insight.topic}`);
      }

      // 2. Auto-respond to unread messages
      const unread = SharedMemory.getUnreadMessages();
      if (unread.length === 0) return;

      const provider = pickCheapProvider(providers);
      if (!provider) {
        log.warn('[shared] No provider available for auto-chat');
        return;
      }

      for (const msg of unread) {
        log.info(`[shared] Auto-processing message from ${msg.from}: ${msg.content.substring(0, 60)}`);

        const persona = Persona.get(authorizedUsers[0]) || '';
        const systemPrompt = persona
          ? `${persona}\n\nEstás respondiendo automáticamente a un mensaje del bot "${msg.from}". Sé conciso y útil.`
          : `Eres ${SharedMemory.botName}. Responde al mensaje del bot "${msg.from}". Sé conciso y útil. Responde en español.`;

        const result = await provider.execute(msg.content, {
          systemPrompt,
          userId: 'auto-chat',
        });

        if (result.ok && result.output) {
          // Reply back to the sender
          SharedMemory.sendMessage(msg.from, `[Re: "${msg.content.substring(0, 80)}"]\n\n${result.output}`);
          log.info(`[shared] Auto-reply to ${msg.from}: ${result.output.substring(0, 60)}`);

          // Show exchange on screen
          await notifyUsers(
            `🤖↔🤖 Chat con ${msg.from}:\n\n` +
            `📨 ${msg.from}: "${msg.content.substring(0, 300)}"\n\n` +
            `💬 ${SharedMemory.botName}: "${result.output.substring(0, 300)}"`
          );

          // Learn from bot-to-bot exchange: extract insights from peer's message AND our reply
          if (msg.content.length + result.output.length > 100) {
            extractInsight(msg.content, result.output, providers, 'auto-chat').catch(() => {});
          }
        }

        SharedMemory.markRead(msg.id);
      }
    } catch (err) {
      log.error(`[shared] Auto-chat error: ${sanitizeError(err.message)}`);
    }
  }, 30_000);

  return interval;
}
