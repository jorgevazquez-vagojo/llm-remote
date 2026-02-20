import { ClaudeProvider } from './claude.js';
import { ClaudeRemoteProvider } from './claude-remote.js';
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
        maxTurns: config.claude.maxTurns,
        timeoutSec: config.claude.timeoutSec,
      }),
      'claude-remote': new ClaudeRemoteProvider({
        host: config.claudeRemote.host,
        port: config.claudeRemote.port,
        user: config.claudeRemote.user,
        key: config.claudeRemote.key,
        remoteBin: config.claudeRemote.remoteBin,
        remoteWorkDir: config.claudeRemote.remoteWorkDir,
        maxTurns: config.claudeRemote.maxTurns,
        timeoutSec: config.claudeRemote.timeoutSec,
      }),
      openai: new OpenAIProvider({
        apiKey: config.providers?.openai?.apiKey,
        model: config.providers?.openai?.model,
      }),
      gemini: new GeminiProvider({
        apiKey: config.providers?.gemini?.apiKey,
        model: config.providers?.gemini?.model,
      }),
      'gemini-pro': new GeminiProvider({
        name: 'gemini-pro',
        apiKey: config.providers?.gemini?.apiKey,
        model: process.env.GEMINI_PRO_MODEL || 'gemini-2.5-pro-preview-05-06',
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
