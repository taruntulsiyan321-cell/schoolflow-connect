import { describe, expect, it } from "vitest";
import { canAccessPath, dashboardForRole } from "./rbac";

describe("canAccessPath", () => {
  it("lets a student into the student panel only", () => {
    expect(canAccessPath("student", "/student")).toBe(true);
    expect(canAccessPath("student", "/student/practice")).toBe(true);
    expect(canAccessPath("student", "/teacher")).toBe(false);
  });

  it("has no panel for an organisation role (the live app is individual-only)", () => {
    for (const role of ["teacher", "parent", "principal", "admin", "super_admin"] as const) {
      expect(canAccessPath(role, "/student"), role).toBe(false);
      expect(canAccessPath(role, `/${role}`), role).toBe(false);
    }
  });

  it("denies unknown post-login redirects (fail closed)", () => {
    expect(canAccessPath("student", "/evil-admin")).toBe(false);
    expect(canAccessPath("teacher", "//evil.com")).toBe(false);
    expect(canAccessPath("admin", "/api/secret")).toBe(false);
  });

  it("allows safe open paths, and no longer the password-reset page", () => {
    expect(canAccessPath("student", "/unauthorized")).toBe(true);
    expect(canAccessPath("student", "/reset-password")).toBe(false);
  });
});

describe("dashboardForRole", () => {
  it("sends a student to the student panel and every organisation role to /unauthorized", () => {
    expect(dashboardForRole("student")).toBe("/student");
    for (const role of ["teacher", "parent", "principal", "admin", "super_admin"] as const) {
      expect(dashboardForRole(role), role).toBe("/unauthorized");
    }
    expect(dashboardForRole(null)).toBe("/auth");
  });
});
