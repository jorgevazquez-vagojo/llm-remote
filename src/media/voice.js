/**
 * Voice message transcription.
 * Fallback chain: Groq Whisper (free) → OpenAI Whisper → Gemini (free, multimodal).
 */
import { log } from '../utils/logger.js';
import { config } from '../utils/config.js';

export async function transcribeVoice(fileBuffer, fileName = 'audio.ogg') {
  const errors = [];

  // 1. Groq Whisper (free)
  const groqKey = config.providers?.groq?.apiKey;
  if (groqKey) {
    try {
      return await transcribeWithGroq(fileBuffer, fileName, groqKey);
    } catch (err) {
      log.warn(`[voice] Groq transcription failed: ${err.message}`);
      errors.push(`Groq: ${err.message}`);
    }
  }

  // 2. OpenAI Whisper
  const openaiKey = config.providers?.openai?.apiKey;
  if (openaiKey) {
    try {
      return await transcribeWithOpenAI(fileBuffer, fileName, openaiKey);
    } catch (err) {
      log.warn(`[voice] OpenAI transcription failed: ${err.message}`);
      errors.push(`OpenAI: ${err.message}`);
    }
  }

  // 3. Gemini (multimodal audio, free)
  const geminiKey = config.providers?.gemini?.apiKey;
  if (geminiKey) {
    try {
      return await transcribeWithGemini(fileBuffer, fileName, geminiKey);
    } catch (err) {
      log.warn(`[voice] Gemini transcription failed: ${err.message}`);
      errors.push(`Gemini: ${err.message}`);
    }
  }

  throw new Error(
    'No se pudo transcribir. ' +
    (errors.length ? `Errores: ${errors.join('; ')}` : 'Necesitas Groq, OpenAI o Gemini API key.')
  );
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
    throw new Error(`${res.status}: ${err.substring(0, 200)}`);
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
    throw new Error(`${res.status}: ${err.substring(0, 200)}`);
  }

  const data = await res.json();
  return data.text;
}

async function transcribeWithGemini(fileBuffer, fileName, apiKey) {
  const model = config.providers?.gemini?.model || 'gemini-2.5-flash-preview-05-20';
  log.info(`[voice] Transcribing with Gemini ${model}`);

  // Detect MIME type from filename
  const ext = fileName.split('.').pop()?.toLowerCase() || 'ogg';
  const mimeMap = {
    ogg: 'audio/ogg', oga: 'audio/ogg', opus: 'audio/opus',
    mp3: 'audio/mpeg', m4a: 'audio/mp4', wav: 'audio/wav',
    webm: 'audio/webm', flac: 'audio/flac', aac: 'audio/aac',
  };
  const mimeType = mimeMap[ext] || 'audio/ogg';

  const base64Audio = fileBuffer.toString('base64');

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{
        parts: [
          { inline_data: { mime_type: mimeType, data: base64Audio } },
          { text: 'Transcribe este audio a texto. Devuelve SOLO la transcripción literal, sin explicaciones ni comentarios.' },
        ],
      }],
      generationConfig: { maxOutputTokens: 4096, temperature: 0.1 },
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`${res.status}: ${err.substring(0, 200)}`);
  }

  const data = await res.json();
  const text = data.candidates?.[0]?.content?.parts?.map(p => p.text).join('') || '';

  if (!text.trim()) throw new Error('Gemini returned empty transcription');
  return text.trim();
}
