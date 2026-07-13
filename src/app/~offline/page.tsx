"use client";

import Link from "next/link";
import { WifiOff, Home, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getAppName } from "@/lib/app-config";

/**
 * Fallback document served by the service worker when a route is not in cache
 * and the device is offline. Users can jump to the home shell if it was cached.
 */
export default function OfflineFallbackPage() {
  const appName = getAppName();

  return (
    <div className="flex min-h-svh flex-col items-center justify-center gap-6 bg-background px-6 text-center">
      <div className="flex h-16 w-16 items-center justify-center rounded-full bg-red-50 dark:bg-red-950/40">
        <WifiOff className="h-8 w-8 text-red-600" />
      </div>
      <div className="space-y-2 max-w-md">
        <h1 className="text-2xl font-bold tracking-tight">Sin conexión</h1>
        <p className="text-muted-foreground text-sm leading-relaxed">
          {appName} no pudo cargar esta pantalla porque no hay internet y aún no
          está en el cache de este dispositivo. Conéctate una vez, abre las
          secciones que uses y quedarán disponibles sin red.
        </p>
      </div>
      <div className="flex flex-wrap items-center justify-center gap-3">
        <Button asChild variant="default">
          <Link href="/">
            <Home className="mr-2 h-4 w-4" />
            Ir al inicio
          </Link>
        </Button>
        <Button
          variant="outline"
          onClick={() => {
            if (typeof window !== "undefined") window.location.reload();
          }}
        >
          <RefreshCw className="mr-2 h-4 w-4" />
          Reintentar
        </Button>
      </div>
    </div>
  );
}
