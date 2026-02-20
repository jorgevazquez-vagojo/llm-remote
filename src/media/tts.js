/**
 * Text-to-Speech module.
 * Converts AI text responses to voice notes.
 * Uses OpenAI TTS (paid) or Groq TTS if available.
 */
import { log } from '../utils/logger.js';
import { config } from '../utils/config.js';

// Per-user TTS toggle
const ttsEnabled = new Map();

export function isTTSEnabled(userId) {
  return ttsEnabled.get(userId) || false;
}

export function toggleTTS(userId) {
  const current = ttsEnabled.get(userId) || false;
  ttsEnabled.set(userId, !current);
  return !current;
}

export async function textToSpeech(text, voice = 'nova') {
  // Trim text for TTS (max ~4000 chars)
  const trimmed = text.substring(0, 4000);

  // Try OpenAI TTS first
  const openaiKey = config.providers?.openai?.apiKey;
  if (openaiKey) {
    try {
      return await ttsOpenAI(trimmed, voice, openaiKey);
    } catch (err) {
      log.warn(`[tts] OpenAI TTS failed: ${err.message}`);
    }
  }

  // Try Groq TTS
  const groqKey = config.providers?.groq?.apiKey;
  if (groqKey) {
    try {
      return await ttsGroq(trimmed, groqKey);
    } catch (err) {
      log.warn(`[tts] Groq TTS failed: ${err.message}`);
    }
  }

  throw new Error('No hay proveedor TTS configurado (necesitas OpenAI o Groq API key)');
}

async function ttsOpenAI(text, voice, apiKey) {
  log.info(`[tts] Generating with OpenAI TTS (voice: ${voice})`);

  const res = await fetch('https://api.openai.com/v1/audio/speech', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: 'tts-1',
      input: text,
      voice, // alloy, echo, fable, onyx, nova, shimmer
      response_format: 'opus',
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`OpenAI TTS ${res.status}: ${err}`);
  }

  return Buffer.from(await res.arrayBuffer());
}

async function ttsGroq(text, apiKey) {
  log.info('[tts] Generating with Groq TTS');

  const res = await fetch('https://api.groq.com/openai/v1/audio/speech', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: 'playai-tts',
      input: text,
      voice: 'Arista-PlayAI',
      response_format: 'wav',
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Groq TTS ${res.status}: ${err}`);
  }

  return Buffer.from(await res.arrayBuffer());
}
