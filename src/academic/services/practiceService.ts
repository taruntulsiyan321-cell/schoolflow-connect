import {
  assertCanOwn,
  assertCanConsume,
  toRepoContext,
  type ServiceContext,
} from "./context";
import { getClient, throwIfError } from "../repository/base";
import { emitEvent } from "../repository/eventsRepository";
import { broadcastAcademicWrite } from "../live";
import { notifyStudentXpUpdated } from "@/lib/studentXpNotify";
import {
  filterSubjectsForStream,
  inferStreamFromText,
  isSubjectAllowedForScope,
  normalizeStream,
  parseClassLevel,
  type AcademicStream,
  type CurriculumScope,
} from "@/lib/curriculumScope";
import {
  academicLabelMatches,
  displayChapter,
  displayConcept,
  displaySubject,
  toPresentedTerm,
  type TaxonomyTermRef,
} from "@/lib/academicPresentation";

export type { CurriculumScope };
export type AcademicTermRef = TaxonomyTermRef;

/**
 * PracticeService — wraps practice session RPCs + finish path.
 * AI/practice modules should call this instead of raw RPCs where practical.
 */
export const PracticeService = {
  async start(
    ctx: ServiceContext,
    args: Record<string, unknown>,
  ) {
    assertCanOwn(ctx, "practice");
    const { data, error } = await getClient(toRepoContext(ctx)).rpc(
      "rpc_start_practice_session",
      args as never,
    );
    throwIfError(error, "Failed to start practice session");
    return data;
  },

  async finish(
    ctx: ServiceContext,
    args: Record<string, unknown>,
  ) {
    assertCanOwn(ctx, "practice");
    const { data, error } = await getClient(toRepoContext(ctx)).rpc(
      "rpc_finish_practice_session",
      args as never,
    );
    throwIfError(error, "Failed to finish practice session");
    await emitEvent(toRepoContext(ctx), {
      eventType: "practice.session.completed",
      entityType: "practice",
      entityId: (args._session_id as string) ?? null,
      studentId: ctx.studentId ?? null,
      payload: args,
    }).catch(() => undefined);
    broadcastAcademicWrite(ctx.schoolId, ["xp", "profile"], {
      studentId: ctx.studentId,
      source: "PracticeService",
    });
    notifyStudentXpUpdated();
    return data;
  },

  /**
   * Record one practice attempt via RPC (preferred). Product paths should not
   * raw-insert `question_attempts` when this succeeds.
   */
  async recordAttempt(
    ctx: ServiceContext,
    args: {
      sessionId: string;
      templateId?: string | null;
      bankQuestionId?: string | null;
      generatedQuestion: Record<string, unknown>;
      selectedAnswer: Record<string, unknown>;
      correctAnswer: Record<string, unknown>;
      isCorrect: boolean;
      score?: number;
      timeTakenMs?: number | null;
      skipped?: boolean;
      subject?: string;
      chapter?: string;
      concept?: string;
      topic?: string;
      difficulty?: string;
      hintUsed?: boolean;
      solutionViewed?: boolean;
      confidence?: number | null;
      attemptNumber?: number | null;
      timedOut?: boolean;
      practiceMode?: string | null;
      source?: string | null;
      sourceId?: string | null;
      classLevel?: number | null;
      board?: string | null;
      stream?: string | null;
      schoolId?: string | null;
      answeredAt?: string | null;
    },
  ) {
    assertCanOwn(ctx, "practice");
    const client = getClient(toRepoContext(ctx));
    const skipped = Boolean(args.skipped || args.timedOut);
    const generatedQuestion = {
      ...args.generatedQuestion,
      ...(args.bankQuestionId ? { bank_question_id: args.bankQuestionId } : {}),
      ...(args.subject ? { subject: args.subject } : {}),
      ...(args.chapter ? { chapter: args.chapter } : {}),
      ...(args.concept ? { concept: args.concept } : {}),
      ...(args.topic ? { topic: args.topic } : {}),
      ...(args.difficulty ? { difficulty: args.difficulty } : {}),
      ...(args.practiceMode ? { practice_mode: args.practiceMode } : {}),
    };
    const meta = {
      solution_viewed: args.solutionViewed ?? false,
      confidence: args.confidence ?? null,
      attempt_number: args.attemptNumber ?? null,
      timed_out: args.timedOut ?? false,
      practice_mode: args.practiceMode ?? args.source ?? null,
      source_id: args.sourceId ?? args.sessionId,
      class_level: args.classLevel ?? null,
      board: args.board ?? null,
      stream: args.stream ?? null,
      topic: args.topic ?? args.concept ?? args.chapter ?? null,
      difficulty: args.difficulty ?? null,
      school_id: args.schoolId ?? ctx.schoolId ?? null,
      answered_at: args.answeredAt ?? new Date().toISOString(),
      hint_used: args.hintUsed ?? false,
    };
    const payload = {
      _correct_answer: args.correctAnswer,
      _generated_question: generatedQuestion,
      _is_correct: skipped ? false : args.isCorrect,
      _selected_answer: args.selectedAnswer,
      _session_id: args.sessionId,
      _score: args.score ?? (skipped ? 0 : args.isCorrect ? 1 : 0),
      _skipped: skipped,
      _template_id: args.templateId ?? null,
      _time_taken_ms: args.timeTakenMs ?? null,
      _bank_question_id: args.bankQuestionId ?? null,
      _hint_used: args.hintUsed ?? false,
      _source: args.source ?? "practice",
      _meta: meta,
    };
    const { data, error } = await client.rpc("rpc_record_question_attempt", payload as never);
    if (!error) return data as string;

    // Mid-migration: hint+source, no meta.
    const withHint = await client.rpc("rpc_record_question_attempt", {
      _correct_answer: args.correctAnswer,
      _generated_question: generatedQuestion,
      _is_correct: skipped ? false : args.isCorrect,
      _selected_answer: args.selectedAnswer,
      _session_id: args.sessionId,
      _score: args.score ?? (skipped ? 0 : args.isCorrect ? 1 : 0),
      _skipped: skipped,
      _template_id: args.templateId ?? null,
      _time_taken_ms: args.timeTakenMs ?? null,
      _bank_question_id: args.bankQuestionId ?? null,
      _hint_used: args.hintUsed ?? false,
      _source: args.source ?? "practice",
    } as never);
    if (!withHint.error) return withHint.data as string;

    // Mid-migration signature (bank id, no hint/source).
    const withBank = await client.rpc("rpc_record_question_attempt", {
      _correct_answer: args.correctAnswer,
      _generated_question: generatedQuestion,
      _is_correct: skipped ? false : args.isCorrect,
      _selected_answer: args.selectedAnswer,
      _session_id: args.sessionId,
      _score: args.score ?? (skipped ? 0 : args.isCorrect ? 1 : 0),
      _skipped: skipped,
      _template_id: args.templateId ?? null,
      _time_taken_ms: args.timeTakenMs ?? null,
      _bank_question_id: args.bankQuestionId ?? null,
    } as never);
    if (!withBank.error) return withBank.data as string;

    // Pre-grading-migration signature (no bank_question_id).
    const legacy = await client.rpc("rpc_record_question_attempt", {
      _correct_answer: args.correctAnswer,
      _generated_question: generatedQuestion,
      _is_correct: skipped ? false : args.isCorrect,
      _selected_answer: args.selectedAnswer,
      _session_id: args.sessionId,
      _score: args.score ?? (skipped ? 0 : args.isCorrect ? 1 : 0),
      _skipped: skipped,
      _template_id: args.templateId ?? null,
      _time_taken_ms: args.timeTakenMs ?? null,
    } as never);
    throwIfError(legacy.error ?? withBank.error ?? withHint.error ?? error, "Failed to record practice attempt");
    return legacy.data as string;
  },

  async getSession(ctx: ServiceContext, sessionId: string) {
    assertCanConsume(ctx, "practice");
    const { data, error } = await getClient(toRepoContext(ctx))
      .from("practice_sessions")
      .select("*")
      .eq("id", sessionId)
      .maybeSingle();
    throwIfError(error, "Failed to load practice session");
    return data;
  },

  async listRecentFinished(ctx: ServiceContext, limit = 10) {
    assertCanConsume(ctx, "practice");
    const { data, error } = await getClient(toRepoContext(ctx))
      .from("practice_sessions")
      .select("id, subject, chapter, question_count, correct_count, score, created_at, finished_at")
      .eq("user_id", ctx.userId)
      .not("finished_at", "is", null)
      .order("finished_at", { ascending: false })
      .limit(limit);
    throwIfError(error, "Failed to load practice history");
    return data ?? [];
  },

  async resolveSchoolBoard(ctx: ServiceContext): Promise<string> {
    const scope = await this.resolveCurriculumScope(ctx);
    return scope.board;
  },

  /**
   * Resolve student's class_level + school board/stream for bank filtering.
   * class_level comes from students → classes name/display (e.g. "10-A" → 10, "12-C" → 12).
   * Used for EVERY class — never dump other class levels.
   * stream from schools.stream, else class category/label (commerce/science/…).
   */
  async resolveCurriculumScope(ctx: ServiceContext): Promise<CurriculumScope> {
    const client = getClient(toRepoContext(ctx));
    let board = "rbse";
    let schoolStream: AcademicStream | null = null;

    // Prefer board+stream; fall back to board-only if stream column not migrated yet.
    {
      const withStream = await client
        .from("schools")
        .select("board, stream")
        .eq("id", ctx.schoolId)
        .maybeSingle();
      if (withStream.error) {
        const boardOnly = await client
          .from("schools")
          .select("board")
          .eq("id", ctx.schoolId)
          .maybeSingle();
        const rawBoard = (boardOnly.data as { board?: string | null } | null)?.board;
        if (rawBoard && typeof rawBoard === "string" && rawBoard.trim()) {
          board = rawBoard.trim().toLowerCase();
        }
      } else {
        const school = withStream.data as { board?: string | null; stream?: string | null } | null;
        if (school?.board && typeof school.board === "string" && school.board.trim()) {
          board = school.board.trim().toLowerCase();
        }
        schoolStream = normalizeStream(school?.stream ?? null);
      }
    }

    let classLevel: number | null = null;
    let classLabel: string | null = null;
    let classCategory: string | null = null;

    type ClassJoin = {
      name?: string | null;
      section?: string | null;
      display_name?: string | null;
      category?: string | null;
    };

    const readClass = (raw: ClassJoin | ClassJoin[] | null | undefined) => {
      const c = Array.isArray(raw) ? raw[0] : raw;
      if (!c) return;
      classCategory = c.category ?? null;
      const base = [c.name, c.section].filter(Boolean).join("-");
      classLabel = c.display_name || base || null;
      classLevel = parseClassLevel(classLabel) ?? parseClassLevel(c.name) ?? parseClassLevel(base);
    };

    if (ctx.studentId) {
      const { data: stu } = await client
        .from("students")
        .select("class_id, classes(name, section, display_name, category)")
        .eq("id", ctx.studentId)
        .maybeSingle();
      readClass((stu as { classes?: ClassJoin | ClassJoin[] | null } | null)?.classes);
    } else if (ctx.userId) {
      const { data: stu } = await client
        .from("students")
        .select("class_id, classes(name, section, display_name, category)")
        .eq("user_id", ctx.userId)
        .maybeSingle();
      readClass((stu as { classes?: ClassJoin | ClassJoin[] | null } | null)?.classes);
    }

    const stream =
      schoolStream ??
      inferStreamFromText(classCategory, classLabel) ??
      null;

    return { classLevel, board, stream, classLabel };
  },

  /** Unique approved subjects from the live question bank (class + board + stream). */
  async listBankSubjects(
    ctx: ServiceContext,
    opts: { classLevel?: number | null } = {},
  ): Promise<string[]> {
    assertCanConsume(ctx, "practice");
    const client = getClient(toRepoContext(ctx));
    const scope = await this.resolveCurriculumScope(ctx);
    const classLevel = opts.classLevel ?? scope.classLevel;

    // Never dump all classes when we cannot resolve the student's class.
    if (classLevel == null || !Number.isFinite(classLevel)) {
      return [];
    }

    let query = client
      .from("question_bank")
      .select("subject, stream")
      .eq("is_approved", true)
      .eq("class_level", classLevel)
      .or(`school_id.is.null,school_id.eq.${ctx.schoolId}`)
      .or(`board.eq.${scope.board},board.eq.both,board.is.null`)
      .limit(800);

    if (scope.stream) {
      query = query.or(`stream.eq.${scope.stream},stream.is.null`);
    }

    const { data, error } = await query;
    throwIfError(error, "Failed to load practice subjects");
    const seen = new Map<string, string>();
    for (const row of data ?? []) {
      const raw = String((row as { subject?: string }).subject ?? "").trim();
      if (!raw) continue;
      if (!isSubjectAllowedForScope(raw, scope.stream, classLevel)) continue;
      const label = displaySubject(raw);
      const key = label.toLowerCase();
      if (!seen.has(key)) seen.set(key, label);
    }
    return filterSubjectsForStream([...seen.values()], scope.stream, classLevel);
  },

  /** Unique chapters for a subject from the live bank (`id` = DB value, `displayName` for UI). */
  async listBankChapters(
    ctx: ServiceContext,
    opts: { subject: string; classLevel?: number | null },
  ): Promise<AcademicTermRef[]> {
    assertCanConsume(ctx, "practice");
    const client = getClient(toRepoContext(ctx));
    const scope = await this.resolveCurriculumScope(ctx);
    const classLevel = opts.classLevel ?? scope.classLevel;

    if (classLevel == null || !Number.isFinite(classLevel)) return [];
    if (!isSubjectAllowedForScope(opts.subject, scope.stream, classLevel)) return [];

    let query = client
      .from("question_bank")
      .select("chapter")
      .eq("is_approved", true)
      .eq("class_level", classLevel)
      .ilike("subject", opts.subject)
      .or(`school_id.is.null,school_id.eq.${ctx.schoolId}`)
      .or(`board.eq.${scope.board},board.eq.both,board.is.null`)
      .limit(800);

    if (scope.stream) {
      query = query.or(`stream.eq.${scope.stream},stream.is.null`);
    }

    const { data, error } = await query;
    throwIfError(error, "Failed to load practice chapters");
    const seen = new Map<string, AcademicTermRef>();
    for (const row of data ?? []) {
      const raw = String((row as { chapter?: string | null }).chapter ?? "").trim();
      if (!raw) continue;
      const term = toPresentedTerm(raw, "chapter");
      if (!term) continue;
      const key = term.displayName.toLowerCase();
      if (!seen.has(key)) seen.set(key, { id: raw, displayName: term.displayName });
    }
    return [...seen.values()].sort((a, b) => a.displayName.localeCompare(b.displayName));
  },

  /** Unique topics/concepts for subject (+ optional chapter). */
  async listBankTopics(
    ctx: ServiceContext,
    opts: { subject: string; chapter?: string | null; classLevel?: number | null },
  ): Promise<AcademicTermRef[]> {
    assertCanConsume(ctx, "practice");
    const client = getClient(toRepoContext(ctx));
    const scope = await this.resolveCurriculumScope(ctx);
    const classLevel = opts.classLevel ?? scope.classLevel;

    if (classLevel == null || !Number.isFinite(classLevel)) return [];
    if (!isSubjectAllowedForScope(opts.subject, scope.stream, classLevel)) return [];

    let query = client
      .from("question_bank")
      .select("topic, concept, chapter")
      .eq("is_approved", true)
      .eq("class_level", classLevel)
      .ilike("subject", opts.subject)
      .or(`school_id.is.null,school_id.eq.${ctx.schoolId}`)
      .or(`board.eq.${scope.board},board.eq.both,board.is.null`)
      .limit(800);

    if (scope.stream) {
      query = query.or(`stream.eq.${scope.stream},stream.is.null`);
    }

    const { data, error } = await query;
    throwIfError(error, "Failed to load practice topics");
    const seen = new Map<string, AcademicTermRef>();
    for (const row of data ?? []) {
      const r = row as { topic?: string | null; concept?: string | null; chapter?: string | null };
      if (opts.chapter && !academicLabelMatches(r.chapter, opts.chapter)) continue;
      for (const candidate of [r.topic, r.concept]) {
        const raw = String(candidate ?? "").trim();
        if (!raw) continue;
        const term = toPresentedTerm(raw, "concept");
        if (!term) continue;
        const key = term.displayName.toLowerCase();
        if (!seen.has(key)) seen.set(key, { id: raw, displayName: term.displayName });
      }
    }
    return [...seen.values()].sort((a, b) => a.displayName.localeCompare(b.displayName));
  },

  /** Weak concepts from concept_mastery (honest empty if none tracked). */
  async listWeakConcepts(
    ctx: ServiceContext,
    opts: { threshold?: number; limit?: number } = {},
  ): Promise<Array<{
    subject: string;
    chapter: string | null;
    concept: string;
    concept_label: string;
    mastery_score: number;
  }>> {
    assertCanConsume(ctx, "practice");
    const threshold = opts.threshold ?? 70;
    const limit = opts.limit ?? 12;
    const client = getClient(toRepoContext(ctx));
    const { data, error } = await client
      .from("concept_mastery")
      .select("subject, chapter, concept, mastery_score")
      .eq("user_id", ctx.userId)
      .lt("mastery_score", threshold)
      .order("mastery_score", { ascending: true })
      .limit(limit);
    throwIfError(error, "Failed to load weak concepts");
    const scope = await this.resolveCurriculumScope(ctx);
    return (data ?? []).map((r) => {
      const subjectRaw = String((r as { subject: string }).subject ?? "");
      const chapterRaw = (r as { chapter?: string | null }).chapter ?? null;
      const conceptRaw = String((r as { concept: string }).concept ?? "");
      return {
        // Keep raw concept for mastery keys / filters; callers should display via displayConcept.
        subject: displaySubject(subjectRaw) || subjectRaw,
        chapter: chapterRaw ? displayChapter(chapterRaw) : null,
        concept: conceptRaw,
        concept_label: displayConcept(conceptRaw),
        mastery_score: Number((r as { mastery_score: number }).mastery_score) || 0,
      };
    }).filter((r) =>
      r.subject &&
      r.concept &&
      isSubjectAllowedForScope(r.subject, scope.stream, scope.classLevel),
    );
  },

  /** Unmastered mistakes + wrong attempts as practice-ready questions (honest empty if none). */
  async listMistakeQuestions(
    ctx: ServiceContext,
    opts: { limit?: number } = {},
  ): Promise<Array<{
    id: string;
    subject: string;
    chapter: string | null;
    difficulty: string | null;
    question: string;
    options: unknown;
    correct_index: number;
    explanation: string | null;
  }>> {
    assertCanConsume(ctx, "practice");
    const limit = Math.min(90, Math.max(1, opts.limit ?? 20));
    const client = getClient(toRepoContext(ctx));
    const scope = await this.resolveCurriculumScope(ctx);

    type OutRow = {
      id: string;
      subject: string;
      chapter: string | null;
      difficulty: string | null;
      question: string;
      options: unknown;
      correct_index: number;
      explanation: string | null;
    };
    const out: OutRow[] = [];
    const seen = new Set<string>();

    const pushRow = (row: OutRow) => {
      if (!row.question) return;
      const optsRaw = Array.isArray(row.options) ? row.options : [];
      if (optsRaw.length < 2) return;
      if (!isSubjectAllowedForScope(row.subject || "", scope.stream, scope.classLevel)) return;
      const key = (row.id || row.question).toLowerCase();
      if (seen.has(key)) return;
      seen.add(key);
      out.push({ ...row, options: optsRaw });
    };

    const { data, error } = await client
      .from("student_mistakes")
      .select("id, subject, chapter, question_text, options, correct_answer, explanation, question_id")
      .eq("user_id", ctx.userId)
      .eq("mastered", false)
      .order("last_wrong_at", { ascending: false })
      .limit(limit);
    throwIfError(error, "Failed to load incorrect questions");

    for (const row of data ?? []) {
      const r = row as {
        id: string;
        subject: string;
        chapter: string | null;
        question_text: string;
        options: unknown;
        correct_answer: { correct_index?: number; indexes?: number[]; index?: number } | null;
        explanation: string | null;
        question_id: string | null;
      };
      let correctIndex = 0;
      if (typeof r.correct_answer?.correct_index === "number") {
        correctIndex = r.correct_answer.correct_index;
      } else if (typeof r.correct_answer?.index === "number") {
        correctIndex = r.correct_answer.index;
      } else if (Array.isArray(r.correct_answer?.indexes) && r.correct_answer.indexes.length > 0) {
        correctIndex = r.correct_answer.indexes[0];
      }
      pushRow({
        id: r.question_id || r.id,
        subject: r.subject || "General",
        chapter: r.chapter,
        difficulty: "medium",
        question: r.question_text,
        options: r.options,
        correct_index: correctIndex,
        explanation: r.explanation,
      });
    }

    if (out.length < limit) {
      const { data: attempts, error: attErr } = await client
        .from("question_attempts")
        .select("id, bank_question_id, subject, chapter, generated_question, correct_answer, is_correct, skipped")
        .eq("user_id", ctx.userId)
        .eq("is_correct", false)
        .eq("skipped", false)
        .order("created_at", { ascending: false })
        .limit(limit * 3);
      throwIfError(attErr, "Failed to load incorrect attempts");

      for (const row of attempts ?? []) {
        if (out.length >= limit) break;
        const r = row as {
          id: string;
          bank_question_id?: string | null;
          subject?: string | null;
          chapter?: string | null;
          generated_question?: {
            question?: string;
            options?: unknown;
            explanation?: string;
            bank_question_id?: string;
            subject?: string;
            chapter?: string;
          } | null;
          correct_answer?: { correct_index?: number; index?: number } | null;
        };
        const gq = r.generated_question ?? {};
        const id = r.bank_question_id || gq.bank_question_id || r.id;
        const correctIndex =
          typeof r.correct_answer?.correct_index === "number"
            ? r.correct_answer.correct_index
            : typeof r.correct_answer?.index === "number"
              ? r.correct_answer.index
              : 0;
        pushRow({
          id,
          subject: r.subject || gq.subject || "General",
          chapter: r.chapter ?? gq.chapter ?? null,
          difficulty: "medium",
          question: String(gq.question ?? ""),
          options: gq.options,
          correct_index: correctIndex,
          explanation: gq.explanation ?? null,
        });
      }
    }

    return out.slice(0, limit);
  },

  /** Previously skipped questions from attempts (honest empty if none). */
  async listSkippedBankQuestions(
    ctx: ServiceContext,
    opts: { limit?: number } = {},
  ): Promise<Array<{
    id: string;
    subject: string;
    chapter: string | null;
    difficulty: string | null;
    question: string;
    options: unknown;
    correct_index: number;
    explanation: string | null;
  }>> {
    assertCanConsume(ctx, "practice");
    const limit = Math.min(90, Math.max(1, opts.limit ?? 20));
    const client = getClient(toRepoContext(ctx));
    const scope = await this.resolveCurriculumScope(ctx);
    const { data: attempts, error } = await client
      .from("question_attempts")
      .select("id, bank_question_id, subject, chapter, generated_question, correct_answer")
      .eq("user_id", ctx.userId)
      .eq("skipped", true)
      .order("created_at", { ascending: false })
      .limit(limit * 3);
    throwIfError(error, "Failed to load skipped questions");

    const ids: string[] = [];
    const seenIds = new Set<string>();
    const fallback: Array<{
      id: string;
      subject: string;
      chapter: string | null;
      difficulty: string | null;
      question: string;
      options: unknown;
      correct_index: number;
      explanation: string | null;
    }> = [];
    const seenFallback = new Set<string>();

    for (const row of attempts ?? []) {
      const r = row as {
        id: string;
        bank_question_id?: string | null;
        subject?: string | null;
        chapter?: string | null;
        generated_question?: {
          question?: string;
          options?: unknown;
          explanation?: string;
          bank_question_id?: string;
          subject?: string;
          chapter?: string;
        } | null;
        correct_answer?: { correct_index?: number; index?: number } | null;
      };
      const bankId = r.bank_question_id || r.generated_question?.bank_question_id || null;
      if (bankId) {
        if (!seenIds.has(bankId)) {
          seenIds.add(bankId);
          ids.push(bankId);
        }
        continue;
      }
      const gq = r.generated_question ?? {};
      const stem = String(gq.question ?? "").trim();
      const optsRaw = Array.isArray(gq.options) ? gq.options : [];
      if (!stem || optsRaw.length < 2) continue;
      const subject = r.subject || gq.subject || "General";
      if (!isSubjectAllowedForScope(subject, scope.stream, scope.classLevel)) continue;
      const key = stem.toLowerCase();
      if (seenFallback.has(key)) continue;
      seenFallback.add(key);
      const correctIndex =
        typeof r.correct_answer?.correct_index === "number"
          ? r.correct_answer.correct_index
          : typeof r.correct_answer?.index === "number"
            ? r.correct_answer.index
            : 0;
      fallback.push({
        id: r.id,
        subject,
        chapter: r.chapter ?? gq.chapter ?? null,
        difficulty: "medium",
        question: stem,
        options: optsRaw,
        correct_index: correctIndex,
        explanation: gq.explanation ?? null,
      });
    }

    const fromBank = ids.length > 0
      ? await this.listBankQuestions(ctx, { ids: ids.slice(0, limit), limit })
      : [];

    const merged = [...fromBank];
    const seenMerge = new Set(fromBank.map((r) => r.id));
    for (const row of fallback) {
      if (merged.length >= limit) break;
      if (seenMerge.has(row.id)) continue;
      seenMerge.add(row.id);
      merged.push(row);
    }
    return merged.slice(0, limit);
  },

  /** Approved bank questions for student practice sessions (honest empty if none). */
  async listBankQuestions(
    ctx: ServiceContext,
    opts: {
      subject?: string | null;
      chapter?: string | null;
      topic?: string | null;
      concept?: string | null;
      difficulty?: string | null;
      classLevel?: number | null;
      limit?: number;
      pyqOnly?: boolean;
      ids?: string[];
      /** Match any of these chapter/concept/topic strings (weak-area mode). */
      weakTargets?: Array<{ subject?: string; chapter?: string | null; concept?: string }>;
    } = {},
  ) {
    assertCanConsume(ctx, "practice");
    const client = getClient(toRepoContext(ctx));
    const limit = Math.min(90, Math.max(1, opts.limit ?? 20));
    const scope = await this.resolveCurriculumScope(ctx);
    const classLevel = opts.classLevel ?? scope.classLevel;

    // Never dump all classes when class cannot be resolved (unless fetching by id).
    const byIds = opts.ids && opts.ids.length > 0;
    if (!byIds && (classLevel == null || !Number.isFinite(classLevel))) {
      return [];
    }
    if (
      opts.subject &&
      opts.subject !== "Mixed" &&
      !isSubjectAllowedForScope(opts.subject, scope.stream, classLevel)
    ) {
      return [];
    }

    let query = client
      .from("question_bank")
      .select("id, subject, chapter, topic, concept, difficulty, question, options, correct_index, explanation, exam_year, source, source_type, stream")
      .eq("is_approved", true)
      .or(`school_id.is.null,school_id.eq.${ctx.schoolId}`)
      .or(`board.eq.${scope.board},board.eq.both,board.is.null`)
      .limit(Math.min(400, Math.max(80, limit * 8)));

    if (byIds) {
      query = query.in("id", opts.ids!);
    }
    if (classLevel != null && Number.isFinite(classLevel)) {
      query = query.eq("class_level", classLevel);
    }
    if (scope.stream) {
      query = query.or(`stream.eq.${scope.stream},stream.is.null`);
    }
    if (opts.subject && opts.subject !== "Mixed") {
      query = query.ilike("subject", opts.subject);
    }
    // Chapter / topic / concept filters applied client-side with academicLabelMatches
    // so display-cleaned labels still hit slug or mojibake-stored rows.
    if (opts.difficulty && opts.difficulty !== "mixed") {
      query = query.eq("difficulty", opts.difficulty);
    }
    if (opts.pyqOnly) {
      query = query.or("exam_year.not.is.null,source_type.ilike.%pyq%,source.ilike.%pyq%,source.ilike.%previous%");
    }

    const { data, error } = await query;
    throwIfError(error, "Failed to load practice questions");
    let rows = (data ?? []) as Array<{
      id: string;
      subject: string;
      chapter: string | null;
      topic: string | null;
      concept: string | null;
      difficulty: string | null;
      question: string;
      options: unknown;
      correct_index: number;
      explanation: string | null;
      exam_year: number | null;
      source: string | null;
      source_type: string | null;
      stream: string | null;
    }>;

    // Senior stream allowlists (commerce / science 11–12) — covers null-stream legacy rows.
    rows = rows.filter((r) => isSubjectAllowedForScope(r.subject, scope.stream, classLevel));

    if (opts.chapter) {
      rows = rows.filter((r) => academicLabelMatches(r.chapter, opts.chapter));
    }
    if (opts.topic) {
      rows = rows.filter((r) =>
        academicLabelMatches(r.topic, opts.topic) ||
        academicLabelMatches(r.concept, opts.topic) ||
        academicLabelMatches(r.chapter, opts.topic),
      );
    }
    if (opts.concept) {
      rows = rows.filter((r) =>
        academicLabelMatches(r.concept, opts.concept) ||
        academicLabelMatches(r.topic, opts.concept),
      );
    }
    if (opts.weakTargets && opts.weakTargets.length > 0) {
      const targets = opts.weakTargets.filter((w) =>
        !w.subject || isSubjectAllowedForScope(w.subject, scope.stream, classLevel),
      );
      if (targets.length === 0) return [];
      rows = rows.filter((r) =>
        targets.some((w) => {
          const subjOk = !w.subject || r.subject.toLowerCase() === w.subject.toLowerCase();
          if (!subjOk) return false;
          const needle = w.concept || w.chapter || "";
          if (!needle) return subjOk;
          return (
            academicLabelMatches(r.concept, needle) ||
            academicLabelMatches(r.topic, needle) ||
            academicLabelMatches(r.chapter, needle)
          );
        }),
      );
    }

    // Shuffle client-side so repeated sessions vary when bank is large enough.
    for (let i = rows.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [rows[i], rows[j]] = [rows[j], rows[i]];
    }
    return rows.slice(0, limit).map((r) => ({
      id: r.id,
      subject: displaySubject(r.subject) || r.subject,
      chapter: r.chapter ? displayChapter(r.chapter) : r.chapter,
      difficulty: r.difficulty,
      question: r.question,
      options: r.options,
      correct_index: r.correct_index,
      explanation: r.explanation,
    }));
  },
};
