import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { Persona } from '../src/context/persona.js';

describe('Persona', () => {
  const testUser = 999001;

  beforeEach(() => {
    Persona.reset(testUser);
  });

  it('returns empty string for user without persona and no env default', () => {
    const result = Persona.get(testUser);
    // Returns DEFAULT_PERSONA (from env SYSTEM_PROMPT or empty)
    assert.equal(typeof result, 'string');
  });

  it('sets and gets a custom persona', () => {
    Persona.set(testUser, 'Eres un experto en M&A y mercados financieros.', 'Experta M&A');
    const result = Persona.get(testUser);
    assert.equal(result, 'Eres un experto en M&A y mercados financieros.');
  });

  it('getInfo returns isCustom true after set', () => {
    Persona.set(testUser, 'Responde en inglés siempre.', 'English mode');
    const info = Persona.getInfo(testUser);
    assert.equal(info.isCustom, true);
    assert.equal(info.label, 'English mode');
    assert.equal(info.prompt, 'Responde en inglés siempre.');
    assert.ok(info.updatedAt);
  });

  it('getInfo returns isCustom false for default', () => {
    const info = Persona.getInfo(testUser);
    assert.equal(info.isCustom, false);
  });

  it('appends instructions to existing persona', () => {
    Persona.set(testUser, 'Base prompt.', 'Base');
    Persona.append(testUser, 'Extra instructions.');
    const result = Persona.get(testUser);
    assert.ok(result.includes('Base prompt.'));
    assert.ok(result.includes('Extra instructions.'));
  });

  it('resets persona to default', () => {
    Persona.set(testUser, 'Custom persona.', 'Custom');
    Persona.reset(testUser);
    const info = Persona.getInfo(testUser);
    assert.equal(info.isCustom, false);
  });

  it('isolates personas per user', () => {
    const userA = 999002;
    const userB = 999003;
    Persona.set(userA, 'Persona A');
    Persona.set(userB, 'Persona B');
    assert.equal(Persona.get(userA), 'Persona A');
    assert.equal(Persona.get(userB), 'Persona B');
    // cleanup
    Persona.reset(userA);
    Persona.reset(userB);
  });

  it('auto-generates label from prompt when not provided', () => {
    Persona.set(testUser, 'A very long prompt that should be truncated for the label.');
    const info = Persona.getInfo(testUser);
    assert.equal(info.label, 'A very long prompt that should be truncated for th');
  });
});
