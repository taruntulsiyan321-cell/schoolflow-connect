/**
 * QuestionPaperService — the teacher's question paper (§10.24).
 *
 * Three tables that had existed empty and unreachable since they were created:
 * `question_papers`, `question_paper_sections`, `question_paper_questions`.
 * This is the first code that writes to any of them.
 *
 * ── NO ROLE CHECK IN THIS FILE, AND THAT IS THE DESIGN ───────────────────
 *
 * Authorship lives in exactly one place: `can_author_question_paper()` and
 * `owns_question_paper()`, consulted by the RLS policies on all three tables
 * (`20260916040000`). Measured before that migration, as the caller: the
 * PRINCIPAL could create, edit and delete papers — §10 gives them
 * announcements and nothing else — and ANY signed-in user could author one,
 * students included, because the policy asked "is this row mine" and never
 * "may this person author a paper at all". Restating that rule here would be
 * the two-homes defect the report service was careful to avoid last session.
 *
 * A caller who may not write gets a PostgREST 42501, screened into a sentence
 * by `throwIfError` and the page's `toErrorMessage`.
 *
 * ── WHAT FILLS A SECTION ─────────────────────────────────────────────────
 *
 * `fillSectionFromBank` calls `rpc_fill_paper_section_from_bank`, which
 * retrieves from `question_bank` by STRUCTURED query — class level, subject,
 * chapter, difficulty — and not by vector similarity.
 *
 * That is a stated deviation from the brief, which asks for
 * `embed` -> `match_question_bank`. `match_question_bank` works: measured
 * 2026-09-09 as the teacher, 10 rows, best similarity 1.0000, subject and
 * class filters honoured, anon refused at the grant. What is not available is
 * `embed`, the edge function that turns the blueprint into the query vector —
 * it is on `*.supabase.co`, and there is currently no IPv4 route to that host
 * at all. A section is also a structured query by nature: every one of the
 * 21,681 usable bank rows carries a chapter and a difficulty. The semantic
 * path is a widening of that RPC once `embed` is reachable, not a different
 * one, and not a different service call.
 *
 * `shortfall` comes back on every fill and the UI must show it. The brief asks
 * for the shortfall to be GENERATED; nothing generates questions — `ai-gateway`
 * exposes `plan`, `generate_outline` and `marking_scheme`, and all three
 * declare `generates_full_paper: false`.
 */
import { assertCanConsume, toRepoContext, type ServiceContext } from "./context";
import { getClient, throwIfError } from "../repository/base";
import { resolveSectionSubjectId } from "./testService";
import type { Json } from "@/integrations/supabase/types";

/** The three formats `qps_format_check` admits. */
export type PaperSectionFormat = "mcq" | "short" | "long";

/** The three `qps_difficulty_check` admits, plus "any". */
export type PaperDifficulty = "easy" | "medium" | "hard";

export interface QuestionPaperRow {
  id: string;
  school_id: string;
  created_by: string;
  title: string;
  subject: string;
  class_level: number | null;
  board: string | null;
  duration_minutes: number | null;
  status: "draft" | "final";
  created_at: string;
  updated_at: string;
}

export interface QuestionPaperSectionRow {
  id: string;
  paper_id: string;
  school_id: string;
  order_index: number;
  title: string;
  question_format: PaperSectionFormat;
  marks_per_question: number;
  target_count: number;
  difficulty: PaperDifficulty | null;
  chapters: string[];
}

export interface QuestionPaperQuestionRow {
  id: string;
  paper_id: string;
  section_id: string;
  order_index: number;
  /** `retrieved` came from the bank; `generated` was written by a person or a model. */
  origin: "retrieved" | "generated";
  bank_id: string | null;
  question: string;
  options: unknown;
  correct_index: number | null;
  answer: string | null;
  explanation: string | null;
  chapter: string | null;
  marks: number | null;
}

/** What one fill actually did. `shortfall` is the part the bank could not cover. */
export interface SectionFillResult {
  section_id: string;
  target_count: number;
  already_present: number;
  requested: number;
  pool_size: number;
  inserted: number;
  shortfall: number;
}

export interface CreatePaperInput {
  title: string;
  subject: string;
  classLevel: number;
  board?: string | null;
  durationMinutes?: number | null;
}

