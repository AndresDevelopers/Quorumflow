/**
 * Firestore read helpers that respect a short "force server" window
 * opened by the global header refresh button.
 *
 * With persistentLocalCache, plain getDocs may return IndexedDB data.
 * During a manual sync we prefer getDocsFromServer so notes, council,
 * ministering, missionary work, activities, services, etc. all get fresh DB data.
 *
 * Offline / flaky mobile: always prefer cache and NEVER hang waiting for network.
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
  type FirestoreError,
  type Query,
  type QuerySnapshot,
} from 'firebase/firestore';
import { isBrowserOnline, isNetworkError, withTimeout } from '@/lib/network';

/** Firebase permission-denied code. */
const PERMISSION_DENIED = 'permission-denied';

/** Check if error is a Firestore permission-denied error. */
function isPermissionDenied(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as FirestoreError).code === PERMISSION_DENIED
  );
}

const FORCE_UNTIL_KEY = 'sionflow_force_server_reads_until';

/** Max wait for cache reads (should be local IndexedDB). */
const CACHE_READ_MS = 2_500;
/** Max wait for server reads during manual refresh. */
const SERVER_READ_MS = 8_000;
/** Max wait for default getDocs/getDoc when online. */
const DEFAULT_READ_MS = 10_000;

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

async function readDocsFromCache(q: QueryLike): Promise<QuerySnapshot<DocumentData>> {
  return withTimeout(
    getDocsFromCache(q as Query<DocumentData>),
    CACHE_READ_MS,
    'getDocsFromCache'
  );
}

async function readDocFromCache<T extends DocumentData>(
  ref: DocumentReference<T>
): Promise<DocumentSnapshot<T>> {
  return withTimeout(getDocFromCache(ref), CACHE_READ_MS, 'getDocFromCache');
}

/**
 * Drop-in for firebase getDocs.
 * - Offline: cache only (never wait on network)
 * - Manual refresh (online): server with timeout, then cache
 * - Normal online: default SDK with timeout, then cache
 */
export async function getDocs(q: QueryLike): Promise<QuerySnapshot<DocumentData>> {
  const offline = !isBrowserOnline();

  if (offline) {
    // CRITICAL: do not call fsGetDocs offline — it can hang waiting for the server.
    try {
      return await readDocsFromCache(q);
    } catch (error) {
      console.warn('[firestore-query] offline getDocs: no local cache', error);
      throw error;
    }
  }

  if (isForceServerReads()) {
    try {
      return await withTimeout(getDocsFromServer(q), SERVER_READ_MS, 'getDocsFromServer');
    } catch (error) {
      console.warn('[firestore-query] getDocsFromServer failed/timed out → cache', error);
      try {
        return await readDocsFromCache(q);
      } catch {
        // Last resort: short default read (may still use persistence)
        return withTimeout(fsGetDocs(q), 3_000, 'getDocs-fallback');
      }
    }
  }

  try {
    return await withTimeout(fsGetDocs(q), DEFAULT_READ_MS, 'getDocs');
  } catch (error) {
    if (isPermissionDenied(error)) {
      // Missing Firestore permissions — try cache, then throw empty result
      try {
        return await readDocsFromCache(q);
      } catch {
        throw error;
      }
    }
    if (isNetworkError(error) || !isBrowserOnline()) {
      try {
        return await readDocsFromCache(q);
      } catch {
        throw error;
      }
    }
    // Timeout or other: still try cache before failing
    try {
      return await readDocsFromCache(q);
    } catch {
      throw error;
    }
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
      return await readDocFromCache(ref);
    } catch (error) {
      console.warn('[firestore-query] offline getDoc: no local cache', error);
      throw error;
    }
  }

  if (isForceServerReads()) {
    try {
      return await withTimeout(getDocFromServer(ref), SERVER_READ_MS, 'getDocFromServer');
    } catch (error) {
      console.warn('[firestore-query] getDocFromServer failed/timed out → cache', error);
      if (isPermissionDenied(error)) {
        try {
          return await readDocFromCache(ref);
        } catch {
          const fakeDoc = {
            exists: () => false,
            id: ref.id,
            ref,
            data: () => undefined,
            get: () => undefined,
            metadata: { hasPendingWrites: false, fromCache: true },
          } as unknown as DocumentSnapshot<T>;
          return fakeDoc;
        }
      }
      try {
        return await readDocFromCache(ref);
      } catch {
        return withTimeout(fsGetDoc(ref), 3_000, 'getDoc-fallback');
      }
    }
  }

  try {
    return await withTimeout(fsGetDoc(ref), DEFAULT_READ_MS, 'getDoc');
  } catch (error) {
    if (isPermissionDenied(error)) {
      // Missing Firestore permissions — try cache, then fail silently
      try {
        return await readDocFromCache(ref);
      } catch {
        // Return a non-existent snapshot so callers can handle gracefully
        const fakeDoc = {
            exists: () => false,
            id: ref.id,
            ref,
            data: () => undefined,
            get: () => undefined,
            metadata: { hasPendingWrites: false, fromCache: true },
          } as unknown as DocumentSnapshot<T>;
        return fakeDoc;
      }
    }
    if (isNetworkError(error) || !isBrowserOnline()) {
      try {
        return await readDocFromCache(ref);
      } catch {
        throw error;
      }
    }
    try {
      return await readDocFromCache(ref);
    } catch {
      throw error;
    }
  }
}
