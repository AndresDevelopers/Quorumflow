'use client';

import { useEffect, useState } from 'react';
import {
  cacheImage,
  getCachedImageSrc,
  isCacheableImageUrl,
  resolveImageSrc,
} from '@/lib/image-offline-cache';
import { isBrowserOnline } from '@/lib/network';

/**
 * Returns a displayable image src that works offline when previously cached.
 * Online: original URL (and warms cache). Offline: blob: from Cache Storage.
 */
export function useOfflineImageSrc(
  src: string | null | undefined
): string | undefined {
  const [resolved, setResolved] = useState<string | undefined>(() => {
    if (!src) return undefined;
    if (src.startsWith('blob:') || src.startsWith('data:')) return src;
    // Online first paint uses original; offline starts empty until cache resolves
    return isBrowserOnline() || !isCacheableImageUrl(src) ? src : undefined;
  });

  useEffect(() => {
    let cancelled = false;
    if (!src) {
      setResolved(undefined);
      return;
    }
    if (src.startsWith('blob:') || src.startsWith('data:')) {
      setResolved(src);
      return;
    }
    if (!isCacheableImageUrl(src)) {
      setResolved(src);
      return;
    }

    // Optimistic: show network URL when online
    if (isBrowserOnline()) {
      setResolved(src);
      void cacheImage(src);
      return;
    }

    // Offline: prefer cached blob
    void (async () => {
      const cached = await getCachedImageSrc(src);
      if (cancelled) return;
      if (cached) {
        setResolved(cached);
        return;
      }
      const fallback = await resolveImageSrc(src);
      if (!cancelled) setResolved(fallback);
    })();

    return () => {
      cancelled = true;
    };
  }, [src]);

  // When going offline mid-session, swap to blob if we have it
  useEffect(() => {
    if (!src || !isCacheableImageUrl(src)) return;

    const onOffline = () => {
      void getCachedImageSrc(src).then((cached) => {
        if (cached) setResolved(cached);
      });
    };
    const onOnline = () => {
      setResolved(src);
      void cacheImage(src);
    };

    window.addEventListener('offline', onOffline);
    window.addEventListener('online', onOnline);
    return () => {
      window.removeEventListener('offline', onOffline);
      window.removeEventListener('online', onOnline);
    };
  }, [src]);

  return resolved;
}
