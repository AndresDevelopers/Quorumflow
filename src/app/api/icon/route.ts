import { NextResponse } from "next/server";
import { getAppIcon } from "@/lib/app-config";

export const revalidate = 86400;

/** Path to fallback static icon in /public. */
const FALLBACK_ICON = "/icono-app.png";

export async function GET(request: Request) {
  const iconUrl = getAppIcon();

  // Use static fallback when no custom icon is configured or it points to this route itself
  if (!iconUrl || iconUrl === FALLBACK_ICON || iconUrl === "/api/icon") {
    const url = new URL(request.url);
    // Fetch the static file from public/ and serve it as the response body
    // (no redirect — redirects break PWA manifest icon validation on mobile).
    try {
      const res = await fetch(`${url.origin}${FALLBACK_ICON}`, {
        next: { revalidate: 86400 },
      });
      if (!res.ok) throw new Error(`Failed to fetch fallback icon: ${res.status}`);
      const buffer = Buffer.from(await res.arrayBuffer());
      const contentType = res.headers.get("content-type") || "image/png";
      return new NextResponse(buffer, {
        headers: {
          "Content-Type": contentType,
          "Cache-Control": "public, max-age=86400, s-maxage=86400, stale-while-revalidate=43200",
        },
      });
    } catch {
      return new NextResponse(null, { status: 404 });
    }
  }

  try {
    const res = await fetch(iconUrl, { next: { revalidate: 86400 } });
    if (!res.ok) throw new Error(`Failed to fetch icon: ${res.status}`);

    const buffer = Buffer.from(await res.arrayBuffer());
    const contentType = res.headers.get("content-type") || "image/png";

    return new NextResponse(buffer, {
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "public, max-age=86400, s-maxage=86400, stale-while-revalidate=43200",
      },
    });
  } catch {
    const url = new URL(request.url);
    try {
      const res = await fetch(`${url.origin}${FALLBACK_ICON}`, {
        next: { revalidate: 86400 },
      });
      if (!res.ok) return new NextResponse(null, { status: 404 });
      const buffer = Buffer.from(await res.arrayBuffer());
      const contentType = res.headers.get("content-type") || "image/png";
      return new NextResponse(buffer, {
        headers: {
          "Content-Type": contentType,
          "Cache-Control": "public, max-age=86400, s-maxage=86400, stale-while-revalidate=43200",
        },
      });
    } catch {
      return new NextResponse(null, { status: 404 });
    }
  }
}
