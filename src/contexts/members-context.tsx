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
import { saveMembersLocalCache } from '@/hooks/use-members-local';
import { mergeMembersCache } from '@/lib/members-cache-merge';
import { isBrowserOnline } from '@/lib/network';

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
  const { user, loading: authLoading, barrioOrg } = useAuth();
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [lastSyncTime, setLastSyncTime] = useState<Date | null>(null);
  const inFlight = useRef(false);
  const membersRef = useRef<Member[]>([]);
  membersRef.current = members;

  const clearCache = useCallback(() => {
    if (!barrioOrg || typeof window === 'undefined') return;
    const keys = cacheKeys(barrioOrg);
    localStorage.removeItem(keys.data);
    localStorage.removeItem(keys.ts);
  }, [barrioOrg]);

  /** Load any cached list (no TTL — stale is fine until the user presses refresh). */
  const loadFromLocalCache = useCallback((): { list: Member[]; ts: number } | null => {
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
      if (inFlight.current && !forceRefresh) return false;

      // Without force, or offline: prefer any local cache (app usable without internet)
      if (!forceRefresh || !isBrowserOnline()) {
        const cached = loadFromLocalCache();
        if (cached) {
          setMembers(cached.list);
          setLastSyncTime(new Date(cached.ts));
          setLoading(false);
          // Offline force refresh: keep cache only, skip network
          if (!isBrowserOnline()) return false;
          if (!forceRefresh) return false;
        } else if (!isBrowserOnline()) {
          setLoading(false);
          return false;
        }
      }

      inFlight.current = true;
      // Only show full loading skeleton when we have nothing to display yet
      if (membersRef.current.length === 0) {
        setLoading(true);
      }
      try {
        const cacheBuster = forceRefresh ? `&t=${Date.now()}` : '';
        const url = `/api/members?barrioOrg=${encodeURIComponent(barrioOrg)}${cacheBuster}`;
        const response = await fetch(url, {
          cache: forceRefresh ? 'no-store' : 'default',
          headers: forceRefresh ? { 'Cache-Control': 'no-cache' } : undefined,
        });
        if (!response.ok) {
          throw new Error(`Failed to fetch members: ${response.status}`);
        }
        const raw = (await response.json()) as Member[];
        const serverList = normalizeList(raw);

        // Merge against current in-memory list (or localStorage if empty)
        const previous =
          membersRef.current.length > 0
            ? membersRef.current
            : loadFromLocalCache()?.list ?? [];

        const merged = mergeMembersCache(previous, serverList);

        if (merged.hasChanges) {
          setMembers(merged.list);
          setLastSyncTime(new Date());
          // Only rewrite caches when something actually changed
          // (unchanged members kept; new/updated/removed applied — never a blind wipe)
          saveToLocalCache(merged.list);
          saveMembersLocalCache(barrioOrg, merged.list);
        }
        // If nothing new: keep previous members + cache intact (no wipe, no rewrite)

        return merged.hasChanges;
      } catch (error) {
        console.error('[MembersProvider] fetch failed', error);
        // On error keep whatever we already have — never clear cache
        const cached = loadFromLocalCache();
        if (cached && membersRef.current.length === 0) {
          setMembers(cached.list);
          setLastSyncTime(new Date(cached.ts));
        }
        return false;
      } finally {
        inFlight.current = false;
        setLoading(false);
      }
    },
    [authLoading, user, barrioOrg, loadFromLocalCache, saveToLocalCache]
  );

  // Initial load once per barrioOrg: cache first, network only if empty.
  // No polling / TTL auto-refresh — user must press the header refresh icon.
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
      void refreshMembers(false);
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
