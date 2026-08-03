import { describe, expect, it } from "vitest";
import { canAccessPath, dashboardForRole, mapAuthError } from "./rbac";

describe("canAccessPath", () => {
  it("routes each portal role to its shell prefix only", () => {
    expect(canAccessPath("student", "/student")).toBe(true);
    expect(canAccessPath("student", "/student/practice")).toBe(true);
    expect(canAccessPath("student", "/teacher")).toBe(false);
    expect(canAccessPath("teacher", "/teacher/classes")).toBe(true);
    expect(canAccessPath("parent", "/parent")).toBe(true);
    expect(canAccessPath("principal", "/principal")).toBe(true);
    expect(canAccessPath("admin", "/admin")).toBe(true);
  });

  it("denies unknown post-login redirects (fail closed)", () => {
    expect(canAccessPath("student", "/evil-admin")).toBe(false);
    expect(canAccessPath("teacher", "//evil.com")).toBe(false);
    expect(canAccessPath("admin", "/api/secret")).toBe(false);
  });

  it("allows safe open paths", () => {
    expect(canAccessPath("student", "/unauthorized")).toBe(true);
    expect(canAccessPath("teacher", "/reset-password")).toBe(true);
  });
});

describe("dashboardForRole", () => {
  it("maps roles to correct shells", () => {
    expect(dashboardForRole("student")).toBe("/student");
    expect(dashboardForRole("teacher")).toBe("/teacher");
    expect(dashboardForRole("parent")).toBe("/parent");
    expect(dashboardForRole("principal")).toBe("/principal");
    expect(dashboardForRole("admin")).toBe("/admin");
    expect(dashboardForRole(null)).toBe("/auth");
  });
});

describe("mapAuthError", () => {
  it("maps RLS / permission failures to a clear message", () => {
    expect(mapAuthError({ message: "new row violates row-level security policy" })).toMatch(
      /permission/i,
    );
    expect(mapAuthError({ message: "permission denied for table students" })).toMatch(/permission/i);
  });
});
