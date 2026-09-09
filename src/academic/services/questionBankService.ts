import {
  assertCanOwn,
  assertCanConsume,
  toRepoContext,
  ForbiddenError,
  type ServiceContext,
} from "./context";
import { getClient, throwIfError } from "../repository/base";
import { ValidationFailedError } from "../repository/errors";
import { emitEvent, emitEventBestEffort } from "../repository/eventsRepository";
import { broadcastAcademicWrite } from "../live";
import type { Json } from "@/integrations/supabase/types";
import { fixUtf8Content } from "@/lib/utf8Text";
import { repairUtf8Mojibake } from "@/lib/utf8MojibakeRepair";

/** One row of the super admin's review queue. */
export type QuestionReviewRow = {
  id: string;
  question: string;
  options: Json;
  correct_index: number;
  explanation: string | null;
  subject: string;
  chapter: string | null;
  class_level: number | null;
  difficulty: string | null;
  source: string | null;
  created_by: string | null;
  author_name: string;
  created_at: string;
};

/** How many pending questions one page of the queue shows. */
export const REVIEW_PAGE_SIZE = 25;

/**
 * §10.20 gives "Manage the central question bank" to the super admin, and only
 * to them. Both review calls assert it before the network, so the screen can
 * say what is wrong instead of surfacing a bare 42501 from the RPC — which
 * enforces the same rule server-side and is the actual authority.
 */
function assertSuperAdmin(ctx: ServiceContext, action: string): void {
  if (ctx.role !== "super_admin") {
    throw new ForbiddenError(`Only a super admin may ${action} (§10.20).`);
  }
}

export type QuestionBankInsertRow = {
  class_level?: number | null;
  subject: string;
  chapter?: string | null;
  /**
   * The curriculum chapter this question belongs to. NOT optional in practice:
   * see `assertQuestionRowsAreKeyed` — the database refuses an active row
   * without one. It is typed optional only because the column is nullable for
   * the 15 retired legacy rows that have no chapter.
   */
  chapter_id?: string | null;
  topic?: string | null;
  concept?: string | null;
  difficulty?: string;
  question: string;
  options: string[] | Json;
  correct_index: number;
  explanation?: string | null;
  source?: string | null;
  /**
   * Where the question came from, in the vocabulary
   * `question_bank_source_type_check` admits: ncert_aligned,
   * ncert_exemplar_aligned, teacher, ai_generated, licensed_import, legacy.
   *
   * This is the "tagged" half of §5's write-back rule. A generated question
   * that reaches the bank untagged is indistinguishable from a curated one the
   * moment it is approved, and the point of routing it through review is that
   * the reviewer can see what they are reviewing.
   */
  source_type?: string | null;
  /** mcq / short / long / … — `question_bank_question_format_check`. */
  question_format?: string | null;
  created_by?: string | null;
  board?: string | null;
  stream?: string | null;
  is_approved?: boolean;
};

/**
 * Build the rows sent to `question_bank`, separated from the request so the
 * shape can be asserted without a network client or a mock.
 *
 * IT MUST NOT EMIT A `school_id`. `public.question_bank` HAS NO SUCH COLUMN —
 * §10.9 makes the bank "centralised and shared across all schools and all
 * users", so there is deliberately nothing to scope it by, and
 * `match_question_bank`'s own body says the same. This function used to add
 * `school_id: r.school_id ?? ctx.schoolId` to every row, and
 * `.insert(payload as never)` hid the mismatch from the compiler.
 *
 * The type system CANNOT guard this — measured 2026-09-07: with the cast
 * removed and `school_id` deliberately re-added, `tsc --noEmit` still exits 0,
 * because excess-property checking does not apply to a mapped variable, only to
 * an object literal. That is why the guard is the test beside this file rather
 * than a type.
 */
