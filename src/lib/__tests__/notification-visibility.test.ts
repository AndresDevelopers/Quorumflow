import { describe, expect, it } from "vitest";
import {
  normalizeVisibilityPath,
  resolveNotificationCategory,
  resolveNotificationPage,
  resolveVisibilityRoot,
  userCanReceiveNotification,
  userHasVisiblePage,
} from "../notification-visibility";

describe("normalizeVisibilityPath", () => {
  it("maps legacy paths", () => {
    expect(normalizeVisibilityPath("/future-members")).toBe("/missionary-work");
    expect(normalizeVisibilityPath("/reports")).toBe("/reports/activities");
    expect(normalizeVisibilityPath("/council?tab=1")).toBe("/council");
  });
});

describe("resolveVisibilityRoot", () => {
  it("collapses nested routes to nav roots", () => {
    expect(resolveVisibilityRoot("/ministering/urgent")).toBe("/ministering");
    expect(resolveVisibilityRoot("/members/abc123")).toBe("/members");
    expect(resolveVisibilityRoot("/reports/activities")).toBe(
      "/reports/activities"
    );
    expect(resolveVisibilityRoot("/missionary-work")).toBe("/missionary-work");
  });
});

describe("userHasVisiblePage", () => {
  it("allows all pages when visiblePages is null or empty", () => {
    expect(userHasVisiblePage(null, "/council")).toBe(true);
    expect(userHasVisiblePage([], "/ministering")).toBe(true);
    expect(userHasVisiblePage(undefined, "/birthdays")).toBe(true);
  });

  it("requires an allowed page when list is set", () => {
    const pages = ["/members", "/birthdays"];
    expect(userHasVisiblePage(pages, "/members")).toBe(true);
    expect(userHasVisiblePage(pages, "/members/xyz")).toBe(true);
    expect(userHasVisiblePage(pages, "/council")).toBe(false);
    expect(userHasVisiblePage(pages, "/ministering/urgent")).toBe(false);
  });

  it("maps legacy aliases in the allow list", () => {
    expect(userHasVisiblePage(["/future-members"], "/missionary-work")).toBe(
      true
    );
    expect(userHasVisiblePage(["/reports"], "/reports/activities")).toBe(true);
  });

  it("always allows church-chat and dashboard", () => {
    expect(userHasVisiblePage(["/members"], "/church-chat")).toBe(true);
    expect(userHasVisiblePage(["/members"], "/")).toBe(true);
  });

  it("never grants /admin via visiblePages alone", () => {
    expect(userHasVisiblePage(["/admin", "/members"], "/admin/users")).toBe(
      false
    );
  });
});

describe("resolveNotificationPage", () => {
  it("prefers actionUrl over contextType", () => {
    expect(
      resolveNotificationPage({
        actionUrl: "/ministering/urgent",
        contextType: "council",
      })
    ).toBe("/ministering");
  });

  it("falls back to contextType", () => {
    expect(resolveNotificationPage({ contextType: "birthday" })).toBe(
      "/birthdays"
    );
    expect(resolveNotificationPage({ contextType: "activity" })).toBe(
      "/reports/activities"
    );
  });

  it("returns null for external or unknown", () => {
    expect(
      resolveNotificationPage({ actionUrl: "https://example.com" })
    ).toBeNull();
    expect(resolveNotificationPage({})).toBeNull();
  });
});

describe("userCanReceiveNotification", () => {
  it("filters by page visibility", () => {
    const pages = ["/members", "/birthdays"];
    expect(
      userCanReceiveNotification(pages, {
        contextType: "birthday",
        actionUrl: "/birthdays",
      })
    ).toBe(true);
    expect(
      userCanReceiveNotification(pages, {
        contextType: "urgent_family",
        actionUrl: "/ministering/urgent",
      })
    ).toBe(false);
  });

  it("allows admin_user (role-gated elsewhere)", () => {
    expect(
      userCanReceiveNotification(["/members"], { contextType: "admin_user" })
    ).toBe(true);
  });

  it("allows unrestricted notifications when no page is known", () => {
    expect(
      userCanReceiveNotification(["/members"], {
        title: "x",
      } as { actionUrl?: string })
    ).toBe(true);
  });
});

describe("resolveNotificationCategory", () => {
  it("maps pages to category keys", () => {
    expect(
      resolveNotificationCategory({ actionUrl: "/ministering/urgent" })
    ).toBe("ministering");
    expect(resolveNotificationCategory({ contextType: "council" })).toBe(
      "council"
    );
    expect(resolveNotificationCategory({ contextType: "activity" })).toBe(
      "activities"
    );
  });
});
