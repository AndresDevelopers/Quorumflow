import type { ReactNode } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import Image from "next/image";
import { getAppName, getAppLogo } from "@/lib/app-config";

export const metadata: Metadata = {
  title: "Admin general",
  description:
    "Panel del administrador general de la aplicación. Acceso restringido.",
  robots: {
    index: false,
    follow: false,
  },
};

/**
 * Layout del admin general (platform).
 * Vive en el route group (platform-admin), fuera de (main):
 * no usa sidebar de barrio ni PrivateRoute de miembros.
 *
 * Rutas propias: /app-admin/login, /app-admin/panel
 * (No se usa /admin/* porque choca con la administración de barrio en (main)/admin.)
 */
export default function PlatformAdminLayout({
  children,
}: {
  children: ReactNode;
}) {
  const appName = getAppName();

  return (
    <div className="relative flex min-h-screen w-full flex-col bg-background">
      <header className="border-b bg-muted/30">
        <div className="mx-auto flex w-full max-w-5xl items-center justify-between gap-3 px-4 py-3">
          <Link
            href="/app-admin/login"
            className="flex items-center gap-2 font-semibold text-foreground"
          >
            <Image
              src={getAppLogo()}
              alt={appName}
              width={28}
              height={28}
              className="h-7 w-7"
            />
            <span className="text-base">{appName}</span>
            <span className="rounded-md bg-rose-500/15 px-2 py-0.5 text-xs font-medium text-rose-700 dark:text-rose-300">
              ADMIN GENERAL
            </span>
          </Link>
        </div>
      </header>
      <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col px-4 py-8">
        {children}
      </main>
    </div>
  );
}