export function buildQuestionBankInsertPayload(
  rows: QuestionBankInsertRow[],
  ctx: Pick<ServiceContext, "userId">,
) {
  return rows.map((r) => {
    const options = Array.isArray(r.options)
      ? r.options.map((o) => (typeof o === "string" ? fixUtf8Content(o) : o))
      : r.options;
    // `school_id` is destructured out rather than merely "not added". Dropping
    // the explicit assignment is NOT enough: `...r` re-introduces whatever the
    // caller passed, and the CSV path builds its rows from parsed text. Removing
    // it from the type only guards object literals the compiler can see.
    const { school_id: _schoolIdIsNotAColumn, ...rest } =
      r as QuestionBankInsertRow & { school_id?: unknown };
    void _schoolIdIsNotAColumn;
    return {
      ...rest,
      subject: repairUtf8Mojibake(r.subject),
      chapter: r.chapter != null ? repairUtf8Mojibake(r.chapter) : r.chapter,
      topic: r.topic != null ? repairUtf8Mojibake(r.topic) : r.topic,
      concept: r.concept != null ? repairUtf8Mojibake(r.concept) : r.concept,
      question: fixUtf8Content(r.question),
      options,
      explanation:
        r.explanation != null && String(r.explanation).trim()
          ? fixUtf8Content(r.explanation)
          : r.explanation ?? null,
      created_by: r.created_by ?? ctx.userId,
      // `is_approved` is NOT defaulted here. The column defaults to FALSE
      // (20260907000000) so a contribution is not student-visible at every
      // school the moment it saves; `?? true` here overrode that default and
      // was the reason it leaked. An explicit value from a caller still wins,
      // which is what an approval path would use once one exists.
    };
  });
}

/**
 * THERE IS NO CLASS-LEVEL RANGE HERE ANY MORE, and that is the fix.
 *
 * This file briefly carried `QUESTION_BANK_CLASS_LEVELS = { min: 6, max: 12 }`,
 * mirroring `question_bank_class_level_check`. Both are gone
 * (`20260914020000`). §10.9 names Class 5 by hand — "a Class 5 student is only
 * ever served Class 5 content for their own board" — and a hardcoded 6..12 was
 * what archived all 2,189 Class 5 questions in the first place.
 *
 * The class a question belongs to is now decided by the CHAPTER it is keyed to:
 * a database trigger fills `class_level` from the chapter's curriculum class and
 * refuses any row where the two disagree. So the domain is whatever the
 * curriculum tree holds, there is no literal to drift, and adding Class 4 later
 * is a seeding job rather than a code change. `assertQuestionRowsAreKeyed` below
 * therefore checks only that a class is PRESENT.
 */

/**
 * Every question saved to the bank must be keyed to a chapter and a class.
 *
 * This is not a preference. `question_bank_active_must_be_keyed`
 * (20260828160000 §4) is `CHECK (NOT is_active OR (chapter_id IS NOT NULL AND
 * class_level IS NOT NULL))`, and `is_active` defaults TRUE — so an unkeyed row
 * is refused by the database with `23514`, whose message names a constraint and
 * tells a teacher nothing. Measured as a real teacher on 2026-09-07: both the
 * "Save to bank" button and the CSV import failed with exactly that, on every
 * attempt, because neither path had ever sent a `chapter_id`.
 *
 * The rule it enforces is §10.10 — "Everything downstream — mistake book,
 * custom sessions, analysis — keys on chapter_id" — and §10.22, "Chapter is
 * picked, never typed." A question with no chapter can never be served, so
 * saving one is not a partial success to be tolerated; it is a row that would
 * sit in the bank forever and reach no student.
 *
 * Checked here rather than only in the UI because there are two write paths and
 * a third (an importer, a seeding script) is the obvious next one.
 */
export function assertQuestionRowsAreKeyed(rows: QuestionBankInsertRow[]): void {
  const issues: { field: string; code: string; message: string }[] = [];
  rows.forEach((r, i) => {
    // Row numbers are 1-based: they are read by a person against a list.
    const at = `Question ${i + 1}`;
    if (!r.chapter_id) {
      issues.push({
        field: "chapter_id",
        code: "chapter_required",
        message: `${at}: pick a chapter — a question with no chapter is never served.`,
      });
    }
    if (r.class_level == null) {
      issues.push({
        field: "class_level",
        code: "class_required",
        message: `${at}: pick a class — it is what keeps a Class 5 student off Class 12 content.`,
      });
    }
    // No RANGE check. Which classes exist is the curriculum tree's answer, and
    // `tg_question_bank_class_follows_chapter` refuses any row whose class
    // disagrees with its chapter — so a wrong class is impossible rather than
    // merely discouraged, and a right one is never rejected for being new.
  });
  if (issues.length > 0) throw new ValidationFailedError(issues);
}

