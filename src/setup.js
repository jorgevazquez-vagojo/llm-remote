#!/usr/bin/env node

/**
 * Claude Remote — Configurador Interactivo
 * Ejecutar: node src/setup.js
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

function mask(val) {
  if (!val || val.length < 8) return val;
  return val.substring(0, 4) + '...' + val.substring(val.length - 4);
}

async function main() {
  console.clear();
  console.log(`
   ╔══════════════════════════════════════════╗
   ║   Claude Remote — Configurador          ║
   ║   Telegram ↔ IA Bridge (cifrado)        ║
   ╚══════════════════════════════════════════╝
  `);

  // Load existing config
  let existing = {};
  if (existsSync(ENV_PATH)) {
    console.log('  .env existente encontrado — valores actuales como defaults.\n');
    const content = readFileSync(ENV_PATH, 'utf8');
    for (const line of content.split('\n')) {
      const match = line.match(/^([^#=]+)=(.*)$/);
      if (match) existing[match[1].trim()] = match[2].trim();
    }
  }

  // 1. Telegram
  header('1/6  Telegram');
  console.log('  Obtén un token en @BotFather de Telegram.\n');

  const botToken = await ask('Token del bot', existing.TELEGRAM_BOT_TOKEN || '');
  if (!botToken) {
    console.log('\n  ERROR: El token es obligatorio. Saliendo.');
    process.exit(1);
  }

  console.log('\n  Tu Telegram user ID (envía /myid a @userinfobot)');
  const users = await ask('IDs autorizados (separados por coma)', existing.AUTHORIZED_USERS || '');
  if (!users) {
    console.log('\n  ERROR: Al menos un ID es obligatorio. Saliendo.');
    process.exit(1);
  }

  // 2. Seguridad
  header('2/6  Seguridad');
  const defaultPin = existing.AUTH_PIN || String(Math.floor(100000 + Math.random() * 900000));
  const pin = await ask('PIN de autenticación (6+ chars)', defaultPin);

  const defaultPassword = existing.MASTER_PASSWORD || randomBytes(32).toString('base64');
  console.log('\n  Contraseña maestra para cifrado (auto-generada si vacía)');
  const masterPassword = await ask('Contraseña maestra', defaultPassword);

  // 3. Sesión y límites
  header('3/6  Sesión y Límites');
  const timeout = await ask('Timeout de sesión (minutos)', existing.SESSION_TIMEOUT_MIN || '15');
  const rateLimit = await ask('Max comandos por minuto', existing.RATE_LIMIT_PER_MIN || '10');
  const autoDelete = await ask('Auto-borrar mensajes (segundos, 0=off)', existing.AUTO_DELETE_SEC || '0');

  // 4. Claude Code
  header('4/6  Claude Code CLI');
  console.log('  Claude Code es el proveedor principal (agentic, acceso a ficheros).\n');
  const claudeBin = await ask('Ruta al binario claude', existing.CLAUDE_BIN || 'claude');
  const defaultDir = await ask('Directorio de trabajo por defecto', existing.DEFAULT_WORK_DIR || process.env.HOME);
  const maxConcurrent = await ask('Procesos simultáneos max', existing.MAX_CONCURRENT || '2');

  // 5. Proveedores IA adicionales
  header('5/6  Proveedores IA (opcional)');
  console.log('  Además de Claude Code CLI, puedes añadir otros proveedores.');
  console.log('  Deja vacío para omitir. Usa /ia en Telegram para cambiar.\n');

  console.log('  🟢 OpenAI (GPT-4o)');
  const openaiKey = await ask('  OPENAI_API_KEY', existing.OPENAI_API_KEY || '');
  const openaiModel = openaiKey ? await ask('  Modelo', existing.OPENAI_MODEL || 'gpt-4o') : '';

  console.log('\n  🔵 Google Gemini (2.5 Flash — gratis 20 req/día)');
  const geminiKey = await ask('  GEMINI_API_KEY', existing.GEMINI_API_KEY || '');
  const geminiModel = geminiKey ? await ask('  Modelo', existing.GEMINI_MODEL || 'gemini-2.5-flash-preview-05-20') : '';

  console.log('\n  🟣 Anthropic API (Claude Sonnet, sin agentic)');
  const anthropicKey = await ask('  ANTHROPIC_API_KEY', existing.ANTHROPIC_API_KEY || '');
  const anthropicModel = anthropicKey ? await ask('  Modelo', existing.ANTHROPIC_MODEL || 'claude-sonnet-4-20250514') : '';

  console.log('\n  🟠 Groq (Llama 3.3 70B — gratis, ultra-rápido)');
  console.log('  Obtén API key gratis en https://console.groq.com/keys');
  const groqKey = await ask('  GROQ_API_KEY', existing.GROQ_API_KEY || '');
  const groqModel = groqKey ? await ask('  Modelo', existing.GROQ_MODEL || 'llama-3.3-70b-versatile') : '';

  // 6. Logging
  header('6/6  Logging');
  const logLevel = await ask('Nivel de log (debug/info/warn/error)', existing.LOG_LEVEL || 'info');

  // Generate .env
  const envContent = `# Claude Remote Configuration
# Generado: ${new Date().toISOString()}

# Telegram
TELEGRAM_BOT_TOKEN=${botToken}
AUTHORIZED_USERS=${users}

# Seguridad
AUTH_PIN=${pin}
MASTER_PASSWORD=${masterPassword}

# Sesión
SESSION_TIMEOUT_MIN=${timeout}
RATE_LIMIT_PER_MIN=${rateLimit}
AUTO_DELETE_SEC=${autoDelete}

# Claude Code CLI
CLAUDE_BIN=${claudeBin}
DEFAULT_WORK_DIR=${defaultDir}
MAX_CONCURRENT=${maxConcurrent}

# --- Proveedores IA ---

# OpenAI
OPENAI_API_KEY=${openaiKey}
OPENAI_MODEL=${openaiModel || 'gpt-4o'}

# Google Gemini
GEMINI_API_KEY=${geminiKey}
GEMINI_MODEL=${geminiModel || 'gemini-2.5-flash-preview-05-20'}

# Anthropic API
ANTHROPIC_API_KEY=${anthropicKey}
ANTHROPIC_MODEL=${anthropicModel || 'claude-sonnet-4-20250514'}

# Groq (gratis)
GROQ_API_KEY=${groqKey}
GROQ_MODEL=${groqModel || 'llama-3.3-70b-versatile'}

# Logging
LOG_LEVEL=${logLevel}
`;

  writeFileSync(ENV_PATH, envContent, { mode: 0o600 });

  // Summary
  header('Configuración completada');

  const configured = [];
  configured.push('🟣 Claude Code CLI (siempre activo)');
  if (openaiKey) configured.push(`🟢 OpenAI — ${openaiModel || 'gpt-4o'}`);
  if (geminiKey) configured.push(`🔵 Gemini — ${geminiModel || '2.5 Flash'}`);
  if (anthropicKey) configured.push(`🟣 Anthropic API — ${anthropicModel || 'Sonnet'}`);
  if (groqKey) configured.push(`🟠 Groq — ${groqModel || 'Llama 3.3 70B'}`);

  console.log(`
  .env guardado en: ${ENV_PATH}
  Permisos: 600 (solo tú puedes leerlo)

  Tu PIN: ${pin}
  (Recuérdalo — lo necesitas para autenticarte en Telegram)

  Proveedores configurados:
${configured.map(p => `    ${p}`).join('\n')}

  Siguiente:
    1. npm start
    2. Abre tu bot en Telegram
    3. Envía: /auth ${pin}
    4. Escribe cualquier mensaje → va a Claude Code
    5. /ia openai → cambia a GPT-4o
    6. /ia gemini → cambia a Gemini (gratis)

  Seguridad:
    - .env chmod 600 (solo owner)
    - Cifrado AES-256-GCM + HMAC para audit log
    - PIN se borra de Telegram tras auth
    - Auto-lock tras ${timeout} min de inactividad
    - Anti-bruteforce: 5 intentos → 15 min lockout
  `);

  rl.close();
}

main().catch((err) => {
  console.error('Error de setup:', err);
  process.exit(1);
});
