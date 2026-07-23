/**
 * Client-side "new changelog" indicator.
 *
 * Shows a badge when the current app version differs from the last version
 * the user opened in the changelog dialog, for up to 24 hours from the first
 * time this device detected that version. Opening the changelog clears it.
 */

const SEEN_VERSION_KEY = "changelogSeenVersion";
const DETECTED_KEY = "changelogNewDetected";

/** 24 hours in milliseconds */
export const CHANGELOG_BADGE_TTL_MS = 24 * 60 * 60 * 1000;

export type ChangelogDetected = {
  version: string;
  at: number;
};

function safeGetItem(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeSetItem(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Ignore quota / private mode errors
  }
}

function parseDetected(raw: string | null): ChangelogDetected | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<ChangelogDetected>;
    if (
      typeof parsed.version === "string" &&
      parsed.version.length > 0 &&
      typeof parsed.at === "number" &&
      Number.isFinite(parsed.at)
    ) {
      return { version: parsed.version, at: parsed.at };
    }
  } catch {
    // ignore corrupt storage
  }
  return null;
}

/**
 * Returns whether the "new" badge should be shown for `currentVersion`.
 * Side effect: if this version has never been tracked, records first-seen time.
 * On the very first visit (no prior seen/detected data), baselines the current
 * version as already seen so we only highlight *future* releases.
 * Safe to call only on the client (uses localStorage).
 */
export function shouldShowChangelogBadge(
  currentVersion: string,
  now: number = Date.now()
): boolean {
  if (!currentVersion || typeof window === "undefined") return false;

  const seen = safeGetItem(SEEN_VERSION_KEY);
  if (seen === currentVersion) return false;

  const existingDetected = parseDetected(safeGetItem(DETECTED_KEY));

  // First visit after this feature ships: don't flash a badge for whatever is
  // already live — only for the next version bump.
  if (seen === null && existingDetected === null) {
    safeSetItem(SEEN_VERSION_KEY, currentVersion);
    return false;
  }

  let detected = existingDetected;
  if (!detected || detected.version !== currentVersion) {
    detected = { version: currentVersion, at: now };
    safeSetItem(DETECTED_KEY, JSON.stringify(detected));
  }

  return now - detected.at < CHANGELOG_BADGE_TTL_MS;
}

/**
 * Marks the given version as viewed (user opened the changelog).
 */
export function markChangelogSeen(version: string): void {
  if (!version || typeof window === "undefined") return;
  safeSetItem(SEEN_VERSION_KEY, version);
}

/**
 * Pure check used by tests: given storage snapshot, decide badge visibility
 * without writing. If detected is missing/stale, returns whether a new
 * detection would show the badge (true when version is unseen).
 */
export function evaluateChangelogBadge(params: {
  currentVersion: string;
  seenVersion: string | null;
  detected: ChangelogDetected | null;
  now?: number;
}): {
  show: boolean;
  nextDetected: ChangelogDetected | null;
  /** When set, storage should baseline this as the seen version (first visit). */
  baselineSeenVersion: string | null;
} {
  const { currentVersion, seenVersion, detected } = params;
  const now = params.now ?? Date.now();

  if (!currentVersion) {
    return { show: false, nextDetected: detected, baselineSeenVersion: null };
  }

  if (seenVersion === currentVersion) {
    return { show: false, nextDetected: detected, baselineSeenVersion: null };
  }

  if (seenVersion === null && detected === null) {
    return {
      show: false,
      nextDetected: null,
      baselineSeenVersion: currentVersion,
    };
  }

  const nextDetected =
    !detected || detected.version !== currentVersion
      ? { version: currentVersion, at: now }
      : detected;

  const show = now - nextDetected.at < CHANGELOG_BADGE_TTL_MS;
  return { show, nextDetected, baselineSeenVersion: null };
}
