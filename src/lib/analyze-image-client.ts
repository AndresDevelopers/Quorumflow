/**
 * Client-side helper to request an automatic image description.
 * Uses a normal HTTP API (not a Next.js Server Action) so HMR/rebuilds
 * cannot leave the browser with a stale action id.
 */
export async function requestImageDescription(imageDataUrl: string): Promise<string> {
  const response = await fetch('/api/analyze-image', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    cache: 'no-store',
    body: JSON.stringify({ imageData: imageDataUrl }),
  });

  const payload = (await response.json().catch(() => ({}))) as {
    description?: string;
    error?: string;
  };

  if (!response.ok || !payload.description) {
    throw new Error(payload.error || `analyze-image failed (${response.status})`);
  }

  return payload.description;
}
