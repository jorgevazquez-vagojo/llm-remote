import { config } from '../utils/config.js';
import { log } from '../utils/logger.js';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { timingSafeEqual } from 'node:crypto';

const sessions = new Map();
const SESSIONS_FILE = resolve(config.paths.data, 'sessions.json');

export class SessionManager {
  constructor() {
    this.#loadSessions();
  }

  authenticate(userId, pin) {
    if (!config.auth.authorizedUsers.includes(userId)) {
      return { ok: false, reason: 'unauthorized_user' };
    }

    // Constant-time comparison to prevent timing attacks
    const pinBuf = Buffer.from(String(pin));
    const expectedBuf = Buffer.from(String(config.auth.pin));
    if (pinBuf.length !== expectedBuf.length) {
      return { ok: false, reason: 'invalid_pin' };
    }
    if (!timingSafeEqual(pinBuf, expectedBuf)) {
      return { ok: false, reason: 'invalid_pin' };
    }

    sessions.set(userId, {
      authenticatedAt: Date.now(),
      lastActivity: Date.now(),
      workDir: config.claude.defaultWorkDir,
    });

    this.#saveSessions();
    return { ok: true };
  }

  isAuthenticated(userId) {
    const session = sessions.get(userId);
    if (!session) return false;

    const elapsed = Date.now() - session.lastActivity;
    if (elapsed > config.auth.sessionTimeoutMs) {
      sessions.delete(userId);
      this.#saveSessions();
      return false;
    }

    return true;
  }

  touch(userId) {
    const session = sessions.get(userId);
    if (session) {
      session.lastActivity = Date.now();
      // Save periodically (every 60s) to avoid excessive writes
      if (!this._lastSave || Date.now() - this._lastSave > 60_000) {
        this.#saveSessions();
      }
    }
  }

  lock(userId) {
    sessions.delete(userId);
    this.#saveSessions();
  }

  getWorkDir(userId) {
    return sessions.get(userId)?.workDir || config.claude.defaultWorkDir;
  }

  setWorkDir(userId, dir) {
    const session = sessions.get(userId);
    if (session) {
      session.workDir = dir;
      this.#saveSessions();
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
    this.#saveSessions();
  }

  /**
   * Get all currently authenticated user IDs.
   */
  getAuthenticatedUsers() {
    const active = [];
    for (const [userId, session] of sessions) {
      const elapsed = Date.now() - session.lastActivity;
      if (elapsed <= config.auth.sessionTimeoutMs) {
        active.push(userId);
      }
    }
    return active;
  }

  /**
   * Persist sessions to disk (encrypted would be ideal, but JSON is sufficient
   * since the data dir is inside the container and not exposed).
   */
  #saveSessions() {
    try {
      if (!existsSync(config.paths.data)) mkdirSync(config.paths.data, { recursive: true });
      const data = {};
      for (const [userId, session] of sessions) {
        data[userId] = session;
      }
      writeFileSync(SESSIONS_FILE, JSON.stringify(data));
      this._lastSave = Date.now();
    } catch (err) {
      log.warn(`[session] Save failed: ${err.message}`);
    }
  }

  /**
   * Load sessions from disk on startup.
   * Only restores sessions that haven't expired.
   */
  #loadSessions() {
    try {
      if (!existsSync(SESSIONS_FILE)) return;
      const data = JSON.parse(readFileSync(SESSIONS_FILE, 'utf-8'));
      const now = Date.now();
      let restored = 0;
      for (const [userId, session] of Object.entries(data)) {
        const elapsed = now - session.lastActivity;
        if (elapsed <= config.auth.sessionTimeoutMs) {
          sessions.set(parseInt(userId, 10), session);
          restored++;
        }
      }
      if (restored > 0) {
        log.info(`[session] Restored ${restored} active session(s) from disk`);
      }
    } catch (err) {
      log.warn(`[session] Load failed: ${err.message}`);
    }
  }
}
