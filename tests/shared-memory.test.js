// Set env vars BEFORE importing modules (config reads at import time)
process.env.BOT_NAME = 'testbot';
process.env.PEER_BOT_NAMES = 'peerbot,otherbot';
process.env.SHARED_DATA_DIR = '/tmp/shared-memory-test-' + Date.now();

import { describe, it, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const { SharedMemory } = await import('../src/context/shared-memory.js');

const SHARED_DIR = process.env.SHARED_DATA_DIR;
const MEMORY_FILE = resolve(SHARED_DIR, 'memory.json');

describe('SharedMemory', () => {
  beforeEach(() => {
    if (existsSync(MEMORY_FILE)) rmSync(MEMORY_FILE);
  });

  after(() => {
    if (existsSync(SHARED_DIR)) rmSync(SHARED_DIR, { recursive: true, force: true });
  });

  it('reports enabled when BOT_NAME and SHARED_DATA_DIR are set', () => {
    assert.equal(SharedMemory.enabled, true);
  });

  it('reports peerEnabled when PEER_BOT_NAMES has entries', () => {
    assert.equal(SharedMemory.peerEnabled, true);
  });

  it('returns correct bot and peer names', () => {
    assert.equal(SharedMemory.botName, 'testbot');
    assert.deepEqual(SharedMemory.peerNames, ['peerbot', 'otherbot']);
  });

  it('isPeer checks against configured peers', () => {
    assert.equal(SharedMemory.isPeer('peerbot'), true);
    assert.equal(SharedMemory.isPeer('otherbot'), true);
    assert.equal(SharedMemory.isPeer('stranger'), false);
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
    assert.equal(SharedMemory.getInsightsFrom('testbot').length, 1);
    assert.equal(SharedMemory.getInsightsFrom('peerbot').length, 0);
  });

  it('getPeerInsights returns insights from all configured peers', () => {
    SharedMemory.addInsight('init', 'setup');
    const data = JSON.parse(readFileSync(MEMORY_FILE, 'utf-8'));
    data.insights.push(
      { id: 'peer1', from: 'peerbot', topic: 'a', content: 'insight A', timestamp: new Date().toISOString() },
      { id: 'other1', from: 'otherbot', topic: 'b', content: 'insight B', timestamp: new Date().toISOString() },
      { id: 'stranger1', from: 'stranger', topic: 'c', content: 'should not appear', timestamp: new Date().toISOString() }
    );
    writeFileSync(MEMORY_FILE, JSON.stringify(data));

    const peerInsights = SharedMemory.getPeerInsights();
    assert.equal(peerInsights.length, 2);
    assert.ok(peerInsights.some(i => i.from === 'peerbot'));
    assert.ok(peerInsights.some(i => i.from === 'otherbot'));
    assert.ok(!peerInsights.some(i => i.from === 'stranger'));
  });

  it('sends messages to specific peer', () => {
    const msg = SharedMemory.sendMessage('peerbot', 'Hello peerbot!');
    assert.equal(msg.to, 'peerbot');
    assert.equal(msg.read, false);
  });

  it('sendToAllPeers sends to every configured peer', () => {
    const msgs = SharedMemory.sendToAllPeers('Broadcast message');
    assert.equal(msgs.length, 2);
    assert.equal(msgs[0].to, 'peerbot');
    assert.equal(msgs[1].to, 'otherbot');
  });

  it('marks messages as read', () => {
    SharedMemory.addInsight('init', 'setup');
    const data = JSON.parse(readFileSync(MEMORY_FILE, 'utf-8'));
    data.messages.push({
      id: 'peerbot_123', from: 'peerbot', to: 'testbot',
      content: 'Hey testbot!', read: false, timestamp: new Date().toISOString(),
    });
    writeFileSync(MEMORY_FILE, JSON.stringify(data));

    assert.equal(SharedMemory.getUnreadMessages().length, 1);
    SharedMemory.markRead('peerbot_123');
    assert.equal(SharedMemory.getUnreadMessages().length, 0);
  });

  it('markAllRead clears all unread messages', () => {
    SharedMemory.addInsight('init', 'setup');
    const data = JSON.parse(readFileSync(MEMORY_FILE, 'utf-8'));
    data.messages.push(
      { id: 'p1', from: 'peerbot', to: 'testbot', content: 'msg1', read: false, timestamp: new Date().toISOString() },
      { id: 'p2', from: 'otherbot', to: 'testbot', content: 'msg2', read: false, timestamp: new Date().toISOString() }
    );
    writeFileSync(MEMORY_FILE, JSON.stringify(data));

    assert.equal(SharedMemory.getUnreadMessages().length, 2);
    SharedMemory.markAllRead();
    assert.equal(SharedMemory.getUnreadMessages().length, 0);
  });

  it('getContext includes insights from all peers', () => {
    SharedMemory.addInsight('init', 'setup');
    const data = JSON.parse(readFileSync(MEMORY_FILE, 'utf-8'));
    data.insights.push(
      { id: 'peer1', from: 'peerbot', topic: 'stocks', content: 'Inditex up 5%', timestamp: new Date().toISOString() },
      { id: 'other1', from: 'otherbot', topic: 'crypto', content: 'BTC at 100k', timestamp: new Date().toISOString() }
    );
    writeFileSync(MEMORY_FILE, JSON.stringify(data));

    const context = SharedMemory.getContext();
    assert.ok(context.includes('peerbot'));
    assert.ok(context.includes('otherbot'));
    assert.ok(context.includes('Inditex up 5%'));
    assert.ok(context.includes('BTC at 100k'));
  });

  it('getSummary lists all peers and their insight counts', () => {
    SharedMemory.addInsight('test', 'My insight');
    const data = JSON.parse(readFileSync(MEMORY_FILE, 'utf-8'));
    data.insights.push(
      { id: 'p1', from: 'peerbot', topic: 'a', content: 'x', timestamp: new Date().toISOString() }
    );
    writeFileSync(MEMORY_FILE, JSON.stringify(data));

    const summary = SharedMemory.getSummary();
    assert.ok(summary.includes('testbot'));
    assert.ok(summary.includes('peerbot'));
    assert.ok(summary.includes('otherbot'));
  });

  it('getNewPeerInsights tracks last seen and returns only new ones', () => {
    SharedMemory.addInsight('init', 'setup');
    const data = JSON.parse(readFileSync(MEMORY_FILE, 'utf-8'));
    data.insights.push(
      { id: 'peer_old', from: 'peerbot', topic: 'old', content: 'old insight', timestamp: new Date().toISOString() }
    );
    writeFileSync(MEMORY_FILE, JSON.stringify(data));

    // First call: returns the new insight
    const first = SharedMemory.getNewPeerInsights();
    assert.equal(first.length, 1);
    assert.equal(first[0].id, 'peer_old');

    // Second call: nothing new
    const second = SharedMemory.getNewPeerInsights();
    assert.equal(second.length, 0);

    // Add another insight from peer
    const data2 = JSON.parse(readFileSync(MEMORY_FILE, 'utf-8'));
    data2.insights.push(
      { id: 'peer_new', from: 'otherbot', topic: 'new', content: 'fresh insight', timestamp: new Date().toISOString() }
    );
    writeFileSync(MEMORY_FILE, JSON.stringify(data2));

    // Third call: only the new one
    const third = SharedMemory.getNewPeerInsights();
    assert.equal(third.length, 1);
    assert.equal(third[0].id, 'peer_new');
  });
});
