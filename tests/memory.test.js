import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { ConversationMemory } from '../src/context/memory.js';

describe('ConversationMemory', () => {
  const userId = 12345;

  beforeEach(() => {
    ConversationMemory.clear(userId);
  });

  it('stores and retrieves messages', () => {
    ConversationMemory.add(userId, 'user', 'Hello');
    ConversationMemory.add(userId, 'assistant', 'Hi there');

    const history = ConversationMemory.get(userId);
    assert.equal(history.length, 2);
    assert.equal(history[0].role, 'user');
    assert.equal(history[0].content, 'Hello');
    assert.equal(history[1].role, 'assistant');
  });

  it('returns empty array for unknown user', () => {
    const history = ConversationMemory.get(99999);
    assert.deepEqual(history, []);
  });

  it('clears messages for a user', () => {
    ConversationMemory.add(userId, 'user', 'test');
    ConversationMemory.clear(userId);
    assert.equal(ConversationMemory.get(userId).length, 0);
  });

  it('limits to max messages (20)', () => {
    for (let i = 0; i < 25; i++) {
      ConversationMemory.add(userId, 'user', `msg-${i}`);
    }
    const history = ConversationMemory.get(userId);
    assert.equal(history.length, 20);
    assert.equal(history[0].content, 'msg-5'); // First 5 trimmed
    assert.equal(history[19].content, 'msg-24');
  });

  it('getForProvider strips timestamps', () => {
    ConversationMemory.add(userId, 'user', 'hello');
    const forProvider = ConversationMemory.getForProvider(userId);
    assert.equal(forProvider.length, 1);
    assert.equal(forProvider[0].role, 'user');
    assert.equal(forProvider[0].content, 'hello');
    assert.equal(forProvider[0].timestamp, undefined);
  });

  it('getStats returns correct counts', () => {
    ConversationMemory.add(userId, 'user', 'a');
    ConversationMemory.add(userId, 'assistant', 'b');
    const stats = ConversationMemory.getStats(userId);
    assert.equal(stats.messages, 2);
    assert.equal(stats.maxMessages, 20);
  });

  it('isolates users', () => {
    ConversationMemory.add(111, 'user', 'user-111');
    ConversationMemory.add(222, 'user', 'user-222');
    assert.equal(ConversationMemory.get(111).length, 1);
    assert.equal(ConversationMemory.get(222).length, 1);
    assert.equal(ConversationMemory.get(111)[0].content, 'user-111');
  });
});
