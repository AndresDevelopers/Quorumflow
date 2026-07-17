/**
 * DeepSeek — IA de TODO el sistema en TEXTO.
 *
 * Usos: resumen del dashboard, sugerencias de actividades/servicio,
 * Chat Iglesia, reescritura de textos y cualquier flujo JSON/texto.
 *
 * NO se usa para analizar fotos (la API de chat no acepta image_url).
 * Para imágenes ver `@/lib/vision` (GEMINI_API_KEY).
 *
 * Env: DEEPSEEK_API_KEY, DEEPSEEK_MODEL, DEEPSEEK_CHAT_MODEL, DEEPSEEK_MAX_TOKENS
 */
import { z } from 'zod';

const DEEPSEEK_API_URL = 'https://api.deepseek.com/v1/chat/completions';
const DEFAULT_MODEL = process.env.DEEPSEEK_MODEL || 'deepseek-v4-flash';
/**
 * Default 30s (was 8s). Serverless cold start + DeepSeek latency often exceeds 8s
 * in production, which made suggestions/vision polish fail only on sionflow.com.
 * Keep under route `maxDuration` (60s).
 */
const DEEPSEEK_TIMEOUT_MS = Number(process.env.DEEPSEEK_TIMEOUT_MS) || 30_000;
const DEEPSEEK_MAX_TOKENS = Number(process.env.DEEPSEEK_MAX_TOKENS) || 1600;

type DeepSeekMessage = {
  role: 'system' | 'user' | 'assistant';
  content: string | Array<{ type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } }>;
};

function extractJsonBlock(text: string): string {
  const fenced = text.match(/```json\s*([\s\S]*?)```/i);
  if (fenced?.[1]) return fenced[1].trim();

  const firstBrace = text.indexOf('{');
  const lastBrace = text.lastIndexOf('}');
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    return text.slice(firstBrace, lastBrace + 1).trim();
  }

  return text.trim();
}

export async function requestDeepSeekText(messages: DeepSeekMessage[], model = DEFAULT_MODEL): Promise<string> {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) {
    throw new Error('DEEPSEEK_API_KEY no está configurada en el servidor.');
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), DEEPSEEK_TIMEOUT_MS);

  try {
    const response = await fetch(DEEPSEEK_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages,
        temperature: 0.4,
        max_tokens: DEEPSEEK_MAX_TOKENS,
        // v4 models can return empty `content` when thinking runs; keep it off.
        thinking: { type: 'disabled' },
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`DeepSeek request failed (${response.status}): ${text}`);
    }

    const data = (await response.json()) as {
      choices?: Array<{ message?: { content?: string | Array<{ text?: string }> } }>;
    };

    const rawContent = data.choices?.[0]?.message?.content;

    if (typeof rawContent === 'string') {
      return rawContent.trim();
    }

    if (Array.isArray(rawContent)) {
      return rawContent.map((item) => item.text ?? '').join(' ').trim();
    }

    throw new Error('DeepSeek respondió sin contenido.');
  } catch (error) {
    if (
      (error instanceof Error && error.name === 'AbortError') ||
      (typeof error === 'object' &&
        error !== null &&
        'name' in error &&
        (error as { name: string }).name === 'AbortError')
    ) {
      throw new Error(`DeepSeek request timed out after ${DEEPSEEK_TIMEOUT_MS}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function requestDeepSeekJson<T>(params: {
  messages: DeepSeekMessage[];
  schema: z.ZodSchema<T>;
  model?: string;
}): Promise<T> {
  const text = await requestDeepSeekText(params.messages, params.model);
  const normalized = extractJsonBlock(text);

  let parsed: unknown;
  try {
    parsed = JSON.parse(normalized);
  } catch {
    throw new Error('La respuesta de DeepSeek no fue JSON válido.');
  }

  return params.schema.parse(parsed);
}
