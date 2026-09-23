/**
 * Student shell primary order — Dashboard first, then the learning tabs,
 * then Nova. Layout.sidebarNav / bottomNav must stay in lockstep with TOP_LEVEL.
 *
 * Source assertions (RULE 29): Layout is read after stripComments so a comment
 * naming the old order cannot satisfy these checks.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { stripComments } from "@/test/stripComments";
import { TOP_LEVEL, PAGE_TITLE, LEARNING, pageSection } from "./nav";

const NAV = stripComments(readFileSync(join(__dirname, "nav.ts"), "utf8"));
const LAYOUT = stripComments(
  readFileSync(join(__dirname, "components/Layout.tsx"), "utf8"),
);

const EXPECTED_TOP: string[] = [
  "dashboard",
  "practice",
  "analysis",
  "recovery",
  "revision",
  "aicoach",
  "battleground",
  "learninghub",
  "classhub",
];

function arrayKeysAfter(src: string, marker: string): string[] {
  const start = src.indexOf(marker);
  expect(start, `${marker} missing`).toBeGreaterThan(-1);
  const open = src.indexOf("[", start);
  const close = src.indexOf("];", open);
  const body = src.slice(open, close + 2);
  return [...body.matchAll(/["']([a-z]+)["']/g)].map((m) => m[1]);
}

function navEntryKeys(src: string, constName: string): string[] {
  const start = src.indexOf(`const ${constName}`);
  expect(start, `${constName} missing`).toBeGreaterThan(-1);
  const body = src.slice(start, src.indexOf("];", start) + 2);
  return [...body.matchAll(/key:"([^"]+)"/g)].map((m) => m[1]);
}

describe("student shell organization", () => {
  it("locks TOP_LEVEL order in nav.ts source", () => {
    expect(arrayKeysAfter(NAV, "export const TOP_LEVEL")).toEqual(EXPECTED_TOP);
    expect([...TOP_LEVEL]).toEqual(EXPECTED_TOP);
  });

  it("puts Dashboard first, then Practice → Analysis → Recovery → Revision → Nova", () => {
    expect(TOP_LEVEL.slice(0, 6)).toEqual([
      "dashboard",
      "practice",
      "analysis",
      "recovery",
      "revision",
      "aicoach",
    ]);
  });

  it("keeps Battleground, Learning and Class after the primary tabs", () => {
    expect(TOP_LEVEL.slice(6)).toEqual(["battleground", "learninghub", "classhub"]);
  });

  it("names the coach Nova in the title map", () => {
    expect(PAGE_TITLE.aicoach).toBe("Nova");
    expect(NAV).toContain('aicoach: "Nova"');
    expect(NAV).not.toContain('aicoach: "AI Coach"');
  });

  it("does not nest Analysis / Recovery / Revision under Learning anymore", () => {
    expect(LEARNING).toEqual(["learninghub", "mistakebook"]);
    expect(pageSection("analysis")).toBeUndefined();
    expect(pageSection("recovery")).toBeUndefined();
    expect(pageSection("revision")).toBeUndefined();
    expect(pageSection("aicoach")).toBeUndefined();
    expect(pageSection("mistakebook")).toBe("Learning");
  });

  it("renders the same primary order in the sidebar", () => {
    expect(navEntryKeys(LAYOUT, "sidebarNav")).toEqual([...TOP_LEVEL]);
  });

  it("bottom nav is Home, Practice, Analysis, Recovery", () => {
    expect(navEntryKeys(LAYOUT, "bottomNav")).toEqual([
      "dashboard",
      "practice",
      "analysis",
      "recovery",
    ]);
  });

  it("labels Nova in the sidebar, not AI Coach", () => {
    expect(LAYOUT).toContain('label:"Nova"');
    expect(LAYOUT).not.toContain('label:"AI Coach"');
  });
});
