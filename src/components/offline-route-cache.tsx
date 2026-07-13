'use client';

import { useEffect } from 'react';
import { usePathname } from 'next/navigation';
import { isBrowserOnline } from '@/lib/network';
import { markPageContentSeen } from '@/lib/offline-cache-warm';

/**
 * When the user visits a route online:
 * - Refresh document + RSC in Cache Storage for this path (hard offline open)
 * - Mark content as "seen" so offline UX knows data should exist
 */
export function OfflineRouteCache() {
  const pathname = usePathname();

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!pathname) return;

    const url = window.location.href;
    const controller = new AbortController();

    const timer = window.setTimeout(() => {
      if (!isBrowserOnline()) return;

      void (async () => {
        try {
          // Document shell for this exact URL
          const docRes = await fetch(url, {
            credentials: 'same-origin',
            cache: 'reload',
            signal: controller.signal,
            headers: { Accept: 'text/html' },
          });
          if (docRes.ok && 'caches' in window) {
            const cache = await caches.open('pages');
            await cache.put(url, docRes.clone());
            await cache.put(pathname, docRes.clone());
          }
        } catch {
          // ignore
        }

        try {
          // RSC for soft client navigation offline
          const rscRes = await fetch(url, {
            credentials: 'same-origin',
            cache: 'reload',
            signal: controller.signal,
            headers: {
              RSC: '1',
              'Next-Router-Prefetch': '1',
            },
          });
          if (rscRes.ok && 'caches' in window) {
            const cache = await caches.open('pages-rsc');
            await cache.put(url, rscRes.clone());
          }
        } catch {
          // ignore
        }

        try {
          const reg = await navigator.serviceWorker?.getRegistration('/');
          const worker = reg?.active ?? reg?.waiting;
          worker?.postMessage({
            type: 'WARM_CACHE_URLS',
            urls: [url, pathname, `${window.location.origin}${pathname}`],
          });
        } catch {
          // ignore
        }

        // User stayed on page online → content loaders likely ran
        markPageContentSeen(pathname);
      })();
    }, 500);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [pathname]);

  useEffect(() => {
    const onOffline = () => {
      window.dispatchEvent(new CustomEvent('sionflow:went-offline'));
    };
    window.addEventListener('offline', onOffline);
    return () => window.removeEventListener('offline', onOffline);
  }, []);

  return null;
}
