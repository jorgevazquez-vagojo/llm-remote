import { appendFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import { config } from '../utils/config.js';
import { Cipher } from '../crypto/cipher.js';

let cipher;
let auditPath;

export function initAudit() {
  mkdirSync(config.paths.data, { recursive: true });
  cipher = new Cipher(config.crypto.masterPassword);
  auditPath = config.paths.db.replace('.db', '.log');
}

export function logAudit(userId, action, data = null) {
  const entry = {
    t: new Date().toISOString(),
    u: cipher.hash(String(userId)),
    a: action,
    d: data,
  };

  const encrypted = cipher.encrypt(JSON.stringify(entry));
  appendFileSync(auditPath, encrypted + '\n', { mode: 0o600 });
}

export function queryAudit(userId, limit = 20) {
  if (!existsSync(auditPath)) return [];

  const userHash = cipher.hash(String(userId));
  const lines = readFileSync(auditPath, 'utf8').trim().split('\n').filter(Boolean);

  const results = [];
  // Read from end for most recent
  for (let i = lines.length - 1; i >= 0 && results.length < limit; i--) {
    try {
      const entry = JSON.parse(cipher.decrypt(lines[i]));
      if (entry.u === userHash) {
        results.push({
          timestamp: entry.t,
          action: entry.a,
          data: entry.d,
        });
      }
    } catch {
      // Skip corrupted entries
    }
  }

  return results;
}

export function closeAudit() {
  // No-op for file-based audit
}
