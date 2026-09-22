import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { stripComments } from "@/test/stripComments";
import { parseClassLevel } from "./parseClassLevel";

const MARKER = "// ── SHARED BODY (parity-checked";

function bodyOf(path: string): string {
  const text = readFileSync(join(process.cwd(), path), "utf8");
  const ix = text.indexOf(MARKER);
  if (ix < 0) throw new Error(`${path}: the SHARED BODY marker is missing`);
  return stripComments(text.slice(ix))
    .split(/\r?\n/)
    .map((l) => l.trimEnd())
    .filter((l) => l.trim() !== "")
    .join("\n");
}

describe("parseClassLevel pair cannot drift", () => {
  const CLIENT = "src/lib/parseClassLevel.ts";
  const DENO = "supabase/functions/_shared/parseClassLevel.ts";

  it("the Deno copy is identical to the client copy below the marker", () => {
    expect(bodyOf(DENO)).toBe(bodyOf(CLIENT));
  });

  it("the comparison is looking at real code, not an empty string", () => {
    const body = bodyOf(CLIENT);
    expect(body.length).toBeGreaterThan(200);
    expect(body).toContain("parseClassLevel");
    expect(body).toContain("XII");
  });
});

describe("parseClassLevel", () => {
  it("parses Roman class labels that used to disable Nova matching (F6)", () => {
    expect(parseClassLevel("X-A")).toBe(10);
    expect(parseClassLevel("XII-B")).toBe(12);
    expect(parseClassLevel("Class XI Science")).toBe(11);
    expect(parseClassLevel("Class VIII")).toBe(8);
  });

  it("prefers a real class digit over an earlier room number", () => {
    expect(parseClassLevel("Room 2 — Class 10")).toBe(10);
  });
});
