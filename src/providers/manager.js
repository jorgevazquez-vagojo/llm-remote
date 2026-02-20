import { ClaudeProvider } from './claude.js';
import { OpenAIProvider } from './openai.js';
import { GeminiProvider } from './gemini.js';
import { AnthropicProvider } from './anthropic.js';
import { GroqProvider } from './groq.js';
import { config } from '../utils/config.js';

const userProviders = new Map(); // userId -> providerName
const DEFAULT_PROVIDER = process.env.DEFAULT_PROVIDER || 'groq';

export class ProviderManager {
  #providers = {};

  constructor() {
    this.#providers = {
      claude: new ClaudeProvider({
        bin: config.claude.bin,
      }),
      openai: new OpenAIProvider({
        apiKey: config.providers?.openai?.apiKey,
        model: config.providers?.openai?.model,
      }),
      gemini: new GeminiProvider({
        apiKey: config.providers?.gemini?.apiKey,
        model: config.providers?.gemini?.model,
      }),
      anthropic: new AnthropicProvider({
        apiKey: config.providers?.anthropic?.apiKey,
        model: config.providers?.anthropic?.model,
      }),
      groq: new GroqProvider({
        apiKey: config.providers?.groq?.apiKey,
        model: config.providers?.groq?.model,
      }),
    };
  }

  get(name) {
    return this.#providers[name];
  }

  getForUser(userId) {
    const name = userProviders.get(userId) || DEFAULT_PROVIDER;
    return this.#providers[name];
  }

  setForUser(userId, name) {
    if (!this.#providers[name]) {
      return { ok: false, reason: `Provider '${name}' no existe` };
    }
    if (!this.#providers[name].isConfigured) {
      return { ok: false, reason: `Provider '${name}' no configurado (falta API key)` };
    }
    userProviders.set(userId, name);
    return { ok: true, provider: this.#providers[name] };
  }

  getUserProviderName(userId) {
    return userProviders.get(userId) || DEFAULT_PROVIDER;
  }

  listAll() {
    return Object.entries(this.#providers).map(([name, provider]) => ({
      name,
      displayName: provider.displayName,
      configured: provider.isConfigured,
      active: false, // set by caller
    }));
  }

  listConfigured() {
    return Object.entries(this.#providers)
      .filter(([, p]) => p.isConfigured)
      .map(([name, p]) => ({ name, displayName: p.displayName }));
  }
}
