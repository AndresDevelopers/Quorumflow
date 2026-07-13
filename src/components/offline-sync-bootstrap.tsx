'use client';

import { useEffect } from 'react';
import { initFirebaseOfflineSync } from '@/lib/firebase-offline-sync';
import { useToast } from '@/hooks/use-toast';
import { useI18n } from '@/contexts/i18n-context';

/**
 * Mount once in the main shell: enables auto-flush of Firestore pending
 * writes + Storage offline queue when connectivity returns.
 */
export function OfflineSyncBootstrap() {
  const { toast } = useToast();
  const { t } = useI18n();

  useEffect(() => {
    const dispose = initFirebaseOfflineSync();

    const onSyncComplete = (event: Event) => {
      const detail = (event as CustomEvent).detail as {
        storageUploaded?: number;
        storageFailed?: number;
        firestoreOk?: boolean;
      };
      const uploaded = detail?.storageUploaded ?? 0;
      if (uploaded > 0) {
        toast({
          title: t('offline.sync.completeTitle') || 'Sincronización completa',
          description:
            t('offline.sync.completeDescription', { count: String(uploaded) }) ||
            `Se subieron ${uploaded} archivo(s) pendientes y se sincronizó Firestore.`,
        });
      }
    };

    window.addEventListener('sionflow:offline-sync-complete', onSyncComplete);
    return () => {
      dispose();
      window.removeEventListener('sionflow:offline-sync-complete', onSyncComplete);
    };
  }, [toast, t]);

  return null;
}
