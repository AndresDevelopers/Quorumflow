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
import type { Member, MemberStatus } from '@/lib/types';
import { useAuth } from '@/contexts/auth-context';
import { getAppStoragePrefix } from '@/lib/app-config';
import { useOnManualRefresh } from '@/contexts/refresh-context';
import {
  saveMembersLocalCache,
  isMembersLocalCacheEnabled,
  clearMembersLocalCacheKeys,
} from '@/hooks/use-members-local';
import { mergeMembersCache } from '@/lib/members-cache-merge';
import { isBrowserOnline, isNetworkError } from '@/lib/network';

/** Hard cap for members API so refresh never hangs the UI. */
const MEMBERS_FETCH_TIMEOUT_MS = 8_000;

function isAbortError(error: unknown): boolean {
  if (!error) return false;
  if (typeof error === 'object' && error !== null && 'name' in error) {
    const name = String((error as { name?: string }).name);
    if (name === 'AbortError' || name === 'TimeoutError') return true;
  }
  if (error instanceof Error && /aborted|AbortError|timed out/i.test(error.message)) {
    return true;
  }
  return false;
}

interface MembersContextValue {
  members: Member[];
  loading: boolean;
  lastSyncTime: Date | null;
  /**
   * Refresh members from API.
   * forceRefresh hits the network; without force uses local cache only.
   * On network load, cache is merged (only changed members rewritten).
   * Returns whether the in-memory/cache data actually changed.
   */
  refreshMembers: (forceRefresh?: boolean) => Promise<boolean>;
  clearCache: () => void;
  getByStatus: (status: MemberStatus) => Member[];
}

const MembersContext = createContext<MembersContextValue | undefined>(undefined);

const prefix = typeof window !== 'undefined' ? getAppStoragePrefix() : 'sionflow';

function cacheKeys(barrioOrg: string) {
  return {
    data: `${prefix}_members_cache_${barrioOrg}`,
    ts: `${prefix}_members_cache_ts_${barrioOrg}`,
  };
}

function normalizeStatus(status?: unknown): MemberStatus {
  if (typeof status !== 'string') return 'active';
  const n = status.toLowerCase().trim();
  if (['deceased', 'fallecido', 'fallecida'].includes(n)) return 'deceased';
  if (['inactive', 'inactivo'].includes(n)) return 'inactive';
  if (['less_active', 'less active', 'menos activo', 'menos_activo'].includes(n)) return 'less_active';
  return 'active';
}

function normalizeList(raw: Member[]): Member[] {
  return raw.map((m) => ({
    ...m,
    status: normalizeStatus(m.status),
  }));
}

