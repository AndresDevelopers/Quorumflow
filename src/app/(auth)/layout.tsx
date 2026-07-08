"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import Image from "next/image";
import { AuthSettings } from "@/components/auth-settings";
import { getAppName, getAppLogo } from "@/lib/app-config";
import { DisclaimerPopup } from "@/components/shared/disclaimer-popup";

const appName = getAppName();

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="relative flex min-h-screen w-full flex-col items-center justify-center bg-background p-4">
       <AuthSettings />
      <div className="w-full max-w-md">
        <div className="mb-8 flex justify-center">
          <Link
            href="/"
            className="flex items-center gap-2 font-semibold text-foreground"
          >
            <Image
              src={getAppLogo()}
              alt={appName}
              width={32}
              height={32}
              className="h-8 w-8"
            />
            <span className="text-xl">{appName}</span>
          </Link>
        </div>
        {children}
      </div>
      <DisclaimerPopup persistent={false} />
    </div>
  );
}
