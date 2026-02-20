import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Pipeline } from '../src/pipeline/pipeline.js';

describe('Pipeline', () => {
  it('rejects pipelines with less than 2 steps', async () => {
    const result = await Pipeline.execute('single step', {
      providers: { getForUser: () => ({}) },
      sessionManager: { getWorkDir: () => '/tmp' },
      userId: 1,
    });
    assert.equal(result.ok, false);
    assert.ok(result.output.includes('al menos 2 pasos'));
  });

  it('parses steps separated by →', async () => {
    let executedPrompts = [];
    const mockProvider = {
      execute: async (prompt) => {
        executedPrompts.push(prompt);
        return { ok: true, output: 'mock result' };
      },
    };

    const result = await Pipeline.execute('paso uno → paso dos', {
      providers: { getForUser: () => mockProvider },
      sessionManager: { getWorkDir: () => '/tmp' },
      userId: 1,
    });

    assert.equal(result.ok, true);
    assert.equal(result.steps.length, 2);
    assert.equal(executedPrompts.length, 2);
    // Second step should include context from first
    assert.ok(executedPrompts[1].includes('mock result'));
  });

  it('parses steps separated by |', async () => {
    const mockProvider = {
      execute: async () => ({ ok: true, output: 'ok' }),
    };

    const result = await Pipeline.execute('step1 | step2 | step3', {
      providers: { getForUser: () => mockProvider },
      sessionManager: { getWorkDir: () => '/tmp' },
      userId: 1,
    });

    assert.equal(result.ok, true);
    assert.equal(result.steps.length, 3);
  });

  it('stops on provider error', async () => {
    let callCount = 0;
    const mockProvider = {
      execute: async () => {
        callCount++;
        if (callCount === 2) return { ok: false, output: 'API error' };
        return { ok: true, output: 'fine' };
      },
    };

    const result = await Pipeline.execute('a → b → c', {
      providers: { getForUser: () => mockProvider },
      sessionManager: { getWorkDir: () => '/tmp' },
      userId: 1,
    });

    assert.equal(result.ok, false);
    assert.ok(result.output.includes('Error en paso'));
    assert.equal(callCount, 2); // Stopped at step 2
  });
});
