/**
 * Offline queue for Firebase Storage uploads.
 * Firestore already queues writes via persistentLocalCache;
 * Storage does not — we persist blobs in IndexedDB and upload when online.
 */
import { getDownloadURL, ref, uploadBytes } from 'firebase/storage';
import { doc, updateDoc } from 'firebase/firestore';
import { storage, firestore } from '@/lib/firebase';
import { getAppStoragePrefix } from '@/lib/app-config';
import { isBrowserOnline, isNetworkError } from '@/lib/network';

const DB_NAME = () => `${getAppStoragePrefix()}_storage_offline_v1`;
const STORE = 'uploads';
const DB_VERSION = 1;

export type StorageFirestorePatch = {
  /** Firestore collection id, e.g. c_miembros */
  collection: string;
  docId: string;
  /** Field that receives the download URL */
  urlField: string;
  /** Optional field that receives the storage path */
  pathField?: string;
};

export type QueuedStorageUpload = {
  id: string;
  storagePath: string;
  contentType: string;
  /** Blob bytes */
  data: ArrayBuffer;
  createdAt: number;
  firestorePatch?: StorageFirestorePatch;
};

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB not available'));
      return;
    }
    const req = indexedDB.open(DB_NAME(), DB_VERSION);
    req.onerror = () => reject(req.error);
    req.onsuccess = () => resolve(req.result);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: 'id' });
        store.createIndex('createdAt', 'createdAt');
      }
    };
  });
}

function idbRequest<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function blobToArrayBuffer(blob: Blob): Promise<ArrayBuffer> {
  return blob.arrayBuffer();
}

async function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = () => reject(new Error('No se pudo leer el archivo offline'));
    reader.readAsDataURL(blob);
  });
}

export async function getStorageQueueCount(): Promise<number> {
  try {
    const db = await openDb();
    const tx = db.transaction(STORE, 'readonly');
    const store = tx.objectStore(STORE);
    const count = await idbRequest(store.count());
    db.close();
    return count;
  } catch {
    return 0;
  }
}

export async function listQueuedStorageUploads(): Promise<QueuedStorageUpload[]> {
  try {
    const db = await openDb();
    const tx = db.transaction(STORE, 'readonly');
    const store = tx.objectStore(STORE);
    const all = await idbRequest(store.getAll());
    db.close();
    return (all as QueuedStorageUpload[]) ?? [];
  } catch {
    return [];
  }
}

export async function enqueueStorageUpload(params: {
  storagePath: string;
  data: Blob;
  contentType?: string;
  firestorePatch?: StorageFirestorePatch;
}): Promise<{ id: string; localPreviewUrl: string }> {
  const id = `stg_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`;
  const buffer = await blobToArrayBuffer(params.data);
  const item: QueuedStorageUpload = {
    id,
    storagePath: params.storagePath,
    contentType: params.contentType || params.data.type || 'application/octet-stream',
    data: buffer,
    createdAt: Date.now(),
    firestorePatch: params.firestorePatch,
  };

  const db = await openDb();
  const tx = db.transaction(STORE, 'readwrite');
  await idbRequest(tx.objectStore(STORE).put(item));
  db.close();

  const localPreviewUrl = await blobToDataUrl(params.data);

  if (typeof window !== 'undefined') {
    window.dispatchEvent(
      new CustomEvent('sionflow:storage-queue-changed', {
        detail: { countDelta: 1 },
      })
    );
  }

  return { id, localPreviewUrl };
}

async function removeQueuedUpload(id: string) {
  const db = await openDb();
  const tx = db.transaction(STORE, 'readwrite');
  await idbRequest(tx.objectStore(STORE).delete(id));
  db.close();
}

/**
 * Upload to Firebase Storage, or queue when offline.
 * Returns a real download URL online, or a local data-URL preview when queued.
 */
export async function uploadBytesOfflineAware(
  storagePath: string,
  data: Blob,
  options?: {
    contentType?: string;
    firestorePatch?: StorageFirestorePatch;
  }
): Promise<{ url: string; path: string; queued: boolean; queueId?: string }> {
  const contentType = options?.contentType || data.type || 'application/octet-stream';

  if (isBrowserOnline() && storage) {
    try {
      const storageRef = ref(storage, storagePath);
      await uploadBytes(storageRef, data, { contentType });
      const url = await getDownloadURL(storageRef);
      return { url, path: storagePath, queued: false };
    } catch (error) {
      if (!isNetworkError(error)) throw error;
      // fall through to queue
    }
  }

  const { id, localPreviewUrl } = await enqueueStorageUpload({
    storagePath,
    data,
    contentType,
    firestorePatch: options?.firestorePatch,
  });

  return {
    url: localPreviewUrl,
    path: storagePath,
    queued: true,
    queueId: id,
  };
}

/**
 * Process queued Storage uploads. Call when the device is back online.
 * Also applies optional Firestore field patches after each successful upload.
 */
export async function processStorageOfflineQueue(): Promise<{
  uploaded: number;
  failed: number;
}> {
  if (!isBrowserOnline() || !storage) {
    return { uploaded: 0, failed: 0 };
  }

  const items = await listQueuedStorageUploads();
  let uploaded = 0;
  let failed = 0;

  for (const item of items) {
    try {
      const blob = new Blob([item.data], { type: item.contentType });
      const storageRef = ref(storage, item.storagePath);
      await uploadBytes(storageRef, blob, { contentType: item.contentType });
      const url = await getDownloadURL(storageRef);

      if (item.firestorePatch && firestore) {
        const { collection, docId, urlField, pathField } = item.firestorePatch;
        const refDoc = doc(firestore, collection, docId);
        const patch: Record<string, string> = { [urlField]: url };
        if (pathField) patch[pathField] = item.storagePath;
        try {
          await updateDoc(refDoc, patch);
        } catch (patchError) {
          console.warn('[storage-offline-queue] firestore patch failed', patchError);
        }
      }

      await removeQueuedUpload(item.id);
      uploaded += 1;
    } catch (error) {
      console.error('[storage-offline-queue] upload failed', item.id, error);
      failed += 1;
    }
  }

  if (typeof window !== 'undefined' && (uploaded > 0 || failed > 0)) {
    window.dispatchEvent(
      new CustomEvent('sionflow:storage-queue-changed', {
        detail: { uploaded, failed },
      })
    );
    if (uploaded > 0) {
      window.dispatchEvent(
        new CustomEvent('sionflow:storage-queue-flushed', {
          detail: { uploaded, failed },
        })
      );
    }
  }

  return { uploaded, failed };
}
