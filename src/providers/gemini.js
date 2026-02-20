import { BaseProvider } from './base.js';
import { log } from '../utils/logger.js';

/**
 * Google Gemini API provider.
 * Uses native fetch — no SDK needed.
 * Gemini 2.5 Flash is free tier (20 req/day).
 */
export class GeminiProvider extends BaseProvider {
  constructor(config) {
    super('gemini', config);
  }

  get displayName() { return '🔵 Gemini 2.5 Flash (gratis)'; }

  get isConfigured() {
    return !!this.config.apiKey;
  }

  async execute(prompt, context = {}) {
    const { workDir, history = [] } = context;

    const model = this.config.model || 'gemini-2.5-flash-preview-05-20';
    const systemPrompt = `Eres un asistente experto en ingeniería de software. El usuario trabaja en: ${workDir}. Responde de forma concisa en español. Código en inglés.`;

    log.info(`[gemini] Calling ${model}`);

    const contents = [
      ...history.map(m => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.content }],
      })),
      { role: 'user', parts: [{ text: prompt }] },
    ];

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${this.config.apiKey}`;

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: systemPrompt }] },
        contents,
        generationConfig: {
          maxOutputTokens: 4096,
          temperature: 0.3,
        },
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      log.error(`[gemini] API error: ${res.status} ${err}`);
      return {
        ok: false,
        output: `Error API Gemini (${res.status}): ${err.substring(0, 500)}`,
        model,
      };
    }

    const data = await res.json();
    const output = data.candidates?.[0]?.content?.parts?.map(p => p.text).join('') || '(respuesta vacía)';
    const usage = data.usageMetadata;

    log.info(`[gemini] ${model} — ${usage?.totalTokenCount || '?'} tokens`);

    return {
      ok: true,
      output,
      model,
      tokens: usage?.totalTokenCount,
    };
  }

  kill() { return false; }
  isRunning() { return false; }
}
