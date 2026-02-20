import { BaseProvider } from './base.js';
import { log } from '../utils/logger.js';

/**
 * Groq API provider.
 * Free tier, ultra-fast inference.
 * Runs Llama 3.3 70B, Mixtral, etc.
 * Get API key: https://console.groq.com/keys
 */
export class GroqProvider extends BaseProvider {
  constructor(config) {
    super('groq', config);
  }

  get displayName() { return '🟠 Groq Llama 3.3 70B (gratis)'; }

  get isConfigured() {
    return !!this.config.apiKey;
  }

  async execute(prompt, context = {}) {
    const { workDir, history = [], systemPrompt: externalPrompt } = context;

    const model = this.config.model || 'llama-3.3-70b-versatile';
    const systemPrompt = externalPrompt || `Eres un asistente experto en ingeniería de software. El usuario trabaja en: ${workDir}. Responde de forma concisa en español. Código en inglés.`;

    log.info(`[groq] Calling ${model}`);

    const messages = [
      { role: 'system', content: systemPrompt },
      ...history,
      { role: 'user', content: prompt },
    ];

    // Groq uses OpenAI-compatible API format
    const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.config.apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages,
        max_tokens: 4096,
        temperature: 0.3,
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      log.error(`[groq] API error: ${res.status} ${err}`);
      return {
        ok: false,
        output: `Error API Groq (${res.status}): ${err.substring(0, 500)}`,
        model,
      };
    }

    const data = await res.json();
    const output = data.choices?.[0]?.message?.content || '(respuesta vacía)';
    const usage = data.usage;

    log.info(`[groq] ${model} — ${usage?.total_tokens || '?'} tokens`);

    return {
      ok: true,
      output,
      model,
      tokens: usage?.total_tokens,
    };
  }

  kill() { return false; }
  isRunning() { return false; }
}
