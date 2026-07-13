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
    /network|offline|Failed to fetch|ERR_INTERNET|unavailable/i.test(msg)
  );
}
