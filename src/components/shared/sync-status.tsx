'use client';

import { RefreshCw, CheckCircle, AlertCircle } from 'lucide-react';
import { format } from 'date-fns';
import { useI18n } from '@/contexts/i18n-context';

interface SyncStatusProps {
  syncStatus: 'idle' | 'syncing' | 'error';
  lastSyncTime?: Date | null;
  className?: string;
}

export function SyncStatus({ syncStatus, lastSyncTime, className = '' }: SyncStatusProps) {
  const { t } = useI18n();

  return (
    <div className={`flex items-center gap-2 ${className}`}>
      {syncStatus === 'syncing' && (
        <div className="flex items-center gap-1 text-sm text-blue-600">
          <RefreshCw className="h-3 w-3 animate-spin" />
          <span>{t('syncStatus.syncing')}</span>
        </div>
      )}
      {syncStatus === 'idle' && lastSyncTime && (
        <div className="flex items-center gap-1 text-sm text-green-600">
          <CheckCircle className="h-3 w-3" />
          <span>{t('syncStatus.updated', { time: format(lastSyncTime, 'HH:mm') })}</span>
        </div>
      )}
      {syncStatus === 'error' && (
        <div className="flex items-center gap-1 text-sm text-red-600">
          <AlertCircle className="h-3 w-3" />
          <span>{t('syncStatus.error')}</span>
        </div>
      )}
    </div>
  );
}
