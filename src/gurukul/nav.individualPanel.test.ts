/**
 * Individual vs school student panel visibility — ONE place: nav.ts.
 *
 * Source-lock + behavioural asserts so the individual shell cannot grow
 * classhub/battleground without failing here, and the school shell cannot lose
 * them either.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  SCHOOL_ONLY_PAGE_KEYS,
  isSchoolOnlyPage,
  isSchoolOnlyPath,
  studentNavEntries,
} from "./nav";
import { stripComments } from "@/test/stripComments";

const NAV_RAW = readFileSync(join(__dirname, "nav.ts"), "utf8");
const NAV_SOURCE = stripComments(NAV_RAW);
const LAYOUT_SOURCE = stripComments(
  readFileSync(join(__dirname, "components", "Layout.tsx"), "utf8"),
);

describe("individual vs school student panel nav", () => {
  it("lists battleground and classhub as school-only (tenant-of-one has no opponent)", () => {
    expect(SCHOOL_ONLY_PAGE_KEYS).toContain("battleground");
    expect(SCHOOL_ONLY_PAGE_KEYS).toContain("classhub");
    expect(isSchoolOnlyPage("battleground")).toBe(true);
    expect(isSchoolOnlyPage("classhub")).toBe(true);
    expect(isSchoolOnlyPage("practice")).toBe(false);
    expect(isSchoolOnlyPath("/student/battleground")).toBe(true);
    expect(isSchoolOnlyPath("/student/battleground/battle/x")).toBe(true);
    expect(isSchoolOnlyPath("/student/fees")).toBe(true);
    expect(isSchoolOnlyPath("/student/notices")).toBe(true);
    expect(isSchoolOnlyPath("/student/practice")).toBe(false);
    // Notifications stay for individuals (pathToPage maps them to classhub for lighting).
    expect(isSchoolOnlyPath("/student/notifications")).toBe(false);
    // Documentation lives in a comment — read raw so stripComments cannot hide it.
    expect(NAV_RAW).toMatch(/tenant-of-one can never find an opponent/);
  });

  it("individual nav never includes classhub or battleground", () => {
    const { sidebar, bottom } = studentNavEntries("individual");
    expect(sidebar).not.toContain("classhub");
    expect(sidebar).not.toContain("battleground");
    expect(sidebar).not.toContain("learninghub");
    expect(bottom).not.toContain("classhub");
    expect(bottom).not.toContain("battleground");
    expect(bottom).not.toContain("learninghub");
    // Positive control — individual still has a learning surface.
    expect(sidebar).toContain("analysis");
    expect(bottom).toEqual(["dashboard", "practice", "analysis", "recovery"]);
  });

  it("school (and null while loading) still includes classhub and battleground", () => {
    for (const kind of ["school", null] as const) {
      const { sidebar, bottom } = studentNavEntries(kind);
      expect(sidebar).toContain("classhub");
      expect(sidebar).toContain("battleground");
      expect(sidebar).toContain("learninghub");
      expect(bottom).toContain("classhub");
      expect(bottom).toContain("learninghub");
      expect(bottom).not.toContain("battleground");
    }
  });

  it("Layout filters through studentNavEntries — not a second kind switch on nav keys", () => {
    expect(LAYOUT_SOURCE).toContain("studentNavEntries");
    expect(NAV_SOURCE).toContain("studentNavEntries");
    // No layout-local sidebar key array — keys must come from studentNavEntries.
    expect(LAYOUT_SOURCE).not.toMatch(
      /const sidebarNav\s*[:=]\s*\[\s*\{\s*key\s*:\s*["']dashboard["']/,
    );
  });

  it("StudentDashboard blocks school-only routes unless kind is known school", () => {
    const dash = stripComments(
      readFileSync(join(__dirname, "..", "pages", "StudentDashboard.tsx"), "utf8"),
    );
    // Must deny while kind is null/individual — not only when kind === individual
    // (that race left CUET on Battleground until identity settled).
    expect(dash).toMatch(/isSchoolOnlyPath\([^)]+\)\s*&&\s*schoolKind\s*!==\s*["']school["']/);
    expect(dash).not.toMatch(
      /schoolKind\s*===\s*["']individual["']\s*&&\s*isSchoolOnlyPath/,
    );
  });

  it("Dashboard never sends an individual next-action to homework", () => {
    const home = stripComments(
      readFileSync(join(__dirname, "pages", "Dashboard.tsx"), "utf8"),
    );
    expect(home).toMatch(/includeHomework:\s*!isIndividual/);
    expect(home).toMatch(/buildMission\([^,]+,\s*\{\s*includeHomework/);
  });

  it("Profile hides school homework/tests/rank for individual accounts", () => {
    const profile = stripComments(
      readFileSync(join(__dirname, "pages", "Profile.tsx"), "utf8"),
    );
    expect(profile).toMatch(/schoolKind\s*!==\s*["']individual["']/);
    expect(profile).toMatch(/isSchool\s*&&\s*\(/);
  });
});
