import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { ROLE_PRIORITY } from "./session";
import { stripComments } from "@/test/stripComments";

/**
 * RULE 30 — the client and the database must agree on which role a multi-role
 * account lands in.
 *
 * `ROLE_PRIORITY` in `src/auth/session.ts` decides which app is rendered.
 * `public._role_precedence` decides which membership `active_membership_id()`
 * activates when the account has chosen none. If they diverge, the client draws
 * the teacher app while the database activates the parent membership, and every
 * query on the rendered screen is refused — the same class of failure the
 * multi-role lockout produced, just harder to see.
 *
 * Two copies of one order in two languages is this project's recurring drift
 * pattern (G9, two homes). This test is the ratchet.
 *
 * WHY IT READS THE NEWEST MIGRATION RATHER THAN A FIXED FILENAME: precedence
 * changes would land in a NEW migration replacing the function, so pinning
 * 20260906000000 would silently compare against a superseded definition. The
 * highest-timestamped file that defines the function is the live one.
 *
 * Comments are stripped before parsing (rule 29): a comment containing a
 * `WHEN 'admin' THEN 2` example would otherwise be read as part of the mapping.
 */

const MIGRATIONS = join(__dirname, "..", "..", "supabase", "migrations");
const DEFINES = /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\._role_precedence/;

function newestSqlDefinition(): { file: string; order: string[] } {
  const files = readdirSync(MIGRATIONS)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .reverse();

  for (const file of files) {
    const raw = readFileSync(join(MIGRATIONS, file), "utf8");
    if (!DEFINES.test(raw)) continue;

    const sql = stripComments(raw);
    if (!DEFINES.test(sql)) continue; // the only mention was inside a comment

    const body = sql.slice(sql.search(DEFINES));
    const end = body.indexOf("$function$;");
    const mapping = end === -1 ? body : body.slice(0, end);

    const pairs: Array<[string, number]> = [];
    const when = /WHEN\s+'([a-z_]+)'\s+THEN\s+(\d+)/gi;
    let m: RegExpExecArray | null;
    while ((m = when.exec(mapping))) pairs.push([m[1], Number(m[2])]);

    return { file, order: pairs.sort((a, b) => a[1] - b[1]).map(([role]) => role) };
  }
  throw new Error("no migration defines public._role_precedence");
}

describe("rule 30 — role precedence parity between client and database", () => {
  const sql = newestSqlDefinition();

  it("parses a non-empty mapping, so a silent parse failure cannot pass", () => {
    // G11: without this, a regex that matched nothing would make the comparison
    // below trivially true for an empty array and the guard would be decorative.
    expect(sql.order.length).toBeGreaterThan(0);
    expect(sql.order.length).toBe(ROLE_PRIORITY.length);
  });

  it("orders the roles identically to ROLE_PRIORITY", () => {
    expect(sql.order).toEqual([...ROLE_PRIORITY]);
  });

  it("covers every role the client knows about", () => {
    for (const role of ROLE_PRIORITY) expect(sql.order).toContain(role);
  });

  it("does not rely on the app_role enum order, which is not a privilege order", () => {
    // Postgres declares app_role as (admin, teacher, student, parent, principal,
    // super_admin) — `principal` after `parent`. Any mapping equal to that is a
    // sign someone reached for the enum instead of the stated precedence.
    const ENUM_ORDER = ["admin", "teacher", "student", "parent", "principal", "super_admin"];
    expect(sql.order).not.toEqual(ENUM_ORDER);
  });
});
