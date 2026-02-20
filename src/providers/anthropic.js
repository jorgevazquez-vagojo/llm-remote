import { BaseProvider } from './base.js';
import { log } from '../utils/logger.js';

/**
 * Anthropic Claude API provider (direct API, not CLI).
 * For when you want Claude without agentic capabilities.
 */
export class AnthropicProvider extends BaseProvider {
  constructor(config) {
    super('anthropic', config);
  }

  get displayName() { return '🟣 Claude API (Sonnet, sin agéntico)'; }

  get isConfigured() {
    return !!this.config.apiKey;
  }

  async execute(prompt, context = {}) {
    const { workDir, history = [], systemPrompt: externalPrompt } = context;

    const model = this.config.model || 'claude-sonnet-4-20250514';
    const systemPrompt = externalPrompt || `Eres un asistente experto en ingeniería de software. El usuario trabaja en: ${workDir}. Responde de forma concisa en español. Código en inglés.`;

    log.info(`[anthropic] Calling ${model}`);

    const messages = [
      ...history.map(m => ({ role: m.role, content: m.content })),
      { role: 'user', content: prompt },
    ];

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.config.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model,
        max_tokens: 4096,
        system: systemPrompt,
        messages,
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      log.error(`[anthropic] API error: ${res.status} ${err}`);
      return {
        ok: false,
        output: `Error API Anthropic (${res.status}): ${err.substring(0, 500)}`,
        model,
      };
    }

    const data = await res.json();
    const output = data.content?.map(c => c.text).join('') || '(respuesta vacía)';
    const usage = data.usage;

    log.info(`[anthropic] ${model} — ${(usage?.input_tokens || 0) + (usage?.output_tokens || 0)} tokens`);

    return {
      ok: true,
      output,
      model,
      tokens: (usage?.input_tokens || 0) + (usage?.output_tokens || 0),
    };
  }

  kill() { return false; }
  isRunning() { return false; }
}
