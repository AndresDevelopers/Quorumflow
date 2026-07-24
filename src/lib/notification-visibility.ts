/**
 * Visibility rules for in-app + push notifications.
 *
 * Aligns with:
 * - Cloud Function `userHasCategoryPage` / CATEGORY_PAGE (functions/src/index.ts)
 * - main-layout sidebar: null/empty visiblePages ⇒ all pages
 * - Settings notification category pages
 */

import type { AppNotification } from "./types";

/** Same keys as Settings notificationCategories and CF NotifCategory. */
export type NotificationCategory =
  | "observations"
  | "converts"
  | "futureMembers"
  | "birthdays"
  | "familySearch"
  | "missionaryWork"
  | "service"
  | "council"
  | "activities"
  | "ministering";

/**
 * Canonical page path per notification category (must match Settings + CF).
 */
export const CATEGORY_PAGE: Record<NotificationCategory, string> = {
  observations: "/observations",
  converts: "/converts",
  futureMembers: "/missionary-work",
  birthdays: "/birthdays",
  familySearch: "/family-search",
  missionaryWork: "/missionary-work",
  service: "/service",
  council: "/council",
  activities: "/reports/activities",
  ministering: "/ministering",
};

/**
 * Map AppNotification.contextType → category page for visibility checks.
 * admin_user is role-gated (not a visiblePages entry) and returns null.
 */
export const CONTEXT_TYPE_PAGE: Partial<
  Record<NonNullable<AppNotification["contextType"]>, string>
> = {
  convert: "/converts",
  activity: "/reports/activities",
  service: "/service",
  member: "/members",
  council: "/council",
  baptism: "/converts",
  birthday: "/birthdays",
  investigator: "/missionary-work",
  urgent_family: "/ministering",
  missionary_assignment: "/missionary-work",
  ministering_interview: "/ministering",
  // admin_user: handled by role, not visiblePages
};

/** Known nav roots used to collapse nested actionUrls (e.g. /ministering/urgent). */
const NAV_ROOTS = [
  "/reports/activities",
  "/missionary-work",
  "/ministering",
  "/family-search",
  "/observations",
  "/birthdays",
  "/converts",
  "/members",
  "/council",
  "/service",
  "/church-chat",
  "/admin",
] as const;

/**
 * Normalize a path for visibility comparison (legacy aliases + strip query).
 */
export function normalizeVisibilityPath(path: string): string {
  const raw = path.trim().split("?")[0] || "/";
  if (raw === "/future-members") return "/missionary-work";
  if (raw === "/reports") return "/reports/activities";
  return raw;
}

/**
 * Collapse nested routes to the nav/settings root used in visiblePages.
 * `/ministering/urgent` → `/ministering`, `/members/abc` → `/members`.
 */
export function resolveVisibilityRoot(path: string): string {
  const normalized = normalizeVisibilityPath(path);
  if (normalized === "/" || normalized === "") return "/";

  // Longest-prefix match so /reports/activities wins over shorter roots
  let best: string | null = null;
  for (const root of NAV_ROOTS) {
    if (normalized === root || normalized.startsWith(`${root}/`)) {
      if (!best || root.length > best.length) best = root;
    }
  }
  return best ?? normalized;
}

/**
 * Whether the user can see a given app page according to visiblePages.
 * null / empty list ⇒ all pages (same as main-layout + CF).
 */
export function userHasVisiblePage(
  visiblePages: string[] | null | undefined,
  page: string
): boolean {
  if (visiblePages == null || visiblePages.length === 0) {
    return true;
  }

  const target = resolveVisibilityRoot(page);
  // Admin routes are role-gated in the UI; never grant via empty path tricks
  if (target.startsWith("/admin")) {
    return false;
  }

  const allowed = new Set(
    visiblePages.map((p) => resolveVisibilityRoot(normalizeVisibilityPath(p)))
  );
  // church-chat is always available in the sidebar
  allowed.add("/church-chat");

  if (allowed.has(target)) return true;
  // Dashboard "/" is always reachable for authenticated users
  if (target === "/") return true;
  return false;
}

/**
 * Resolve the page a notification refers to (actionUrl preferred, then contextType).
 * Returns null when there is no page constraint (general / system notif).
 */
export function resolveNotificationPage(params: {
  actionUrl?: string | null;
  contextType?: AppNotification["contextType"] | string | null;
}): string | null {
  if (params.actionUrl) {
    const path = normalizeVisibilityPath(params.actionUrl);
    // External https links are not gated by in-app visibility
    if (path.startsWith("https://") || path.startsWith("http://")) {
      return null;
    }
    if (path.startsWith("/")) {
      return resolveVisibilityRoot(path);
    }
  }

  if (params.contextType && typeof params.contextType === "string") {
    const fromContext =
      CONTEXT_TYPE_PAGE[params.contextType as keyof typeof CONTEXT_TYPE_PAGE];
    if (fromContext) return fromContext;
  }

  return null;
}

/**
 * Whether a stored/pending notification should be shown or delivered to a user
 * given their current visiblePages.
 *
 * - No resolvable page → allow (broadcast / system)
 * - admin_user → allow at delivery time only if caller already filtered by role
 * - Otherwise require matching visiblePages
 */
export function userCanReceiveNotification(
  visiblePages: string[] | null | undefined,
  params: {
    actionUrl?: string | null;
    contextType?: AppNotification["contextType"] | string | null;
  }
): boolean {
  if (params.contextType === "admin_user") {
    // Role-gated; visiblePages does not include /admin. Caller must filter by role.
    return true;
  }

  const page = resolveNotificationPage(params);
  if (!page) return true;
  return userHasVisiblePage(visiblePages, page);
}

/**
 * Infer Settings category key from contextType / actionUrl for notificationPrefs.
 */
export function resolveNotificationCategory(params: {
  actionUrl?: string | null;
  contextType?: AppNotification["contextType"] | string | null;
}): NotificationCategory | null {
  const page = resolveNotificationPage(params);
  if (!page) return null;

  switch (page) {
    case "/observations":
      return "observations";
    case "/converts":
      return "converts";
    case "/birthdays":
      return "birthdays";
    case "/family-search":
      return "familySearch";
    case "/missionary-work":
      // Ambiguous between futureMembers and missionaryWork — default missionaryWork
      return "missionaryWork";
    case "/service":
      return "service";
    case "/council":
      return "council";
    case "/reports/activities":
      return "activities";
    case "/ministering":
      return "ministering";
    default:
      return null;
  }
}
