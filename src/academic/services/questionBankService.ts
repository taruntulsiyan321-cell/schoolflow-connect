import {
  assertCanOwn,
  assertCanConsume,
  toRepoContext,
  type ServiceContext,
} from "./context";
import { getClient, throwIfError } from "../repository/base";
import { emitEvent } from "../repository/eventsRepository";
import { broadcastAcademicWrite } from "../live";
import type { Json } from "@/integrations/supabase/types";
import { fixUtf8Content } from "@/lib/utf8Text";
import { repairUtf8Mojibake } from "@/lib/utf8MojibakeRepair";

export type QuestionBankInsertRow = {
  class_level?: number | null;
  subject: string;
  chapter?: string | null;
  topic?: string | null;
  concept?: string | null;
  difficulty?: string;
  question: string;
  options: string[] | Json;
  correct_index: number;
  explanation?: string | null;
  source?: string | null;
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
      is_approved: r.is_approved ?? true,
    };
  });
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
};
