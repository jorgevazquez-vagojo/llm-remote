import { config } from '../utils/config.js';

const sessions = new Map();

export class SessionManager {
  authenticate(userId, pin) {
    if (!config.auth.authorizedUsers.includes(userId)) {
      return { ok: false, reason: 'unauthorized_user' };
    }

    // Constant-time comparison to prevent timing attacks
    const pinBuf = Buffer.from(pin);
    const expectedBuf = Buffer.from(config.auth.pin);
    if (pinBuf.length !== expectedBuf.length) {
      return { ok: false, reason: 'invalid_pin' };
    }
    let diff = 0;
    for (let i = 0; i < pinBuf.length; i++) {
      diff |= pinBuf[i] ^ expectedBuf[i];
    }
    if (diff !== 0) {
      return { ok: false, reason: 'invalid_pin' };
    }

    sessions.set(userId, {
      authenticatedAt: Date.now(),
      lastActivity: Date.now(),
      workDir: config.claude.defaultWorkDir,
    });

    return { ok: true };
  }

  isAuthenticated(userId) {
    const session = sessions.get(userId);
    if (!session) return false;

    const elapsed = Date.now() - session.lastActivity;
    if (elapsed > config.auth.sessionTimeoutMs) {
      sessions.delete(userId);
      return false;
    }

    return true;
  }

  touch(userId) {
    const session = sessions.get(userId);
    if (session) {
      session.lastActivity = Date.now();
    }
  }

  lock(userId) {
    sessions.delete(userId);
  }

  getWorkDir(userId) {
    return sessions.get(userId)?.workDir || config.claude.defaultWorkDir;
  }

  setWorkDir(userId, dir) {
    const session = sessions.get(userId);
    if (session) {
      session.workDir = dir;
    }
  }

  getInfo(userId) {
    const session = sessions.get(userId);
    if (!session) return null;

    const elapsed = Date.now() - session.lastActivity;
    const remaining = Math.max(0, config.auth.sessionTimeoutMs - elapsed);

    return {
      workDir: session.workDir,
      authenticatedAt: new Date(session.authenticatedAt).toISOString(),
      lastActivity: new Date(session.lastActivity).toISOString(),
      timeoutIn: `${Math.round(remaining / 60000)}min`,
    };
  }

  lockAll() {
    sessions.clear();
  }
}
