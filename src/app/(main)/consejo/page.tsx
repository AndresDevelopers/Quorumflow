import { redirect } from "next/navigation";

/**
 * Legacy route: the full multi-language council page lives at /council.
 * Keep this path so old bookmarks and notifications still work.
 */
export default function ConsejoRedirectPage() {
  redirect("/council");
}
