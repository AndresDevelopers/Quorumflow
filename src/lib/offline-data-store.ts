/**
 * Secondary offline cache for page data (localStorage).
 * Complements Firestore persistentLocalCache and Workbox page/image caches.
 */
import { getAppStoragePrefix } from '@/lib/app-config';
import { isBrowserOnline } from '@/lib/network';

export function offlineDataKey(namespace: string, barrioOrg: string): string {
  return `${getAppStoragePrefix()}_odc_v1_${namespace}_${barrioOrg}`;
}

export function readOfflineData<T>(key: string): T | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export function writeOfflineData(key: string, data: unknown): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(key, JSON.stringify(data));
  } catch {
    // quota / private mode
  }
}

/**
 * Load data with offline fallback:
 * - Offline: return cache if present, else try loader (Firestore IndexedDB)
 * - Online: loader, then write cache; on failure return stale cache
 */
export async function withOfflineData<T>(
  key: string,
  loader: () => Promise<T>
): Promise<T> {
  if (!isBrowserOnline()) {
    const cached = readOfflineData<T>(key);
    if (cached != null) return cached;
    // Fall through — Firestore may still serve from IndexedDB
  }

  try {
    const data = await loader();
    // Strip non-JSON-safe values via stringify (Timestamps become {seconds,nanoseconds})
    writeOfflineData(key, JSON.parse(JSON.stringify(data)));
    return data;
  } catch (error) {
    const cached = readOfflineData<T>(key);
    if (cached != null) return cached;
    throw error;
  }
}
