'use client';

import { useEffect, useRef } from 'react';
import { useAuth } from '@/contexts/auth-context';
import { useMembersContext } from '@/contexts/members-context';
import {
  collectImageUrls,
  collectMemberImageUrls,
} from '@/lib/offline-cache-warm';
import { cacheImages } from '@/lib/image-offline-cache';
import { isBrowserOnline } from '@/lib/network';

/**
 * Prefetch member photos into local Cache Storage for offline viewing.
 * Page SHELLS are handled separately by OfflineShellPrecache (background).
 * Page CONTENT is cached when each page is visited (Firestore / offline-data-store).
 */
export function OfflineCacheWarmup() {
  const { user, profileLoaded, barrioOrg } = useAuth();
  const { members, loading: membersLoading } = useMembersContext();
  const ranKey = useRef<string | null>(null);

  useEffect(() => {
    if (!profileLoaded || !user || !barrioOrg || membersLoading) return;
    if (!isBrowserOnline()) return;

    const photoCount = members.filter((m) => m.photoURL).length;
    const key = `${user.uid}|${barrioOrg}|${members.length}|${photoCount}`;
    if (ranKey.current === key) return;
    ranKey.current = key;

    const photos = collectImageUrls([
      user.photoURL,
      ...members.flatMap((m) => collectMemberImageUrls(m)),
    ]);

    const timer = window.setTimeout(() => {
      void cacheImages(photos, { concurrency: 5, limit: 300 });
    }, 3000);

    return () => window.clearTimeout(timer);
  }, [user, profileLoaded, barrioOrg, members, membersLoading]);

  useEffect(() => {
    const onOnline = () => {
      ranKey.current = null;
      if (!user || !profileLoaded) return;
      const photos = collectImageUrls([
        user.photoURL,
        ...members.flatMap((m) => collectMemberImageUrls(m)),
      ]);
      void cacheImages(photos, { concurrency: 5, limit: 300 });
    };
    window.addEventListener('online', onOnline);
    return () => window.removeEventListener('online', onOnline);
  }, [user, profileLoaded, members]);

  return null;
}
