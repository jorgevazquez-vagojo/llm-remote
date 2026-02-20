import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Cipher } from '../src/crypto/cipher.js';

describe('Cipher', () => {
  const password = 'test-master-password-at-least-16-chars';
  const cipher = new Cipher(password);

  it('encrypts and decrypts correctly', () => {
    const plaintext = 'Hello, Claude Remote!';
    const encrypted = cipher.encrypt(plaintext);
    const decrypted = cipher.decrypt(encrypted);
    assert.equal(decrypted, plaintext);
  });

  it('produces different ciphertext each time (random IV/salt)', () => {
    const plaintext = 'same text';
    const enc1 = cipher.encrypt(plaintext);
    const enc2 = cipher.encrypt(plaintext);
    assert.notEqual(enc1, enc2);
  });

  it('handles empty strings', () => {
    const encrypted = cipher.encrypt('');
    const decrypted = cipher.decrypt(encrypted);
    assert.equal(decrypted, '');
  });

  it('handles unicode and emojis', () => {
    const plaintext = '¡Hola mundo! 🔐 日本語 العربية';
    const encrypted = cipher.encrypt(plaintext);
    const decrypted = cipher.decrypt(encrypted);
    assert.equal(decrypted, plaintext);
  });

  it('handles large text', () => {
    const plaintext = 'x'.repeat(100_000);
    const encrypted = cipher.encrypt(plaintext);
    const decrypted = cipher.decrypt(encrypted);
    assert.equal(decrypted, plaintext);
  });

  it('detects tampered data', () => {
    const encrypted = cipher.encrypt('test');
    // Tamper with a byte
    const buf = Buffer.from(encrypted, 'base64');
    buf[40] ^= 0xFF;
    const tampered = buf.toString('base64');

    assert.throws(() => cipher.decrypt(tampered), /HMAC verification failed/);
  });

  it('rejects short ciphertext', () => {
    assert.throws(() => cipher.decrypt('dG9vc2hvcnQ='), /too short/);
  });

  it('different passwords cannot decrypt', () => {
    const other = new Cipher('other-password-also-16-chars');
    const encrypted = cipher.encrypt('secret');
    assert.throws(() => other.decrypt(encrypted), /HMAC verification failed/);
  });

  it('hash produces consistent output', () => {
    const h1 = cipher.hash('test-data');
    const h2 = cipher.hash('test-data');
    assert.equal(h1, h2);
    assert.equal(h1.length, 64); // SHA-256 hex
  });

  it('hash differs for different inputs', () => {
    const h1 = cipher.hash('input-a');
    const h2 = cipher.hash('input-b');
    assert.notEqual(h1, h2);
  });

  it('rejects short master password', () => {
    assert.throws(() => new Cipher('short'), /at least 16/);
  });
});
