/**
 * Pipeline engine.
 * Chains multiple operations: analyze → transform → output.
 * Syntax: /pipe step1 → step2 → step3
 */
import { log } from '../utils/logger.js';
import { webSearch, formatSearchResults } from '../search/web.js';

export class Pipeline {
  static async execute(pipelineText, context) {
    const { providers, sessionManager, userId, bot, chatId } = context;

    // Parse steps separated by →, >, or |
    const steps = pipelineText
      .split(/\s*[→>|]\s*/)
      .map(s => s.trim())
      .filter(s => s.length > 0);

    if (steps.length < 2) {
      return { ok: false, output: 'El pipeline necesita al menos 2 pasos separados por →\nEjemplo: /pipe busca tendencias React → resume en 3 puntos → traduce al inglés' };
    }

    const results = [];
    let previousOutput = '';

    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];
      const isLast = i === steps.length - 1;
      const stepLabel = `[${i + 1}/${steps.length}]`;

      log.info(`[pipeline] ${stepLabel} ${step.substring(0, 50)}`);

      try {
        // Check for special built-in steps
        if (step.toLowerCase().startsWith('busca ') || step.toLowerCase().startsWith('search ')) {
          const query = step.replace(/^(busca|search)\s+/i, '');
          const searchQuery = previousOutput ? `${query} ${previousOutput.substring(0, 100)}` : query;
          const { results: searchResults } = await webSearch(searchQuery);
          previousOutput = formatSearchResults(searchResults);
        } else {
          // Send to AI provider with previous context
          const provider = providers.getForUser(userId);
          const workDir = sessionManager.getWorkDir(userId);

          const prompt = previousOutput
            ? `Contexto del paso anterior:\n\n${previousOutput.substring(0, 3000)}\n\nAhora: ${step}`
            : step;

          const result = await provider.execute(prompt, { workDir, userId });

          if (!result.ok) {
            return { ok: false, output: `Error en paso ${stepLabel}: ${result.output}` };
          }

          previousOutput = result.output;
        }

        results.push({ step: stepLabel, instruction: step, output: previousOutput.substring(0, 500) });

        // Send intermediate progress
        if (!isLast && bot) {
          try {
            await bot.api.sendMessage(chatId, `✅ ${stepLabel} ${step}\n⏳ Siguiente paso...`);
          } catch {}
        }
      } catch (err) {
        return { ok: false, output: `Error en paso ${stepLabel} "${step}": ${err.message}` };
      }
    }

    return { ok: true, output: previousOutput, steps: results };
  }
}
