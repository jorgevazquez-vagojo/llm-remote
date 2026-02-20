/**
 * Shared memory between bot instances.
 * Uses a shared volume (/shared) mounted in both containers.
 * Atomic writes: write temp → rename (atomic on Linux).
 * No caching: reads from disk each time (peer may have written).
 *
 * Env vars:
 *   BOT_NAME        — this bot's identifier (e.g., "jorge", "isa")
 *   PEER_BOT_NAME   — peer bot's identifier (empty = disabled)
 *   SHARED_DATA_DIR — path to shared directory (default: /shared)
 *   INTER_BOT_AUTO  — "true" to enable autonomous inter-bot chat
 */
import { readFileSync, writeFileSync, renameSync, existsSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { randomBytes } from 'node:crypto';
import { config } from '../utils/config.js';
import { log } from '../utils/logger.js';

const SHARED_DIR = config.shared.dataDir || '/shared';
const MEMORY_FILE = resolve(SHARED_DIR, 'memory.json');
const BOT_NAME = config.shared.botName;
const PEER_NAME = config.shared.peerBotName;
const MAX_INSIGHTS = 200;
const MAX_MESSAGES = 500;

function ensureDir() {
  if (!existsSync(SHARED_DIR)) {
    try { mkdirSync(SHARED_DIR, { recursive: true }); } catch {}
  }
}

function readMemory() {
  try {
    if (existsSync(MEMORY_FILE)) {
      return JSON.parse(readFileSync(MEMORY_FILE, 'utf-8'));
    }
  } catch (err) {
    log.warn(`[shared] Read failed: ${err.message}`);
  }
  return { insights: [], messages: [] };
}

function writeMemory(data) {
  ensureDir();
  const tmp = MEMORY_FILE + '.' + randomBytes(4).toString('hex') + '.tmp';
  try {
    writeFileSync(tmp, JSON.stringify(data, null, 2));
    renameSync(tmp, MEMORY_FILE);
  } catch (err) {
    log.error(`[shared] Write failed: ${err.message}`);
    try { if (existsSync(tmp)) writeFileSync(tmp, ''); } catch {}
  }
}

function genId() {
  return `${BOT_NAME}_${Date.now()}_${randomBytes(3).toString('hex')}`;
}

export class SharedMemory {
  /**
   * Check if shared memory is enabled (both BOT_NAME and SHARED_DATA_DIR set).
   */
  static get enabled() {
    return !!(BOT_NAME && config.shared.dataDir);
  }

  /**
   * Check if peer communication is enabled.
   */
  static get peerEnabled() {
    return this.enabled && !!PEER_NAME;
  }

  /**
   * Check if autonomous inter-bot chat is enabled.
   */
  static get autoChat() {
    return this.peerEnabled && config.shared.autoChat;
  }

  /**
   * Save a learning/insight to shared memory.
   * @param {string} topic — category (e.g., "kubernetes", "finance")
   * @param {string} content — the insight text
   */
  static addInsight(topic, content) {
    if (!this.enabled) return null;

    const data = readMemory();
    const insight = {
      id: genId(),
      from: BOT_NAME,
      topic: topic.toLowerCase().trim(),
      content: content.trim(),
      timestamp: new Date().toISOString(),
    };

    data.insights.push(insight);

    // Trim oldest if over limit
    while (data.insights.length > MAX_INSIGHTS) {
      data.insights.shift();
    }

    writeMemory(data);
    log.info(`[shared] Insight saved: ${topic} (${content.substring(0, 60)})`);
    return insight;
  }

  /**
   * Get recent insights from ALL bots.
   * @param {number} limit
   */
  static getInsights(limit = 20) {
    if (!this.enabled) return [];
    const data = readMemory();
    return data.insights.slice(-limit);
  }

  /**
   * Get insights from a specific bot.
   * @param {string} botName
   * @param {number} limit
   */
  static getInsightsFrom(botName, limit = 20) {
    if (!this.enabled) return [];
    const data = readMemory();
    return data.insights.filter(i => i.from === botName).slice(-limit);
  }

  /**
   * Get insights from the peer bot (the other bot).
   * @param {number} limit
   */
  static getPeerInsights(limit = 20) {
    if (!this.peerEnabled) return [];
    return this.getInsightsFrom(PEER_NAME, limit);
  }

  /**
   * Send a message to a specific bot.
   * @param {string} toBotName — recipient bot name
   * @param {string} content — message text
   */
  static sendMessage(toBotName, content) {
    if (!this.enabled) return null;

    const data = readMemory();
    const message = {
      id: genId(),
      from: BOT_NAME,
      to: toBotName,
      content: content.trim(),
      read: false,
      timestamp: new Date().toISOString(),
    };

    data.messages.push(message);

    while (data.messages.length > MAX_MESSAGES) {
      data.messages.shift();
    }

    writeMemory(data);
    log.info(`[shared] Message sent to ${toBotName}: ${content.substring(0, 60)}`);
    return message;
  }

  /**
   * Send a message to the peer bot.
   * @param {string} content
   */
  static sendToPeer(content) {
    if (!this.peerEnabled) return null;
    return this.sendMessage(PEER_NAME, content);
  }

  /**
   * Get unread messages addressed to THIS bot.
   */
  static getUnreadMessages() {
    if (!this.enabled) return [];
    const data = readMemory();
    return data.messages.filter(m => m.to === BOT_NAME && !m.read);
  }

  /**
   * Get all messages for THIS bot (read + unread).
   * @param {number} limit
   */
  static getMessages(limit = 20) {
    if (!this.enabled) return [];
    const data = readMemory();
    return data.messages
      .filter(m => m.to === BOT_NAME || m.from === BOT_NAME)
      .slice(-limit);
  }

  /**
   * Mark a message as read.
   * @param {string} messageId
   */
  static markRead(messageId) {
    if (!this.enabled) return;
    const data = readMemory();
    const msg = data.messages.find(m => m.id === messageId);
    if (msg) {
      msg.read = true;
      writeMemory(data);
    }
  }

  /**
   * Mark all unread messages for this bot as read.
   */
  static markAllRead() {
    if (!this.enabled) return;
    const data = readMemory();
    let changed = false;
    for (const msg of data.messages) {
      if (msg.to === BOT_NAME && !msg.read) {
        msg.read = true;
        changed = true;
      }
    }
    if (changed) writeMemory(data);
  }

  /**
   * Build context string to inject into the system prompt.
   * Includes peer insights and unread message count.
   */
  static getContext() {
    if (!this.peerEnabled) return '';

    const peerInsights = this.getPeerInsights(10);
    const unread = this.getUnreadMessages();

    const parts = [];

    if (peerInsights.length > 0) {
      parts.push(`[Conocimiento compartido por ${PEER_NAME}:]`);
      for (const insight of peerInsights.slice(-5)) {
        parts.push(`- [${insight.topic}] ${insight.content}`);
      }
    }

    if (unread.length > 0) {
      parts.push(`\n[${unread.length} mensaje(s) pendiente(s) de ${PEER_NAME}]`);
      for (const msg of unread.slice(-3)) {
        parts.push(`- "${msg.content.substring(0, 200)}"`);
      }
    }

    return parts.length > 0 ? '\n\n' + parts.join('\n') : '';
  }

  /**
   * Get summary for /memoria command display.
   */
  static getSummary() {
    if (!this.enabled) return 'Memoria compartida no configurada (BOT_NAME y SHARED_DATA_DIR requeridos).';

    const data = readMemory();
    const myInsights = data.insights.filter(i => i.from === BOT_NAME).length;
    const peerInsights = PEER_NAME ? data.insights.filter(i => i.from === PEER_NAME).length : 0;
    const unread = data.messages.filter(m => m.to === BOT_NAME && !m.read).length;
    const totalMsgs = data.messages.filter(m => m.to === BOT_NAME || m.from === BOT_NAME).length;

    const lines = [
      `🧠 Memoria Compartida`,
      `Bot: ${BOT_NAME}${PEER_NAME ? ` ↔ ${PEER_NAME}` : ''}`,
      `📚 Insights míos: ${myInsights}`,
    ];

    if (PEER_NAME) {
      lines.push(`📚 Insights de ${PEER_NAME}: ${peerInsights}`);
      lines.push(`💬 Mensajes: ${totalMsgs} (${unread} sin leer)`);
      lines.push(`🤖 Auto-chat: ${config.shared.autoChat ? 'ON' : 'OFF'}`);
    }

    return lines.join('\n');
  }

  /**
   * Get this bot's name.
   */
  static get botName() { return BOT_NAME; }

  /**
   * Get peer bot's name.
   */
  static get peerName() { return PEER_NAME; }
}
