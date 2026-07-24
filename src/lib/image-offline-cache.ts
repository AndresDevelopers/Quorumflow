/**
 * Local offline cache for remote images (member photos, gallery, Firebase Storage).
 *
 * Strategy:
 * - Prefer Cache Storage (blob:) whenever a copy exists — online and offline
 *   so installed PWA / return visits avoid re-downloading from Firebase Storage
 * - While online and not yet cached: fetch once (CORS), store, then serve blob:
 * - Memory map reuses blob URLs per session (no leak of duplicate blobs)
 * - Lifecycle: new uploads are cached; removed/replaced URLs are uncached;
 *   bulk warm reconciles the active set so deletes/updates stay correct
 *
 * Works even if the Service Worker is inactive — pure client Cache API.
 * The SW also CacheFirsts Storage hosts (see worker/index.js + next-pwa).
 */
import { getAppStoragePrefix } from '@/lib/app-config';
import { isBrowserOnline } from '@/lib/network';

const memoryBlobUrls = new Map<string, string>();
const inflight = new Map<string, Promise<string | null>>();

/** Default cap for bulk warm (members + domain collections). */
export const DEFAULT_IMAGE_WARM_LIMIT = 400;

/** Cache names used by Workbox / custom SW for Firebase images (for invalidation). */
const SW_IMAGE_CACHE_NAMES = [
  'firebase-images-v1',
  'firebase-storage-images',
  'gcs-images',
  'firebase-app-images',
] as const;

function cacheName(): string {
  return `${getAppStoragePrefix()}-img-v1`;
}

function activeIndexKey(scopeKey: string): string {
  return `${getAppStoragePrefix()}-img-active-v1:${scopeKey}`;
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

/** Normalize / dedupe cacheable remote image URLs. */
export function normalizeImageUrls(
  urls: Array<string | null | undefined>
): string[] {
  return [
    ...new Set(
      urls
        .filter((u): u is string => typeof u === 'string' && u.length > 0)
        .map((u) => u.trim())
        .filter(isCacheableImageUrl)
    ),
  ];
}

/** Stable fingerprint of a URL set (order-independent) for warmup dirty checks. */
export function imageUrlSetFingerprint(urls: Array<string | null | undefined>): string {
  return normalizeImageUrls(urls).sort().join('\n');
}

async function openCache(): Promise<Cache | null> {
  if (typeof window === 'undefined' || !('caches' in window)) return null;
  try {
    return await caches.open(cacheName());
  } catch {
    return null;
  }
}

/** Keys under which the same object may have been stored. */
function urlKeyVariants(url: string): string[] {
  const keys = new Set<string>([url]);
  if (typeof window === 'undefined') return [...keys];
  try {
    const absolute =
      url.startsWith('http') || url.startsWith('/')
        ? url.startsWith('http')
          ? url
          : new URL(url, window.location.origin).href
        : url;
    keys.add(absolute);
    const u = new URL(absolute);
    keys.add(`${u.origin}${u.pathname}`);
    keys.add(u.pathname);
    if (u.search) {
      keys.add(`${u.origin}${u.pathname}${u.search}`);
    }
  } catch {
    // keep original only
  }
  return [...keys];
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

function forgetMemoryBlob(url: string): void {
  for (const key of urlKeyVariants(url)) {
    const prev = memoryBlobUrls.get(key);
    if (!prev) continue;
    try {
      URL.revokeObjectURL(prev);
    } catch {
      // ignore
    }
    memoryBlobUrls.delete(key);
  }
  // also clear exact map key
  const prev = memoryBlobUrls.get(url);
  if (prev) {
    try {
      URL.revokeObjectURL(prev);
    } catch {
      // ignore
    }
    memoryBlobUrls.delete(url);
  }
}

function postToServiceWorker(message: Record<string, unknown>): void {
  if (typeof navigator === 'undefined' || !navigator.serviceWorker) return;
  void navigator.serviceWorker.getRegistration('/').then((reg) => {
    const worker = reg?.active ?? reg?.waiting ?? reg?.installing;
    worker?.postMessage(message);
  }).catch(() => {
    // ignore
  });
}

function loadActiveIndex(scopeKey: string): string[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(activeIndexKey(scopeKey));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((u): u is string => typeof u === 'string');
  } catch {
    return [];
  }
}

function saveActiveIndex(scopeKey: string, urls: string[]): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(activeIndexKey(scopeKey), JSON.stringify(urls));
  } catch {
    // quota / private mode
  }
}

