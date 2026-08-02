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
  school_id?: string | null;
  is_approved?: boolean;
};

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
      const s = String((r as { subject?: string }).subject ?? "General");
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

    const payload = rows.map((r) => {
      const options = Array.isArray(r.options)
        ? r.options.map((o) => (typeof o === "string" ? fixUtf8Content(o) : o))
        : r.options;
      return {
        ...r,
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
        school_id: r.school_id ?? ctx.schoolId,
        created_by: r.created_by ?? ctx.userId,
        is_approved: r.is_approved ?? true,
      };
    });

    const { data, error } = await getClient(toRepoContext(ctx))
      .from("question_bank")
      .insert(payload as never)
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
