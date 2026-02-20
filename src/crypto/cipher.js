import { createCipheriv, createDecipheriv, randomBytes, pbkdf2Sync, createHmac } from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const KEY_LENGTH = 32;
const IV_LENGTH = 16;
const TAG_LENGTH = 16;
const SALT_LENGTH = 32;
const PBKDF2_ITERATIONS = 310_000; // OWASP 2023 recommendation
const PBKDF2_DIGEST = 'sha512';

export class Cipher {
  #masterKey;
  #hmacKey;

  constructor(masterPassword) {
    if (!masterPassword || masterPassword.length < 16) {
      throw new Error('Master password must be at least 16 characters');
    }
    // Derive separate keys for encryption and HMAC
    const salt = Buffer.from('claude-remote-v1-master-salt', 'utf8');
    const derived = pbkdf2Sync(masterPassword, salt, PBKDF2_ITERATIONS, KEY_LENGTH * 2, PBKDF2_DIGEST);
    this.#masterKey = derived.subarray(0, KEY_LENGTH);
    this.#hmacKey = derived.subarray(KEY_LENGTH);
  }

  encrypt(plaintext) {
    const iv = randomBytes(IV_LENGTH);
    const salt = randomBytes(SALT_LENGTH);

    // Derive unique key per message using salt
    const key = pbkdf2Sync(this.#masterKey, salt, 1000, KEY_LENGTH, 'sha256');

    const cipher = createCipheriv(ALGORITHM, key, iv);
    const encrypted = Buffer.concat([
      cipher.update(Buffer.from(plaintext, 'utf8')),
      cipher.final(),
    ]);
    const tag = cipher.getAuthTag();

    // Format: salt(32) + iv(16) + tag(16) + ciphertext
    const payload = Buffer.concat([salt, iv, tag, encrypted]);

    // HMAC over the entire payload for tamper detection
    const hmac = createHmac('sha256', this.#hmacKey).update(payload).digest();

    // Final: hmac(32) + payload
    return Buffer.concat([hmac, payload]).toString('base64');
  }

  decrypt(encoded) {
    const data = Buffer.from(encoded, 'base64');

    if (data.length < 32 + SALT_LENGTH + IV_LENGTH + TAG_LENGTH) {
      throw new Error('Invalid ciphertext: too short');
    }

    // Extract HMAC and verify
    const hmac = data.subarray(0, 32);
    const payload = data.subarray(32);

    const expectedHmac = createHmac('sha256', this.#hmacKey).update(payload).digest();
    if (!hmac.equals(expectedHmac)) {
      throw new Error('HMAC verification failed: data tampered');
    }

    // Extract components
    const salt = payload.subarray(0, SALT_LENGTH);
    const iv = payload.subarray(SALT_LENGTH, SALT_LENGTH + IV_LENGTH);
    const tag = payload.subarray(SALT_LENGTH + IV_LENGTH, SALT_LENGTH + IV_LENGTH + TAG_LENGTH);
    const ciphertext = payload.subarray(SALT_LENGTH + IV_LENGTH + TAG_LENGTH);

    // Derive key
    const key = pbkdf2Sync(this.#masterKey, salt, 1000, KEY_LENGTH, 'sha256');

    const decipher = createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(tag);

    const decrypted = Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]);

    return decrypted.toString('utf8');
  }

  hash(data) {
    return createHmac('sha256', this.#hmacKey).update(data).digest('hex');
  }
}
