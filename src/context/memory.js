/**
 * Conversation memory manager.
 * Stores per-user conversation history for contextual multi-turn chat.
 */

const MAX_MESSAGES = 20; // Max messages per user
const conversations = new Map(); // userId -> [{ role, content, timestamp }]

export class ConversationMemory {
  static add(userId, role, content) {
    if (!conversations.has(userId)) {
      conversations.set(userId, []);
    }
    const history = conversations.get(userId);
    history.push({ role, content, timestamp: Date.now() });

    // Trim to max
    while (history.length > MAX_MESSAGES) {
      history.shift();
    }
  }

  static get(userId) {
    return conversations.get(userId) || [];
  }

  static getForProvider(userId) {
    return this.get(userId).map(({ role, content }) => ({ role, content }));
  }

  static clear(userId) {
    conversations.delete(userId);
  }

  static getStats(userId) {
    const history = this.get(userId);
    return {
      messages: history.length,
      maxMessages: MAX_MESSAGES,
    };
  }
}
