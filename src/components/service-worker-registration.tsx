'use client';

import { useEffect } from 'react';

/**
 * In development: always tear down service workers + Cache Storage so stale
 * production Workbox precaches cannot serve old JS (Server Action IDs).
 * In production: register /sw.js (currently a self-unregistering kill-switch
 * until the next production PWA rebuild).
 */
export function ServiceWorkerRegistration() {
  useEffect(() => {
    if (typeof window === 'undefined' || !('serviceWorker' in navigator)) {
      return;
    }

    const nukeCachesAndWorkers = async () => {
      try {
        const registrations = await navigator.serviceWorker.getRegistrations();
        await Promise.all(registrations.map((registration) => registration.unregister()));

        if ('caches' in window) {
          const cacheNames = await caches.keys();
          await Promise.all(cacheNames.map((cacheName) => caches.delete(cacheName)));
        }
      } catch {
        // ignore
      }
    };

    if (process.env.NODE_ENV === 'development') {
      void nukeCachesAndWorkers();
      return;
    }

    // Production: ensure any old SW is replaced by the kill-switch sw.js once,
    // then it unregisters itself. Re-enable full PWA registration when ready.
    void (async () => {
      try {
        await navigator.serviceWorker.register('/sw.js', { scope: '/' });
      } catch {
        // ignore
      }
    })();
  }, []);

  return null;
}
