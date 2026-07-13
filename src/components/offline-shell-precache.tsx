'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/auth-context';
import {
  precacheAllPageShells,
  type ShellPrecacheProgress,
} from '@/lib/offline-cache-warm';
import { isBrowserOnline } from '@/lib/network';
import { useI18n } from '@/contexts/i18n-context';

/**
 * On app open (online): pre-cache every main page SHELL in the background.
 * Does not load business data — only HTML/RSC so routes open offline.
 * Content is cached later when the user visits each page with internet.
 */
export function OfflineShellPrecache() {
  const router = useRouter();
  const { user, profileLoaded } = useAuth();
  const { t } = useI18n();
  const [progress, setProgress] = useState<ShellPrecacheProgress | null>(null);
  const [showBadge, setShowBadge] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const startedRef = useRef(false);

  useEffect(() => {
    if (!profileLoaded || !user) return;
    if (!isBrowserOnline()) return;
    if (startedRef.current) return;
    startedRef.current = true;

    const ac = new AbortController();
    abortRef.current = ac;

    // Wait until UI is idle so first paint / auth is not competing
    const startTimer = window.setTimeout(() => {
      void (async () => {
        setShowBadge(true);
        try {
          await precacheAllPageShells({
            force: false,
            signal: ac.signal,
            routerPrefetch: async (href) => {
              try {
                // App Router: fills client route cache for soft navigations offline
                router.prefetch(href);
              } catch {
                // ignore
              }
            },
            onProgress: (p) => {
              if (!ac.signal.aborted) setProgress(p);
            },
          });
        } catch (error) {
          console.warn('[OfflineShellPrecache] failed', error);
        } finally {
          if (!ac.signal.aborted) {
            setProgress((p) => (p ? { ...p, phase: 'done' } : p));
            window.setTimeout(() => setShowBadge(false), 3500);
          }
        }
      })();
    }, 4000);

    return () => {
      window.clearTimeout(startTimer);
      ac.abort();
    };
  }, [profileLoaded, user, router]);

  // Re-run when connectivity returns (force)
  useEffect(() => {
    const onOnline = () => {
      if (!user || !profileLoaded) return;
      const ac = new AbortController();
      abortRef.current?.abort();
      abortRef.current = ac;
      setShowBadge(true);
      void precacheAllPageShells({
        force: true,
        signal: ac.signal,
        routerPrefetch: (href) => {
          try {
            router.prefetch(href);
          } catch {
            // ignore
          }
        },
        onProgress: (p) => {
          if (!ac.signal.aborted) setProgress(p);
        },
      }).finally(() => {
        if (!ac.signal.aborted) {
          window.setTimeout(() => setShowBadge(false), 2500);
        }
      });
    };
    window.addEventListener('online', onOnline);
    return () => window.removeEventListener('online', onOnline);
  }, [user, profileLoaded, router]);

  if (!showBadge || !progress || progress.phase === 'done') {
    return null;
  }

  const pct =
    progress.total > 0
      ? Math.min(100, Math.round((progress.done / progress.total) * 100))
      : 0;

  return (
    <div
      className="pointer-events-none fixed bottom-20 left-4 z-40 max-w-[220px] rounded-lg border bg-background/95 px-3 py-2 text-xs shadow-md backdrop-blur sm:bottom-4"
      role="status"
      aria-live="polite"
    >
      <p className="font-medium text-foreground">
        {t('offline.precache.title') || 'Preparando modo offline…'}
      </p>
      <p className="mt-0.5 text-muted-foreground">
        {t('offline.precache.shells') || 'Guardando páginas'} {pct}%
      </p>
      <div className="mt-1.5 h-1 w-full overflow-hidden rounded-full bg-muted">
        <div
          className="h-full bg-primary transition-all duration-300"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}
