/** Browser network helpers */

export function isBrowserOnline(): boolean {
  if (typeof navigator === 'undefined') return true;
  return navigator.onLine;
}

export function isNetworkError(error: unknown): boolean {
  if (!error) return false;
  const msg = error instanceof Error ? error.message : String(error);
  const code =
    typeof error === 'object' && error !== null && 'code' in error
      ? String((error as { code?: string }).code)
      : '';
  return (
    code === 'unavailable' ||
    code === 'deadline-exceeded' ||
    code === 'timeout' ||
    /network|offline|Failed to fetch|ERR_INTERNET|unavailable|timeout|aborted|AbortError/i.test(
      msg
    )
  );
}

/**
 * Race a promise against a timeout. Rejects with a timeout Error so callers
 * can fall back to cache instead of hanging the UI forever.
 */
export function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  label = 'operation'
): Promise<T> {
  if (!Number.isFinite(ms) || ms <= 0) return promise;
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      const err = new Error(`${label} timed out after ${ms}ms`);
      (err as Error & { code?: string }).code = 'timeout';
      reject(err);
    }, ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}

/**
 * Lightweight reachability check. `navigator.onLine` is often wrong on mobile
 * (true with no real connectivity). Use before force-server refreshes.
 */
export async function canReachNetwork(timeoutMs = 2500): Promise<boolean> {
  if (typeof window === 'undefined') return true;
  if (!isBrowserOnline()) return false;

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    // Same-origin tiny resource; cache-bust so SW/network must answer
    const res = await fetch(`/manifest?_ping=${Date.now()}`, {
      method: 'GET',
      cache: 'no-store',
      credentials: 'same-origin',
      signal: controller.signal,
    });
    clearTimeout(timer);
    return res.ok || res.status === 304;
  } catch {
    return false;
  }
}
