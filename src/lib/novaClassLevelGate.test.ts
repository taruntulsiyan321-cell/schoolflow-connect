/**
 * Parity: edge parseClassLevel.ts must stay aligned with src/lib/parseClassLevel.ts
 * (Nova embed/cache gate for Roman XI/XII etc.).
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseClassLevel } from "./parseClassLevel";

const SHARED_MARKER = "SHARED BODY (parity-checked";

function sharedBody(path: string): string {
  const src = readFileSync(path, "utf8");
  const idx = src.indexOf(SHARED_MARKER);
  expect(idx, path).toBeGreaterThanOrEqual(0);
  return src.slice(idx);
}

describe("Nova class-level parse (embed/cache gate)", () => {
  it("accepts arabic and Roman labels used on student profiles", () => {
    expect(parseClassLevel("11-A")).toBe(11);
    expect(parseClassLevel("XI-A")).toBe(11);
    expect(parseClassLevel("Class XII")).toBe(12);
    expect(parseClassLevel("Unassigned")).toBeNull();
  });

  it("keeps client and edge parseClassLevel shared bodies identical", () => {
    const client = sharedBody(join(process.cwd(), "src/lib/parseClassLevel.ts"));
    const edge = sharedBody(
      join(process.cwd(), "supabase/functions/_shared/parseClassLevel.ts"),
    );
    expect(edge).toBe(client);
  });
});
