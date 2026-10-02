import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Reading import.meta.env as an object — passing it around, spreading it,
 * indexing it with a computed key — makes Vite inline ALL of it into the
 * bundle. On Vercel that is every VITE_VERCEL_* system variable: the commit
 * message, its author's name and login, the repository and the deployment
 * URLs. The live bundle shipped all of them until 2026-10-02, through one
 * readEnv(key) helper. Only `import.meta.env.NAME` is allowed.
 */
function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(entry) && !/\.test\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}
const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");
/** import.meta.env NOT followed by ".NAME". */
const WHOLE_OBJECT = /import\.meta\.env(?!\s*\??\.\s*[A-Za-z_$])/g;

describe("the environment is read one variable at a time", () => {
  const files = walk(join(process.cwd(), "src"));

  it("scans the app's source (control)", () => {
    expect(files.length).toBeGreaterThan(150);
  });

  it("no source file reads import.meta.env as a whole", () => {
    const offenders = files.flatMap((f) => {
      const src = stripComments(readFileSync(f, "utf8"));
      return (src.match(WHOLE_OBJECT) ?? []).map(() => f);
    });
    expect(offenders).toEqual([]);
  });

  it("the matcher sees the ways the object gets read whole, and passes a named read (mutants)", () => {
    for (const bad of [
      "const env = import.meta.env as Record<string, string>;",
      "const v = import.meta.env[key];",
      "console.log({ ...import.meta.env });",
      "f(import.meta.env)",
    ]) {
      expect(bad.match(WHOLE_OBJECT), bad).not.toBeNull();
    }
    expect("const id = import.meta.env.VITE_MSG91_WIDGET_ID;".match(WHOLE_OBJECT)).toBeNull();
    expect("const d = import.meta.env.DEV && x;".match(WHOLE_OBJECT)).toBeNull();
  });
});
