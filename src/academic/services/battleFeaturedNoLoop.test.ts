import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { stripComments } from "@/test/stripComments";

/**
 * #5 — the loop that saturated the database.
 *
 * useBattlegroundData reloads on every "battle"/"xp" write announcement and
 * on "student-xp-updated", and each reload calls ensureFeaturedAll. When
 * ensureFeaturedAll itself announced a write, one open page called
 * rpc_ensure_featured_battles_all 274 times a minute. It must stay a quiet
 * warm: no write announcement, and never the platform-wide refresh/rotate.
 */
const SOURCE = stripComments(
  readFileSync(join(process.cwd(), "src", "academic", "services", "battleExperienceService.ts"), "utf8"),
);

function methodBody(src: string, name: string): string {
  const start = src.indexOf(`async ${name}(`);
  if (start < 0) throw new Error(`${name} not found`);
  // Skip the parameter list, then the return type (which may itself hold a
  // "{" inside Promise<{ … }>): the body is the first "{" outside any "<…>".
  let i = src.indexOf("(", start);
  for (let parens = 0; i < src.length; i++) {
    if (src[i] === "(") parens++;
    else if (src[i] === ")" && --parens === 0) break;
  }
  let angle = 0;
  for (; i < src.length; i++) {
    if (src[i] === "<") angle++;
    else if (src[i] === ">" && src[i - 1] !== "=") angle--;
    else if (src[i] === "{" && angle === 0) break;
  }
  const open = i;
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}" && --depth === 0) return src.slice(open, i + 1);
  }
  throw new Error(`${name} body not closed`);
}

const LOOP_TRIGGERS = /afterExperienceWrite|broadcastAcademicWrite|notifyStudentXpUpdated|rpc_refresh_featured_battles|rpc_rotate_featured_battles/;

describe("ensureFeaturedAll stays a quiet warm (#5)", () => {
  it("the check flags a body that announces a write — positive control", () => {
    const bad = `async ensureFeaturedAll(ctx): Promise<{ daily: string }> { const r = await x(); afterExperienceWrite(ctx, ["battle"]); return r; }`;
    expect(methodBody(bad, "ensureFeaturedAll")).toMatch(LOOP_TRIGGERS);
  });

  it("the real method announces nothing and never refreshes the platform", () => {
    const body = methodBody(SOURCE, "ensureFeaturedAll");
    expect(body).toContain("rpc_ensure_featured_battles_all");
    expect(body).not.toMatch(LOOP_TRIGGERS);
  });
});
