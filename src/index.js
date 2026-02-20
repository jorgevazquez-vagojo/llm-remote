import { config } from './utils/config.js';
import { log } from './utils/logger.js';
import { initAudit, closeAudit } from './security/audit.js';
import { createBot } from './bot.js';

async function main() {
  log.info('Claude Remote starting...');

  // Init encrypted audit log
  initAudit();
  log.info('Audit log initialized');

  // Create and start bot
  const bot = createBot();

  // Graceful shutdown
  const shutdown = async (signal) => {
    log.info(`Received ${signal}, shutting down...`);
    bot.stop();
    closeAudit();
    process.exit(0);
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  // Start
  await bot.start({
    onStart: () => {
      log.info('Bot started successfully');
      log.info(`Authorized users: ${config.auth.authorizedUsers.join(', ')}`);
      log.info(`Session timeout: ${config.auth.sessionTimeoutMs / 60000} min`);
      log.info(`Rate limit: ${config.security.rateLimitPerMin}/min`);
      log.info(`Default work dir: ${config.claude.defaultWorkDir}`);
    },
  });
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
