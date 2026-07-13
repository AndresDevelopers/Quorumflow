/**
 * Firestore read helpers that respect a short "force server" window
 * opened by the global header refresh button.
 *
 * With persistentLocalCache, plain getDocs may return IndexedDB data.
 * During a manual sync we prefer getDocsFromServer so notes, council,
 * ministering, missionary work, activities, services, etc. all get fresh DB data.
 *
 * Offline: always prefer getDocsFromCache / local persistence — never block the UI
 * waiting for the network.
 */
import {
  getDocs as fsGetDocs,
  getDocsFromServer,
  getDocsFromCache,
  getDoc as fsGetDoc,
  getDocFromServer,
  getDocFromCache,
  type CollectionReference,
  type DocumentData,
  type DocumentReference,
  type DocumentSnapshot,
  type Query,
  type QuerySnapshot,
} from 'firebase/firestore';
import { isBrowserOnline, isNetworkError } from '@/lib/network';

const FORCE_UNTIL_KEY = 'sionflow_force_server_reads_until';

/** AI suggestion localStorage keys cleared on manual refresh */
export const AI_SUGGESTION_CACHE_KEYS = [
  'activities_suggestions_cache',
  'activities_suggestions_timestamp',
  'service_suggestions_cache',
  'service_suggestions_timestamp',
] as const;

type QueryLike = Query<DocumentData> | CollectionReference<DocumentData>;

/** Open a time window where getDocs/getDoc hit the network (default 20s). */
export function beginForceServerReads(ttlMs = 20_000) {
  if (typeof window === 'undefined') return;
  try {
    sessionStorage.setItem(FORCE_UNTIL_KEY, String(Date.now() + ttlMs));
  } catch {
    // private mode
  }
}

export function clearForceServerReads() {
  if (typeof window === 'undefined') return;
  try {
    sessionStorage.removeItem(FORCE_UNTIL_KEY);
  } catch {
    // ignore
  }
}

export function isForceServerReads(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    const raw = sessionStorage.getItem(FORCE_UNTIL_KEY);
    if (!raw) return false;
    const until = Number(raw);
    if (Number.isNaN(until) || Date.now() > until) {
      sessionStorage.removeItem(FORCE_UNTIL_KEY);
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

/** Drop AI suggestion caches so remounted pages re-fetch suggestions. */
export function clearAiSuggestionCaches() {
  if (typeof window === 'undefined') return;
  for (const key of AI_SUGGESTION_CACHE_KEYS) {
    try {
      localStorage.removeItem(key);
    } catch {
      // ignore
    }
  }
}

/**
 * Drop-in for firebase getDocs.
 * - Manual refresh (online): prefer server, then local cache
 * - Offline: cache-first (IndexedDB), never force network
 */
export async function getDocs(q: QueryLike): Promise<QuerySnapshot<DocumentData>> {
  const offline = !isBrowserOnline();

  if (offline) {
    try {
      return await getDocsFromCache(q as Query<DocumentData>);
    } catch {
      // No exact cache entry — try multi-tab persistence via default getDocs
      try {
        return await fsGetDocs(q);
      } catch (error) {
        console.warn('[firestore-query] offline getDocs failed (no cache)', error);
        throw error;
      }
    }
  }

  if (isForceServerReads()) {
    try {
      return await getDocsFromServer(q);
    } catch (error) {
      console.warn('[firestore-query] getDocsFromServer failed, falling back to cache', error);
      try {
        return await getDocsFromCache(q as Query<DocumentData>);
      } catch {
        return fsGetDocs(q);
      }
    }
  }

  try {
    return await fsGetDocs(q);
  } catch (error) {
    if (isNetworkError(error)) {
      try {
        return await getDocsFromCache(q as Query<DocumentData>);
      } catch {
        throw error;
      }
    }
    throw error;
  }
}

/**
 * Drop-in for firebase getDoc (same offline rules as getDocs).
 */
export async function getDoc<T extends DocumentData = DocumentData>(
  ref: DocumentReference<T>
): Promise<DocumentSnapshot<T>> {
  const offline = !isBrowserOnline();

  if (offline) {
    try {
      return await getDocFromCache(ref);
    } catch {
      try {
        return await fsGetDoc(ref);
      } catch (error) {
        console.warn('[firestore-query] offline getDoc failed (no cache)', error);
        throw error;
      }
    }
  }

  if (isForceServerReads()) {
    try {
      return await getDocFromServer(ref);
    } catch (error) {
      console.warn('[firestore-query] getDocFromServer failed, falling back to cache', error);
      try {
        return await getDocFromCache(ref);
      } catch {
        return fsGetDoc(ref);
      }
    }
  }

  try {
    return await fsGetDoc(ref);
  } catch (error) {
    if (isNetworkError(error)) {
      try {
        return await getDocFromCache(ref);
      } catch {
        throw error;
      }
    }
    throw error;
  }
}
