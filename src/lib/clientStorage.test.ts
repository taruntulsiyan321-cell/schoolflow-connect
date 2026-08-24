import { describe, it, expect, beforeEach } from "vitest";
import {
  novaConversationsKey,
  mistakeBookmarksKey,
  recoverySuccessHistoryKey,
  appSettingsKey,
  clearAppStorage,
} from "./clientStorage";

const IDENTITY = { userId: "user-1", schoolId: "school-1" };
const OTHER = { userId: "user-2", schoolId: "school-2" };

describe("clientStorage keys", () => {
  it("scopes personal keys by both school and user", () => {
    for (const build of [novaConversationsKey, mistakeBookmarksKey, recoverySuccessHistoryKey]) {
      expect(build(IDENTITY)).not.toBe(build(OTHER));
      expect(build(IDENTITY)).toContain("school-1");
      expect(build(IDENTITY)).toContain("user-1");
    }
  });

  it("returns null rather than a shared key when identity is incomplete", () => {
    expect(novaConversationsKey({ userId: "user-1" })).toBeNull();
    expect(novaConversationsKey({ schoolId: "school-1" })).toBeNull();
    expect(novaConversationsKey({})).toBeNull();
    expect(appSettingsKey(null)).toBeNull();
  });

  it("scopes app settings by school", () => {
    expect(appSettingsKey("school-1")).not.toBe(appSettingsKey("school-2"));
  });
});

describe("clearAppStorage", () => {
  beforeEach(() => localStorage.clear());

  it("clears every key the app writes", () => {
    const written = [
      novaConversationsKey(IDENTITY),
      mistakeBookmarksKey(IDENTITY),
      recoverySuccessHistoryKey(IDENTITY),
      appSettingsKey("school-1"),
    ];
    for (const key of written) localStorage.setItem(key as string, "x");

    clearAppStorage();

    for (const key of written) expect(localStorage.getItem(key as string)).toBeNull();
  });

  // These are the exact keys shipped before the namespace existed. They sit on
  // real devices today, so sign-out has to remove them or already-leaked Nova
  // conversations survive forever.
  it("purges the pre-namespace legacy keys", () => {
    const legacy = [
      "gurukul.nova.convos.v1",
      "gurukul.mistake.bookmarks.user-1",
      "recovery-success-history",
      "app-settings",
    ];
    for (const key of legacy) localStorage.setItem(key, "x");

    clearAppStorage();

    for (const key of legacy) expect(localStorage.getItem(key)).toBeNull();
  });

  it("leaves unrelated keys alone", () => {
    localStorage.setItem("sb-auth-token", "keep");
    clearAppStorage();
    expect(localStorage.getItem("sb-auth-token")).toBe("keep");
  });
});
