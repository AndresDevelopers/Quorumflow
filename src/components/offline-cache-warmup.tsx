'use client';

import { useEffect, useRef } from 'react';
import { useAuth } from '@/contexts/auth-context';
import { useMembersContext } from '@/contexts/members-context';
import { collectImageUrls, warmOfflineCaches } from '@/lib/offline-cache-warm';
import { isBrowserOnline } from '@/lib/network';

/**
 * While online, pre-cache main routes + member photos so the PWA works offline.
 * Runs after auth + members are available; debounced and once per session.
 */
export function OfflineCacheWarmup() {
  const { user, profileLoaded, barrioOrg } = useAuth();
  const { members, loading: membersLoading } = useMembersContext();
  const ranKey = useRef<string | null>(null);

  useEffect(() => {
    if (!profileLoaded || !user || !barrioOrg || membersLoading) return;
    if (!isBrowserOnline()) return;

    const key = `${user.uid}|${barrioOrg}|${members.length}`;
    // Re-warm if member list grew a lot; otherwise once per session key
    if (ranKey.current === key) return;
    ranKey.current = key;

    const photos = collectImageUrls([
      user.photoURL,
      ...members.map((m) => m.photoURL),
      ...members.flatMap((m) =>
        Array.isArray((m as { gallery?: string[] }).gallery)
          ? ((m as { gallery?: string[] }).gallery ?? [])
          : []
      ),
    ]).slice(0, 120); // cap to avoid huge warm storms

    const timer = window.setTimeout(() => {
      void warmOfflineCaches(photos);
    }, 2500);

    return () => window.clearTimeout(timer);
  }, [user, profileLoaded, barrioOrg, members, membersLoading]);

  // When connectivity returns, re-warm
  useEffect(() => {
    const onOnline = () => {
      ranKey.current = null;
      if (user && profileLoaded) {
        void warmOfflineCaches(collectImageUrls([user.photoURL, ...members.map((m) => m.photoURL)]).slice(0, 80));
      }
    };
    window.addEventListener('online', onOnline);
    return () => window.removeEventListener('online', onOnline);
  }, [user, profileLoaded, members]);

  return null;
}
