'use client';

import { useState, useEffect } from 'react';
import { Button } from "@/components/ui/button";
import { X, Download } from 'lucide-react';
import { getAppName } from "@/lib/app-config";

const appName = getAppName();

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
};

function isMobileDevice(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /Android|iPhone|iPad|iPod|webOS|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
}

function isChromeBrowser(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent;
  return /CriOS\//i.test(ua) || (/Chrome\//i.test(ua) && !/Edge|Edg|OPR|Opera/i.test(ua));
}

function isSafariIOS(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /iPhone|iPad|iPod/i.test(navigator.userAgent) && /Safari/i.test(navigator.userAgent) && !/CriOS/i.test(navigator.userAgent);
}

function isPWAInstalled(): boolean {
  if (typeof window === 'undefined') return false;
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    (window.navigator as any).standalone === true
  );
}

export function InstallPrompt() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const [ready, setReady] = useState(false);
  const [chromeReady, setChromeReady] = useState(false);

  useEffect(() => {
    if (!isMobileDevice() || isPWAInstalled()) return;

    const onChrome = isChromeBrowser();
    setChromeReady(onChrome);

    const onBeforeInstall = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
      setReady(true);
    };

    const onInstalled = () => {
      setReady(false);
      setDeferredPrompt(null);
    };

    window.addEventListener('beforeinstallprompt', onBeforeInstall);
    window.addEventListener('appinstalled', onInstalled);

    if (!onChrome) {
      setReady(true);
    }

    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstall);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  const handleInstall = async () => {
    if (!deferredPrompt) return;
    try {
      await deferredPrompt.prompt();
      const { outcome } = await deferredPrompt.userChoice;
      if (outcome === 'accepted') {
        setReady(false);
      }
    } catch {
      // user closed the native prompt
    }
    setDeferredPrompt(null);
  };

  if (!ready || dismissed || !isMobileDevice() || isPWAInstalled()) return null;

  const onChrome = chromeReady && deferredPrompt;
  const onIOS = isSafariIOS();

  return (
    <div className="pointer-events-none fixed inset-x-4 bottom-[calc(env(safe-area-inset-bottom)+1rem)] z-50 mx-auto w-full max-w-[min(100%,24rem)]">
      <div className="pointer-events-auto rounded-xl border bg-card/95 p-4 shadow-lg backdrop-blur supports-[backdrop-filter]:bg-card/75">
        <div className="mb-3 flex items-start justify-between">
          <h3 className="flex items-center gap-2 font-medium">
            <Download className="h-4 w-4" />
            Instalar {appName}
          </h3>
          <button
            onClick={() => setDismissed(true)}
            className="text-muted-foreground hover:text-foreground"
            aria-label="Cerrar"
          >
            <X size={18} />
          </button>
        </div>

        {onChrome ? (
          <>
            <p className="mb-4 text-sm text-muted-foreground">
              Instala {appName} para acceso rápido y uso sin conexión.
            </p>
            <Button onClick={handleInstall} size="sm" className="h-11 w-full">
              <Download className="mr-2 h-4 w-4" />
              Instalar
            </Button>
          </>
        ) : onIOS ? (
          <>
            <p className="mb-4 text-sm text-muted-foreground">
              Para instalar {appName}: toca el botón <strong>Compartir</strong> y luego <strong>Agregar a pantalla de inicio</strong>.
            </p>
          </>
        ) : (
          <>
            <p className="mb-4 text-sm text-muted-foreground">
              Para instalar {appName} abre esta página en <strong>Google Chrome</strong>.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