function patchActiveIndex(
  scopeKey: string | undefined,
  patch: { add?: string[]; remove?: string[] }
): void {
  if (!scopeKey || typeof window === 'undefined') return;
  const current = new Set(loadActiveIndex(scopeKey));
  for (const u of patch.remove ?? []) current.delete(u);
  for (const u of patch.add ?? []) {
    if (isCacheableImageUrl(u)) current.add(u);
  }
  saveActiveIndex(scopeKey, [...current]);
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
    for (const key of urlKeyVariants(url)) {
      const match =
        (await cache.match(key, { ignoreSearch: false })) ||
        (await cache.match(key, { ignoreSearch: true }));
      if (match?.ok) {
        const blob = await match.blob();
        if (blob?.size) return rememberBlobUrl(url, URL.createObjectURL(blob));
      }
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Remove a URL from local Cache Storage, memory blobs, and SW image caches.
 * Call when the user deletes or replaces an image.
 */
export async function uncacheImage(url: string | null | undefined): Promise<void> {
  if (!url || typeof url !== 'string') return;
  if (url.startsWith('blob:') || url.startsWith('data:')) return;

  forgetMemoryBlob(url);
  inflight.delete(url);

  const cache = await openCache();
  if (cache) {
    for (const key of urlKeyVariants(url)) {
      try {
        await cache.delete(key, { ignoreSearch: false });
        await cache.delete(key, { ignoreSearch: true });
      } catch {
        // ignore per-key failures
      }
    }
  }

  // Client-side SW caches (Workbox names) — best effort
  if (typeof caches !== 'undefined') {
    for (const name of SW_IMAGE_CACHE_NAMES) {
      try {
        const c = await caches.open(name);
        for (const key of urlKeyVariants(url)) {
          await c.delete(key, { ignoreSearch: false });
          await c.delete(key, { ignoreSearch: true });
        }
      } catch {
        // cache may not exist yet
      }
    }
  }

  postToServiceWorker({ type: 'INVALIDATE_CACHE_URLS', urls: [url] });
}

export async function uncacheImages(
  urls: Array<string | null | undefined>
): Promise<number> {
  const unique = normalizeImageUrls(urls);
  await Promise.all(unique.map((u) => uncacheImage(u)));
  return unique.length;
}

/**
 * Fetch and store an image in Cache Storage (best-effort).
 * Returns a blob: URL if stored, otherwise null.
 * Pass `{ force: true }` after a same-URL content replace (rare with Firebase paths).
 */
export async function cacheImage(
  url: string,
  options?: { force?: boolean }
): Promise<string | null> {
  if (!isCacheableImageUrl(url)) return null;
  if (url.startsWith('blob:') || url.startsWith('data:')) return url;

  if (!options?.force) {
    const existing = await getCachedImageSrc(url);
    if (existing) return existing;
  } else {
    await uncacheImage(url);
  }

  const inflightKey = options?.force ? `${url}#force` : url;
  const pending = inflight.get(inflightKey);
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
        cache: options?.force ? 'reload' : 'force-cache',
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
      inflight.delete(inflightKey);
    }
  })();

  inflight.set(inflightKey, task);
  return task;
}

/**
 * Resolve the best src for display:
 * - Prefer local Cache Storage (blob:) whenever available — online or offline
 * - If missing and online: fetch into cache and return blob: when possible
 * - If missing and offline: fall back to original URL (likely fails)
 */
export async function resolveImageSrc(url: string | null | undefined): Promise<string | undefined> {
  if (!url) return undefined;
  if (url.startsWith('blob:') || url.startsWith('data:')) return url;
  if (!isCacheableImageUrl(url)) return url;

  const cached = await getCachedImageSrc(url);
  if (cached) return cached;

  if (!isBrowserOnline()) {
    return url;
  }

  const stored = await cacheImage(url);
  return stored ?? url;
}

/**
 * Prefetch many image URLs into the local cache (throttled).
 */