/**
 * QuestionBankService — teacher/admin bank writes go through AE (not raw UI inserts).
 */
export const QuestionBankService = {
  async listSummary(ctx: ServiceContext): Promise<{ subject: string; count: number }[]> {
    assertCanConsume(ctx, "question");
    const { data, error } = await getClient(toRepoContext(ctx))
      .from("question_bank")
      .select("subject");
    throwIfError(error, "Failed to load question bank summary");
    const map: Record<string, number> = {};
    for (const r of data ?? []) {
      const s = String((r as { subject?: string }).subject ?? "").trim();
      if (!s) continue;
      map[s] = (map[s] ?? 0) + 1;
    }
    return Object.entries(map)
      .map(([subject, count]) => ({ subject, count }))
      .sort((a, b) => b.count - a.count);
  },

  async insert(
    ctx: ServiceContext,
    rows: QuestionBankInsertRow[],
  ): Promise<{ count: number }> {
    assertCanOwn(ctx, "question");
    if (!rows.length) return { count: 0 };
    assertQuestionRowsAreKeyed(rows);

    const payload = buildQuestionBankInsertPayload(rows, ctx);

    const { data, error } = await getClient(toRepoContext(ctx))
      .from("question_bank")
      .insert(payload)
      .select("id");
    throwIfError(error, "Failed to save questions to the bank");

    const count = data?.length ?? payload.length;
    await emitEvent(toRepoContext(ctx), {
      eventType: "question.bank.saved",
      entityType: "question",
      entityId: data?.[0]?.id ?? null,
      payload: {
        count,
        subjects: [...new Set(payload.map((p) => p.subject))],
        source: payload[0]?.source ?? null,
      },
    }).catch(() => undefined);

    broadcastAcademicWrite(ctx.schoolId, ["profile"], {
      source: "QuestionBankService.insert",
    });

    return { count };
  },

  /**
   * Questions waiting for review, newest first.
   *
   * §10.20 puts the central question bank in the super admin's hands, and §10.9
   * makes the bank central — so approval is central and this is the only role
   * that has it. The RPC asserts that itself; the check here is so the screen
   * fails with a sentence instead of a 42501.
   */
  async listReviewQueue(
    ctx: ServiceContext,
    opts?: { limit?: number; offset?: number },
  ): Promise<QuestionReviewRow[]> {
    assertSuperAdmin(ctx, "review the central question bank");
    const { data, error } = await getClient(toRepoContext(ctx))
      .rpc("rpc_question_bank_review_queue", {
        _limit: opts?.limit ?? REVIEW_PAGE_SIZE,
        _offset: opts?.offset ?? 0,
      });
    throwIfError(error, "Failed to load the review queue");
    return (data ?? []) as QuestionReviewRow[];
  },

  /**
   * Approve or reject one contributed question.
   *
   * Rejection is `is_approved = false` with a note, NOT a delete — §10.21's
   * reasoning for reported questions applies unchanged here: a rejected
   * question may already sit in a student's mistake book, and removing it would
   * take away something they really got wrong.
   */
  async review(
    ctx: ServiceContext,
    questionId: string,
    approved: boolean,
    note?: string | null,
  ): Promise<void> {
    assertSuperAdmin(ctx, "approve or reject a question");
    const { error } = await getClient(toRepoContext(ctx)).rpc("rpc_review_question", {
      _question_id: questionId,
      _approved: approved,
      // Omitted rather than sent as null: `_note` has a SQL default, and a
      // generated optional parameter typed non-null cannot take `null`.
      ...(note && note.trim() ? { _note: note.trim() } : {}),
    });
    throwIfError(error, approved ? "Could not approve the question" : "Could not reject the question");

    await emitEventBestEffort(toRepoContext(ctx), {
      eventType: "question.bank.saved",
      entityType: "question",
      entityId: questionId,
      payload: { reviewed: true, approved, note: note?.trim() || null },
    });
  },
};
