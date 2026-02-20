import { config as dotenvConfig } from 'dotenv';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenvConfig({ path: resolve(__dirname, '../../.env') });

function required(key) {
  const val = process.env[key];
  if (!val) {
    console.error(`FATAL: Missing required env var: ${key}`);
    process.exit(1);
  }
  return val;
}

export const config = {
  telegram: {
    token: required('TELEGRAM_BOT_TOKEN'),
  },
  auth: {
    authorizedUsers: required('AUTHORIZED_USERS').split(',').map(id => parseInt(id.trim(), 10)),
    pin: required('AUTH_PIN'),
    sessionTimeoutMs: (parseInt(process.env.SESSION_TIMEOUT_MIN || '15', 10)) * 60 * 1000,
  },
  crypto: {
    masterPassword: required('MASTER_PASSWORD'),
  },
  claude: {
    bin: process.env.CLAUDE_BIN || 'claude',
    defaultWorkDir: process.env.DEFAULT_WORK_DIR || process.env.HOME,
    maxConcurrent: parseInt(process.env.MAX_CONCURRENT || '2', 10),
  },
  security: {
    rateLimitPerMin: parseInt(process.env.RATE_LIMIT_PER_MIN || '10', 10),
    autoDeleteSec: parseInt(process.env.AUTO_DELETE_SEC || '0', 10),
  },
  providers: {
    openai: {
      apiKey: process.env.OPENAI_API_KEY || '',
      model: process.env.OPENAI_MODEL || 'gpt-4o',
    },
    gemini: {
      apiKey: process.env.GEMINI_API_KEY || '',
      model: process.env.GEMINI_MODEL || 'gemini-2.5-flash-preview-05-20',
    },
    anthropic: {
      apiKey: process.env.ANTHROPIC_API_KEY || '',
      model: process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-20250514',
    },
    groq: {
      apiKey: process.env.GROQ_API_KEY || '',
      model: process.env.GROQ_MODEL || 'llama-3.3-70b-versatile',
    },
  },
  log: {
    level: process.env.LOG_LEVEL || 'info',
  },
  paths: {
    data: resolve(__dirname, '../../data'),
    db: resolve(__dirname, '../../data/audit.db'),
  },
  shared: {
    botName: process.env.BOT_NAME || '',
    peerBotName: process.env.PEER_BOT_NAME || '',
    dataDir: process.env.SHARED_DATA_DIR || '',
    autoChat: process.env.INTER_BOT_AUTO === 'true',
  },
};