export async function cacheImages(
  urls: Array<string | null | undefined>,
  options?: { concurrency?: number; limit?: number; force?: boolean }
): Promise<{ cached: number; failed: number }> {
  const concurrency = options?.concurrency ?? 4;
  const limit = options?.limit ?? DEFAULT_IMAGE_WARM_LIMIT;

  const unique = normalizeImageUrls(urls).slice(0, limit);

  let cached = 0;
  let failed = 0;

  for (let i = 0; i < unique.length; i += concurrency) {
    if (!isBrowserOnline()) break;
    const batch = unique.slice(i, i + concurrency);
    const results = await Promise.all(
      batch.map(async (url) => {
        const out = await cacheImage(url, { force: options?.force });
        return out != null;
      })
    );
    for (const ok of results) {
      if (ok) cached += 1;
      else failed += 1;
    }
  }

  // Mirror into SW warm cache when available
  if (unique.length) {
    postToServiceWorker({ type: 'WARM_CACHE_URLS', urls: unique });
  }

  return { cached, failed };
}

/**
 * Reconcile local cache with the current set of live image URLs:
 * - uncache URLs that disappeared (delete / replace)
 * - cache newly appeared URLs
 * - keep the active index so the next run can diff
 */
export async function syncImageCacheToActiveUrls(
  activeUrls: Array<string | null | undefined>,
  options?: {
    scopeKey?: string;
    concurrency?: number;
    limit?: number;
  }
): Promise<{ added: number; removed: number; cached: number; failed: number }> {
  const scopeKey = options?.scopeKey ?? 'default';
  const limit = options?.limit ?? DEFAULT_IMAGE_WARM_LIMIT;
  const active = normalizeImageUrls(activeUrls).slice(0, limit);
  const previous = loadActiveIndex(scopeKey);
  const activeSet = new Set(active);
  const prevSet = new Set(previous);

  const removed = previous.filter((u) => !activeSet.has(u));
  const added = active.filter((u) => !prevSet.has(u));

  if (removed.length) {
    await uncacheImages(removed);
  }

  // Cache full active set (cacheImage no-ops when already present)
  let cached = 0;
  let failed = 0;
  if (isBrowserOnline() && active.length) {
    const result = await cacheImages(active, {
      concurrency: options?.concurrency ?? 4,
      limit,
    });
    cached = result.cached;
    failed = result.failed;
  }

  saveActiveIndex(scopeKey, active);
  return { added: added.length, removed: removed.length, cached, failed };
}

/**
 * Call after a single upload / delete / replace so the local cache tracks the change
 * immediately (without waiting for the next bulk warm).
 */
export async function notifyStorageImageChange(options: {
  previous?: Array<string | null | undefined>;
  next?: Array<string | null | undefined>;
  /** Optional scope used by bulk sync index (e.g. barrioOrg). */
  scopeKey?: string;
}): Promise<void> {
  const prev = new Set(normalizeImageUrls(options.previous ?? []));
  const next = new Set(normalizeImageUrls(options.next ?? []));

  const removed = [...prev].filter((u) => !next.has(u));
  const added = [...next].filter((u) => !prev.has(u));

  if (removed.length) {
    await uncacheImages(removed);
  }
  if (added.length && isBrowserOnline()) {
    await cacheImages(added, { concurrency: 3, limit: added.length });
  }

  patchActiveIndex(options.scopeKey, { add: added, remove: removed });
}

const DOC_STRING_IMAGE_FIELDS = [
  'photoURL',
  'imageUrl',
  'qrImageUrl',
] as const;

const DOC_ARRAY_IMAGE_FIELDS = [
  'imageUrls',
  'baptismPhotos',
  'gallery',
  'images',
] as const;

/**
 * Pull known image fields from a Firestore-like document (members, activities, services, …).
 */
export function extractImageUrlsFromDoc(
  data: Record<string, unknown> | null | undefined
): string[] {
  if (!data || typeof data !== 'object') return [];
  const out: string[] = [];
  for (const field of DOC_STRING_IMAGE_FIELDS) {
    const v = data[field];
    if (typeof v === 'string' && v.trim()) out.push(v.trim());
  }
  for (const field of DOC_ARRAY_IMAGE_FIELDS) {
    const v = data[field];
    if (!Array.isArray(v)) continue;
    for (const item of v) {
      if (typeof item === 'string' && item.trim()) out.push(item.trim());
    }
  }
  return out;
}

/** Collect image-like fields from a member-like object. */
export function collectMemberImageUrls(member: {
  photoURL?: string | null;
  gallery?: string[] | null;
  images?: string[] | null;
  baptismPhotos?: string[] | null;
  imageUrls?: string[] | null;
  imageUrl?: string | null;
  qrImageUrl?: string | null;
}): string[] {
  return extractImageUrlsFromDoc(member as Record<string, unknown>);
}
