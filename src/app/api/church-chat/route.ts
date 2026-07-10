import { NextResponse } from 'next/server';
import { z } from 'zod';
import logger from '@/lib/logger';
import { fetchLatestChurchNews } from '@/lib/church-news';

const bodySchema = z.object({
  message: z.string().min(2).max(3000).optional(),
  imageDataUrl: z.string().max(10_000_000).regex(/^data:image\/[a-zA-Z0-9.+-]+;base64,/, 'Invalid image').optional(),
  history: z.array(z.object({ role: z.enum(['user', 'assistant']), content: z.string().max(4000) })).max(20).default([]),
  language: z.enum(['en', 'es']).default('es'),
}).refine((data) => Boolean((data.message && data.message.trim().length > 0) || data.imageDataUrl), {
  message: 'Must include text or image.',
});

const DEEPSEEK_API_URL = 'https://api.deepseek.com/v1/chat/completions';
const DEEPSEEK_CHAT_MODEL = process.env.DEEPSEEK_CHAT_MODEL ?? 'deepseek-v4-flash';
const DEEPSEEK_MAX_TOKENS = Number(process.env.DEEPSEEK_MAX_TOKENS) || 800;
const FALLBACK_MODELS = ['deepseek-chat'];

type ChatLanguage = 'en' | 'es';

const systemPromptByLanguage: Record<ChatLanguage, string> = {
  es: `Eres un asistente especializado exclusivamente en temas de La Iglesia de Jesucristo de los Santos de los Últimos Días.

Reglas obligatorias:
1) Solo puedes responder temas del evangelio de Jesucristo desde fuentes oficiales de la Iglesia (manuales, discursos, sitio oficial, Biblioteca del Evangelio, Biblia y obras canónicas) y su interpretación oficial.
2) Si el usuario pregunta algo no relacionado, responde con amabilidad que este chat es exclusivo de temas de la Iglesia.
3) No inventes citas. Si no estás seguro, dilo y sugiere revisar una fuente oficial.
4) Si el usuario pide noticias/actualidad, utiliza el bloque "CONTEXT_NEWS" para confirmar información reciente. Si no hay datos verificables allí, indícalo explícitamente.
5) Responde en español, claro y pastoral, incluyendo recomendaciones prácticas de estudio cuando ayude.
6) Debes mantener continuidad con el historial ("history"): no pierdas el contexto conversacional, evita contradicciones y reconoce seguimiento de preguntas previas.
7) Si la información de actualidad no pudo verificarse o está potencialmente desactualizada, dilo explícitamente antes de responder y luego comparte lo último disponible en CONTEXT_NEWS.`,
  en: `You are an assistant specialized exclusively in topics related to The Church of Jesus Christ of Latter-day Saints.

Mandatory rules:
1) You may only answer gospel topics using official Church sources (handbooks, talks, the official website, Gospel Library, the Bible and other standard works) and their official interpretation.
2) If the user asks about something unrelated, kindly explain that this chat is exclusively for Church topics.
3) Do not invent citations. If you are unsure, say so and suggest checking an official source.
4) If the user asks for news/current events, use the "CONTEXT_NEWS" block to confirm recent information. If there is no verifiable data there, say so explicitly.
5) Respond in English, clearly and pastorally, including practical study recommendations when helpful.
6) Maintain continuity with the conversation history ("history"): do not lose conversational context, avoid contradictions, and acknowledge follow-up questions.
7) If current information could not be verified or may be outdated, say so explicitly before answering and then share the latest available items in CONTEXT_NEWS.`,
};

const apiMessages = {
  es: {
    missingApiKey: 'DEEPSEEK_API_KEY no está configurada en el servidor.',
    messageTooLong: (max: number) => `El mensaje excede el límite de ${max} caracteres.`,
    invalidRequest: 'Solicitud inválida.',
    newsUnverified: (iso: string) =>
      `No se pudo verificar noticias oficiales recientes al momento de la consulta (${iso}).`,
    noVerifiedNews: 'Sin noticias verificadas en esta solicitud.',
    newsVerified: (latest: string, iso: string) =>
      `Noticias verificadas. Última publicación reportada: ${latest}. Consulta realizada: ${iso}.`,
    unknownDate: 'fecha desconocida',
    analyzeImage: 'Analiza esta imagen dentro del contexto oficial de la Iglesia.',
    deepseekFailed: 'No se pudo obtener respuesta de DeepSeek.',
    unexpectedError: 'Error inesperado al consultar la IA.',
  },
  en: {
    missingApiKey: 'DEEPSEEK_API_KEY is not configured on the server.',
    messageTooLong: (max: number) => `The message exceeds the ${max} character limit.`,
    invalidRequest: 'Invalid request.',
    newsUnverified: (iso: string) =>
      `Could not verify recent official news at the time of the request (${iso}).`,
    noVerifiedNews: 'No verified news in this request.',
    newsVerified: (latest: string, iso: string) =>
      `News verified. Latest reported publication: ${latest}. Request made: ${iso}.`,
    unknownDate: 'unknown date',
    analyzeImage: 'Analyze this image within the official Church context.',
    deepseekFailed: 'Could not get a response from DeepSeek.',
    unexpectedError: 'Unexpected error while querying the AI.',
  },
} as const;