export function MembersProvider({ children }: { children: ReactNode }) {
  const { user, loading: authLoading, barrioOrg, firebaseUser } = useAuth();
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [lastSyncTime, setLastSyncTime] = useState<Date | null>(null);
  const inFlight = useRef(false);
  const membersRef = useRef<Member[]>([]);
  useEffect(() => {
    membersRef.current = members;
  }, [members]);

  const clearCache = useCallback(() => {
    if (!barrioOrg || typeof window === 'undefined') return;
    const keys = cacheKeys(barrioOrg);
    localStorage.removeItem(keys.data);
    localStorage.removeItem(keys.ts);
  }, [barrioOrg]);

  /** Load any cached list (no TTL — stale is fine until the user presses refresh). */
  const loadFromLocalCache = useCallback((): { list: Member[]; ts: number } | null => {
    if (!isMembersLocalCacheEnabled()) return null;
    if (!barrioOrg || typeof window === 'undefined') return null;
    try {
      const keys = cacheKeys(barrioOrg);
      const tsRaw = localStorage.getItem(keys.ts);
      const dataRaw = localStorage.getItem(keys.data);
      if (!dataRaw) return null;
      const ts = tsRaw ? Number(tsRaw) : Date.now();
      if (Number.isNaN(ts)) return null;
      return { list: normalizeList(JSON.parse(dataRaw) as Member[]), ts };
    } catch {
      return null;
    }
  }, [barrioOrg]);

  const saveToLocalCache = useCallback(
    (list: Member[]) => {
      if (!isMembersLocalCacheEnabled()) return;
      if (!barrioOrg || typeof window === 'undefined') return;
      try {
        const keys = cacheKeys(barrioOrg);
        localStorage.setItem(keys.data, JSON.stringify(list));
        localStorage.setItem(keys.ts, String(Date.now()));
      } catch {
        // quota / private mode — ignore
      }
    },
    [barrioOrg]
  );

  const refreshMembers = useCallback(
    async (forceRefresh = false): Promise<boolean> => {
      if (authLoading || !user || !barrioOrg) return false;
      // En dev siempre forzar red (sin cache) para pruebas
      const force = forceRefresh || !isMembersLocalCacheEnabled();
      // Evitar peticiones en paralelo (también en dev)
      if (inFlight.current) return false;

      const offline = !isBrowserOnline();

      // Offline or soft load: always prefer local cache — never hit network offline
      // (en development loadFromLocalCache ya devuelve null)
      if (offline || !force) {
        const cached = loadFromLocalCache();
        if (cached) {
          setMembers(cached.list);
          setLastSyncTime(new Date(cached.ts));
          setLoading(false);
          // Offline / non-force: stop here (manual online refresh continues only if force)
          if (offline || !force) return false;
        } else if (offline) {
          setLoading(false);
          return false;
        }
      }

      inFlight.current = true;
      // Only show full loading skeleton when we have nothing to display yet
      if (membersRef.current.length === 0) {
        setLoading(true);
      }

      const controller = new AbortController();
      // Timed abort is expected (slow network / hung API). Pass a reason so
      // browsers don't report the generic "signal is aborted without reason".
      const abortTimer = setTimeout(() => {
        try {
          if (typeof DOMException !== 'undefined') {
            controller.abort(
              new DOMException(
                `Members fetch timed out after ${MEMBERS_FETCH_TIMEOUT_MS}ms`,
                'AbortError'
              )
            );
          } else {
            controller.abort();
          }
        } catch {
          // ignore — aborting a completed controller is a no-op in some engines
        }
      }, MEMBERS_FETCH_TIMEOUT_MS);

      try {
        const idToken = await firebaseUser?.getIdToken().catch(() => null);
        if (!idToken) {
          throw new Error('No autenticado');
        }
        const cacheBuster = force ? `&t=${Date.now()}` : '';
        const url = `/api/members?barrioOrg=${encodeURIComponent(barrioOrg)}${cacheBuster}`;
        // Single timeout via AbortController (no second withTimeout race).
        const response = await fetch(url, {
          cache: force ? 'no-store' : 'default',
          headers: {
            Authorization: `Bearer ${idToken}`,
            ...(force ? { 'Cache-Control': 'no-cache' } : {}),
          },
          signal: controller.signal,
        });
        if (!response.ok) {
          throw new Error(`Failed to fetch members: ${response.status}`);
        }
        const raw = (await response.json()) as Member[];
        const serverList = normalizeList(raw);

        // Dev: usar solo respuesta del servidor (sin merge con cache viejo)
        if (!isMembersLocalCacheEnabled()) {
          setMembers(serverList);
          setLastSyncTime(new Date());
          return true;
        }

        // Merge against current in-memory list (or localStorage if empty)
        const previous =
          membersRef.current.length > 0
            ? membersRef.current
            : loadFromLocalCache()?.list ?? [];

        const merged = mergeMembersCache(previous, serverList);

        // Always hydrate in-memory state after a successful fetch.
        // Another writer (useMembersLocal) may have already persisted the same
        // list, making hasChanges=false while this provider's state is still [].
        setMembers(merged.list);
        setLastSyncTime(new Date());
        if (merged.hasChanges) {
          // Only rewrite caches when something actually changed
          // (unchanged members kept; new/updated/removed applied — never a blind wipe)
          saveToLocalCache(merged.list);
          saveMembersLocalCache(barrioOrg, merged.list);
        }

        return merged.hasChanges;
      } catch (error) {
        // Timeout/abort is intentional — fall back to cache without alarming the console.
        if (isAbortError(error) || controller.signal.aborted) {
          if (process.env.NODE_ENV === 'development') {
            console.debug(
              '[MembersProvider] members fetch timed out; using cache if available'
            );
          }
        } else if (!isNetworkError(error)) {
          console.error('[MembersProvider] fetch failed', error);
        } else if (process.env.NODE_ENV === 'development') {
          console.debug('[MembersProvider] network error; using cache if available', error);
        }
        // On error keep whatever we already have — never clear cache
        const cached = loadFromLocalCache();
        if (cached) {
          if (membersRef.current.length === 0 || force) {
            setMembers(cached.list);
            setLastSyncTime(new Date(cached.ts));
          }
        }
        return false;
      } finally {
        clearTimeout(abortTimer);
        inFlight.current = false;
        setLoading(false);
      }
    },
    [authLoading, user, firebaseUser, barrioOrg, loadFromLocalCache, saveToLocalCache]
  );

  // Initial load once per barrioOrg.
  // production: cache first, network only if empty
  // development: always network (force), and drop stale local keys
  useEffect(() => {
    if (authLoading) return;
    if (!user || !barrioOrg) {
      queueMicrotask(() => {
        setMembers([]);
        setLoading(false);
      });
      return;
    }
    queueMicrotask(() => {
      if (!isMembersLocalCacheEnabled()) {
        clearMembersLocalCacheKeys(barrioOrg);
        try {
          const keys = cacheKeys(barrioOrg);
          localStorage.removeItem(keys.data);
          localStorage.removeItem(keys.ts);
        } catch {
          // ignore
        }
        void refreshMembers(true);
      } else {
        void refreshMembers(false);
      }
    });
  }, [authLoading, user, barrioOrg, refreshMembers]);

  // Manual refresh from header icon — merge only what is new into cache
  const forceRefresh = useCallback(async () => {
    return refreshMembers(true);
  }, [refreshMembers]);

  useOnManualRefresh(forceRefresh);

  const getByStatus = useCallback(
    (status: MemberStatus) => members.filter((m) => m.status === status),
    [members]
  );

  const value = useMemo(
    () => ({
      members,
      loading,
      lastSyncTime,
      refreshMembers,
      clearCache,
      getByStatus,
    }),
    [members, loading, lastSyncTime, refreshMembers, clearCache, getByStatus]
  );

  return <MembersContext.Provider value={value}>{children}</MembersContext.Provider>;
}

export function useMembersContext(): MembersContextValue {
  const ctx = useContext(MembersContext);
  if (!ctx) {
    throw new Error('useMembersContext must be used within MembersProvider');
  }
  return ctx;
}

/** Optional hook that returns null outside provider (for shared components). */
export function useMembersContextOptional(): MembersContextValue | null {
  return useContext(MembersContext) ?? null;
}
