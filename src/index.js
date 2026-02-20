import { config } from './utils/config.js';
import { log } from './utils/logger.js';
import { initAudit, closeAudit } from './security/audit.js';
import { createBot } from './bot.js';

async function main() {
  log.info('Claude Remote iniciando...');

  // Inicializar audit log cifrado
  initAudit();
  log.info('Audit log inicializado');

  // Crear y arrancar bot
  const bot = createBot();

  // Apagado limpio
  const shutdown = async (signal) => {
    log.info(`Señal ${signal} recibida, apagando...`);
    bot.stop();
    closeAudit();
    process.exit(0);
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  // Arrancar
  await bot.start({
    onStart: () => {
      log.info('Bot arrancado correctamente');
      log.info(`Usuarios autorizados: ${config.auth.authorizedUsers.join(', ')}`);
      log.info(`Timeout de sesión: ${config.auth.sessionTimeoutMs / 60000} min`);
      log.info(`Límite de comandos: ${config.security.rateLimitPerMin}/min`);
      log.info(`Directorio por defecto: ${config.claude.defaultWorkDir}`);
    },
  });
}

main().catch((err) => {
  console.error('Error fatal:', err);
  process.exit(1);
});
