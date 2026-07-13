/**
 * Offline sync coordinator using Firebase SDK persistence.
 *
 * Firestore: persistentLocalCache already enables offline reads + automatic
 * write queue. We wait for pending writes when connectivity returns.
 * Storage: custom IndexedDB queue (see storage-offline-queue).
 */
import { waitForPendingWrites } from 'firebase/firestore';
import { firestore } from '@/lib/firebase';
import { isBrowserOnline } from '@/lib/network';
import {
  getStorageQueueCount,
  processStorageOfflineQueue,
} from '@/lib/storage-offline-queue';

let initialized = false;
let syncing = false;

export function isOfflineSyncRunning(): boolean {
  return syncing;
}

/**
 * Flush Firestore pending writes + Storage offline queue.
 * Safe to call multiple times; concurrent runs are serialized.
 */
export async function flushOfflineSync(): Promise<{
  firestoreOk: boolean;
  storageUploaded: number;
  storageFailed: number;
  storagePending: number;
}> {
  if (!isBrowserOnline()) {
    const pending = await getStorageQueueCount();
    return {
      firestoreOk: false,
      storageUploaded: 0,
      storageFailed: 0,
      storagePending: pending,
    };
  }

  if (syncing) {
    const pending = await getStorageQueueCount();
    return {
      firestoreOk: true,
      storageUploaded: 0,
      storageFailed: 0,
      storagePending: pending,
    };
  }

  syncing = true;
  let firestoreOk = true;
  let storageUploaded = 0;
  let storageFailed = 0;

  try {
    if (firestore) {
      try {
        // Resolves when the local write queue has been sent to the backend
        await waitForPendingWrites(firestore);
      } catch (error) {
        firestoreOk = false;
        console.warn('[firebase-offline-sync] waitForPendingWrites failed', error);
      }
    }

    const result = await processStorageOfflineQueue();
    storageUploaded = result.uploaded;
    storageFailed = result.failed;
  } finally {
    syncing = false;
  }

  const storagePending = await getStorageQueueCount();

  if (typeof window !== 'undefined') {
    window.dispatchEvent(
      new CustomEvent('sionflow:offline-sync-complete', {
        detail: {
          firestoreOk,
          storageUploaded,
          storageFailed,
          storagePending,
        },
      })
    );
  }

  return { firestoreOk, storageUploaded, storageFailed, storagePending };
}

/** Start listening for connectivity and auto-flush when back online. */
export function initFirebaseOfflineSync(): () => void {
  if (typeof window === 'undefined') return () => {};
  if (initialized) return () => {};
  initialized = true;

  const onOnline = () => {
    console.log('[firebase-offline-sync] online — flushing pending work');
    void flushOfflineSync();
  };

  window.addEventListener('online', onOnline);

  // If we boot already online, drain any leftover storage queue
  if (isBrowserOnline()) {
    void flushOfflineSync();
  }

  return () => {
    window.removeEventListener('online', onOnline);
    initialized = false;
  };
}
