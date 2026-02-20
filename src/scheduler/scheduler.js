/**
 * Task scheduler for recurring AI tasks.
 * Stores schedules in encrypted JSON, executes via setInterval/cron-like logic.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { log } from '../utils/logger.js';
import { config } from '../utils/config.js';

const SCHEDULES_FILE = resolve(config.paths.data, 'schedules.json');
const schedules = new Map(); // id -> { cron, prompt, userId, provider, workDir, timer }
let nextId = 1;
let botInstance = null;
let providersInstance = null;

export class Scheduler {
  static init(bot, providers) {
    botInstance = bot;
    providersInstance = providers;
    this.load();
  }

  static add(userId, cronExpr, prompt, providerName, workDir) {
    const id = nextId++;
    const schedule = {
      id,
      userId,
      cron: cronExpr,
      prompt,
      provider: providerName,
      workDir,
      createdAt: new Date().toISOString(),
      lastRun: null,
      timer: null,
    };

    const intervalMs = parseCronToMs(cronExpr);
    if (!intervalMs) {
      return { ok: false, reason: 'Formato de intervalo no válido. Usa: 1h, 30m, 24h, 7d, o cron (*/5 * * * *)' };
    }

    schedule.intervalMs = intervalMs;
    schedule.timer = setInterval(() => this.execute(id), intervalMs);
    schedules.set(id, schedule);
    this.save();

    return { ok: true, id, intervalMs };
  }

  static remove(userId, id) {
    const schedule = schedules.get(id);
    if (!schedule) return { ok: false, reason: 'Tarea no encontrada.' };
    if (schedule.userId !== userId) return { ok: false, reason: 'No tienes permiso.' };

    if (schedule.timer) clearInterval(schedule.timer);
    schedules.delete(id);
    this.save();
    return { ok: true };
  }

  static list(userId) {
    return [...schedules.values()]
      .filter(s => s.userId === userId)
      .map(({ id, cron, prompt, provider, lastRun }) => ({
        id, cron, prompt: prompt.substring(0, 60), provider, lastRun,
      }));
  }

  static async execute(id) {
    const schedule = schedules.get(id);
    if (!schedule || !botInstance || !providersInstance) return;

    try {
      log.info(`[scheduler] Running task #${id}: ${schedule.prompt.substring(0, 50)}`);

      const provider = providersInstance.get(schedule.provider) || providersInstance.getForUser(schedule.userId);

      const result = await provider.execute(schedule.prompt, {
        workDir: schedule.workDir,
        userId: schedule.userId,
      });

      schedule.lastRun = new Date().toISOString();
      this.save();

      if (result.ok && result.output) {
        const header = `⏰ Tarea programada #${id}\n📝 ${schedule.prompt.substring(0, 50)}\n\n`;
        const text = header + result.output.substring(0, 3500);

        await botInstance.api.sendMessage(schedule.userId, text);
      }
    } catch (err) {
      log.error(`[scheduler] Task #${id} failed: ${err.message}`);
    }
  }

  static save() {
    try {
      if (!existsSync(config.paths.data)) mkdirSync(config.paths.data, { recursive: true });
      const data = [...schedules.values()].map(({ timer, ...rest }) => rest);
      writeFileSync(SCHEDULES_FILE, JSON.stringify(data, null, 2));
    } catch (err) {
      log.error(`[scheduler] Save failed: ${err.message}`);
    }
  }

  static load() {
    try {
      if (!existsSync(SCHEDULES_FILE)) return;
      const data = JSON.parse(readFileSync(SCHEDULES_FILE, 'utf-8'));
      for (const s of data) {
        if (s.id >= nextId) nextId = s.id + 1;
        if (s.intervalMs) {
          s.timer = setInterval(() => this.execute(s.id), s.intervalMs);
        }
        schedules.set(s.id, s);
      }
      log.info(`[scheduler] Loaded ${data.length} scheduled tasks`);
    } catch (err) {
      log.warn(`[scheduler] Load failed: ${err.message}`);
    }
  }

  static stop() {
    for (const s of schedules.values()) {
      if (s.timer) clearInterval(s.timer);
    }
  }
}

/**
 * Parse simple interval notation to milliseconds.
 * Supports: 5m, 1h, 24h, 7d, 30s
 */
function parseCronToMs(expr) {
  expr = expr.trim().toLowerCase();

  // Simple intervals: 5m, 1h, 24h, 7d
  const match = expr.match(/^(\d+)(s|m|h|d)$/);
  if (match) {
    const value = parseInt(match[1], 10);
    const unit = match[2];
    const multipliers = { s: 1000, m: 60000, h: 3600000, d: 86400000 };
    const ms = value * multipliers[unit];
    if (ms < 60000) return null; // Min 1 minute
    return ms;
  }

  return null;
}
