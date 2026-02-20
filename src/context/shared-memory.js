/**
 * Shared memory between bot instances.
 * Uses a shared volume (/shared) mounted in all participating containers.
 * Atomic writes: write temp → rename (atomic on Linux).
 * No caching: reads from disk each time (peers may have written).
 *
 * Env vars:
 *   BOT_NAME         — this bot's identifier (e.g., "jorge", "isa")
 *   PEER_BOT_NAMES   — comma-separated peer names (e.g., "isa,carlos")
 *                      Each bot chooses who it talks to. Empty = no peers.
 *   SHARED_DATA_DIR  — path to shared directory (default: /shared)
 *   INTER_BOT_AUTO   — "true" = bots talk autonomously without human intervention
 */
import { readFileSync, writeFileSync, renameSync, existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import { config } from '../utils/config.js';
import { log } from '../utils/logger.js';

const SHARED_DIR = config.shared.dataDir || '/shared';
const MEMORY_FILE = resolve(SHARED_DIR, 'memory.json');
const BOT_NAME = config.shared.botName;
const PEERS = config.shared.peerBotNames; // string[]
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
   * Check if peer communication is enabled (at least one peer configured).
   */
  static get peerEnabled() {
    return this.enabled && PEERS.length > 0;
  }

  /**
   * Check if autonomous inter-bot chat is enabled.
   */
  static get autoChat() {
    return this.peerEnabled && config.shared.autoChat;
  }

  /**
   * Check if a bot name is a configured peer.
   */
  static isPeer(name) {
    return PEERS.includes(name?.toLowerCase());
  }

  /**
   * Save a learning/insight to shared memory.
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
    while (data.insights.length > MAX_INSIGHTS) data.insights.shift();

    writeMemory(data);
    log.info(`[shared] Insight saved: ${topic} (${content.substring(0, 60)})`);
    return insight;
  }

  /**
   * Get recent insights from ALL bots.
   */
  static getInsights(limit = 20) {
    if (!this.enabled) return [];
    return readMemory().insights.slice(-limit);
  }

  /**
   * Get insights from a specific bot.
   */
  static getInsightsFrom(botName, limit = 20) {
    if (!this.enabled) return [];
    return readMemory().insights.filter(i => i.from === botName).slice(-limit);
  }

  /**
   * Get insights from all configured peers.
   */
  static getPeerInsights(limit = 20) {
    if (!this.peerEnabled) return [];
    return readMemory().insights
      .filter(i => PEERS.includes(i.from))
      .slice(-limit);
  }

  /**
   * Send a message to a specific bot.
   */
  static sendMessage(toBotName, content) {
    if (!this.enabled) return null;

    const data = readMemory();
    const message = {
      id: genId(),
      from: BOT_NAME,
      to: toBotName.toLowerCase(),
      content: content.trim(),
      read: false,
      timestamp: new Date().toISOString(),
    };

    data.messages.push(message);
    while (data.messages.length > MAX_MESSAGES) data.messages.shift();

    writeMemory(data);
    log.info(`[shared] Message sent to ${toBotName}: ${content.substring(0, 60)}`);
    return message;
  }

  /**
   * Send a message to all peers.
   */
  static sendToAllPeers(content) {
    if (!this.peerEnabled) return [];
    return PEERS.map(peer => this.sendMessage(peer, content));
  }

  /**
   * Get unread messages addressed to THIS bot (from any peer).
   */
  static getUnreadMessages() {
    if (!this.enabled) return [];
    return readMemory().messages.filter(m => m.to === BOT_NAME && !m.read);
  }

  /**
   * Get all messages involving THIS bot (sent or received).
   */
  static getMessages(limit = 20) {
    if (!this.enabled) return [];
    return readMemory().messages
      .filter(m => m.to === BOT_NAME || m.from === BOT_NAME)
      .slice(-limit);
  }

  /**
   * Mark a message as read.
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
   * Includes insights from all peers and unread message count.
   */
  static getContext() {
    if (!this.peerEnabled) return '';

    const peerInsights = this.getPeerInsights(10);
    const unread = this.getUnreadMessages();

    const parts = [];

    if (peerInsights.length > 0) {
      parts.push(`[Conocimiento compartido por peers (${PEERS.join(', ')}):]`);
      for (const insight of peerInsights.slice(-5)) {
        parts.push(`- [${insight.from}/${insight.topic}] ${insight.content}`);
      }
    }

    if (unread.length > 0) {
      // Group by sender
      const bySender = {};
      for (const msg of unread) {
        if (!bySender[msg.from]) bySender[msg.from] = [];
        bySender[msg.from].push(msg);
      }
      for (const [sender, msgs] of Object.entries(bySender)) {
        parts.push(`\n[${msgs.length} mensaje(s) pendiente(s) de ${sender}]`);
        for (const msg of msgs.slice(-2)) {
          parts.push(`- "${msg.content.substring(0, 200)}"`);
        }
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
    const unread = data.messages.filter(m => m.to === BOT_NAME && !m.read).length;
    const totalMsgs = data.messages.filter(m => m.to === BOT_NAME || m.from === BOT_NAME).length;

    const lines = [
      `🧠 Memoria Compartida`,
      `Bot: ${BOT_NAME}`,
      `📚 Insights míos: ${myInsights}`,
    ];

    if (PEERS.length > 0) {
      lines.push(`🔗 Peers: ${PEERS.join(', ')}`);
      for (const peer of PEERS) {
        const peerCount = data.insights.filter(i => i.from === peer).length;
        lines.push(`  📚 ${peer}: ${peerCount} insights`);
      }
      lines.push(`💬 Mensajes: ${totalMsgs} (${unread} sin leer)`);
      lines.push(`🤖 Auto-chat: ${config.shared.autoChat ? 'ON' : 'OFF'}`);
    }

    return lines.join('\n');
  }

  /**
   * Get new peer insights since the last check (for notifications).
   * Tracks last seen insight per peer in memory.json metadata.
   */
  static getNewPeerInsights() {
    if (!this.peerEnabled) return [];
    const data = readMemory();
    if (!data.meta) data.meta = {};
    const lastSeen = data.meta[`${BOT_NAME}_lastInsightCheck`] || '';

    const peerInsights = data.insights.filter(i => PEERS.includes(i.from));
    if (peerInsights.length === 0) return [];

    // Find insights newer than lastSeen
    const lastIdx = lastSeen ? peerInsights.findIndex(i => i.id === lastSeen) : -1;
    const newInsights = peerInsights.slice(lastIdx + 1);

    if (newInsights.length > 0) {
      data.meta[`${BOT_NAME}_lastInsightCheck`] = newInsights[newInsights.length - 1].id;
      writeMemory(data);
    }

    return newInsights;
  }

  static get botName() { return BOT_NAME; }
  static get peerNames() { return PEERS; }
  /** @deprecated Use peerNames instead */
  static get peerName() { return PEERS[0] || ''; }
}
