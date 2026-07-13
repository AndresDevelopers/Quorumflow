'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useRouter } from 'next/navigation';
import { useToast } from '@/hooks/use-toast';
import { useI18n } from '@/contexts/i18n-context';
import { useAuth } from '@/contexts/auth-context';
import { getAppStoragePrefix } from '@/lib/app-config';
import {
  beginForceServerReads,
  clearAiSuggestionCaches,
  clearForceServerReads,
} from '@/lib/firestore-query';
import { canReachNetwork, isBrowserOnline, withTimeout } from '@/lib/network';
import { flushOfflineSync } from '@/lib/firebase-offline-sync';

/**
 * Handler for manual refresh.
 * May return `true` if it applied real data changes (so the UI can message accordingly).
 */
export type RefreshHandler = () => void | boolean | Promise<void | boolean>;

export type RequestRefreshOptions = {
  /**
   * Silent = auto-sync from Cloud Function (no toast).
   * Manual button uses silent: false (default) as fallback UX.
   */
  silent?: boolean;
};

interface RefreshContextValue {
  /** True while a manual refresh is in progress */
  isRefreshing: boolean;
  /** Last successful sync time (updated even when there is no new data) */
  lastSyncTime: Date | null;
  /** Bumps when a refresh finishes; use as key to remount page content */
  refreshGeneration: number;
  /** Register a handler that runs on every manual refresh. Returns unregister fn. */
  registerRefreshHandler: (handler: RefreshHandler) => () => void;
  /**
   * Refresh page data from server/cache.
   * Auto path (Cloud Function signal): `{ silent: true }`.
   * Header button (fallback): default / `{ silent: false }`.
   * Offline / no connectivity: keeps cache, never blocks the UI.
   */
  requestRefresh: (options?: RequestRefreshOptions) => Promise<void>;
  /** Update header clock (e.g. after Cloud Function auto-sync). */
  markLastSyncTime: (date?: Date) => void;
}

const RefreshContext = createContext<RefreshContextValue | undefined>(undefined);

/** Custom event name for optional loose coupling outside React tree */
export const APP_DATA_REFRESH_EVENT = 'sionflow:data-refresh';

/** Per-handler timeout so one stuck page cannot freeze the spinner forever */
const HANDLER_TIMEOUT_MS = 6_000;
/** Soft budget for the whole offline refresh pass */
const OFFLINE_REFRESH_BUDGET_MS = 2_500;
/** Soft budget when online but network is flaky */
const ONLINE_REFRESH_BUDGET_MS = 15_000;

function lastSyncStorageKey(barrioOrg: string) {
  const prefix = typeof window !== 'undefined' ? getAppStoragePrefix() : 'sionflow';
  return `${prefix}_last_manual_sync_${barrioOrg}`;
}

function readStoredLastSync(barrioOrg: string | null | undefined): Date | null {
  if (!barrioOrg || typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(lastSyncStorageKey(barrioOrg));
    if (!raw) return null;
    const ts = Number(raw);
    if (Number.isNaN(ts) || ts <= 0) return null;
    return new Date(ts);
  } catch {
    return null;
  }
}

function writeStoredLastSync(barrioOrg: string, date: Date) {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(lastSyncStorageKey(barrioOrg), String(date.getTime()));
  } catch {
    // quota / private mode
  }
}

async function runHandlersSafely(
  handlers: RefreshHandler[],
  perHandlerMs: number
): Promise<boolean> {
  if (handlers.length === 0) return false;

  const results = await Promise.all(
    handlers.map(async (handler) => {
      try {
        const result = await withTimeout(
          Promise.resolve().then(() => handler()),
          perHandlerMs,
          'refresh-handler'
        );
        return result === true;
      } catch (error) {
        console.warn('[RefreshProvider] handler failed or timed out', error);
        return false;
      }
    })
  );

  return results.some(Boolean);
}

