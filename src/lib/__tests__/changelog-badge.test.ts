import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  CHANGELOG_BADGE_TTL_MS,
  evaluateChangelogBadge,
  markChangelogSeen,
  shouldShowChangelogBadge,
} from "@/lib/changelog-badge";

describe("evaluateChangelogBadge", () => {
  const now = 1_700_000_000_000;

  it("hides badge when version was already seen", () => {
    const result = evaluateChangelogBadge({
      currentVersion: "1.2.0",
      seenVersion: "1.2.0",
      detected: { version: "1.2.0", at: now - 1000 },
      now,
    });
    expect(result.show).toBe(false);
  });

  it("baselines first visit without showing a badge", () => {
    const result = evaluateChangelogBadge({
      currentVersion: "1.2.0",
      seenVersion: null,
      detected: null,
      now,
    });
    expect(result.show).toBe(false);
    expect(result.baselineSeenVersion).toBe("1.2.0");
  });

  it("shows badge for a new version and seeds detection time", () => {
    const result = evaluateChangelogBadge({
      currentVersion: "1.2.0",
      seenVersion: "1.1.0",
      detected: null,
      now,
    });
    expect(result.show).toBe(true);
    expect(result.nextDetected).toEqual({ version: "1.2.0", at: now });
  });

  it("shows badge within 24 hours of first detection", () => {
    const result = evaluateChangelogBadge({
      currentVersion: "1.2.0",
      seenVersion: "1.1.0",
      detected: { version: "1.2.0", at: now - CHANGELOG_BADGE_TTL_MS + 1 },
      now,
    });
    expect(result.show).toBe(true);
  });

  it("hides badge after 24 hours even if not opened", () => {
    const result = evaluateChangelogBadge({
      currentVersion: "1.2.0",
      seenVersion: "1.1.0",
      detected: { version: "1.2.0", at: now - CHANGELOG_BADGE_TTL_MS },
      now,
    });
    expect(result.show).toBe(false);
  });

  it("resets detection when a newer version ships", () => {
    const result = evaluateChangelogBadge({
      currentVersion: "1.3.0",
      seenVersion: "1.1.0",
      detected: {
        version: "1.2.0",
        at: now - CHANGELOG_BADGE_TTL_MS * 2,
      },
      now,
    });
    expect(result.show).toBe(true);
    expect(result.nextDetected).toEqual({ version: "1.3.0", at: now });
  });
});

describe("shouldShowChangelogBadge / markChangelogSeen (localStorage)", () => {
  const store = new Map<string, string>();

  beforeEach(() => {
    store.clear();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => {
        store.set(key, value);
      },
      removeItem: (key: string) => {
        store.delete(key);
      },
      clear: () => store.clear(),
    });
  });

  it("baselines first visit, then shows on next version", () => {
    const now = Date.now();
    // First ever visit: baseline, no badge
    expect(shouldShowChangelogBadge("2.0.0", now)).toBe(false);
    expect(shouldShowChangelogBadge("2.0.0", now + 1000)).toBe(false);

    // New release arrives
    expect(shouldShowChangelogBadge("2.1.0", now + 2000)).toBe(true);
    // Same detection window
    expect(shouldShowChangelogBadge("2.1.0", now + 3000)).toBe(true);

    markChangelogSeen("2.1.0");
    expect(shouldShowChangelogBadge("2.1.0", now + 4000)).toBe(false);
  });

  it("expires after 24 hours without opening", () => {
    const now = Date.now();
    // Seed prior seen version so this is treated as a real update
    markChangelogSeen("2.9.0");
    expect(shouldShowChangelogBadge("3.0.0", now)).toBe(true);
    expect(
      shouldShowChangelogBadge("3.0.0", now + CHANGELOG_BADGE_TTL_MS)
    ).toBe(false);
  });
});
