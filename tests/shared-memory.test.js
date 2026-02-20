// Set env vars BEFORE importing modules (config reads at import time)
process.env.BOT_NAME = 'testbot';
process.env.PEER_BOT_NAME = 'peerbot';
process.env.SHARED_DATA_DIR = '/tmp/shared-memory-test-' + Date.now();

import { describe, it, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Dynamic import to ensure env vars are loaded first
const { SharedMemory } = await import('../src/context/shared-memory.js');

const SHARED_DIR = process.env.SHARED_DATA_DIR;
const MEMORY_FILE = resolve(SHARED_DIR, 'memory.json');

describe('SharedMemory', () => {
  beforeEach(() => {
    if (existsSync(MEMORY_FILE)) {
      rmSync(MEMORY_FILE);
    }
  });

  after(() => {
    if (existsSync(SHARED_DIR)) {
      rmSync(SHARED_DIR, { recursive: true, force: true });
    }
  });

  it('reports enabled when BOT_NAME and SHARED_DATA_DIR are set', () => {
    assert.equal(SharedMemory.enabled, true);
  });

  it('reports peerEnabled when PEER_BOT_NAME is set', () => {
    assert.equal(SharedMemory.peerEnabled, true);
  });

  it('returns correct bot and peer names', () => {
    assert.equal(SharedMemory.botName, 'testbot');
    assert.equal(SharedMemory.peerName, 'peerbot');
  });

  it('adds and retrieves insights', () => {
    const insight = SharedMemory.addInsight('finance', 'Bitcoin hit 100k USD');
    assert.ok(insight);
    assert.equal(insight.from, 'testbot');
    assert.equal(insight.topic, 'finance');
    assert.ok(insight.id.startsWith('testbot_'));

    const insights = SharedMemory.getInsights();
    assert.equal(insights.length, 1);
    assert.equal(insights[0].content, 'Bitcoin hit 100k USD');
  });

  it('filters insights by bot name', () => {
    SharedMemory.addInsight('topic1', 'From testbot');

    const myInsights = SharedMemory.getInsightsFrom('testbot');
    assert.equal(myInsights.length, 1);

    const peerInsights = SharedMemory.getInsightsFrom('peerbot');
    assert.equal(peerInsights.length, 0);
  });

  it('sends and receives messages', () => {
    const msg = SharedMemory.sendToPeer('Hello peerbot!');
    assert.ok(msg);
    assert.equal(msg.from, 'testbot');
    assert.equal(msg.to, 'peerbot');
    assert.equal(msg.read, false);

    // This bot sent the message TO peerbot, so getUnreadMessages (for THIS bot) returns nothing
    const unread = SharedMemory.getUnreadMessages();
    assert.equal(unread.length, 0);

    // But getMessages should include it (sent by this bot)
    const all = SharedMemory.getMessages();
    assert.equal(all.length, 1);
  });

  it('marks messages as read', () => {
    // Create a message addressed TO testbot by writing directly
    SharedMemory.addInsight('init', 'setup'); // ensure file exists
    const data = JSON.parse(readFileSync(MEMORY_FILE, 'utf-8'));
    data.messages.push({
      id: 'peerbot_123',
      from: 'peerbot',
      to: 'testbot',
      content: 'Hey testbot!',
      read: false,
      timestamp: new Date().toISOString(),
    });
    writeFileSync(MEMORY_FILE, JSON.stringify(data));

    const unread = SharedMemory.getUnreadMessages();
    assert.equal(unread.length, 1);
    assert.equal(unread[0].content, 'Hey testbot!');

    SharedMemory.markRead('peerbot_123');
    const afterMark = SharedMemory.getUnreadMessages();
    assert.equal(afterMark.length, 0);
  });

  it('markAllRead clears all unread messages', () => {
    SharedMemory.addInsight('init', 'setup'); // ensure file exists
    const data = JSON.parse(readFileSync(MEMORY_FILE, 'utf-8'));
    data.messages.push(
      { id: 'p1', from: 'peerbot', to: 'testbot', content: 'msg1', read: false, timestamp: new Date().toISOString() },
      { id: 'p2', from: 'peerbot', to: 'testbot', content: 'msg2', read: false, timestamp: new Date().toISOString() }
    );
    writeFileSync(MEMORY_FILE, JSON.stringify(data));

    assert.equal(SharedMemory.getUnreadMessages().length, 2);
    SharedMemory.markAllRead();
    assert.equal(SharedMemory.getUnreadMessages().length, 0);
  });

  it('getContext returns formatted string with peer insights', () => {
    SharedMemory.addInsight('init', 'setup'); // ensure file exists
    const data = JSON.parse(readFileSync(MEMORY_FILE, 'utf-8'));
    data.insights.push({
      id: 'peerbot_456',
      from: 'peerbot',
      topic: 'stocks',
      content: 'Inditex up 5%',
      timestamp: new Date().toISOString(),
    });
    writeFileSync(MEMORY_FILE, JSON.stringify(data));

    const context = SharedMemory.getContext();
    assert.ok(context.includes('peerbot'));
    assert.ok(context.includes('Inditex up 5%'));
  });

  it('getSummary returns formatted status', () => {
    SharedMemory.addInsight('test', 'A test insight');
    const summary = SharedMemory.getSummary();
    assert.ok(summary.includes('testbot'));
    assert.ok(summary.includes('peerbot'));
    assert.ok(summary.includes('Insights'));
  });
});
