/**
 * Base provider interface.
 * All AI providers must implement execute(prompt, context).
 */
export class BaseProvider {
  constructor(name, config = {}) {
    this.name = name;
    this.config = config;
  }

  /** @returns {{ ok: boolean, output: string, stderr?: string, model?: string }} */
  async execute(prompt, context = {}) {
    throw new Error(`Provider ${this.name}: execute() not implemented`);
  }

  get displayName() {
    return this.name;
  }

  get isConfigured() {
    return false;
  }
}
