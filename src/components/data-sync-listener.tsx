'use client';

import { useEffect, useRef } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { firestore } from '@/lib/firebase';
import { useAuth } from '@/contexts/auth-context';
import { useRefresh } from '@/contexts/refresh-context';
import {
  encodeBarrioOrgDocId,
  SYNC_SIGNALS_COLLECTION,
  type SyncSignalPayload,
} from '@/lib/sync-signal';

const DEBOUNCE_MS = 1_200;

/**
 * Listens for Cloud Function sync signals (`c_sync_signals/{barrioOrg}`)
 * and silently refreshes app data. The header refresh button remains the
 * manual fallback if this pipeline fails.
 */
export function DataSyncListener() {
  const { barrioOrg, user } = useAuth();
  const { requestRefresh, isRefreshing, markLastSyncTime } = useRefresh();
  const lastVersionRef = useRef<number | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isRefreshingRef = useRef(isRefreshing);
  isRefreshingRef.current = isRefreshing;

  useEffect(() => {
    if (!user || !barrioOrg || !firestore) return;

    // Only this barrio|organización — never global
    const signalId = encodeBarrioOrgDocId(barrioOrg);
    const ref = doc(firestore, SYNC_SIGNALS_COLLECTION, signalId);

    const unsub = onSnapshot(
      ref,
      (snap) => {
        if (!snap.exists()) return;
        const data = snap.data() as SyncSignalPayload;

        // Extra guard: ignore signals for another ward/org
        if (data.barrioOrg && data.barrioOrg !== barrioOrg) return;

        const version =
          typeof data.version === 'number'
            ? data.version
            : typeof data.updatedAtMs === 'number'
              ? data.updatedAtMs
              : null;
        if (version == null) return;

        // First snapshot after mount = baseline (don't refresh on open)
        if (lastVersionRef.current === null) {
          lastVersionRef.current = version;
          // Show last CF signal time if we never synced manually this session
          if (typeof data.updatedAtMs === 'number' && data.updatedAtMs > 0) {
            markLastSyncTime(new Date(data.updatedAtMs));
          }
          return;
        }
        if (version <= lastVersionRef.current) return;
        lastVersionRef.current = version;

        // Clock updates as soon as CF publishes something new for this barrioOrg
        markLastSyncTime(new Date(version));

        if (debounceRef.current) clearTimeout(debounceRef.current);
        debounceRef.current = setTimeout(() => {
          if (isRefreshingRef.current) return;
          console.log('[DataSyncListener] auto-refresh from CF signal', {
            barrioOrg,
            version,
            collection: data.lastCollection,
          });
          void requestRefresh({ silent: true });
        }, DEBOUNCE_MS);
      },
      (error) => {
        console.warn('[DataSyncListener] onSnapshot error (manual refresh still works)', error);
      }
    );

    return () => {
      unsub();
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [user, barrioOrg, requestRefresh, markLastSyncTime]);

  // FCM / SW data-sync while app is open
  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      const data = event.data;
      if (!data || data.type !== 'DATA_SYNC') return;
      // Scope: only this barrio|organización
      if (barrioOrg && data.barrioOrg && data.barrioOrg !== barrioOrg) return;
      markLastSyncTime(new Date());
      if (isRefreshingRef.current) return;
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        void requestRefresh({ silent: true });
      }, DEBOUNCE_MS);
    };

    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.addEventListener('message', onMessage);
    }
    window.addEventListener('message', onMessage);

    const onCustom = (event: Event) => {
      const detail = (event as CustomEvent).detail as { barrioOrg?: string } | undefined;
      if (barrioOrg && detail?.barrioOrg && detail.barrioOrg !== barrioOrg) return;
      markLastSyncTime(new Date());
      if (isRefreshingRef.current) return;
      void requestRefresh({ silent: true });
    };
    window.addEventListener('sionflow:data-sync', onCustom);

    return () => {
      if ('serviceWorker' in navigator) {
        navigator.serviceWorker.removeEventListener('message', onMessage);
      }
      window.removeEventListener('message', onMessage);
      window.removeEventListener('sionflow:data-sync', onCustom);
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [barrioOrg, requestRefresh, markLastSyncTime]);

  return null;
}
