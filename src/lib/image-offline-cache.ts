/**
 * Local offline cache for remote images (member photos, gallery, Firebase Storage).
 *
 * Strategy:
 * - While online: fetch once (CORS) and store Response in Cache Storage
 * - While offline: serve blob: object URLs from that cache
 * - Memory map reuses blob URLs per session (no leak of duplicate blobs)
 *
 * Works even if the Service Worker is inactive — pure client Cache API.
 */
import { getAppStoragePrefix } from '@/lib/app-config';
import { isBrowserOnline } from '@/lib/network';

const memoryBlobUrls = new Map<string, string>();
const inflight = new Map<string, Promise<string | null>>();

function cacheName(): string {
  return `${getAppStoragePrefix()}-img-v1`;
}

export function isCacheableImageUrl(url: string | null | undefined): boolean {
  if (!url || typeof url !== 'string') return false;
  if (url.startsWith('blob:') || url.startsWith('data:')) return false;
  // Local public assets are same-origin and usually already SW-cached
  if (url.startsWith('/')) return true;
  try {
    const u = new URL(url, typeof window !== 'undefined' ? window.location.origin : 'https://local');
    return (
      u.hostname.includes('firebasestorage.googleapis.com') ||
      u.hostname.includes('storage.googleapis.com') ||
      u.hostname.endsWith('.firebasestorage.app') ||
      u.origin === (typeof window !== 'undefined' ? window.location.origin : '')
    );
  } catch {
    return false;
  }
}

async function openCache(): Promise<Cache | null> {
  if (typeof window === 'undefined' || !('caches' in window)) return null;
  try {
    return await caches.open(cacheName());
  } catch {
    return null;
  }
}

function rememberBlobUrl(url: string, blobUrl: string): string {
  const prev = memoryBlobUrls.get(url);
  if (prev && prev !== blobUrl) {
    try {
      URL.revokeObjectURL(prev);
    } catch {
      // ignore
    }
  }
  memoryBlobUrls.set(url, blobUrl);
  return blobUrl;
}

/**
 * Read a cached image as a blob: URL (or null if not cached).
 */
export async function getCachedImageSrc(url: string): Promise<string | null> {
  if (!url) return null;
  if (url.startsWith('blob:') || url.startsWith('data:')) return url;

  const mem = memoryBlobUrls.get(url);
  if (mem) return mem;

  const cache = await openCache();
  if (!cache) return null;

  try {
    const match =
      (await cache.match(url, { ignoreSearch: false })) ||
      (await cache.match(url, { ignoreSearch: true }));
    if (!match || !match.ok) return null;
    const blob = await match.blob();
    if (!blob || blob.size === 0) return null;
    return rememberBlobUrl(url, URL.createObjectURL(blob));
  } catch {
    return null;
  }
}

/**
 * Fetch and store an image in Cache Storage (best-effort).
 * Returns a blob: URL if stored, otherwise null.
 */
export async function cacheImage(url: string): Promise<string | null> {
  if (!isCacheableImageUrl(url)) return null;
  if (url.startsWith('blob:') || url.startsWith('data:')) return url;

  const existing = await getCachedImageSrc(url);
  if (existing) return existing;

  const pending = inflight.get(url);
  if (pending) return pending;

  const task = (async (): Promise<string | null> => {
    if (!isBrowserOnline()) {
      return getCachedImageSrc(url);
    }

    const cache = await openCache();
    if (!cache) return null;

    try {
      const absolute =
        url.startsWith('http') || url.startsWith('/')
          ? url.startsWith('http')
            ? url
            : new URL(url, window.location.origin).href
          : url;

      const response = await fetch(absolute, {
        mode: 'cors',
        credentials: 'omit',
        cache: 'force-cache',
      });

      if (!response.ok) return null;

      // Store a clean Response (some browsers reject opaque)
      const blob = await response.blob();
      if (!blob.size) return null;

      const stored = new Response(blob, {
        status: 200,
        headers: {
          'Content-Type': blob.type || 'image/jpeg',
          'Cache-Control': 'max-age=31536000',
        },
      });
      await cache.put(absolute, stored);

      // Also put original key if different (relative vs absolute)
      if (absolute !== url) {
        await cache.put(url, stored.clone());
      }

      return rememberBlobUrl(url, URL.createObjectURL(blob));
    } catch (error) {
      console.warn('[image-offline-cache] cache failed', url, error);
      return null;
    } finally {
      inflight.delete(url);
    }
  })();

  inflight.set(url, task);
  return task;
}

/**
 * Resolve the best src for display:
 * - Online: original URL immediately; warm cache in background
 * - Offline: blob: from Cache Storage, else original (may fail)
 */
export async function resolveImageSrc(url: string | null | undefined): Promise<string | undefined> {
  if (!url) return undefined;
  if (url.startsWith('blob:') || url.startsWith('data:')) return url;
  if (!isCacheableImageUrl(url)) return url;

  if (!isBrowserOnline()) {
    const cached = await getCachedImageSrc(url);
    return cached ?? url;
  }

  // Online: fire-and-forget cache, show network URL now
  void cacheImage(url);
  return url;
}

/**
 * Prefetch many image URLs into the local cache (throttled).
 */
export async function cacheImages(
  urls: Array<string | null | undefined>,
  options?: { concurrency?: number; limit?: number }
): Promise<{ cached: number; failed: number }> {
  const concurrency = options?.concurrency ?? 4;
  const limit = options?.limit ?? 250;

  const unique = [
    ...new Set(
      urls
        .filter((u): u is string => typeof u === 'string' && u.length > 0)
        .filter(isCacheableImageUrl)
    ),
  ].slice(0, limit);

  let cached = 0;
  let failed = 0;

  for (let i = 0; i < unique.length; i += concurrency) {
    if (!isBrowserOnline()) break;
    const batch = unique.slice(i, i + concurrency);
    const results = await Promise.all(
      batch.map(async (url) => {
        const out = await cacheImage(url);
        return out != null;
      })
    );
    for (const ok of results) {
      if (ok) cached += 1;
      else failed += 1;
    }
  }

  // Mirror into SW warm cache when available
  try {
    const reg = await navigator.serviceWorker?.getRegistration('/');
    const worker = reg?.active ?? reg?.waiting;
    if (worker && unique.length) {
      worker.postMessage({ type: 'WARM_CACHE_URLS', urls: unique });
    }
  } catch {
    // ignore
  }

  return { cached, failed };
}

/** Collect image-like fields from a member-like object. */
export function collectMemberImageUrls(member: {
  photoURL?: string | null;
  gallery?: string[] | null;
  images?: string[] | null;
  baptismPhotos?: string[] | null;
  imageUrls?: string[] | null;
}): string[] {
  const out: string[] = [];
  if (member.photoURL) out.push(member.photoURL);
  if (Array.isArray(member.gallery)) out.push(...member.gallery);
  if (Array.isArray(member.images)) out.push(...member.images);
  if (Array.isArray(member.baptismPhotos)) out.push(...member.baptismPhotos);
  if (Array.isArray(member.imageUrls)) out.push(...member.imageUrls);
  return out;
}
