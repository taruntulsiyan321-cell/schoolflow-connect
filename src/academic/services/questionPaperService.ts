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
 * `shortfall` comes back on every fill and the UI must show it. Generating that
 * shortfall is `generateForSection`, through `ai-gateway`'s
 * `teacher.question_paper.generate_questions` — the capability added for §5,
 * because `plan`, `generate_outline` and `marking_scheme` all declare
 * `generates_full_paper: false` and none of them produces a question.
 *
 * ── WHAT HAPPENS TO A GENERATED QUESTION ─────────────────────────────────
 *
 * It goes onto the paper, and — if it resolves to a curriculum chapter — into
 * the shared `question_bank` as well, tagged `ai_generated`, credited to its
 * author, `topic` NULL (rule 31), and UNAPPROVED. It is therefore invisible to
 * every student until a super admin approves it, which
 * `trg_question_bank_approval_is_super_admin_only` enforces and this code
 * cannot bypass.
 *
 * Every format goes back now, not just multiple choice: `20260916100000`
 * replaced the bank's two NOT NULL columns with the same either/or answer-shape
 * rule the paper table already used. See `writeBackToBank`.
 */
import { assertCanConsume, toRepoContext, type ServiceContext } from "./context";
import { getClient, throwIfError } from "../repository/base";
import { resolveSectionSubjectId } from "./testService";
import { invokeAiGateway } from "../ai/gatewayClient";
import { toErrorMessage } from "@/lib/presentation";
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
  /**
   * Which path chose these questions. `semantic` means the gateway ranked
   * the candidates by embedding similarity first; `structured` means it
   * could not, and the deterministic chapter round-robin was used instead.
   *
   * The distinction is reported rather than hidden: a teacher who asked for
   * a semantic fill and silently got the other one has been told something
   * false about their own paper.
   */
  strategy: "semantic" | "structured";
  ranked_candidates: number;
  /** Why the semantic path was not used, when it was not. */
  semantic_note?: string | null;
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

/**
 * What one generation attempt did — to the paper, and to the shared bank.
 *
 * The two are separate numbers on purpose: the paper write is the thing the
 * teacher asked for, the bank write is a contribution to every other school,
 * and one can succeed while the other is skipped for a reason worth reading.
 */
export interface GenerationOutcome {
  inserted: number;
  rejected: string[];
  degradedReason: string | null;
  bankSaved: number;
  bankSkipped: string[];
}

