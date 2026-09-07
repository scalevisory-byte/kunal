import { config } from './config.js';
import { log } from './logger.js';

/**
 * Turning a voice note into words.
 *
 * Claude reads text and pictures but not audio, so this is the one part of the
 * pipeline that needs a service outside Anthropic. Which one is a choice with
 * real consequences for Gujarati and Hindi, so it is a setting rather than a
 * decision baked into the code:
 *
 *   SPEECH_PROVIDER=sarvam   SPEECH_API_KEY=...   (best for Indian languages)
 *   SPEECH_PROVIDER=openai   SPEECH_API_KEY=...   (Whisper)
 *   SPEECH_PROVIDER=groq     SPEECH_API_KEY=...   (Whisper, cheaper)
 *
 * With no key the feature is simply off: voice notes are left alone exactly as
 * they were before, and nothing about the rest of the pipeline changes.
 */

const PROVIDERS = {
  sarvam: {
    url: 'https://api.sarvam.ai/speech-to-text',
    // Sarvam wants its key in its own header rather than as a bearer token.
    headers: (key) => ({ 'api-subscription-key': key }),
    form: (blob, filename) => {
      const body = new FormData();
      body.append('file', blob, filename);
      body.append('model', config.speechModel || 'saarika:v2');
      // Unknown language rather than an assumption: these notes switch between
      // Gujarati, Hindi and English inside one sentence.
      body.append('language_code', config.speechLanguage || 'unknown');
      return body;
    },
    read: (json) => json?.transcript ?? json?.text ?? null,
  },
  openai: {
    url: 'https://api.openai.com/v1/audio/transcriptions',
    headers: (key) => ({ Authorization: `Bearer ${key}` }),
    form: (blob, filename) => {
      const body = new FormData();
      body.append('file', blob, filename);
      body.append('model', config.speechModel || 'whisper-1');
      return body;
    },
    read: (json) => json?.text ?? null,
  },
  groq: {
    url: 'https://api.groq.com/openai/v1/audio/transcriptions',
    headers: (key) => ({ Authorization: `Bearer ${key}` }),
    form: (blob, filename) => {
      const body = new FormData();
      body.append('file', blob, filename);
      body.append('model', config.speechModel || 'whisper-large-v3');
      return body;
    },
    read: (json) => json?.text ?? null,
  },
};

export const transcriptionEnabled = () =>
  Boolean(config.speechApiKey && PROVIDERS[config.speechProvider]);

/** What the dashboard shows about this, without revealing the key. */
export function transcriptionState() {
  const known = Boolean(PROVIDERS[config.speechProvider]);
  return {
    enabled: transcriptionEnabled(),
    provider: config.speechProvider,
    knownProvider: known,
    hasKey: Boolean(config.speechApiKey),
    providers: Object.keys(PROVIDERS),
  };
}

const EXTENSION = {
  'audio/ogg': 'ogg', 'audio/opus': 'ogg', 'audio/mpeg': 'mp3',
  'audio/mp4': 'm4a', 'audio/aac': 'm4a', 'audio/wav': 'wav', 'audio/webm': 'webm',
};

/**
 * The words in a voice note, or null.
 *
 * Null every time something goes wrong - no key, an unknown provider, a service
 * that is down, a note too long. A voice note that cannot be transcribed is a
 * voice note nobody hears about, which is the same as before this existed; it
 * must never be an error that costs the surrounding message.
 */
export async function transcribe({ buffer, mime }) {
  if (!transcriptionEnabled()) return null;
  if (!buffer?.length) return null;

  if (buffer.length > config.maxAudioBytes) {
    log.warn(`Voice note skipped: ${Math.round(buffer.length / 1e6)} MB is over the limit.`);
    return null;
  }

  const provider = PROVIDERS[config.speechProvider];
  const type = String(mime || 'audio/ogg').split(';')[0].trim().toLowerCase();
  const filename = `note.${EXTENSION[type] || 'ogg'}`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.speechTimeoutMs);

  try {
    const response = await fetch(provider.url, {
      method: 'POST',
      headers: provider.headers(config.speechApiKey),
      body: provider.form(new Blob([buffer], { type }), filename),
      signal: controller.signal,
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      log.warn(`Transcription failed (${response.status}): ${detail.slice(0, 160)}`);
      return null;
    }

    const text = provider.read(await response.json());
    const clean = String(text || '').trim();
    if (!clean) return null;

    log.info(`Voice note transcribed (${config.speechProvider}): ${clean.length} characters.`);
    return clean.slice(0, 4000);
  } catch (err) {
    const why = err?.name === 'AbortError' ? 'timed out' : err?.message || err;
    log.warn(`Transcription failed: ${why}`);
    return null;
  } finally {
    clearTimeout(timeout);
  }
}
