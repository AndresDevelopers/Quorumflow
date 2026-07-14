'use client';

import { useEffect, useRef } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { firestore } from '@/lib/firebase';
import { useAuth } from '@/contexts/auth-context';
import {
  APP_DATA_REFRESH_EVENT,
  useRefresh,
} from '@/contexts/refresh-context';
import {
  encodeBarrioOrgDocId,
  SYNC_SIGNALS_COLLECTION,
  type SyncSignalPayload,
} from '@/lib/sync-signal';
import { isBrowserOnline } from '@/lib/network';

const DEBOUNCE_MS = 1_200;
/**
 * After a local refresh (especially manual), CF may still publish signals for
 * writes flushed during that same pass (offline queue, etc.). Absorb those
 * echoes so the header does not flip to "Automática" right after a manual sync.
 */
const POST_REFRESH_GRACE_MS = 4_000;

/**
 * Listens for Cloud Function sync signals (`c_sync_signals/{barrioOrg}`)
 * and silently refreshes app data only when there is a *new* remote change
 * the client has not already consumed. Manual refresh remains the fallback
 * and must not be relabeled by CF echoes of the same work.
 */
export function DataSyncListener() {
  const { barrioOrg, user } = useAuth();
  const { requestRefresh, isRefreshing } = useRefresh();
  const lastVersionRef = useRef<number | null>(null);
  /** Highest signal version already covered by a completed local refresh */
  const lastConsumedVersionRef = useRef(0);
  /** Ignore auto-refresh until this timestamp (ms) */
  const graceUntilRef = useRef(0);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingVersionRef = useRef<number | null>(null);
  const isRefreshingRef = useRef(isRefreshing);
  isRefreshingRef.current = isRefreshing;

  const cancelPendingAutoRefresh = () => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }
    pendingVersionRef.current = null;
  };

  const absorbVersion = (version: number) => {
    lastVersionRef.current = Math.max(lastVersionRef.current ?? 0, version);
    lastConsumedVersionRef.current = Math.max(
      lastConsumedVersionRef.current,
      version
    );
  };

  // New ward/org → reset version cursors (never carry another tenant's signal)
  useEffect(() => {
    lastVersionRef.current = null;
    lastConsumedVersionRef.current = 0;
    graceUntilRef.current = 0;
    cancelPendingAutoRefresh();
  }, [barrioOrg]);

  useEffect(() => {
    if (!user || !barrioOrg || !firestore) return;

    // Re-subscribe must re-baseline; keep lastConsumed so we do not re-auto-sync
    lastVersionRef.current = null;

    // Only this barrio|organización — never global
    const signalId = encodeBarrioOrgDocId(barrioOrg);
    const ref = doc(firestore, SYNC_SIGNALS_COLLECTION, signalId);

    const scheduleAutoRefresh = (version: number, meta: SyncSignalPayload) => {
      pendingVersionRef.current = version;
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        debounceRef.current = null;
        const pending = pendingVersionRef.current;
        pendingVersionRef.current = null;
        if (pending == null) return;

        // Another local refresh already covered this (or a newer) signal
        if (pending <= lastConsumedVersionRef.current) return;
        if (Date.now() < graceUntilRef.current) {
          absorbVersion(pending);
          return;
        }
        if (isRefreshingRef.current) {
          absorbVersion(pending);
          return;
        }
        if (!isBrowserOnline()) return;

        console.log('[DataSyncListener] auto-refresh from CF signal', {
          barrioOrg,
          version: pending,
          collection: meta.lastCollection,
        });
        void requestRefresh({ silent: true });
      }, DEBOUNCE_MS);
    };

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

        // First snapshot after subscribe = baseline only.
        // Do NOT overwrite lastSyncTime/source (manual from localStorage must stick).
        if (lastVersionRef.current === null) {
          lastVersionRef.current = version;
          lastConsumedVersionRef.current = Math.max(
            lastConsumedVersionRef.current,
            version
          );
          return;
        }

        if (version <= lastVersionRef.current) return;

        // Advance cursor so we never reprocess this version
        lastVersionRef.current = version;

        // Already pulled by a local refresh (manual or previous auto)
        if (version <= lastConsumedVersionRef.current) {
          return;
        }

        // In-flight refresh will include this data — absorb, do not re-label as auto
        if (isRefreshingRef.current || Date.now() < graceUntilRef.current) {
          absorbVersion(version);
          cancelPendingAutoRefresh();
          return;
        }

        // Truly new remote change → silent auto-refresh.
        // Clock/source are updated only when requestRefresh completes (silent → automatic).
        scheduleAutoRefresh(version, data);
      },
      (error) => {
        console.warn(
          '[DataSyncListener] onSnapshot error (manual refresh still works)',
          error
        );
      }
    );

    return () => {
      unsub();
      cancelPendingAutoRefresh();
    };
    // requestRefresh is stable enough; avoid re-subscribing on every lastSyncTime change
  }, [user, barrioOrg, requestRefresh]);

  // After any successful online refresh, treat current CF signal as consumed
  // so echoes from flushOfflineSync / own writes do not flip UI to "Automática".
  useEffect(() => {
    const onLocalRefresh = (event: Event) => {
      const detail = (event as CustomEvent).detail as
        | {
            offline?: boolean;
            lastSyncTime?: string | null;
          }
        | undefined;

      if (detail?.offline === true) return;

      const completedAt = detail?.lastSyncTime
        ? Date.parse(detail.lastSyncTime)
        : Date.now();
      const completedMs = Number.isFinite(completedAt) ? completedAt : Date.now();

      graceUntilRef.current = Math.max(
        graceUntilRef.current,
        completedMs + POST_REFRESH_GRACE_MS
      );
      lastConsumedVersionRef.current = Math.max(
        lastConsumedVersionRef.current,
        completedMs,
        lastVersionRef.current ?? 0
      );
      if (lastVersionRef.current != null) {
        lastConsumedVersionRef.current = Math.max(
          lastConsumedVersionRef.current,
          lastVersionRef.current
        );
      }

      // Drop any auto-refresh scheduled for signals that raced with this pass
      cancelPendingAutoRefresh();
    };

    window.addEventListener(APP_DATA_REFRESH_EVENT, onLocalRefresh);
    return () => {
      window.removeEventListener(APP_DATA_REFRESH_EVENT, onLocalRefresh);
    };
  }, []);

  // FCM / SW data-sync while app is open
  useEffect(() => {
    const handleRemoteDataSync = (versionHint?: number) => {
      if (isRefreshingRef.current || Date.now() < graceUntilRef.current) {
        if (typeof versionHint === 'number' && versionHint > 0) {
          absorbVersion(versionHint);
        }
        return;
      }
      if (!isBrowserOnline()) return;

      // Prefer the CF onSnapshot path when we already track versions;
      // FCM is a wake-up for when the tab was backgrounded.
      if (
        typeof versionHint === 'number' &&
        versionHint > 0 &&
        versionHint <= lastConsumedVersionRef.current
      ) {
        absorbVersion(versionHint);
        return;
      }

      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        debounceRef.current = null;
        if (isRefreshingRef.current || Date.now() < graceUntilRef.current) {
          return;
        }
        if (!isBrowserOnline()) return;
        void requestRefresh({ silent: true });
      }, DEBOUNCE_MS);
    };

    const onMessage = (event: MessageEvent) => {
      const data = event.data;
      // SW posts DATA_SYNC; tolerate CF-style data-sync if ever forwarded raw
      if (!data || (data.type !== 'DATA_SYNC' && data.type !== 'data-sync')) {
        return;
      }
      // Scope: only this barrio|organización
      if (barrioOrg && data.barrioOrg && data.barrioOrg !== barrioOrg) return;

      const versionRaw = data.version;
      const versionHint =
        typeof versionRaw === 'number'
          ? versionRaw
          : typeof versionRaw === 'string'
            ? Number(versionRaw)
            : undefined;

      handleRemoteDataSync(
        typeof versionHint === 'number' && !Number.isNaN(versionHint)
          ? versionHint
          : undefined
      );
    };

    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.addEventListener('message', onMessage);
    }
    window.addEventListener('message', onMessage);

    const onCustom = (event: Event) => {
      const detail = (event as CustomEvent).detail as
        | { barrioOrg?: string; version?: string | number }
        | undefined;
      if (barrioOrg && detail?.barrioOrg && detail.barrioOrg !== barrioOrg) {
        return;
      }
      const versionHint =
        typeof detail?.version === 'number'
          ? detail.version
          : typeof detail?.version === 'string'
            ? Number(detail.version)
            : undefined;
      handleRemoteDataSync(
        typeof versionHint === 'number' && !Number.isNaN(versionHint)
          ? versionHint
          : undefined
      );
    };
    window.addEventListener('sionflow:data-sync', onCustom);

    return () => {
      if ('serviceWorker' in navigator) {
        navigator.serviceWorker.removeEventListener('message', onMessage);
      }
      window.removeEventListener('message', onMessage);
      window.removeEventListener('sionflow:data-sync', onCustom);
      cancelPendingAutoRefresh();
    };
  }, [barrioOrg, requestRefresh]);

  return null;
}
