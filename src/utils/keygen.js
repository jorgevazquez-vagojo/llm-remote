#!/usr/bin/env node

/**
 * Generate a secure master password
 */

import { randomBytes } from 'node:crypto';

const password = randomBytes(32).toString('base64');
console.log('Generated master password:');
console.log(password);
console.log('\nAdd this to your .env as MASTER_PASSWORD');