export async function POST(request: Request) {
  const raw = await request.json().catch(() => null);
  const preLanguage: ChatLanguage =
    raw && typeof raw === 'object' && (raw as { language?: string }).language === 'en' ? 'en' : 'es';

  if (!process.env.DEEPSEEK_API_KEY) {
    return NextResponse.json(
      { error: apiMessages[preLanguage].missingApiKey },
      { status: 500 }
    );
  }

  const parsed = bodySchema.safeParse(raw);

  if (!parsed.success) {
    const language: ChatLanguage = preLanguage;
    const maxInputChars = 3000;
    const messageIssue = parsed.error.issues.find(
      (issue) => issue.path[0] === 'message' && issue.code === 'too_big'
    );
    if (messageIssue) {
      return NextResponse.json(
        { error: apiMessages[language].messageTooLong(maxInputChars) },
        { status: 400 }
      );
    }
    return NextResponse.json({ error: apiMessages[language].invalidRequest }, { status: 400 });
  }

  const { message, imageDataUrl, history, language } = parsed.data;
  const messages_i18n = apiMessages[language];
  const systemPrompt = systemPromptByLanguage[language];

  const nowIso = new Date().toISOString();
  let newsStatus: string = messages_i18n.newsUnverified(nowIso);
  let contextNews: string = messages_i18n.noVerifiedNews;
  try {
    const news = await fetchLatestChurchNews();
    if (news.length > 0) {
      const latestPublishedAt = news[0]?.publishedAt || messages_i18n.unknownDate;
      newsStatus = messages_i18n.newsVerified(latestPublishedAt, nowIso);
      contextNews = news
        .map((item, index) => `${index + 1}. ${item.title} | ${item.publishedAt} | ${item.link}`)
        .join('\n');
    }
  } catch (error) {
    logger.warn({ error, message: 'No fue posible obtener noticias oficiales para church-chat.' });
  }

  const userText = message?.trim() || messages_i18n.analyzeImage;

  // DeepSeek chat rejects multimodal image_url payloads. When an image is present,
  // describe it with Gemini first and pass a text-only prompt to DeepSeek.
  let imageContext = '';
  if (imageDataUrl) {
    try {
      const { describeImage } = await import('@/lib/vision');
      const vision = await describeImage(imageDataUrl);
      imageContext = `\n\n[IMAGE_DESCRIPTION]\n${vision.description}`;
    } catch (error) {
      logger.warn({ error, message: 'No se pudo analizar la imagen adjunta en church-chat.' });
      imageContext =
        '\n\n[IMAGE_DESCRIPTION]\nNo se pudo analizar la imagen automáticamente (falta GEMINI_API_KEY o falló la API de visión).';
    }
  }

  const messages = [
    { role: 'system', content: `${systemPrompt}\n\nNEWS_STATUS:\n${newsStatus}\n\nCONTEXT_NEWS:\n${contextNews}` },
    ...history.map((item) => ({ role: item.role, content: item.content })),
    {
      role: 'user',
      content: `${userText}${imageContext}`,
    },
  ];

  try {
    const modelCandidates = Array.from(new Set([DEEPSEEK_CHAT_MODEL, ...FALLBACK_MODELS]));
    let answer = '';
    let lastErrorText = '';
    let lastStatus = 502;

    for (const model of modelCandidates) {
      const response = await fetch(DEEPSEEK_API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${process.env.DEEPSEEK_API_KEY}`,
        },
        body: JSON.stringify({
          model,
          messages,
          temperature: 0.3,
          max_tokens: DEEPSEEK_MAX_TOKENS,
        }),
      });

      if (!response.ok) {
        lastStatus = response.status;
        lastErrorText = await response.text();
        logger.warn({ message: 'DeepSeek request failed for model candidate', model, status: response.status });
        continue;
      }

      const data = (await response.json()) as {
        choices?: Array<{ message?: { content?: string | Array<{ text?: string }> } }>;
      };
      const rawContent = data.choices?.[0]?.message?.content;
      answer = typeof rawContent === 'string'
        ? rawContent.trim()
        : Array.isArray(rawContent)
          ? rawContent.map((item) => item.text ?? '').join(' ').trim()
          : '';

      if (answer) {
        break;
      }
    }

    if (!answer) {
      logger.error({
        message: 'DeepSeek request failed in church-chat route after all model candidates',
        status: lastStatus,
        errorText: lastErrorText,
      });
      return NextResponse.json({ error: messages_i18n.deepseekFailed }, { status: 502 });
    }

    return NextResponse.json({ answer, contextNews });
  } catch (error) {
    logger.error({ error, message: 'Unexpected error in church-chat route' });
    return NextResponse.json({ error: messages_i18n.unexpectedError }, { status: 500 });
  }
}
