/**
 * The live app is the INDIVIDUAL student panel only (2026-10-01): one menu,
 * no school screen, and a school student is turned away rather than shown a
 * half-panel. The school side is kept on the `organisation` branch.
 *
 * Source-lock + behavioural asserts so a school screen cannot come back into
 * the shell, the menu or the routes without failing here.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { BOTTOM_PAGES, PAGE_PATH, SIDEBAR_PAGES, pathToPage } from "./nav";
import { stripComments } from "@/test/stripComments";

const NAV_SOURCE = stripComments(readFileSync(join(__dirname, "nav.ts"), "utf8"));
const LAYOUT_SOURCE = stripComments(readFileSync(join(__dirname, "components", "Layout.tsx"), "utf8"));
const SHELL_SOURCE = stripComments(readFileSync(join(__dirname, "..", "pages", "StudentDashboard.tsx"), "utf8"));
const APP_SOURCE = stripComments(readFileSync(join(__dirname, "..", "App.tsx"), "utf8"));

/** Every address the school student's screens lived at. */
const SCHOOL_PATHS = [
  "/student/battleground", "/student/leaderboard", "/student/resources", "/student/doubts",
  "/student/homework", "/student/attendance", "/student/timetable", "/student/calendar",
  "/student/tests", "/student/test", "/student/learning", "/student/class", "/student/classes",
  "/student/notices", "/student/fees", "/student/chat", "/student/practice/math12",
];

describe("the individual student panel", () => {
  it("has the individual pages and no school page", () => {
    expect([...SIDEBAR_PAGES]).toEqual([
      "dashboard", "practice", "mocktests", "aicoach", "analysis", "recovery", "revision",
      "mistakebook", "achievements", "premium",
    ]);
    expect([...BOTTOM_PAGES]).toEqual(["dashboard", "practice", "analysis", "recovery"]);
    const paths = Object.values(PAGE_PATH);
    for (const school of SCHOOL_PATHS) expect(paths, school).not.toContain(school);
    // CONTROL: the list does hold the individual pages' paths.
    expect(paths).toContain("/student/mocks");
    expect(paths).toContain("/student/premium");
  });

  it("maps a school address to Home, and keeps the individual ones where they are", () => {
    // (practice/math12 sits under Practice's prefix, so it lights Practice; the
    // shell's catch-all route still sends it Home.)
    for (const school of SCHOOL_PATHS.filter((p) => !p.startsWith("/student/practice/"))) {
      expect(pathToPage(school), school).toBe("dashboard");
    }
    expect(pathToPage("/student/mocks")).toBe("mocktests");
    expect(pathToPage("/student/mock/abc123")).toBe("mocktests");
    expect(pathToPage("/student/mock/abc123/result")).toBe("mocktests");
    expect(pathToPage("/student/practice/session/x/result")).toBe("practice");
    expect(pathToPage("/student/plans")).toBe("revision");
  });

  it("the shell routes no school screen, and sends every other address to Home", () => {
    for (const route of ["battleground", "leaderboard", "homework", "attendance", "timetable", "calendar", "tests", "learning", "notices", "fees", "classes", "practice/math12", "test/:id/attempt"]) {
      expect(SHELL_SOURCE, route).not.toContain(`path="${route}"`);
    }
    expect(SHELL_SOURCE).toMatch(/<Route path="\*" element=\{<Navigate to="\/student" replace \/>\} \/>/);
    // CONTROL: the individual routes are there.
    for (const route of ["practice", "mocks", "analysis", "recovery", "revision", "mistakes", "achievements", "premium", "profile", "notifications"]) {
      expect(SHELL_SOURCE, route).toContain(`path="${route}"`);
    }
  });

  it("turns a school student away, by known kind only", () => {
    expect(SHELL_SOURCE).toMatch(
      /if \(schoolKind === "school"\) \{\s*return <Navigate to="\/unauthorized" replace state=\{\{ reason: "organisation" \}\} \/>;/,
    );
  });

  it("is a mock paper sat without app chrome, and its result inside the panel", () => {
    expect(SHELL_SOURCE).toMatch(/isSittingAMock\s*=\s*\/\^\\\/student\\\/mock\\\/\[\^\/\]\+\\\/\?\$\//);
    expect(SHELL_SOURCE).toMatch(/if \(isSittingAMock\)/);
    expect(SHELL_SOURCE).toMatch(/path="mock\/:id"\s+element=\{<MockAttempt \/>\}/);
    expect(SHELL_SOURCE).toMatch(/path="mock\/:id\/result"\s+element=\{<MockResult \/>\}/);
  });

  it("Layout renders nav.ts's lists and nothing school", () => {
    expect(LAYOUT_SOURCE).toContain("navEntriesFor(SIDEBAR_PAGES)");
    expect(LAYOUT_SOURCE).toContain("bottomEntriesFor(BOTTOM_PAGES)");
    for (const school of ["MembershipSwitcher", "/student/notices", "/student/fees", "Battleground", "classhub", "learninghub", "student.rank"]) {
      expect(LAYOUT_SOURCE, school).not.toContain(school);
    }
    expect(LAYOUT_SOURCE).toMatch(/mocktests:\s+\{ label: "Mock Tests"/);
    expect(LAYOUT_SOURCE).toMatch(/premium:\s+\{ label: "Plans"/);
    expect(NAV_SOURCE).toMatch(/premium: "\/student\/premium"/);
  });

  it("the app has no organisation route", () => {
    for (const route of ["/admin/*", "/principal/*", "/teacher/*", "/parent/*", "/reset-password"]) {
      expect(APP_SOURCE, route).not.toContain(`path="${route}"`);
    }
    expect(APP_SOURCE).toContain(`path="/student/*"`);
  });
});

describe("Home and Profile carry no school piece", () => {
  it("Home: no class rank, no class leaderboard, no Battleground, no homework", () => {
    const home = stripComments(readFileSync(join(__dirname, "pages", "Dashboard.tsx"), "utf8"));
    for (const school of ["Class Rank", "Class Leaderboard", "Battleground", "homework", "student.rank", "schoolKind"]) {
      expect(home, school).not.toContain(school);
    }
    // CONTROL: Home's own pieces are there.
    expect(home).toContain("Practice accuracy");
    expect(home).toMatch(/buildMission\(snapshot,\s*sessionsToday\(practiceTime\)\)/);
  });

  it("Profile: no homework, marks, remarks or rank", () => {
    const profile = stripComments(readFileSync(join(__dirname, "pages", "Profile.tsx"), "utf8"));
    for (const school of ["HomeworkService", "TestService", "MarksService", "RemarksService", "classRank", "schoolKind"]) {
      expect(profile, school).not.toContain(school);
    }
    expect(profile).toContain("Recent milestones");
  });
});
