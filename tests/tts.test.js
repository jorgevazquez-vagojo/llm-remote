import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { isTTSEnabled, toggleTTS } from '../src/media/tts.js';

describe('TTS', () => {
  it('starts disabled for new users', () => {
    assert.equal(isTTSEnabled(99999), false);
  });

  it('toggles on and returns true', () => {
    const result = toggleTTS(88888);
    assert.equal(result, true);
    assert.equal(isTTSEnabled(88888), true);
  });

  it('toggles off and returns false', () => {
    toggleTTS(77777); // on
    const result = toggleTTS(77777); // off
    assert.equal(result, false);
    assert.equal(isTTSEnabled(77777), false);
  });

  it('isolates per user', () => {
    toggleTTS(11111); // on
    assert.equal(isTTSEnabled(11111), true);
    assert.equal(isTTSEnabled(22222), false);
  });
});
