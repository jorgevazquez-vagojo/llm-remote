/**
 * Vision analysis for images.
 * Routes to the best vision-capable provider available.
 * Supports: OpenAI GPT-4o, Anthropic Claude, Gemini.
 */
import { log } from '../utils/logger.js';
import { config } from '../utils/config.js';

export async function analyzeImage(imageBase64, mimeType, prompt, history = []) {
  // Try providers in order of preference
  const providers = [
    { name: 'openai', fn: analyzeWithOpenAI, key: config.providers?.openai?.apiKey },
    { name: 'anthropic', fn: analyzeWithAnthropic, key: config.providers?.anthropic?.apiKey },
    { name: 'gemini', fn: analyzeWithGemini, key: config.providers?.gemini?.apiKey },
  ];

  for (const { name, fn, key } of providers) {
    if (!key) continue;
    try {
      log.info(`[vision] Analyzing with ${name}`);
      return await fn(imageBase64, mimeType, prompt, key, history);
    } catch (err) {
      log.warn(`[vision] ${name} failed: ${err.message}`);
    }
  }

  throw new Error('No hay proveedor de visión configurado (necesitas OpenAI, Anthropic o Gemini API key)');
}

async function analyzeWithOpenAI(imageBase64, mimeType, prompt, apiKey, history) {
  const model = config.providers.openai.model || 'gpt-4o';
  const messages = [
    { role: 'system', content: 'Eres un asistente experto. Analiza la imagen y responde en español.' },
    ...history,
    {
      role: 'user',
      content: [
        { type: 'text', text: prompt || 'Describe y analiza esta imagen.' },
        { type: 'image_url', image_url: { url: `data:${mimeType};base64,${imageBase64}` } },
      ],
    },
  ];

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ model, messages, max_tokens: 4096 }),
  });

  if (!res.ok) throw new Error(`OpenAI ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return {
    output: data.choices?.[0]?.message?.content || '(sin respuesta)',
    model,
    tokens: data.usage?.total_tokens,
    provider: 'openai',
  };
}

async function analyzeWithAnthropic(imageBase64, mimeType, prompt, apiKey, history) {
  const model = config.providers.anthropic.model || 'claude-sonnet-4-20250514';
  const messages = [
    ...history.map(m => ({ role: m.role, content: m.content })),
    {
      role: 'user',
      content: [
        { type: 'image', source: { type: 'base64', media_type: mimeType, data: imageBase64 } },
        { type: 'text', text: prompt || 'Describe y analiza esta imagen.' },
      ],
    },
  ];

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model,
      max_tokens: 4096,
      system: 'Eres un asistente experto. Analiza la imagen y responde en español.',
      messages,
    }),
  });

  if (!res.ok) throw new Error(`Anthropic ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return {
    output: data.content?.map(c => c.text).join('') || '(sin respuesta)',
    model,
    tokens: (data.usage?.input_tokens || 0) + (data.usage?.output_tokens || 0),
    provider: 'anthropic',
  };
}

async function analyzeWithGemini(imageBase64, mimeType, prompt, apiKey, history) {
  const model = config.providers.gemini.model || 'gemini-2.5-flash-preview-05-20';
  const contents = [
    ...history.map(m => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] })),
    {
      role: 'user',
      parts: [
        { text: prompt || 'Describe y analiza esta imagen.' },
        { inline_data: { mime_type: mimeType, data: imageBase64 } },
      ],
    },
  ];

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      system_instruction: { parts: [{ text: 'Eres un asistente experto. Analiza la imagen y responde en español.' }] },
      contents,
    }),
  });

  if (!res.ok) throw new Error(`Gemini ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return {
    output: data.candidates?.[0]?.content?.parts?.map(p => p.text).join('') || '(sin respuesta)',
    model,
    tokens: data.usageMetadata?.totalTokenCount,
    provider: 'gemini',
  };
}
