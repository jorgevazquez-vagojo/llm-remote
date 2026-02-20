import { config } from '../utils/config.js';
import { log } from '../utils/logger.js';

// Failed auth attempt tracking for brute-force protection
const failedAttempts = new Map();
const MAX_FAILED = 5;
const BASE_LOCKOUT_MS = 15 * 60 * 1000; // 15 min base lockout
const MAX_LOCKOUT_MS = 24 * 60 * 60 * 1000; // 24h max lockout

export function guardMiddleware(sessionManager) {
  return async (ctx, next) => {
    const userId = ctx.from?.id;
    if (!userId) return;

    // Check user is in whitelist
    if (!config.auth.authorizedUsers.includes(userId)) {
      // In groups, silently ignore unauthorized users
      // In private chat, also silent — don't reveal the bot exists
      if (ctx.chat?.type === 'private') {
        log.warn(`Usuario no autorizado bloqueado: ${userId} (@${ctx.from.username || 'desconocido'})`);
      }
      return;
    }

    // In groups: only respond to commands, mentions, or replies to the bot
    if (ctx.chat?.type === 'group' || ctx.chat?.type === 'supergroup') {
      const text = ctx.message?.text || ctx.message?.caption || '';
      const botMentioned = text.includes(`@${ctx.me?.username}`) ||
                           ctx.message?.reply_to_message?.from?.id === ctx.me?.id;
      const isCommand = text.startsWith('/');
      const isVoice = ctx.message?.voice || ctx.message?.audio;
      const isPhoto = ctx.message?.photo;
      const isDocument = ctx.message?.document;

      // In groups only process: commands, bot mentions, replies to bot, or media
      if (!isCommand && !botMentioned && !isVoice && !isPhoto && !isDocument) {
        return; // Ignore regular group messages
      }

      // Strip bot mention from text for cleaner processing
      if (ctx.message?.text && ctx.me?.username) {
        ctx.message.text = ctx.message.text.replace(`@${ctx.me.username}`, '').trim();
      }
    }

    // Check brute-force lockout
    const attempts = failedAttempts.get(userId);
    if (attempts && attempts.count >= MAX_FAILED) {
      // Exponential backoff: 15min, 30min, 1h, 2h, ... up to 24h
      const lockoutMultiplier = Math.pow(2, Math.floor((attempts.count - MAX_FAILED) / MAX_FAILED));
      const lockoutMs = Math.min(BASE_LOCKOUT_MS * lockoutMultiplier, MAX_LOCKOUT_MS);
      const elapsed = Date.now() - attempts.lastAttempt;

      if (elapsed < lockoutMs) {
        const remaining = Math.ceil((lockoutMs - elapsed) / 60000);
        await ctx.reply(`🔒 Bloqueado por intentos fallidos. Intenta en ${remaining} min.`);
        return;
      }
      // Don't reset completely — keep count for exponential backoff
    }

    // Allow /start and /auth without session
    const text = ctx.message?.text || '';
    if (text.startsWith('/start') || text.startsWith('/auth ')) {
      await next();
      return;
    }

    // Check authenticated session
    if (!sessionManager.isAuthenticated(userId)) {
      await ctx.reply('🔐 Sesión expirada o no autenticada.\nUsa /auth <PIN> para autenticarte.');
      return;
    }

    sessionManager.touch(userId);
    await next();
  };
}

export function recordFailedAuth(userId) {
  const attempts = failedAttempts.get(userId) || { count: 0, lastAttempt: 0 };
  attempts.count++;
  attempts.lastAttempt = Date.now();
  failedAttempts.set(userId, attempts);
  return attempts.count;
}

export function clearFailedAuth(userId) {
  failedAttempts.delete(userId);
}
