/**
 * "Skipped Questions" must read the table that actually records a skip.
 *
 * ── THE DEFECT THIS GUARDS ────────────────────────────────────────────────
 *
 * 20260828170000_chunk7b_batch1_practice_tables.sql created practice_skipped,
 * carried the historical rows into it from the retiring question_records, and
 * in the SAME migration removed the only thing that had ever written a skip:
 *
 *   · section 7 stripped `PERFORM public._upsert_question_record(...)` out of
 *     rpc_record_question_attempt
 *   · section 9 dropped _upsert_question_record and question_records
 *
 * Nothing replaced it. practice_skipped was left with one reader
 * (PracticeService.listQuestionIdsByStatus) and zero writers, so the mode
 * could only ever return skips made before 2026-08-28 — for every student
 * since, "Skipped Questions" loaded nothing, forever, with no error.
 *
 * question_attempts is the authority and always was: rpc_record_question_attempt
 * forces `skipped = true` for a skip or a timeout on both the bank and the
 * template path. practice_skipped was a second home for one fact that never
 * got filled, so the reader moved to the authority rather than a writer being
 * bolted onto the duplicate.
 *
 * ── WHY A SOURCE ASSERTION ────────────────────────────────────────────────
 *
 * The bug was a live-schema fact, not a logic error: every unit test passed
 * and the query was valid SQL against a table that was simply always empty.
 * Only the choice of table can be asserted without a database, and that is
 * exactly the thing that was wrong. G11 — each assertion below fails against
 * the code as it stood: the first two on the table name, the third the moment
 * anyone points a reader back at practice_skipped.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { stripComments } from "@/test/stripComments";

const SERVICE = join(__dirname, "practiceService.ts");
const SOURCE = stripComments(readFileSync(SERVICE, "utf8"));

/** The skipped branch, isolated from the `wrong` branch beside it. */
function skippedBranch(): string {
  const start = SOURCE.indexOf("async listQuestionIdsByStatus");
  expect(start, "listQuestionIdsByStatus has been renamed or removed").toBeGreaterThan(-1);
  const body = SOURCE.slice(start, SOURCE.indexOf("async listMistakeQuestions", start));
  // Everything after the ternary's `:` is the skipped arm.
  const colon = body.indexOf(': await client');
  expect(colon, "the wrong/skipped ternary has been restructured").toBeGreaterThan(-1);
  return body.slice(colon);
}

function tsFilesUnder(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules") continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...tsFilesUnder(full));
    else if (/\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

describe("skipped questions read question_attempts, not practice_skipped", () => {
  it("selects skipped rows from question_attempts", () => {
    const branch = skippedBranch();
    expect(branch).toContain('.from("question_attempts")');
    expect(branch).toContain('.eq("skipped", true)');
  });

  it("takes the bank question id and never a null one", () => {
    const branch = skippedBranch();
    // A skip on a template question has no bank id; including those rows
    // would put `null` into the id list the mode loads questions by.
    expect(branch).toContain('.not("bank_question_id", "is", null)');
  });

  it("leaves practice_skipped with no reader anywhere in src", () => {
    // The table is writerless. A reader pointed back at it is the bug
    // returning, in this file or any other.
    const offenders = tsFilesUnder(join(__dirname, "..", "..")).filter((f) => {
      if (f.endsWith("practiceSkippedSource.test.ts")) return false;
      // The generated Supabase types name every table in the schema; they
      // describe the database, they do not read from it.
      if (f.endsWith(join("integrations", "supabase", "types.ts"))) return false;
      return stripComments(readFileSync(f, "utf8")).includes("practice_skipped");
    });
    expect(offenders, `practice_skipped has no writer; these read it: ${offenders.join(", ")}`).toEqual([]);
  });
});
