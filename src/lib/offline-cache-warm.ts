/**
 * Warm the service worker / Cache Storage with shell routes, static assets
 * and media so the PWA can open offline after at least one online session.
 */
import { navigationItems } from '@/lib/navigation';
import { isBrowserOnline } from '@/lib/network';

const WARM_STATIC = [
  '/',
  '/login',
  '/members',
  '/council',
  '/observations',
  '/converts',
  '/ministering',
  '/birthdays',
  '/family-search',
  '/missionary-work',
  '/service',
  '/church-chat',
  '/reports',
  '/settings',
  '/profile',
  '/~offline',
  '/manifest',
  '/api/icon',
  '/logo.png',
  '/icono-app.png',
  '/favicon.ico',
];

/** Dedupe + absolute same-origin URLs for SW warm. */
function toAbsoluteUrls(paths: string[]): string[] {
  if (typeof window === 'undefined') return [];
  const origin = window.location.origin;
  const set = new Set<string>();
  for (const p of paths) {
    if (!p) continue;
    try {
      const url = p.startsWith('http') ? p : new URL(p, origin).href;
      set.add(url);
    } catch {
      // skip bad urls
    }
  }
  return [...set];
}

/**
 * Fetch URLs so Workbox NetworkFirst / CacheFirst handlers store them,
 * and ask the custom worker to put them in warm caches.
 */
export async function warmOfflineCaches(extraUrls: string[] = []): Promise<void> {
  if (typeof window === 'undefined' || !isBrowserOnline()) return;
  if (!('caches' in window) && !('serviceWorker' in navigator)) return;

  const navPaths = navigationItems.map((item) => item.href);
  const all = toAbsoluteUrls([...WARM_STATIC, ...navPaths, ...extraUrls]);

  // 1) Browser fetch — populates Workbox runtime caches (pages, apis, images)
  const CONCURRENCY = 4;
  for (let i = 0; i < all.length; i += CONCURRENCY) {
    const batch = all.slice(i, i + CONCURRENCY);
    await Promise.all(
      batch.map(async (url) => {
        try {
          await fetch(url, {
            credentials: url.startsWith(window.location.origin) ? 'same-origin' : 'omit',
            // Prefer fresh copy while online so cache is current
            cache: 'no-cache',
          });
        } catch {
          // ignore
        }
      })
    );
  }

  // 2) Tell custom SW bridge to store a warm copy
  try {
    const reg = await navigator.serviceWorker?.getRegistration('/');
    const worker = reg?.active ?? reg?.waiting ?? reg?.installing;
    worker?.postMessage({ type: 'WARM_CACHE_URLS', urls: all });
  } catch {
    // ignore
  }

  // 3) Also stash start-url document in Cache Storage for cold open
  try {
    const cache = await caches.open('start-url');
    const start = await fetch('/', { credentials: 'same-origin', cache: 'no-cache' });
    if (start.ok && !start.redirected) {
      await cache.put('/', start.clone());
    }
  } catch {
    // ignore
  }
}

/** Extract image URLs worth caching (member photos, gallery, etc.). */
export function collectImageUrls(sources: Array<string | null | undefined>): string[] {
  const out: string[] = [];
  for (const src of sources) {
    if (!src || typeof src !== 'string') continue;
    if (
      src.startsWith('https://firebasestorage.googleapis.com') ||
      src.startsWith('https://storage.googleapis.com') ||
      src.includes('.firebasestorage.app') ||
      src.startsWith('/') // local public assets
    ) {
      out.push(src);
    }
  }
  return out;
}
