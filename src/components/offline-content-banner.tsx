'use client';

import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { WifiOff } from 'lucide-react';
import { isBrowserOnline } from '@/lib/network';
import { markPageContentSeen, wasPageContentSeen } from '@/lib/offline-cache-warm';
import { useI18n } from '@/contexts/i18n-context';

/**
 * Intelligent offline content UX:
 * - Online visit → mark this route's content as "seen" (data should be in caches)
 * - Offline on a never-visited route → gentle hint that shell is ok but data is empty
 * - Offline on a previously visited route → no scary empty message (data should show)
 */
export function OfflineContentBanner() {
  const pathname = usePathname();
  const { t } = useI18n();
  const [offline, setOffline] = useState(false);
  const [contentSeen, setContentSeen] = useState(true);

  useEffect(() => {
    const sync = () => {
      const on = isBrowserOnline();
      setOffline(!on);
      if (pathname) {
        if (on) {
          markPageContentSeen(pathname);
          setContentSeen(true);
        } else {
          setContentSeen(wasPageContentSeen(pathname));
        }
      }
    };
    sync();
    window.addEventListener('online', sync);
    window.addEventListener('offline', sync);
    return () => {
      window.removeEventListener('online', sync);
      window.removeEventListener('offline', sync);
    };
  }, [pathname]);

  // Mark content seen after a short dwell online (page had time to load data)
  useEffect(() => {
    if (!pathname || !isBrowserOnline()) return;
    const tmr = window.setTimeout(() => {
      markPageContentSeen(pathname);
      setContentSeen(true);
    }, 2500);
    return () => window.clearTimeout(tmr);
  }, [pathname]);

  if (!offline || contentSeen) return null;

  return (
    <div className="mx-4 mb-3 mt-2 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-100 sm:mx-6">
      <WifiOff className="mt-0.5 h-3.5 w-3.5 shrink-0" />
      <p>
        {t('offline.precache.emptyContent') ||
          'Estás sin internet y esta sección aún no tiene datos guardados. Puedes abrirla, pero el contenido aparecerá cuando la visites una vez con conexión.'}
      </p>
    </div>
  );
}
