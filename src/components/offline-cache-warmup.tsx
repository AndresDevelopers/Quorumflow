'use client';

import { useEffect, useRef } from 'react';
import { useAuth } from '@/contexts/auth-context';
import { useMembersContext } from '@/contexts/members-context';
import { collectAllWarmImageUrls } from '@/lib/offline-cache-warm';
import {
  DEFAULT_IMAGE_WARM_LIMIT,
  imageUrlSetFingerprint,
  syncImageCacheToActiveUrls,
} from '@/lib/image-offline-cache';
import { isBrowserOnline } from '@/lib/network';

/**
 * Prefetch domain photos into local Cache Storage and keep the cache in sync
 * when URLs are added, replaced, or removed (members refresh / domain data).
 *
 * Page SHELLS are handled separately by OfflineShellPrecache (background).
 */
export function OfflineCacheWarmup() {
  const { user, profileLoaded, barrioOrg } = useAuth();
  const { members, loading: membersLoading } = useMembersContext();
  const ranKey = useRef<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!profileLoaded || !user || !barrioOrg || membersLoading) return;
    if (!isBrowserOnline()) return;

    // Fingerprint actual photo URLs so replace/delete re-runs sync (not just counts)
    const memberPhotos = members.flatMap((m) => [
      m.photoURL,
      ...(Array.isArray(m.baptismPhotos) ? m.baptismPhotos : []),
    ]);
    const key = `${user.uid}|${barrioOrg}|${imageUrlSetFingerprint([
      user.photoURL,
      ...memberPhotos,
    ])}|n=${members.length}`;
    if (ranKey.current === key) return;
    ranKey.current = key;

    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;

    const timer = window.setTimeout(() => {
      void (async () => {
        if (ac.signal.aborted || !isBrowserOnline()) return;
        try {
          const photos = await collectAllWarmImageUrls({
            barrioOrg,
            memberLike: members,
            extra: [user.photoURL],
          });
          if (ac.signal.aborted || !isBrowserOnline()) return;
          // Adds new URLs, uncache removed/replaced ones, update active index
          await syncImageCacheToActiveUrls(photos, {
            scopeKey: barrioOrg,
            concurrency: 4,
            limit: DEFAULT_IMAGE_WARM_LIMIT,
          });
        } catch (err) {
          console.warn('[OfflineCacheWarmup] image sync failed', err);
        }
      })();
    }, 3000);

    return () => {
      window.clearTimeout(timer);
      ac.abort();
    };
  }, [user, profileLoaded, barrioOrg, members, membersLoading]);

  useEffect(() => {
    if (!user || !profileLoaded || !barrioOrg) return;

    const runSync = async (reason: string) => {
      if (!isBrowserOnline()) return;
      try {
        const photos = await collectAllWarmImageUrls({
          barrioOrg,
          memberLike: members,
          extra: [user.photoURL],
        });
        await syncImageCacheToActiveUrls(photos, {
          scopeKey: barrioOrg,
          concurrency: 4,
          limit: DEFAULT_IMAGE_WARM_LIMIT,
        });
      } catch (err) {
        console.warn(`[OfflineCacheWarmup] ${reason} failed`, err);
      }
    };

    const onOnline = () => {
      ranKey.current = null;
      void runSync('online re-sync');
    };

    // Domain collections (activities/services/…) may change without member list updates
    let lastVisibilitySync = 0;
    const MIN_VISIBILITY_MS = 45_000;
    const onVisibility = () => {
      if (document.visibilityState !== 'visible') return;
      if (Date.now() - lastVisibilitySync < MIN_VISIBILITY_MS) return;
      lastVisibilitySync = Date.now();
      void runSync('visibility re-sync');
    };

    window.addEventListener('online', onOnline);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('online', onOnline);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [user, profileLoaded, barrioOrg, members]);

  return null;
}
