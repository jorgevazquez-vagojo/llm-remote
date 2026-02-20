import { config } from './utils/config.js';
import { log } from './utils/logger.js';
import { initAudit, closeAudit } from './security/audit.js';
import { createBot } from './bot.js';
import { Scheduler } from './scheduler/scheduler.js';
import { MCPManager } from './mcp/client.js';
import { SharedMemory } from './context/shared-memory.js';

async function main() {
  log.info('LLM Remote v2.4 iniciando...');

  // Inicializar audit log cifrado
  initAudit();
  log.info('Audit log inicializado');

  if (SharedMemory.enabled) {
    log.info(`[shared] Bot: ${SharedMemory.botName}, Peers: ${SharedMemory.peerNames.join(', ') || 'ninguno'}, Auto: ${SharedMemory.autoChat}`);
  }

  // Crear y arrancar bot
  const { bot, sessionManager } = createBot();

  // Apagado limpio
  const shutdown = async (signal) => {
    log.info(`Señal ${signal} recibida, apagando...`);
    if (bot._autoChatInterval) clearInterval(bot._autoChatInterval);
    Scheduler.stop();
    MCPManager.stopAll();
    bot.stop();
    closeAudit();
    process.exit(0);
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  // Arrancar
  await bot.start({
    onStart: async () => {
      log.info('Bot arrancado correctamente');
      log.info(`Usuarios autorizados: ${config.auth.authorizedUsers.join(', ')}`);
      log.info(`Timeout de sesión: ${config.auth.sessionTimeoutMs / 60000} min`);
      log.info(`Límite de comandos: ${config.security.rateLimitPerMin}/min`);
      log.info(`Directorio por defecto: ${config.claude.defaultWorkDir}`);

      if (SharedMemory.autoChat) {
        log.info(`[shared] Auto-chat loop running (check every 30s)`);
      }

      // Notify authorized users that the bot has restarted
      for (const userId of config.auth.authorizedUsers) {
        try {
          const isRestored = sessionManager.isAuthenticated(userId);
          const botName = SharedMemory.botName || 'LLM Remote';
          if (isRestored) {
            await bot.api.sendMessage(userId,
              `🔄 ${botName} reiniciado.\n✅ Tu sesión ha sido restaurada automáticamente.\n\nEscribe algo para continuar.`
            );
          } else {
            await bot.api.sendMessage(userId,
              `🔄 ${botName} reiniciado.\n🔐 Sesión expirada. Usa /auth <PIN> para autenticarte.`
            );
          }
        } catch (err) {
          log.debug(`[notify] Could not notify user ${userId}: ${err.message}`);
        }
      }
    },
  });
}

main().catch((err) => {
  console.error('Error fatal:', err);
  process.exit(1);
});
