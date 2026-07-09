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

interface MembersContextValue {
  members: Member[];
  loading: boolean;
  lastSyncTime: Date | null;
  /** Refresh members from API. forceRefresh bypasses local TTL. */
  refreshMembers: (forceRefresh?: boolean) => Promise<void>;
  clearCache: () => void;
  getByStatus: (status: MemberStatus) => Member[];
}

const MembersContext = createContext<MembersContextValue | undefined>(undefined);

const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes
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

export function MembersProvider({ children }: { children: ReactNode }) {
  const { user, loading: authLoading, barrioOrg } = useAuth();
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [lastSyncTime, setLastSyncTime] = useState<Date | null>(null);
  const inFlight = useRef(false);

  const clearCache = useCallback(() => {
    if (!barrioOrg || typeof window === 'undefined') return;
    const keys = cacheKeys(barrioOrg);
    localStorage.removeItem(keys.data);
    localStorage.removeItem(keys.ts);
  }, [barrioOrg]);

  const loadFromLocalCache = useCallback((): Member[] | null => {
    if (!barrioOrg || typeof window === 'undefined') return null;
    try {
      const keys = cacheKeys(barrioOrg);
      const tsRaw = localStorage.getItem(keys.ts);
      const dataRaw = localStorage.getItem(keys.data);
      if (!tsRaw || !dataRaw) return null;
      const age = Date.now() - Number(tsRaw);
      if (Number.isNaN(age) || age > CACHE_TTL_MS) return null;
      return JSON.parse(dataRaw) as Member[];
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
    async (forceRefresh = false) => {
      if (authLoading || !user || !barrioOrg) return;
      if (inFlight.current && !forceRefresh) return;

      if (!forceRefresh) {
        const cached = loadFromLocalCache();
        if (cached) {
          setMembers(cached);
          setLastSyncTime(new Date());
          setLoading(false);
          return;
        }
      }

      inFlight.current = true;
      setLoading(true);
      try {
        const url = `/api/members?barrioOrg=${encodeURIComponent(barrioOrg)}`;
        const response = await fetch(url, {
          cache: forceRefresh ? 'no-store' : 'default',
        });
        if (!response.ok) {
          throw new Error(`Failed to fetch members: ${response.status}`);
        }
        const raw = (await response.json()) as Member[];
        const list = raw.map((m) => ({
          ...m,
          status: normalizeStatus(m.status),
        }));
        setMembers(list);
        setLastSyncTime(new Date());
        saveToLocalCache(list);
      } catch (error) {
        console.error('[MembersProvider] fetch failed', error);
        const cached = loadFromLocalCache();
        if (cached) {
          setMembers(cached);
        }
      } finally {
        inFlight.current = false;
        setLoading(false);
      }
    },
    [authLoading, user, barrioOrg, loadFromLocalCache, saveToLocalCache]
  );

  // Prefetch once per barrioOrg session (queueMicrotask avoids sync setState-in-effect lint)
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