export interface CreateSectionInput {
  title: string;
  format: PaperSectionFormat;
  marksPerQuestion: number;
  targetCount: number;
  difficulty?: PaperDifficulty | null;
  chapters?: string[];
}

const PAPER_COLUMNS =
  "id, school_id, created_by, title, subject, class_level, board, duration_minutes, status, created_at, updated_at";

export const QuestionPaperService = {
  async list(ctx: ServiceContext): Promise<QuestionPaperRow[]> {
    assertCanConsume(ctx, "test");
    const { data, error } = await getClient(toRepoContext(ctx))
      .from("question_papers")
      .select(PAPER_COLUMNS)
      .order("created_at", { ascending: false })
      .limit(100);
    throwIfError(error, "Failed to load question papers");
    return (data ?? []) as QuestionPaperRow[];
  },

  async create(ctx: ServiceContext, input: CreatePaperInput): Promise<QuestionPaperRow> {
    const { data, error } = await getClient(toRepoContext(ctx))
      .from("question_papers")
      .insert({
        school_id: ctx.schoolId,
        // §8 — credited to whoever made it. The RLS policy requires this to be
        // the caller, so it cannot be filed under anyone else.
        created_by: ctx.userId,
        title: input.title,
        subject: input.subject,
        class_level: input.classLevel,
        board: input.board ?? null,
        duration_minutes: input.durationMinutes ?? null,
      })
      .select(PAPER_COLUMNS)
      .single();
    throwIfError(error, "Failed to create the question paper");
    return data as QuestionPaperRow;
  },

  async remove(ctx: ServiceContext, paperId: string): Promise<void> {
    const { error } = await getClient(toRepoContext(ctx))
      .from("question_papers")
      .delete()
      .eq("id", paperId);
    throwIfError(error, "Failed to delete the question paper");
  },

  async listSections(
    ctx: ServiceContext,
    paperId: string,
  ): Promise<QuestionPaperSectionRow[]> {
    assertCanConsume(ctx, "test");
    const { data, error } = await getClient(toRepoContext(ctx))
      .from("question_paper_sections")
      .select("*")
      .eq("paper_id", paperId)
      .order("order_index", { ascending: true });
    throwIfError(error, "Failed to load the paper's sections");
    return (data ?? []) as QuestionPaperSectionRow[];
  },

  async addSection(
    ctx: ServiceContext,
    paperId: string,
    input: CreateSectionInput,
    orderIndex: number,
  ): Promise<QuestionPaperSectionRow> {
    const { data, error } = await getClient(toRepoContext(ctx))
      .from("question_paper_sections")
      .insert({
        paper_id: paperId,
        school_id: ctx.schoolId,
        order_index: orderIndex,
        title: input.title,
        question_format: input.format,
        marks_per_question: input.marksPerQuestion,
        target_count: input.targetCount,
        difficulty: input.difficulty ?? null,
        chapters: input.chapters ?? [],
      })
      .select("*")
      .single();
    throwIfError(error, "Failed to add the section");
    return data as QuestionPaperSectionRow;
  },

  async removeSection(ctx: ServiceContext, sectionId: string): Promise<void> {
    const { error } = await getClient(toRepoContext(ctx))
      .from("question_paper_sections")
      .delete()
      .eq("id", sectionId);
    throwIfError(error, "Failed to remove the section");
  },

  async listQuestions(
    ctx: ServiceContext,
    paperId: string,
  ): Promise<QuestionPaperQuestionRow[]> {
    assertCanConsume(ctx, "test");
    const { data, error } = await getClient(toRepoContext(ctx))
      .from("question_paper_questions")
      .select("*")
      .eq("paper_id", paperId)
      .order("order_index", { ascending: true });
    throwIfError(error, "Failed to load the paper's questions");
    return (data ?? []) as QuestionPaperQuestionRow[];
  },

  async removeQuestion(ctx: ServiceContext, questionId: string): Promise<void> {
    const { error } = await getClient(toRepoContext(ctx))
      .from("question_paper_questions")
      .delete()
      .eq("id", questionId);
    throwIfError(error, "Failed to remove the question");
  },

  /**
   * Pull questions for one section out of the bank.
   *
   * The RPC is SECURITY INVOKER and fences itself through the policies already
   * on the tables, so there is nothing to re-check here. It refuses a section
   * that is not the caller's, a paper that is already final, and any section
   * that is not MCQ — the bank holds 21,696 questions and every one of them is
   * multiple choice.
   */
  async fillSectionFromBank(
    ctx: ServiceContext,
    sectionId: string,
  ): Promise<SectionFillResult> {
    const { data, error } = await getClient(toRepoContext(ctx)).rpc(
      "rpc_fill_paper_section_from_bank",
      { _section_id: sectionId },
    );
    throwIfError(error, "Failed to fill this section from the question bank");
    return data as unknown as SectionFillResult;
  },

  /**
   * Add one question by hand. The shape the CHECK constraint wants differs by
   * format: an MCQ needs options AND an answer index, anything else needs a
   * written answer.
   */
  async addManualQuestion(
    ctx: ServiceContext,
    args: {
      paperId: string;
      sectionId: string;
      orderIndex: number;
      question: string;
      options?: string[];
      correctIndex?: number | null;
      answer?: string | null;
      explanation?: string | null;
      chapter?: string | null;
      marks?: number | null;
    },
  ): Promise<QuestionPaperQuestionRow> {
    const isMcq = Array.isArray(args.options) && args.options.length > 0;
    const { data, error } = await getClient(toRepoContext(ctx))
      .from("question_paper_questions")
      .insert({
        paper_id: args.paperId,
        section_id: args.sectionId,
        school_id: ctx.schoolId,
        order_index: args.orderIndex,
        // Written by a person, not retrieved from the bank. `retrieved` is
        // reserved for rows that carry a bank_id.
        origin: "generated",
        question: args.question,
        options: isMcq ? (args.options as unknown as Json) : null,
        correct_index: isMcq ? (args.correctIndex ?? 0) : null,
        answer: isMcq ? null : (args.answer ?? null),
        explanation: args.explanation ?? null,
        chapter: args.chapter ?? null,
        marks: args.marks ?? null,
      })
      .select("*")
      .single();
    throwIfError(error, "Failed to add the question");
    return data as QuestionPaperQuestionRow;
  },

  async setStatus(
    ctx: ServiceContext,
    paperId: string,
    status: "draft" | "final",
  ): Promise<void> {
    const { error } = await getClient(toRepoContext(ctx))
      .from("question_papers")
      .update({ status, updated_at: new Date().toISOString() })
      .eq("id", paperId);
    throwIfError(error, "Failed to update the paper");
  },

  /**
   * Push an all-MCQ paper out as an online test (§10.24).
   *
   * The RPC refuses any paper holding a question without options and an answer
   * key, and it is checked on the QUESTIONS rather than the section headings —
   * a section labelled 'mcq' whose rows carry free text would otherwise
   * produce a test nothing can mark. It is SECURITY INVOKER, so `tests_insert`
   * decides whether this teacher may put a test on this section.
   */
  async pushAsTest(
    ctx: ServiceContext,
    paperId: string,
    sectionSubjectId: string,
    durationSec?: number | null,
  ): Promise<string> {
    const { data, error } = await getClient(toRepoContext(ctx)).rpc(
      "rpc_question_paper_to_test",
      {
        _paper_id: paperId,
        _section_subject_id: sectionSubjectId,
        _duration_sec: durationSec ?? undefined,
      },
    );
    throwIfError(error, "Failed to create an online test from this paper");
    return String(data);
  },

  /**
   * The same push, addressed the way a teacher thinks about it — a class and a
   * subject rather than a `section_subject_id`.
   *
   * The resolution goes through `resolveSectionSubjectId`, which `TestService`
   * already uses for exactly this and which REFUSES rather than guessing when
   * a class teaches several subjects and none was named. Guessing there would
   * file a Physics paper under Mathematics with nothing on screen to show it.
   */
  async pushAsTestForClass(
    ctx: ServiceContext,
    paperId: string,
    classId: string,
    subject: string,
    durationSec?: number | null,
  ): Promise<string> {
    const sectionSubjectId = await resolveSectionSubjectId(ctx, classId, subject);
    return this.pushAsTest(ctx, paperId, sectionSubjectId, durationSec);
  },
};
