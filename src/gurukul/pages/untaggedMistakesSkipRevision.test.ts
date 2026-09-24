/**
 * Untagged screen_capture / upload must NOT seed revision (§5.1 / migration 790).
 *
 * ── THE DEFECT THIS GUARDS ────────────────────────────────────────────────
 *
 * rpc_record_concept_mistake (770) always upserted concept_mastery and
 * revision_queue for upload / screen_capture, even when chapter_id IS NULL.
 * Spec §5.1: untagged stay practisable but are excluded from recovery and
 * revision — a guessed chapter is worse than none.
 *
 * 790 gates mastery + revision_queue on `_chapter_id IS NOT NULL`.
 * 800 clears already-poisoned revision_queue rows and makes chapter_tally
 * resolve tagged captures (untagged still produce zero tally rows).
 *
 * The Revision screen itself reads chapter_state via RecoveryEngineService,
 * never revision_queue — so these asserts also pin that the client does not
 * re-open the retired queue as a seed path.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { stripComments } from "@/test/stripComments";

const ROOT = join(__dirname, "..", "..", "..");
const MIG_790 = join(
  ROOT,
  "supabase",
  "migrations",
  "20261079000000_untagged_mistakes_skip_revision.sql",
);
const MIG_801 = join(
  ROOT,
  "supabase",
  "migrations",
  "20261080100000_revision_untagged_poison_and_capture_tally.sql",
);
const QUEUE_HOOK = join(__dirname, "useRevisionQueueV2.ts");

describe("untagged mistakes skip revision (790 / 801 / Revision screen)", () => {
  it("790 wraps mastery and revision_queue behind chapter_id IS NOT NULL", () => {
    const src = readFileSync(MIG_790, "utf8");
    expect(src).toContain("IF _chapter_id IS NOT NULL THEN");
    expect(src).toContain("_upsert_concept_mastery");
    expect(src).toContain("INSERT INTO public.revision_queue");
    expect(src).toContain("screen_capture_wrong");
    expect(src).toContain("upload_wrong");
    // Positive control: gate must sit before the mastery call, not after.
    const gate = src.indexOf("IF _chapter_id IS NOT NULL THEN");
    const mastery = src.indexOf("PERFORM public._upsert_concept_mastery");
    const insert = src.indexOf("INSERT INTO public.revision_queue");
    expect(gate).toBeGreaterThan(-1);
    expect(mastery).toBeGreaterThan(gate);
    expect(insert).toBeGreaterThan(gate);
  });

  it("801 deletes untagged poison and tallies only tagged captures", () => {
    const src = readFileSync(MIG_801, "utf8");
    expect(src).toContain("DELETE FROM public.revision_queue");
    expect(src).toContain("screen_capture_wrong");
    expect(src).toContain("upload_wrong");
    expect(src).toContain("sm.chapter_id IS NOT NULL");
    expect(src).toContain("student_capture_questions");
    expect(src).toContain("capture_question_id");
    expect(src).toContain("resolved.chapter_id IS NOT NULL");
    // Negative control still present in the migration's own prove block.
    expect(src).toMatch(/untagged capture/i);
  });

  it("Revision queue reads chapter_state, not revision_queue", () => {
    const body = stripComments(readFileSync(QUEUE_HOOK, "utf8"));
    expect(body).toContain("getChapterStates");
    expect(body).toContain("next_revision_at !== null");
    expect(body).not.toMatch(/\.from\(\s*["']revision_queue["']\s*\)/);
    expect(body).not.toContain("rpc_student_revision_queue");
    expect(body).not.toContain("rpc_revision_plan_v2");
  });
});
