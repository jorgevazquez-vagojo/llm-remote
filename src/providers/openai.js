import { BaseProvider } from './base.js';
import { log } from '../utils/logger.js';

/**
 * OpenAI API provider.
 * Uses native fetch — no SDK needed.
 */
export class OpenAIProvider extends BaseProvider {
  constructor(config) {
    super('openai', config);
  }

  get displayName() { return '🟢 OpenAI GPT-4o'; }

  get isConfigured() {
    return !!this.config.apiKey;
  }

  async execute(prompt, context = {}) {
    const { workDir } = context;

    const model = this.config.model || 'gpt-4o';
    const systemPrompt = `You are a senior software engineer assistant. The user is working in: ${workDir}. Respond concisely in the user's language. If they write in Spanish, respond in Spanish.`;

    log.info(`[openai] Calling ${model}`);

    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.config.apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: prompt },
        ],
        max_tokens: 4096,
        temperature: 0.3,
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      log.error(`[openai] API error: ${res.status} ${err}`);
      return {
        ok: false,
        output: `OpenAI API error (${res.status}): ${err.substring(0, 500)}`,
        model,
      };
    }

    const data = await res.json();
    const output = data.choices?.[0]?.message?.content || '(empty response)';
    const usage = data.usage;

    log.info(`[openai] ${model} — ${usage?.total_tokens || '?'} tokens`);

    return {
      ok: true,
      output,
      model,
      tokens: usage?.total_tokens,
    };
  }

  kill() { return false; } // API calls can't be cancelled
  isRunning() { return false; }
}
