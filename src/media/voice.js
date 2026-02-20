/**
 * Voice message transcription.
 * Uses Groq Whisper API (free) for speech-to-text.
 * Fallback: OpenAI Whisper if Groq unavailable.
 */
import { log } from '../utils/logger.js';
import { config } from '../utils/config.js';

export async function transcribeVoice(fileBuffer, fileName = 'audio.ogg') {
  // Try Groq first (free)
  const groqKey = config.providers?.groq?.apiKey;
  if (groqKey) {
    try {
      return await transcribeWithGroq(fileBuffer, fileName, groqKey);
    } catch (err) {
      log.warn(`[voice] Groq transcription failed: ${err.message}`);
    }
  }

  // Fallback to OpenAI
  const openaiKey = config.providers?.openai?.apiKey;
  if (openaiKey) {
    try {
      return await transcribeWithOpenAI(fileBuffer, fileName, openaiKey);
    } catch (err) {
      log.warn(`[voice] OpenAI transcription failed: ${err.message}`);
    }
  }

  throw new Error('No hay proveedor de transcripción configurado (necesitas Groq o OpenAI API key)');
}

async function transcribeWithGroq(fileBuffer, fileName, apiKey) {
  log.info('[voice] Transcribing with Groq Whisper');

  const formData = new FormData();
  formData.append('file', new Blob([fileBuffer]), fileName);
  formData.append('model', 'whisper-large-v3');
  formData.append('language', 'es');

  const res = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${apiKey}` },
    body: formData,
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Groq Whisper ${res.status}: ${err}`);
  }

  const data = await res.json();
  return data.text;
}

async function transcribeWithOpenAI(fileBuffer, fileName, apiKey) {
  log.info('[voice] Transcribing with OpenAI Whisper');

  const formData = new FormData();
  formData.append('file', new Blob([fileBuffer]), fileName);
  formData.append('model', 'whisper-1');
  formData.append('language', 'es');

  const res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${apiKey}` },
    body: formData,
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`OpenAI Whisper ${res.status}: ${err}`);
  }

  const data = await res.json();
  return data.text;
}
