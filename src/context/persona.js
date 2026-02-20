/**
 * Per-user persona / system prompt management.
 * Users can customize their bot's personality and expertise
 * using natural language via /modo command.
 * Persists to data/personas.json.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { log } from '../utils/logger.js';
import { config } from '../utils/config.js';

const PERSONAS_FILE = resolve(config.paths?.data || 'data', 'personas.json');
let personas = {};

// Default system prompt from env
const DEFAULT_PERSONA = process.env.SYSTEM_PROMPT || '';

function load() {
  try {
    if (existsSync(PERSONAS_FILE)) {
      personas = JSON.parse(readFileSync(PERSONAS_FILE, 'utf-8'));
      log.info(`[persona] Loaded ${Object.keys(personas).length} custom personas`);
    }
  } catch (err) {
    log.warn(`[persona] Load failed: ${err.message}`);
  }
}

function save() {
  try {
    const dir = resolve(config.paths?.data || 'data');
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(PERSONAS_FILE, JSON.stringify(personas, null, 2));
  } catch (err) {
    log.error(`[persona] Save failed: ${err.message}`);
  }
}

export class Persona {
  static init() {
    load();
  }

  /**
   * Get the active system prompt for a user.
   * Returns user's custom persona or the default from env.
   */
  static get(userId) {
    const custom = personas[String(userId)];
    if (custom) return custom.prompt;
    return DEFAULT_PERSONA;
  }

  /**
   * Set a custom persona for a user.
   * @param {number} userId
   * @param {string} prompt - The system prompt / instructions
   * @param {string} label - Short label (e.g., "Experta M&A")
   */
  static set(userId, prompt, label = '') {
    personas[String(userId)] = {
      prompt,
      label: label || prompt.substring(0, 50),
      updatedAt: new Date().toISOString(),
    };
    save();
    log.info(`[persona] Updated for user ${userId}: ${label || prompt.substring(0, 40)}`);
  }

  /**
   * Append instructions to existing persona.
   */
  static append(userId, extra) {
    const current = this.get(userId);
    const combined = current ? `${current}\n\n${extra}` : extra;
    const label = personas[String(userId)]?.label || '';
    this.set(userId, combined, label);
  }

  /**
   * Reset user's persona to default.
   */
  static reset(userId) {
    delete personas[String(userId)];
    save();
    log.info(`[persona] Reset for user ${userId}`);
  }

  /**
   * Get info about a user's persona.
   */
  static getInfo(userId) {
    const custom = personas[String(userId)];
    if (custom) {
      return {
        isCustom: true,
        label: custom.label,
        prompt: custom.prompt,
        updatedAt: custom.updatedAt,
      };
    }
    return {
      isCustom: false,
      label: DEFAULT_PERSONA ? 'Default (env)' : 'Sin personalizar',
      prompt: DEFAULT_PERSONA,
    };
  }
}

// Load on import
Persona.init();
