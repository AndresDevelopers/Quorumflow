import { NextResponse } from "next/server";
import { getAppIcon } from "@/lib/app-config";
import { enforceRateLimit } from "@/lib/rate-limit";

export const revalidate = 86400;

export async function GET(request: Request) {
  const limited = await enforceRateLimit(request, "api");
  if (limited) return limited;

  const iconUrl = getAppIcon();

  if (!iconUrl || iconUrl === "/icono-app.png") {
    const url = new URL(request.url);
    return NextResponse.redirect(`${url.origin}/icono-app.png`);
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
    return NextResponse.redirect(`${url.origin}/icono-app.png`);
  }
}