export function RefreshProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const { toast } = useToast();
  const { t } = useI18n();
  const { barrioOrg } = useAuth();
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [lastSyncTime, setLastSyncTime] = useState<Date | null>(null);
  const [refreshGeneration, setRefreshGeneration] = useState(0);
  const handlersRef = useRef(new Set<RefreshHandler>());
  const inFlightRef = useRef(false);

  // Restore last sync time for this ward/org (so user always sees when they last synced)
  useEffect(() => {
    setLastSyncTime(readStoredLastSync(barrioOrg));
  }, [barrioOrg]);

  const registerRefreshHandler = useCallback((handler: RefreshHandler) => {
    handlersRef.current.add(handler);
    return () => {
      handlersRef.current.delete(handler);
    };
  }, []);

  const markLastSyncTime = useCallback(
    (date?: Date) => {
      const when = date ?? new Date();
      setLastSyncTime(when);
      if (barrioOrg) {
        writeStoredLastSync(barrioOrg, when);
      }
    },
    [barrioOrg]
  );

  const requestRefresh = useCallback(async (options?: RequestRefreshOptions) => {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    const silent = options?.silent === true;
    setIsRefreshing(true);

    try {
      // 1) Fast local flag
      let online = isBrowserOnline();

      // 2) If the browser says online, verify real connectivity (mobile often lies)
      if (online) {
        online = await canReachNetwork(2_000);
      }

      const handlers = Array.from(handlersRef.current);

      // ── OFFLINE / NO CONNECTIVITY: keep cache, never remount, never hang ──
      if (!online) {
        clearForceServerReads();

        // Best-effort: re-hydrate from localStorage / Firestore IndexedDB with a hard budget
        try {
          await withTimeout(
            runHandlersSafely(handlers, 1_500),
            OFFLINE_REFRESH_BUDGET_MS,
            'offline-refresh'
          );
        } catch {
          // ignore — cache already on screen
        }

        if (typeof window !== 'undefined') {
          window.dispatchEvent(
            new CustomEvent(APP_DATA_REFRESH_EVENT, {
              detail: {
                hasChanges: false,
                lastSyncTime: lastSyncTime?.toISOString() ?? null,
                offline: true,
                silent,
              },
            })
          );
        }

        if (!silent) {
          toast({
            title: t('offline.refresh.cacheTitle') || 'Modo sin conexión',
            description:
              t('offline.refresh.cacheDescription') ||
              'Sin internet: se mantienen los datos en cache. Se sincronizará al recuperar la red.',
          });
        }
        return;
      }

      // ── ONLINE: sync + force server window + remount pages ──
      try {
        await withTimeout(flushOfflineSync(), 8_000, 'flushOfflineSync');
      } catch (error) {
        console.warn('[RefreshProvider] flushOfflineSync timed out', error);
      }

      beginForceServerReads(20_000);
      clearAiSuggestionCaches();

      let anyDataChanged = false;
      try {
        anyDataChanged = await withTimeout(
          runHandlersSafely(handlers, HANDLER_TIMEOUT_MS),
          ONLINE_REFRESH_BUDGET_MS,
          'online-refresh'
        );
      } catch (error) {
        console.warn('[RefreshProvider] online handlers budget exceeded', error);
      }

      const now = new Date();
      setLastSyncTime(now);
      if (barrioOrg) {
        writeStoredLastSync(barrioOrg, now);
      }

      if (typeof window !== 'undefined') {
        window.dispatchEvent(
          new CustomEvent(APP_DATA_REFRESH_EVENT, {
            detail: {
              hasChanges: anyDataChanged,
              lastSyncTime: now.toISOString(),
              offline: false,
              silent,
            },
          })
        );
      }

      // Only remount when we actually have connectivity — never offline
      try {
        router.refresh();
      } catch {
        // ignore
      }
      setRefreshGeneration((g) => g + 1);

      if (!silent) {
        if (anyDataChanged) {
          toast({
            title: t('mainLayout.refreshSuccessTitle') || 'Datos actualizados',
            description:
              t('mainLayout.refreshSuccessDescription') ||
              'Se aplicaron los cambios nuevos del servidor.',
          });
        } else {
          toast({
            title: t('mainLayout.refreshUpToDateTitle') || 'Todo al día',
            description:
              t('mainLayout.refreshUpToDateDescription') ||
              'No hay datos nuevos. Se conservó el cache local.',
          });
        }
      }
    } catch (error) {
      console.error('[RefreshProvider] requestRefresh failed', error);
      // On total failure, still never leave the user blocked — prefer cache message
      clearForceServerReads();
      if (!silent) {
        if (!isBrowserOnline()) {
          toast({
            title: t('offline.refresh.cacheTitle') || 'Modo sin conexión',
            description:
              t('offline.refresh.cacheDescription') ||
              'Sin internet: se mantienen los datos en cache.',
          });
        } else {
          toast({
            title: t('common.error') || 'Error',
            description:
              t('mainLayout.refreshErrorDescription') ||
              'No se pudieron actualizar los datos. Se mantiene el cache.',
            variant: 'destructive',
          });
        }
      }
    } finally {
      // Do NOT clear force-server window here on success — remounted pages
      // need ~20s of getDocsFromServer (TTL in beginForceServerReads).
      inFlightRef.current = false;
      setIsRefreshing(false);
    }
  }, [router, toast, t, barrioOrg, lastSyncTime]);

  const value = useMemo(
    () => ({
      isRefreshing,
      lastSyncTime,
      refreshGeneration,
      registerRefreshHandler,
      requestRefresh,
      markLastSyncTime,
    }),
    [
      isRefreshing,
      lastSyncTime,
      refreshGeneration,
      registerRefreshHandler,
      requestRefresh,
      markLastSyncTime,
    ]
  );

  return <RefreshContext.Provider value={value}>{children}</RefreshContext.Provider>;
}

export function useRefresh(): RefreshContextValue {
  const ctx = useContext(RefreshContext);
  if (!ctx) {
    throw new Error('useRefresh must be used within RefreshProvider');
  }
  return ctx;
}

/** Optional: null outside provider */
export function useRefreshOptional(): RefreshContextValue | null {
  return useContext(RefreshContext) ?? null;
}

/**
 * Register a callback that runs when the user presses the global refresh icon.
 * Pass a stable handler (useCallback) to avoid re-registering every render.
 */
export function useOnManualRefresh(handler: RefreshHandler) {
  const refresh = useRefreshOptional();
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  useEffect(() => {
    if (!refresh) return;
    return refresh.registerRefreshHandler(() => handlerRef.current());
  }, [refresh]);
}
