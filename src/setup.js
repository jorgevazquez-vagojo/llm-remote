#!/usr/bin/env node

/**
 * Claude Remote — Interactive Setup Wizard
 * Run: node src/setup.js
 */

import { createInterface } from 'node:readline';
import { randomBytes } from 'node:crypto';
import { writeFileSync, existsSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ENV_PATH = resolve(__dirname, '../.env');

const rl = createInterface({
  input: process.stdin,
  output: process.stdout,
});

function ask(question, defaultVal = '') {
  const suffix = defaultVal ? ` [${defaultVal}]` : '';
  return new Promise((resolve) => {
    rl.question(`  ${question}${suffix}: `, (answer) => {
      resolve(answer.trim() || defaultVal);
    });
  });
}

function header(text) {
  console.log(`\n${'─'.repeat(50)}`);
  console.log(`  ${text}`);
  console.log(`${'─'.repeat(50)}`);
}

async function main() {
  console.clear();
  console.log(`
   ╔══════════════════════════════════════╗
   ║   Claude Remote — Setup Wizard      ║
   ║   Encrypted Telegram-Claude Bridge  ║
   ╚══════════════════════════════════════╝
  `);

  // Load existing config if present
  let existing = {};
  if (existsSync(ENV_PATH)) {
    console.log('  Found existing .env — values shown as defaults.\n');
    const content = readFileSync(ENV_PATH, 'utf8');
    for (const line of content.split('\n')) {
      const match = line.match(/^([^#=]+)=(.*)$/);
      if (match) existing[match[1].trim()] = match[2].trim();
    }
  }

  // 1. Telegram
  header('1/5  Telegram Configuration');
  console.log('  Get a token from @BotFather on Telegram.\n');

  const botToken = await ask('Bot token', existing.TELEGRAM_BOT_TOKEN || '');
  if (!botToken) {
    console.log('\n  ERROR: Bot token is required. Exiting.');
    process.exit(1);
  }

  console.log('\n  Your Telegram user ID (send /myid to @userinfobot)');
  const users = await ask('Authorized user IDs (comma-separated)', existing.AUTHORIZED_USERS || '');
  if (!users) {
    console.log('\n  ERROR: At least one user ID is required. Exiting.');
    process.exit(1);
  }

  // 2. Security
  header('2/5  Security');
  const defaultPin = existing.AUTH_PIN || String(Math.floor(100000 + Math.random() * 900000));
  const pin = await ask('Auth PIN (6+ chars)', defaultPin);

  const defaultPassword = existing.MASTER_PASSWORD || randomBytes(32).toString('base64');
  console.log('\n  Master encryption password (auto-generated if empty)');
  const masterPassword = await ask('Master password', defaultPassword);

  // 3. Session & Limits
  header('3/5  Session & Limits');
  const timeout = await ask('Session timeout (minutes)', existing.SESSION_TIMEOUT_MIN || '15');
  const rateLimit = await ask('Max commands per minute', existing.RATE_LIMIT_PER_MIN || '10');
  const autoDelete = await ask('Auto-delete messages (seconds, 0=off)', existing.AUTO_DELETE_SEC || '0');

  // 4. Claude Code
  header('4/5  Claude Code');
  const claudeBin = await ask('Claude binary path', existing.CLAUDE_BIN || 'claude');
  const defaultDir = await ask('Default work directory', existing.DEFAULT_WORK_DIR || process.env.HOME);
  const maxConcurrent = await ask('Max concurrent processes', existing.MAX_CONCURRENT || '2');

  // 5. Logging
  header('5/5  Logging');
  const logLevel = await ask('Log level (debug/info/warn/error)', existing.LOG_LEVEL || 'info');

  // Generate .env
  const envContent = `# Claude Remote Configuration
# Generated: ${new Date().toISOString()}

# Telegram
TELEGRAM_BOT_TOKEN=${botToken}
AUTHORIZED_USERS=${users}

# Security
AUTH_PIN=${pin}
MASTER_PASSWORD=${masterPassword}

# Session
SESSION_TIMEOUT_MIN=${timeout}
RATE_LIMIT_PER_MIN=${rateLimit}
AUTO_DELETE_SEC=${autoDelete}

# Claude Code
CLAUDE_BIN=${claudeBin}
DEFAULT_WORK_DIR=${defaultDir}
MAX_CONCURRENT=${maxConcurrent}

# Logging
LOG_LEVEL=${logLevel}
`;

  writeFileSync(ENV_PATH, envContent, { mode: 0o600 }); // Only owner can read

  header('Setup Complete!');
  console.log(`
  .env written to: ${ENV_PATH}
  File permissions: 600 (owner read/write only)

  Your PIN: ${pin}
  (Remember this — you need it to authenticate on Telegram)

  Next steps:
    1. npm install
    2. npm start
    3. Open Telegram, find your bot
    4. Send: /auth ${pin}
    5. Then just type any message for Claude Code

  Security notes:
    - .env is chmod 600 (only you can read it)
    - Add .env to .gitignore (already done)
    - Master password encrypts all stored data
    - PIN auto-deleted from Telegram after auth
    - Session auto-locks after ${timeout} min inactivity
    - Brute-force protection: 5 attempts then 15min lockout
  `);

  rl.close();
}

main().catch((err) => {
  console.error('Setup error:', err);
  process.exit(1);
});
