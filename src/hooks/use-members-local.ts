'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import type { Member, MemberStatus } from '@/lib/types';
import { useAuth } from '@/contexts/auth-context';
import { useToast } from '@/hooks/use-toast';

interface UseMembersLocalReturn {
  members: Member[];
  loading: boolean;
  syncStatus: 'idle' | 'syncing' | 'error';
  lastSyncTime: Date | null;
  /** Fuerza sincronización desde el servidor (ignora TTL local) */
  syncFromServer: () => Promise<void>;
  /** Agrega un miembro al cache local (ya debe estar creado en Firestore) */
  addToLocal: (member: Member) => void;
  /** Actualiza un miembro en el cache local (ya debe estar actualizado en Firestore) */
  updateInLocal: (member: Member) => void;
  /** Elimina un miembro del cache local (ya debe estar eliminado de Firestore) */
  removeFromLocal: (memberId: string) => void;
  /** Limpia todo el cache local */
  clearLocalCache: () => void;
}

const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hora

function getCacheKeys(barrioOrg: string) {
  return {
    data: `qf_members_local_${barrioOrg}`,
    ts: `qf_members_local_ts_${barrioOrg}`,
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

export function useMembersLocal(): UseMembersLocalReturn {
  const { user, loading: authLoading, barrioOrg } = useAuth();
  const { toast } = useToast();

  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncStatus, setSyncStatus] = useState<'idle' | 'syncing' | 'error'>('idle');
  const [lastSyncTime, setLastSyncTime] = useState<Date | null>(null);

  const inFlight = useRef(false);
  const initialLoadDone = useRef(false);

  /** Lee miembros desde localStorage */
  const loadFromLocal = useCallback((): { members: Member[]; ts: number } | null => {
    if (!barrioOrg || typeof window === 'undefined') return null;
    try {
      const keys = getCacheKeys(barrioOrg);
      const tsRaw = localStorage.getItem(keys.ts);
      const dataRaw = localStorage.getItem(keys.data);
      if (!tsRaw || !dataRaw) return null;
      const ts = Number(tsRaw);
      if (Number.isNaN(ts)) return null;
      const list = JSON.parse(dataRaw) as Member[];
      return { members: list.map((m) => ({ ...m, status: normalizeStatus(m.status) })), ts };
    } catch {
      return null;
    }
  }, [barrioOrg]);

  /** Guarda miembros en localStorage */
  const saveToLocal = useCallback(
    (list: Member[]) => {
      if (!barrioOrg || typeof window === 'undefined') return;
      try {
        const keys = getCacheKeys(barrioOrg);
        localStorage.setItem(keys.data, JSON.stringify(list));
        localStorage.setItem(keys.ts, String(Date.now()));
      } catch {
        // quota / private mode — ignore
      }
    },
    [barrioOrg]
  );

  /** Sincroniza desde el servidor */
  const syncFromServer = useCallback(async () => {
    if (!user || !barrioOrg || inFlight.current) return;
    inFlight.current = true;
    setSyncStatus('syncing');
    try {
      const url = `/api/members?barrioOrg=${encodeURIComponent(barrioOrg)}`;
      const response = await fetch(url, { cache: 'no-store' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const raw = (await response.json()) as Member[];
      const list = raw.map((m: Member) => ({ ...m, status: normalizeStatus(m.status) }));
      setMembers(list);
      setLastSyncTime(new Date());
      saveToLocal(list);
      setSyncStatus('idle');
    } catch (error) {
      console.error('[useMembersLocal] syncFromServer error', error);
      setSyncStatus('error');
      // Mantener datos locales si falla
    } finally {
      inFlight.current = false;
    }
  }, [user, barrioOrg, saveToLocal]);

  // Carga inicial: siempre de localStorage primero, sincroniza si TTL expiró
  useEffect(() => {
    if (authLoading || initialLoadDone.current) return;
    if (!user || !barrioOrg) {
      setMembers([]);
      setLoading(false);
      initialLoadDone.current = true;
      return;
    }

    initialLoadDone.current = true;

    // 1. Cargar de localStorage inmediatamente
    const cached = loadFromLocal();
    if (cached) {
      setMembers(cached.members);
      setLastSyncTime(new Date(cached.ts));
      setLoading(false);

      const age = Date.now() - cached.ts;
      // 2. Si el cache expiró (>1 hora), sincronizar en background
      if (age > CACHE_TTL_MS) {
        syncFromServer().catch(() => {});
      }
    } else {
      // Sin cache local: ir al servidor
      setLoading(true);
      syncFromServer().finally(() => setLoading(false));
    }
  }, [authLoading, user, barrioOrg, loadFromLocal, syncFromServer]);

  const addToLocal = useCallback(
    (member: Member) => {
      setMembers((prev) => {
        const next = [...prev, { ...member, status: normalizeStatus(member.status) }];
        next.sort((a, b) => a.lastName.localeCompare(b.lastName));
        saveToLocal(next);
        return next;
      });
    },
    [saveToLocal]
  );

  const updateInLocal = useCallback(
    (member: Member) => {
      setMembers((prev) => {
        const next = prev.map((m) =>
          m.id === member.id
            ? { ...member, status: normalizeStatus(member.status) }
            : m
        );
        next.sort((a, b) => a.lastName.localeCompare(b.lastName));
        saveToLocal(next);
        return next;
      });
    },
    [saveToLocal]
  );

  const removeFromLocal = useCallback(
    (memberId: string) => {
      setMembers((prev) => {
        const next = prev.filter((m) => m.id !== memberId);
        saveToLocal(next);
        return next;
      });
    },
    [saveToLocal]
  );

  const clearLocalCache = useCallback(() => {
    if (!barrioOrg || typeof window === 'undefined') return;
    const keys = getCacheKeys(barrioOrg);
    localStorage.removeItem(keys.data);
    localStorage.removeItem(keys.ts);
  }, [barrioOrg]);

  return {
    members,
    loading,
    syncStatus,
    lastSyncTime,
    syncFromServer,
    addToLocal,
    updateInLocal,
    removeFromLocal,
    clearLocalCache,
  };
}
