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
import { existsSync } from 'node:fs';

export function createBot() {
  const bot = new Bot(config.telegram.token);
  const sessionManager = new SessionManager();
  const providers = new ProviderManager();

  // Init scheduler and MCP
  Scheduler.init(bot, providers);
  MCPManager.loadConfig().catch(err => log.warn(`[mcp] Init: ${err.message}`));

  // Global middleware: auth guard
  bot.use(guardMiddleware(sessionManager));

  // /start
  bot.command('start', async (ctx) => {
    const configured = providers.listConfigured();
    const providerList = configured.map(p => `  ${p.displayName}`).join('\n');

    await ctx.reply(
      '🤖 LLM Remote v2.0 — Telegram ↔ IA Bridge\n\n' +
      'Autenticarse: /auth <PIN>\n\n' +
      '📝 Comandos básicos:\n' +
      '  /ask <prompt> — Enviar prompt\n' +
      '  /ia — Cambiar proveedor IA\n' +
      '  /clear — Limpiar contexto\n' +
      '  /project <ruta> — Cambiar directorio\n' +
      '  /status — Info de sesión\n\n' +
      '🆕 Nuevas funciones:\n' +
      '  🎤 Envía un audio → transcripción + IA\n' +
      '  📷 Envía una foto → análisis visual\n' +
      '  📎 Envía un archivo → análisis de contenido\n' +
      '  /web <query> — Búsqueda web + resumen\n' +
      '  /schedule <intervalo> <prompt> — Tareas programadas\n' +
      '  /pipe paso1 → paso2 → paso3 — Pipelines\n' +
      '  /mcp — Servidores MCP\n\n' +
      `Proveedores:\n${providerList}`
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
      await ctx.reply(
        '✅ Sesión iniciada.\n' +
        `📁 Directorio: ${sessionManager.getWorkDir(ctx.from.id)}\n` +
        `🤖 Proveedor: ${provider.displayName}\n` +
        `⏱ Timeout: ${config.auth.sessionTimeoutMs / 60000} min\n\n` +
        'Escribe texto, envía audio 🎤, foto 📷 o archivo 📎'
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
        '\n\nUso: /ia <nombre>\nNombres: claude, openai, gemini, anthropic, groq'
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

    await ctx.reply(
      formatStatus(info) +
      `\n\n🤖 ${provider.displayName}\n${providerStatus}` +
      `\n💬 Contexto: ${memStats.messages}/${memStats.maxMessages} mensajes` +
      (schedules.length ? `\n⏰ Tareas programadas: ${schedules.length}` : '') +
      (mcpServers.length ? `\n🔌 MCP: ${mcpServers.filter(s => s.connected).length}/${mcpServers.length} conectados` : '')
    );
  });

  // /project <path>
  bot.command('project', async (ctx) => {
    const dir = ctx.match?.trim();
    if (!dir) {
      await ctx.reply(`📁 Actual: ${sessionManager.getWorkDir(ctx.from.id)}\n\nUso: /project <ruta>`);
      return;
    }
    if (!existsSync(dir)) { await ctx.reply(`❌ Directorio no encontrado: ${dir}`); return; }

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

      const summaryPrompt = `El usuario buscó "${query}". Resultados:\n\n${formatted}\n\nResume los resultados más relevantes en español. Incluye las URLs de las fuentes.`;

      const aiResult = await provider.execute(summaryPrompt, { workDir, userId: ctx.from.id, history });

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
      await ctx.reply(`❌ Error en búsqueda: ${err.message}`);
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
        await ctx.reply(`❌ Error conectando a ${name}: ${err.message}`);
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
        await ctx.reply(`❌ Error: ${err.message}`);
      }
    } else {
      await ctx.reply('Uso: /mcp add|remove|tools|call');
    }
  });

  // /help
  bot.command('help', async (ctx) => {
    await ctx.reply(
      '🤖 LLM Remote v2.0 — Comandos:\n\n' +
      '🔐 Sesión:\n' +
      '  /auth <PIN> — Autenticarse\n' +
      '  /lock — Bloquear sesión\n' +
      '  /status — Info de sesión\n' +
      '  /history — Historial cifrado\n\n' +
      '🤖 IA:\n' +
      '  /ask <prompt> — Enviar prompt\n' +
      '  /ia [nombre] — Ver/cambiar proveedor\n' +
      '  /clear — Limpiar contexto conversación\n' +
      '  /project <ruta> — Directorio de trabajo\n' +
      '  /kill — Parar proceso\n\n' +
      '🆕 Multimedia:\n' +
      '  🎤 Audio — Transcripción automática + IA\n' +
      '  📷 Foto — Análisis visual con IA\n' +
      '  📎 Archivo — Análisis de contenido\n\n' +
      '🔍 Herramientas:\n' +
      '  /web <query> — Búsqueda web + resumen IA\n' +
      '  /schedule <intervalo> <prompt> — Tarea programada\n' +
      '  /schedules — Ver tareas programadas\n' +
      '  /unschedule <id> — Eliminar tarea\n' +
      '  /pipe paso1 → paso2 — Pipeline\n' +
      '  /mcp — Servidores MCP\n\n' +
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

      ConversationMemory.add(ctx.from.id, 'user', transcription);
      logAudit(ctx.from.id, 'voice_prompt', { provider: providerName, prompt: transcription.substring(0, 200) });

      const result = await provider.execute(transcription, { workDir, userId: ctx.from.id, history });

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
      } else {
        await ctx.reply(`🎤 "${transcription.substring(0, 100)}"\n\n❌ Error: ${result.output?.substring(0, 500)}`);
      }
    } catch (err) {
      try { await ctx.api.deleteMessage(ctx.chat.id, statusMsg.message_id); } catch {}
      await ctx.reply(`❌ Error transcribiendo audio: ${err.message}`);
      log.error(`[voice] Error: ${err.message}`);
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
      await ctx.reply(`❌ Error analizando imagen: ${err.message}`);
      log.error(`[vision] Error: ${err.message}`);
    }
  });

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
        await ctx.reply(`❌ Error: ${err.message}`);
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

      const prompt = `El usuario envió el archivo "${fileName}":\n\n\`\`\`\n${content.substring(0, 10000)}\n\`\`\`\n\n${caption}`;

      ConversationMemory.add(ctx.from.id, 'user', `[archivo: ${fileName}] ${caption}`);
      logAudit(ctx.from.id, 'file_prompt', { provider: providerName, file: fileName });

      const result = await provider.execute(prompt, { workDir, userId: ctx.from.id, history });

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
      await ctx.reply(`❌ Error procesando archivo: ${err.message}`);
      log.error(`[files] Error: ${err.message}`);
    }
  });

  return bot;
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
