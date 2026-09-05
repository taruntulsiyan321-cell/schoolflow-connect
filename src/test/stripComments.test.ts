import { describe, it, expect } from "vitest";
import { stripComments } from "./stripComments";

/**
 * RULE 29's control. Every source assertion that calls `stripComments` is only
 * as trustworthy as the stripper — a stripper that silently returned its input
 * would leave those assertions passing for the wrong reason, or failing for it.
 * G11: these are the tests that make the others able to fail honestly.
 */
describe("rule 29 — the comment stripper the source guards depend on", () => {
  it("removes a line comment, which is the case that cost two sessions", () => {
    const src = ["// examAvg was removed here; see f6e2f51", "const a = 1;"].join("\n");
    expect(src).toContain("examAvg");
    expect(stripComments(src)).not.toContain("examAvg");
  });

  it("removes a block comment spanning lines", () => {
    const src = ["/*", " * examAvg ?? accuracy was the old blend", " */", "const b = 2;"].join("\n");
    expect(stripComments(src)).not.toContain("examAvg");
  });

  it("removes a trailing comment without eating the code before it", () => {
    const out = stripComments("const c = 3; // examAvg");
    expect(out).not.toContain("examAvg");
    expect(out).toContain("const c = 3;");
  });

  it("keeps code that merely looks like a comment inside a URL", () => {
    const out = stripComments('const u = "https://example.test/examAvg";');
    expect(out).toContain("https://example.test/examAvg");
  });

  it("preserves line and column offsets so a matcher still reports the right place", () => {
    const src = ["const d = 4; // gone", "const e = 5;"].join("\n");
    const out = stripComments(src);
    expect(out.split("\n")).toHaveLength(2);
    expect(out.split("\n")[0]).toHaveLength(src.split("\n")[0].length);
    expect(out.indexOf("const e")).toBe(src.indexOf("const e"));
  });

  it("leaves a body with no comments untouched", () => {
    const src = "const f = 6;\nconst g = 7;";
    expect(stripComments(src)).toBe(src);
  });
});
