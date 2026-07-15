import { NextResponse } from "next/server";
import { getAppName, getAppIcon } from "@/lib/app-config";

const appName = getAppName();
const shortName = appName.length > 12 ? appName.slice(0, 12) : appName;

/** Static icon file served from /public — always a 200, never a redirect. */
const STATIC_ICON = "/icono-app.png";

export const revalidate = 86400;

export async function GET() {
  // Use the static icon file directly so browsers (Chrome Android, etc.)
  // never receive a redirect response for the manifest icon — redirects
  // cause PWA install prompts to fail silently on mobile.
  const useStaticIcon =
    !getAppIcon() || getAppIcon() === "/icono-app.png" || getAppIcon() === "/api/icon";

  const iconSrc = useStaticIcon ? STATIC_ICON : "/api/icon";

  const icons = [
    {
      src: iconSrc,
      sizes: "192x192",
      type: "image/png",
      purpose: "any",
    },
    {
      src: iconSrc,
      sizes: "512x512",
      type: "image/png",
      purpose: "any",
    },
  ];

  const manifest = {
    name: appName,
    short_name: shortName,
    description: "Sistema de gestión integral para presidencias del Quorum de Elderes y Sociedad de Socorro.",
    start_url: "/",
    display: "standalone",
    orientation: "portrait-primary",
    background_color: "#ffffff",
    theme_color: "#5B21B6",
    categories: ["productivity", "utilities"],
    lang: "es",
    scope: "/",
    icons,
    shortcuts: [
      {
        name: "Dashboard",
        short_name: "Dashboard",
        description: "Panel principal",
        url: "/dashboard",
        icons: [{ src: iconSrc, sizes: "96x96" }],
      },
      {
        name: "Miembros",
        short_name: "Miembros",
        description: "Gestionar miembros del quórum y sociedad de socorro",
        url: "/members",
        icons: [{ src: iconSrc, sizes: "96x96" }],
      },
      {
        name: "Consejo",
        short_name: "Consejo",
        description: "Ver elementos del consejo",
        url: "/council",
        icons: [{ src: iconSrc, sizes: "96x96" }],
      },
    ],
    prefer_related_applications: false,
  };

  return NextResponse.json(manifest, {
    headers: {
      "Content-Type": "application/manifest+json",
      "Cache-Control": "public, max-age=3600, s-maxage=86400",
    },
  });
}
