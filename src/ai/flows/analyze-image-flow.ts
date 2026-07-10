/**
 * Shared image analysis helper (server-only logic via @/lib/vision).
 * Prefer POST /api/analyze-image from the client — avoids Next.js Server Action
 * ID mismatches after HMR ("UnrecognizedActionError").
 */
import { z } from 'zod';
import { describeImage } from '@/lib/vision';

const AnalyzeImageInputSchema = z.object({
  imageData: z.string().describe('The base64 encoded image data (data:image/jpeg;base64,...).'),
});
export type AnalyzeImageInput = z.infer<typeof AnalyzeImageInputSchema>;

const AnalyzeImageOutputSchema = z.object({
  description: z.string().describe('A detailed description of the image content.'),
});
export type AnalyzeImageOutput = z.infer<typeof AnalyzeImageOutputSchema>;

export async function analyzeImage(input: AnalyzeImageInput): Promise<AnalyzeImageOutput> {
  const validatedInput = AnalyzeImageInputSchema.parse(input);
  const result = await describeImage(validatedInput.imageData);
  return AnalyzeImageOutputSchema.parse(result);
}

