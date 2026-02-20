import { config } from '../utils/config.js';
import { log } from '../utils/logger.js';

// Failed auth attempt tracking for brute-force protection
const failedAttempts = new Map();
const MAX_FAILED = 5;
const LOCKOUT_MS = 15 * 60 * 1000; // 15 min lockout

export function guardMiddleware(sessionManager) {
  return async (ctx, next) => {
    const userId = ctx.from?.id;
    if (!userId) return;

    // Check user is in whitelist
    if (!config.auth.authorizedUsers.includes(userId)) {
      log.warn(`Blocked unauthorized user: ${userId} (@${ctx.from.username || 'unknown'})`);
      // Silent ignore — don't reveal bot exists to unauthorized users
      return;
    }

    // Check brute-force lockout
    const attempts = failedAttempts.get(userId);
    if (attempts && attempts.count >= MAX_FAILED) {
      const elapsed = Date.now() - attempts.lastAttempt;
      if (elapsed < LOCKOUT_MS) {
        const remaining = Math.ceil((LOCKOUT_MS - elapsed) / 60000);
        await ctx.reply(`🔒 Locked out. Try again in ${remaining} min.`);
        return;
      }
      failedAttempts.delete(userId);
    }

    // Allow /start and /auth without session
    const text = ctx.message?.text || '';
    if (text.startsWith('/start') || text.startsWith('/auth ')) {
      await next();
      return;
    }

    // Check authenticated session
    if (!sessionManager.isAuthenticated(userId)) {
      await ctx.reply('🔐 Session expired or not authenticated.\nUse /auth <PIN> to authenticate.');
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
