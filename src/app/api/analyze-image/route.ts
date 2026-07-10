import { NextResponse } from 'next/server';
import { z } from 'zod';
import { describeImage } from '@/lib/vision';
import logger from '@/lib/logger';

export const runtime = 'nodejs';
/** Allow enough time for Gemini + optional DeepSeek polish */
export const maxDuration = 60;

const bodySchema = z.object({
  imageData: z
    .string()
    .min(32)
    .max(8_000_000)
    .regex(/^data:image\/[a-zA-Z0-9.+-]+;base64,/, 'Invalid image data URL'),
});

export async function POST(request: Request) {
  try {
    const raw = await request.json().catch(() => null);
    const parsed = bodySchema.safeParse(raw);

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Solicitud inválida. Se espera imageData como data URL base64.' },
        { status: 400 }
      );
    }

    const result = await describeImage(parsed.data.imageData);
    return NextResponse.json({ description: result.description });
  } catch (error) {
    logger.error({ error, message: 'Error en /api/analyze-image' });
    const message = error instanceof Error ? error.message : 'Error al analizar la imagen';
    const missingKey =
      message.includes('GEMINI_API_KEY') ||
      message.includes('GOOGLE_GENERATIVE_AI_API_KEY') ||
      message.includes('API key');

    return NextResponse.json(
      {
        error: missingKey
          ? 'Falta GEMINI_API_KEY en el servidor para descripciones automáticas.'
          : message,
      },
      { status: missingKey ? 503 : 502 }
    );
  }
}