/** Nothing was generated and nothing was written. Not an error by itself. */
const NOTHING_GENERATED: GenerationOutcome = {
  inserted: 0,
  rejected: [],
  degradedReason: null,
  bankSaved: 0,
  bankSkipped: [],
};

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
    paper: QuestionPaperRow,
    section: QuestionPaperSectionRow,
  ): Promise<SectionFillResult> {
    // THE SEMANTIC PATH FIRST, AND IT IS ALLOWED TO FAIL.
    //
    // The gateway embeds the section's blueprint and ranks bank candidates
    // by similarity, returning IDS ONLY — it runs `match_question_bank` with
    // the service role, so handing back rows would be a service-role read of
    // the bank. The RPC below then re-applies every one of the section's own
    // filters as the caller, which is what keeps a ranking from widening
    // what this teacher may retrieve.
    //
    // When there is no embedding provider — or none reachable — this returns
    // nothing and the fill proceeds structurally. That fallback is REPORTED,
    // never silent.
    let bankIds: string[] | null = null;
    let semanticNote: string | null = null;

    try {
      const ranked = await invokeAiGateway<{
        bank_ids?: string[];
        degraded_reason?: string | null;
      }>({
        feature_id: "teacher.question_paper.match_questions",
        input: {
          structured: {
            subject: paper.subject,
            class_level: paper.class_level,
            chapter: section.chapters[0] ?? null,
            title: section.title,
            difficulty: section.difficulty,
            count: section.target_count,
          },
        },
      });
      const reason = ranked?.data?.degraded_reason ?? null;
      const ids = ranked?.data?.bank_ids ?? [];
      if (reason) {
        semanticNote = reason;
      } else if (ids.length === 0) {
        // A real answer, not a failure: the bank has nothing similar enough.
        // Falling through to the structured fill is the right move, and the
        // teacher is told why the ranking did not apply.
        semanticNote = "nothing in the bank was close enough to rank";
      } else {
        bankIds = ids;
      }
    } catch (e) {
      semanticNote = toErrorMessage(e, "the semantic ranking was unavailable");
    }

    // `_bank_ids` is `DEFAULT NULL` in SQL, and a DEFAULT NULL parameter
    // generates as OPTIONAL-NON-NULL in types.ts — `string[] | undefined`, never
    // `| null`. So it is OMITTED behind a guard rather than passed as null, per
    // parameter. A blanket `?? undefined` would paper over the same mismatch
    // everywhere else it appears and hide the next one.
    const { data, error } = await getClient(toRepoContext(ctx)).rpc(
      "rpc_fill_paper_section_from_bank",
      bankIds ? { _section_id: section.id, _bank_ids: bankIds } : { _section_id: section.id },
    );
    throwIfError(error, "Failed to fill this section from the question bank");
    const result = data as unknown as SectionFillResult;
    return { ...result, semantic_note: semanticNote };
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

  /**
   * Generate the questions a section still needs, and store them.
   *
   * This is the brief's "generate the shortfall", and for short and long
   * sections it is the only way to fill them at all — the question bank is
   * 21,696 rows and every one is multiple choice.
   *
   * It goes through `ai-gateway`'s
   * `teacher.question_paper.generate_questions`, which is the capability that
   * did not exist until now: `plan`, `generate_outline` and `marking_scheme`
   * all declare `generates_full_paper: false`. The prompt, the schema and the
   * per-format token budget are shared with `dpp-generate-questions` through
   * `_shared/questionGenerator.ts`.
   *
   * NOTHING IS STORED THAT THE QUALITY GUARD REFUSED. The gateway drops a
   * three-option MCQ, an answer key pointing past the options, and a one-word
   * "short answer", and returns the reasons — which are handed back here so the
   * screen can say why a request for ten produced seven, rather than quietly
   * writing seven.
   */
  async generateForSection(
    ctx: ServiceContext,
    paper: QuestionPaperRow,
    section: QuestionPaperSectionRow,
    alreadyPresent: number,
  ): Promise<GenerationOutcome> {
    const wanted = Math.max(section.target_count - alreadyPresent, 0);
    if (wanted === 0) return NOTHING_GENERATED;

    const response = await invokeAiGateway<{
      questions?: {
        question?: string;
        options?: string[];
        correct_index?: number;
        answer?: string;
        explanation?: string;
      }[];
      rejected?: string[];
      degraded_reason?: string | null;
    }>({
      feature_id: "teacher.question_paper.generate_questions",
      input: {
        structured: {
          question_format: section.question_format,
          subject: paper.subject,
          // Rule 31 — a generated question carries its CHAPTER and leaves
          // `topic` NULL. The section may name several chapters; the first is
          // the one the model is pointed at, and the rest are covered by
          // generating per chapter rather than by guessing a blend.
          chapter: section.chapters[0] ?? null,
          difficulty: section.difficulty ?? "medium",
          count: wanted,
          board: paper.board,
          class_level: paper.class_level,
        },
      },
    });

    if (!response) {
      // The request was cancelled, not refused. There is no envelope and
      // nothing was generated; saying "0 generated" would be a claim about the
      // model that nobody made.
      return { ...NOTHING_GENERATED, degradedReason: "the request was cancelled" };
    }

    const payload = response.data ?? null;
    const generated = payload?.questions ?? [];
    const rejected = payload?.rejected ?? [];
    const degradedReason =
      payload?.degraded_reason ??
      (generated.length === 0 ? (response.message ?? "the generator returned nothing") : null);

    if (generated.length === 0) {
      return { ...NOTHING_GENERATED, rejected, degradedReason };
    }

    const client = getClient(toRepoContext(ctx));
    const rows = generated.map((q, i) => ({
      paper_id: paper.id,
      section_id: section.id,
      school_id: ctx.schoolId,
      order_index: alreadyPresent + i,
      origin: "generated" as const,
      question: String(q.question ?? "").trim(),
      options:
        section.question_format === "mcq" ? ((q.options ?? []) as unknown as Json) : null,
      correct_index: section.question_format === "mcq" ? (q.correct_index ?? 0) : null,
      answer: section.question_format === "mcq" ? null : (q.answer ?? null),
      explanation: q.explanation ?? null,
      chapter: section.chapters[0] ?? null,
      marks: section.marks_per_question,
    }));

    const { error } = await client.from("question_paper_questions").insert(rows);
    throwIfError(error, "The questions were generated but could not be saved");

    // THE PAPER IS SAVED BEFORE THE BANK IS TOUCHED, and the bank write is
    // allowed to fail without taking the paper with it. The paper is the thing
    // the teacher asked for; the bank is a contribution to everyone else.
    const bank = await this.writeBackToBank(ctx, paper, section, generated).catch(
      // Through the presentation boundary, not `.message`: a PostgREST failure
      // here names tables and constraints, and this string is printed on the
      // teacher's screen beside the generation result.
      (e: unknown) => ({
        saved: 0,
        skipped: [toErrorMessage(e, "the question bank rejected the write")],
      }),
    );

    return {
      inserted: rows.length,
      rejected,
      degradedReason: null,
      bankSaved: bank.saved,
      bankSkipped: bank.skipped,
    };
  },

  /**
   * Contribute the generated questions back to the shared question bank,
   * UNAPPROVED (§5, §10.20).
   *
   * `is_approved` is passed explicitly as `false` even though the column
   * already defaults to it: the rule is a product rule, and a rule that holds
   * only because of a default stops holding the day someone changes the
   * default. Approval is not this code's to give either way —
   * `trg_question_bank_approval_is_super_admin_only` refuses it to everyone
   * but a super admin, which is what makes the write safe.
   *
   * ── EVERY FORMAT GOES BACK, SINCE 20260916100000 ───────────────────────
   *
   * `question_bank.options` and `.correct_index` used to be NOT NULL, so the
   * bank could not hold a short or long question at all — even though
   * `question_bank_question_format_check` admitted both. The vocabulary
   * anticipated them and the columns forbade them. Measured as the caller:
   *
   *   INSERT ... question_format='short', options NULL
   *   -> null value in column "options" violates not-null constraint
   *
   * That is now one either/or CHECK — options AND a key, OR non-empty answer
   * text — deliberately the same rule `question_paper_questions` already
   * carried as `qpq_answer_shape`. A question that can go on a paper can go in
   * the bank, and the two tables cannot disagree about what a complete
   * question is.
   *
   * What is still refused, by that CHECK and by the guard in
   * `assertQuestionRowsAreKeyed`, is an ANSWERLESS question: no options, no
   * key, no answer text. Nobody can mark it, so storing it would be worse than
   * storing nothing.
   *
   * ── AN UNKEYED QUESTION IS NEVER SERVED ────────────────────────────────
   *
   * `question_bank_active_must_be_keyed` refuses an active row without a
   * `chapter_id`, and `assertQuestionRowsAreKeyed` says the same in the
   * service. The chapter NAME on the section is resolved to a curriculum
   * chapter id through `CurriculumService`; a name that resolves to nothing is
   * skipped with that as the reason, because storing it would file a question
   * nobody will ever be served.
   */
  async writeBackToBank(
    ctx: ServiceContext,
    paper: QuestionPaperRow,
    section: QuestionPaperSectionRow,
    generated: {
      question?: string;
      options?: string[];
      correct_index?: number;
      answer?: string;
      explanation?: string;
    }[],
  ): Promise<{ saved: number; skipped: string[] }> {
    const skipped: string[] = [];

    if (paper.class_level == null) {
      return { saved: 0, skipped: ["the paper has no class level, so nothing could be keyed"] };
    }

    const chapterName = section.chapters[0] ?? null;
    if (!chapterName) {
      return {
        saved: 0,
        skipped: ["the section names no chapter, and an unkeyed question is never served"],
      };
    }

    const { CurriculumService } = await import("./curriculumService");
    const subjects = await CurriculumService.listSubjects(ctx, paper.class_level);
    const subject = subjects.find(
      (s) => s.name.trim().toLowerCase() === paper.subject.trim().toLowerCase(),
    );
    if (!subject) {
      return {
        saved: 0,
        skipped: [`"${paper.subject}" is not a curriculum subject at class ${paper.class_level}`],
      };
    }

    const chapters = await CurriculumService.listChapters(ctx, subject.ids);
    const chapter = chapters.find(
      (c) => c.name.trim().toLowerCase() === chapterName.trim().toLowerCase(),
    );
    if (!chapter) {
      return {
        saved: 0,
        skipped: [`"${chapterName}" is not a chapter of ${subject.name} at class ${paper.class_level}`],
      };
    }

    const isChoice = section.question_format === "mcq";
    const rows = generated
      .filter((q) => {
        // The same either/or the database now enforces: options AND a key,
        // or written answer text. Anything else cannot be marked.
        const usable = isChoice
          ? Array.isArray(q.options) && q.options.length > 0 && typeof q.correct_index === "number"
          : typeof q.answer === "string" && q.answer.trim() !== "";
        if (!usable) {
          skipped.push(
            isChoice
              ? "a generated question had no options and answer key"
              : "a generated question had no written answer",
          );
        }
        return usable;
      })
      .map((q) => ({
        subject: paper.subject,
        chapter: chapterName,
        chapter_id: chapter.id,
        class_level: paper.class_level,
        // Rule 31 — a generated question carries its chapter and leaves `topic`
        // NULL. A guessed topic string is worse than none: it becomes a facet
        // nobody can filter on correctly.
        topic: null,
        difficulty: section.difficulty ?? "medium",
        question: String(q.question ?? "").trim(),
        options: isChoice ? ((q.options ?? []) as string[]) : null,
        correct_index: isChoice ? (q.correct_index as number) : null,
        answer: isChoice ? null : (q.answer ?? null),
        explanation: q.explanation ?? null,
        question_format: section.question_format,
        source_type: "ai_generated",
        source: `question_paper:${paper.id}`,
        board: paper.board ?? null,
        created_by: ctx.userId,
        is_approved: false,
      }));

    if (rows.length === 0) return { saved: 0, skipped };

    const { QuestionBankService } = await import("./questionBankService");
    const { count } = await QuestionBankService.insert(ctx, rows);
    return { saved: count, skipped };
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
