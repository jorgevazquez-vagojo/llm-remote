import { config } from '../utils/config.js';

const buckets = new Map();

export function checkRateLimit(userId) {
  const now = Date.now();
  const windowMs = 60_000;
  const limit = config.security.rateLimitPerMin;

  let bucket = buckets.get(userId);
  if (!bucket) {
    bucket = { timestamps: [] };
    buckets.set(userId, bucket);
  }

  // Remove expired timestamps
  bucket.timestamps = bucket.timestamps.filter(t => now - t < windowMs);

  if (bucket.timestamps.length >= limit) {
    const oldestInWindow = bucket.timestamps[0];
    const waitSec = Math.ceil((windowMs - (now - oldestInWindow)) / 1000);
    return { allowed: false, waitSec };
  }

  bucket.timestamps.push(now);
  return { allowed: true, remaining: limit - bucket.timestamps.length };
}
