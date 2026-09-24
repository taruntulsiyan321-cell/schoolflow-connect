import {
  assertCanOwn,
  assertCanConsume,
  toRepoContext,
  type ServiceContext,
} from "./context";
import { assertStudentClassContext, assertStudentContext } from "./assertStudentContext";
import type { Json } from "@/integrations/supabase/types";
import { getClient, retryTransient, throwIfError } from "../repository/base";
import { emitEvent, emitEventBestEffort } from "../repository/eventsRepository";
import { broadcastAcademicWrite } from "../live";
import { notifyStudentXpUpdated } from "@/lib/studentXpNotify";
import type { attemptsToFinishPayload } from "@/lib/practiceSessionSnapshot";
import {
  contentStreamForClass,
  filterSubjectsForStream,
  inferStreamFromText,
  isSubjectAllowedForScope,
  normalizeStream,
  parseClassLevel,
  streamForClass,
  type AcademicStream,
  type CurriculumScope,
} from "@/lib/curriculumScope";
import {
  academicLabelEquals,
  academicLabelMatches,
  academicMatchKey,
  displayChapter,
  displayConcept,
  displaySubject,
  isPlaceholderAcademicLabel,
  toPresentedTerm,
  type TaxonomyTermRef,
} from "@/lib/academicPresentation";
import {
  isCleanAcademicLabel,
  looksLikeUnresolvedMojibake,
} from "@/lib/utf8MojibakeRepair";
import { WEAK_CONCEPT_THRESHOLD } from "../eie/masteryBands";
import { DecisionEngineService, type WeakAreaRecommendation } from "./decisionEngineService";
import { DECISION_ENGINE_FEATURE_FLAGS } from "@/lib/productFeatureFlags";
import { sessionAccuracy } from "../metrics/practice";
import { valueOr } from "../metrics/types";
import {
  buildPracticeAnalysisSnapshot,
  type PracticeAttemptRecord,
} from "@/lib/practiceAnalysisSnapshot";
import { answerToIndex } from "./answerText";
import { listCaptureQuestionsByIds } from "./screenCaptureService";

export type { CurriculumScope };
export type AcademicTermRef = TaxonomyTermRef;

/**
 * First occurrence wins, order preserved.
 *
 * Needed wherever a newest-first PostgREST result is deduped by id: PostgREST
 * has no DISTINCT ON, so the collapse happens here, and it must keep the
 * newest row rather than an arbitrary one.
 */
export function dedupePreservingOrder(ids: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of ids) {
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

export type PracticeSessionRow = {
  id: string;
  subject: string;
  // Nullable: sessions with no single chapter (Weak Areas, Incorrect,
  // Skipped, Bookmarked, and Custom Practice with no chapter chosen) are a
  // real state, not missing data — see 20260804040000_practice_sessions_chapter_nullable.sql.
  chapter: string | null;
  question_count: number;
  correct_count: number;
  score: number;
  created_at: string;
  finished_at: string | null;
  practice_mode?: string | null;
  skipped_count?: number | null;
  wrong_count?: number | null;
  total_time_ms?: number | null;
  accuracy?: number | null;
  saved_at?: string | null;
  analysis_snapshot?: Record<string, unknown> | null;
  xp_earned?: number | null;
  difficulty?: string | null;
  /** Timed/mock original limit (seconds); null = untimed. */
  time_limit_sec?: number | null;
};

/**
 * Practice Engine V1 schema probes.
 *
 * The migration that adds question_bank.is_active and
 * concept_mastery.confidence_score/classification is applied out of band, so
 * this code has to run correctly both before and after it lands. Referencing a
 * missing table or column fails the entire PostgREST request, which would take
 * practice down completely — so every new-schema read probes once, caches the
 * answer for the session, and degrades to the pre-migration behaviour.
 *
 * These flags can be deleted in phase 5, once the migration is guaranteed applied.
 */
const MISSING_SCHEMA_CODES = new Set([
  "42703",    // undefined_column
  "42P01",    // undefined_table
  "42883",    // undefined_function
  "PGRST202", // function not found in schema cache
  "PGRST205", // table not found in schema cache
]);

function isMissingSchema(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as { code?: string; message?: string };
  if (e.code && MISSING_SCHEMA_CODES.has(e.code)) return true;
  return /does not exist|schema cache|could not find/i.test(String(e.message ?? ""));
}

/**
 * A topics.id. listBankTopics hands these to the topic picker; a
 * /student/practice?topic= link carries a topic NAME instead, and
 * listBankQuestions narrows each shape its own way.
 */
const TOPIC_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * listBankQuestions reads its pool a page at a time. PostgREST answers at most
 * 1,000 rows per request; the largest pool a class can ask for today is about
 * 3,300 (every subject of one class), so the cap is a runaway guard, not a
 * sample size.
 */
const POOL_PAGE = 1000;
const POOL_CAP = 10_000;

/**
 * The student bank every practice read draws from: approved, active unless a
 * historical view asks otherwise, the student's board, class and stream, and
 * one subject when one is named.
 *
 * listBankQuestions narrows it further; listPyqYears reads the exam years off
 * it. One home for the scope, so the Previous Year Questions screen can only
 * ever offer a year the pool would then serve.
 */
function studentBankQuery(
  client: ReturnType<typeof getClient>,
  columns: string,
  scope: CurriculumScope,
  classLevel: number | null,
  opts: { subject?: string | null; activeOnly: boolean; withCount?: boolean; previousYearOnly?: boolean },
) {
  let query = client
    .from("question_bank_student")
    .select(columns, opts.withCount ? { count: "exact" } : undefined)
    .eq("is_approved", true)
    .order("id");
  if (opts.activeOnly) query = query.eq("is_active", true);

  // Individual (exam) accounts practise their exam's bank only — not the
  // school board/class/stream cut. School accounts never set examId.
  if (scope.examId) {
    query = query.eq("exam_id", scope.examId);
  } else {
    // Chunk 7A: question_bank.school_id is gone — the bank is global (G2),
    // so there is no per-school arm left to filter on.
    query = query
      .is("exam_id", null)
      .or(`board.eq.${scope.board},board.eq.both,board.is.null`);
    if (classLevel != null && Number.isFinite(classLevel)) query = query.eq("class_level", classLevel);
    // A stream narrows content only from Class 11 (contentStreamForClass).
    const stream = contentStreamForClass(scope.stream, classLevel);
    if (stream) query = query.or(`stream.eq.${stream},stream.is.null`);
  }
  if (opts.subject && opts.subject !== "Mixed") query = query.ilike("subject", opts.subject);
  // A previous-year question is one that names the exam year it was set in.
  // The source-text guesses that stood in the pool's filter (a `pyq`
  // source_type, a source naming a past paper) matched none of the bank, and
  // would have admitted a question no year could ever select.
  if (opts.previousYearOnly) query = query.not("exam_year", "is", null);
  return query;
}

/**
 * Every row a paged query admits, up to POOL_CAP.
 *
 * The first page brings the total with it, and every other page is asked for
 * at once. They were fetched one after another: each page is a full round
 * trip of about a second for a thousand rows, so a Class 12 "all subjects"
 * session (3,305 rows, four pages) waited 6.6 seconds before its first
 * question — measured 2026-09-22 as the student. Asked for together, the pages
 * cost one round trip after the first.
 *
 * The query must be ordered by id, so the pages tile it; a row that moves
 * between the first request and the rest is counted once.
 */
/** The chapter to narrow by, or nothing. One home, so a count and a draw agree. */
function chapterFilterOf(chapter: string | null | undefined): string | null {
  const v = chapter?.trim();
  return v ? v : null;
}

/** A topic picked from the list: an id, exact and per chapter (§10.22). */
function topicIdOf(topic: string | null | undefined): string | null {
  return topic && TOPIC_ID_RE.test(topic.trim()) ? topic.trim() : null;
}

/**
 * A topic NAME, from an old `?topic=` link. Skipped when it carries a comma,
 * a parenthesis or a quote: those are PostgREST's own delimiters in an
 * embedded filter, and such a name falls through to the client-side pass.
 */
function topicNameOf(topic: string | null | undefined): string | null {
  return !topicIdOf(topic) && topic && !/[,()"\\]/.test(topic) ? topic.trim() : null;
}

type PageError = { message: string; code?: string } | null;
async function readAllPages<R extends { id: string }>(
  page: (withCount: boolean) => { range: (from: number, to: number) => PromiseLike<{ data: unknown; count?: number | null; error: PageError }> },
): Promise<{ data: R[] | null; error: PageError }> {
  const first = await page(true).range(0, POOL_PAGE - 1);
  if (first.error) return { data: null, error: first.error };
  const firstRows = (first.data ?? []) as R[];
  const total = Math.min(first.count ?? firstRows.length, POOL_CAP);
  const rest: Array<PromiseLike<{ data: unknown; error: PageError }>> = [];
  for (let from = POOL_PAGE; from < total; from += POOL_PAGE) {
    rest.push(page(false).range(from, from + POOL_PAGE - 1));
  }
  const pages = await Promise.all(rest);
  const failed = pages.find((p) => p.error);
  if (failed) return { data: null, error: failed.error };
  const byId = new Map<string, R>();
  for (const row of [firstRows, ...pages.map((p) => (p.data ?? []) as R[])].flat()) byId.set(row.id, row);
  return { data: [...byId.values()], error: null };
}

/** A student's curriculum scope, shared by every question load for a minute. */
const SCOPE_TTL_MS = 60_000;
const scopeCache = new Map<string, { at: number; promise: Promise<CurriculumScope> }>();

/** A keepalive request body may not exceed 64 KB; this leaves headroom. */
const PAGE_EXIT_BODY_LIMIT = 60_000;

let confidenceAvailable: boolean | null = null;

/**
 * Decision Engine Slice 1 swap-in for listWeakConcepts's "simple" path,
 * gated by DECISION_ENGINE_FEATURE_FLAGS.weakAreasV2 (default off).
 * rpc_weak_areas_v2 returns raw concept_mastery columns with no
 * curriculum-scope filtering, placeholder-label filtering, or display
 * formatting -- this reapplies the same guarantees the legacy query
 * already provides, to keep the return contract intact for every caller.
 */
async function loadWeakConceptsFromDecisionEngineV2(
  ctx: ServiceContext,
  limit: number,
): Promise<Array<{
  subject: string;
  chapter: string | null;
  concept: string;
  concept_label: string;
  mastery_score: number;
}>> {
  let recs: WeakAreaRecommendation[];
  try {
    recs = await DecisionEngineService.getWeakAreasV2(ctx);
  } catch (err) {
    // Rollout health fix: this call previously had no observable failure
    // path at all -- a thrown error here meant execution never reached the
    // emit below, so a v2 RPC failure was invisible everywhere except a
    // client console.warn with no server-side trace. Record just enough to
    // count/time failures (no raw message/stack -- that already exists in
    // logs, and free-form strings make aggregation messy), then re-throw
    // the exact same error unchanged. "No silent fallback" is preserved.
    void emitEventBestEffort(toRepoContext(ctx), {
      eventType: "practice.weak_areas.v2_failed",
      entityType: "practice",
      studentId: ctx.studentId ?? null,
      payload: { error_type: err instanceof Error ? err.name : "UnknownError" },
    });
    throw err;
  }
  const scope = await PracticeService.resolveCurriculumScope(ctx);
  void emitEventBestEffort(toRepoContext(ctx), {
    eventType: "practice.weak_areas.path_used",
    entityType: "practice",
    studentId: ctx.studentId ?? null,
    // count = raw rpc_weak_areas_v2 row count, before curriculum-scope
    // filtering/slicing below -- the truest "did the policy return
    // anything" signal, and what empty-result-rate/recommendation-count
    // observability is built from.
    payload: { path: "v2", count: recs.length },
  });
  return recs
    .map((r) => {
      const subjectRaw = r.subject ?? "";
      const chapterRaw = r.chapter;
      const conceptRaw = r.concept ?? "";
      return {
        subjectRaw,
        conceptRaw,
        subject: displaySubject(subjectRaw) || subjectRaw,
        chapter:
          chapterRaw && !isPlaceholderAcademicLabel(chapterRaw)
            ? displayChapter(chapterRaw)
            : null,
        concept: conceptRaw,
        concept_label: displayConcept(conceptRaw),
        // Practice's existing contract expects a mastery-like value. During
        // the feature-flag rollout we intentionally map the Decision
        // Engine's Understanding dimension into that field without
        // changing the public PracticeService contract -- this is an
        // adapter translation, not a claim that mastery_score and
        // Understanding are the same concept. They aren't: mastery_score
        // was a single ad hoc composite; Understanding is one canonical
        // Learning Dimension among several. Numerically compatible (both
        // 0-100), semantically distinct -- do not treat this field as
        // "real" Understanding anywhere downstream.
        mastery_score: r.understanding ?? 0,
      };
    })
    .filter(
      (r) =>
        r.subject &&
        r.concept &&
        !isPlaceholderAcademicLabel(r.subjectRaw) &&
        !isPlaceholderAcademicLabel(r.conceptRaw) &&
        isSubjectAllowedForScope(r.subject, scope.stream, scope.classLevel),
    )
    .slice(0, limit)
    .map(({ subjectRaw: _s, conceptRaw: _c, ...row }) => row);
}

/**
 * How far back Practice History looks when no date is chosen. Saved Sessions
 * are how a session is kept past it; the hub states the window from here.
 */
export const PRACTICE_HISTORY_WINDOW_DAYS = 7;

/**
 * How long a session with no new answers is left open before it counts as
 * walked away from. Long enough that a session being sat in another tab — or a
 * student thinking about a hard question — is never closed underneath them.
 */
export const ABANDONED_AFTER_MS = 30 * 60 * 1000;

/**
 * And how stale is too stale to settle at all.
 *
 * Finishing a session credits XP, bumps the activity minutes and marks a study
 * day — all of them NOW. For practice left an hour ago that is simply late. For
 * practice left five weeks ago it would be an invention: a student who opens
 * Practice today and answers nothing would be given today's streak for a
 * session they sat in August. Older sessions are left as they are; they hold no
 * lost mistakes, because every answer was already recorded as it was given.
 */
export const SETTLE_WITHIN_MS = 12 * 60 * 60 * 1000;

const PRACTICE_SESSION_LIST_SELECT =
  "id, subject, chapter, question_count, correct_count, score, created_at, finished_at, practice_mode, skipped_count, wrong_count, total_time_ms, accuracy, saved_at, analysis_snapshot, xp_earned, difficulty, time_limit_sec";

/**
 * What the SERVER says about an attempt, returned by
 * rpc_record_question_attempt.
 *
 * correctIndex is null when the server has no answer of its own to give —
 * a template or AI question with no bank row behind it, the one path where
 * the client's claim is still what gets stored.
 */
export type AttemptVerdict = {
  attemptId: string | null;
  isCorrect: boolean;
  skipped: boolean;
  correctIndex: number | null;
  correctText: string;
  explanation: string;
};

function parseVerdict(raw: unknown): AttemptVerdict {
  const v = (raw ?? {}) as Record<string, unknown>;
  const idx = Number(v.correct_index);
  return {
    attemptId: typeof v.attempt_id === "string" ? v.attempt_id : null,
    isCorrect: v.is_correct === true,
    skipped: v.skipped === true,
    correctIndex: Number.isInteger(idx) ? idx : null,
    correctText: typeof v.correct_text === "string" ? v.correct_text : "",
    explanation: typeof v.explanation === "string" ? v.explanation : "",
  };
}

/**
 * PracticeService — wraps practice session RPCs + finish path.
 * AI/practice modules should call this instead of raw RPCs where practical.
 */
export const PracticeService = {
  async start(
    ctx: ServiceContext,
    args: {
      _subject: string;
      /**
       * CHUNK 10.7. Nullable, and deliberately so: this goes straight into
       * `practice_sessions.chapter`, which migration
       * 20260804040000_practice_sessions_chapter_nullable made nullable
       * because "no chapter" is a real state — whole-subject practice.
       * Coercing to "" here would write an empty string into the column that
       * migration exists to keep null.
       */
      _chapter: string | null;
      _count?: number;
      _practice_mode?: string | null;
      /** easy | medium | hard; mixed/any/all are stored as null. */
      _difficulty?: string | null;
      /** A Custom Practice time goal, in seconds; null for an untimed session. */
      _time_limit_sec?: number | null;
    },
  ): Promise<string> {
    assertCanOwn(ctx, "practice");
    const difficulty =
      args._difficulty && !["mixed", "any", "all"].includes(String(args._difficulty).toLowerCase())
        ? String(args._difficulty).toLowerCase()
        : null;
    const timeLimit =
      typeof args._time_limit_sec === "number" && args._time_limit_sec > 0
        ? Math.floor(args._time_limit_sec)
        : null;
    // One signature, the live one. This used to retry two older signatures on
    // ANY error — so a network failure on the real call was reported as
    // whatever the oldest signature said, and a pre-migration fallback wrote
    // difficulty and time limit with a second, unchecked update.
    const { data, error } = await getClient(toRepoContext(ctx)).rpc("rpc_start_practice_session", {
      _subject: args._subject,
      // `_chapter text` has no DEFAULT, so it cannot be omitted, and the
      // generated type cannot say it takes null — which whole-subject practice
      // sends on purpose. This one field is cast; the rest are omitted when
      // unset, which reaches the same DEFAULT NULL.
      _chapter: args._chapter as string,
      _count: args._count ?? 10,
      ...(args._practice_mode ? { _practice_mode: args._practice_mode } : {}),
      ...(difficulty ? { _difficulty: difficulty } : {}),
      ...(timeLimit != null ? { _time_limit_sec: timeLimit } : {}),
    });
    throwIfError(error, "Failed to start practice session");
    return data as string;
  },

  /**
   * Finish the session — retried when the database says "not now".
   *
   * Measured on production 2026-09-23: this returned
   * `57014 canceling statement due to statement timeout` while the
   * Battleground's featured-battle maintenance was running, and the session
   * was simply lost to the student (KNOWN_ISSUES 74, item 5 of the report).
   * `rpc_finish_practice_session` de-duplicates the attempts it is sent and
   * then counts the session from question_attempts, so sending it again is
   * safe — the page-exit keepalive path already depends on that.
   *
   * Only transient codes are retried (isTransientDbError): a refusal or a
   * constraint fails on the first answer, as it should.
   */
  async finish(
    ctx: ServiceContext,
    args: Record<string, unknown>,
  ) {
    assertCanOwn(ctx, "practice");
    const data = await retryTransient(async () => {
      const { data: out, error } = await getClient(toRepoContext(ctx)).rpc(
        "rpc_finish_practice_session",
        args as never,
      );
      throwIfError(error, "Failed to finish practice session");
      return out;
    });
    // No payload. §10.8: practice is private to the student, and this event is
    // readable school-side. It carried the finish arguments — every question,
    // the answer chosen and whether it was right — which reached the principal,
    // admin, teachers, parents and other students through the activity feed.
    // Its one consumer refreshes the student's profile and needs only who.
    await emitEvent(toRepoContext(ctx), {
      eventType: "practice.session.completed",
      entityType: "practice",
      entityId: (args._session_id as string) ?? null,
      studentId: ctx.studentId ?? null,
    }).catch((err) => {
      console.warn("[PracticeService.finish] emitEvent failed:", err);
    });
    broadcastAcademicWrite(ctx.schoolId, ["xp", "profile"], {
      studentId: ctx.studentId,
      source: "PracticeService",
    });
    notifyStudentXpUpdated();
    return data;
  },

  /**
   * The same finish, for a page that is going away — the tab closed, or Back
   * out of the app.
   *
   * `finish` cannot do this: it is an ordinary request, and the browser
   * cancels it with the page. So did the answer the student had just given,
   * whose live write was still in flight. Measured 2026-09-22: answer twice,
   * press Back out of the app, and the session was left open holding ONE
   * answer, with no finish sent at all.
   *
   * A keepalive request outlives the page. It carries only the answers whose
   * live write was never confirmed — rpc_finish_practice_session records the
   * attempts it is sent (de-duplicating any that did land) and then counts the
   * session from question_attempts, so the rest need not travel. A keepalive
   * body is capped at 64 KB; past a safe margin the attempts are dropped and
   * the finish counts what reached the server.
   *
   * Nothing is emitted and nothing is awaited: there is no page left to
   * report to. The settle on the next visit remains the net under this.
   */
  finishOnPageExit(args: {
    sessionId: string;
    attempts: ReturnType<typeof attemptsToFinishPayload>;
    accessToken: string;
  }): void {
    const url = `${import.meta.env.VITE_SUPABASE_URL}/rest/v1/rpc/rpc_finish_practice_session`;
    const params = {
      _session_id: args.sessionId,
      _ended_by_user: true,
      _ended_normally: false,
    };
    let body = JSON.stringify({ ...params, _attempts: args.attempts.length ? args.attempts : null });
    if (body.length > PAGE_EXIT_BODY_LIMIT) body = JSON.stringify({ ...params, _attempts: null });
    try {
      void fetch(url, {
        method: "POST",
        keepalive: true,
        headers: {
          apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
          Authorization: `Bearer ${args.accessToken}`,
          "Content-Type": "application/json",
        },
        body,
      }).catch(() => undefined);
    } catch {
      // A browser that refuses the request leaves the session to the settle.
    }
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
      generatedQuestion: Record<string, Json>;
      selectedAnswer: Record<string, Json>;
      correctAnswer: Record<string, Json>;
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
    // Single canonical RPC — do not omit optional args; PostgREST overload
    // disambiguation breaks if multiple signatures share a named-arg prefix.
    const { data, error } = await client.rpc("rpc_record_question_attempt", {
      _correct_answer: args.correctAnswer,
      _generated_question: generatedQuestion,
      _is_correct: skipped ? false : args.isCorrect,
      _selected_answer: args.selectedAnswer,
      _session_id: args.sessionId,
      _score: args.score ?? (skipped ? 0 : args.isCorrect ? 1 : 0),
      _skipped: skipped,
      // CHUNK 10.7 — omitted, not coerced. The generated Args type renders a
      // DEFAULT NULL parameter as optional-but-not-nullable, so `?? null` no
      // longer typechecks. These three are `_template_id uuid DEFAULT NULL`,
      // `_time_taken_ms integer DEFAULT NULL` and `_bank_question_id uuid
      // DEFAULT NULL`, so omitting the key and passing null reach the same
      // column value. The guard narrows; `!` would have asserted.
      //
      // Note what is NOT omitted below it: `_score DEFAULT 0`, `_skipped
      // DEFAULT false`, `_hint_used DEFAULT false`, `_source DEFAULT
      // 'practice'` and `_meta DEFAULT '{}'`. Omitting any of those would write
      // the default instead of null and change the row. The substitution is
      // per-parameter, never blanket.
      ...(args.templateId != null ? { _template_id: args.templateId } : {}),
      ...(args.timeTakenMs != null ? { _time_taken_ms: args.timeTakenMs } : {}),
      ...(args.bankQuestionId != null ? { _bank_question_id: args.bankQuestionId } : {}),
      _hint_used: args.hintUsed ?? false,
      _source: args.source ?? "practice",
      _meta: meta,
    });
    throwIfError(error, "Failed to record practice attempt");
    broadcastAcademicWrite(ctx.schoolId, ["xp", "profile"], {
      studentId: ctx.studentId,
      source: "PracticeService.recordAttempt",
    });
    // THE SERVER'S VERDICT, not the client's. rpc_record_question_attempt
    // re-grades every bank question off question_bank.correct_index and
    // returns what it found; the `_is_correct` this call sent is discarded
    // there. Proved live 2026-09-22: a wrong answer submitted as
    // `_is_correct: true` came back is_correct false.
    //
    // The old `return data as string` handed back a bare attempt id that no
    // caller read. This is what the feedback screen needs so the browser
    // never has to be told the answer in advance.
    return parseVerdict(data);
  },

  async getSession(ctx: ServiceContext, sessionId: string) {
    assertCanConsume(ctx, "practice");
    const { data, error } = await getClient(toRepoContext(ctx))
      .from("practice_sessions")
      .select("*")
      .eq("id", sessionId)
      .maybeSingle();
    throwIfError(error, "Failed to load practice session");
    return data as PracticeSessionRow | null;
  },

  /**
   * A finished session's durable per-question record: the WRONG and the
   * SKIPPED, and nothing else.
   *
   * §10.8's transient/durable rule — "when the session closes, it must not
   * persist; what survives is session or tier TOTALS, plus rows for wrong,
   * skipped and bookmarked" — with "no per-question record of correct
   * answers". The totals live on the practice_sessions row and are what the
   * result screen and the concept report read.
   *
   * The filter is HERE, in the one read of question_attempts for a session,
   * because both things that consume it must obey the same rule: the review
   * list on the result screen, and the snapshot a saved session freezes.
   *
   * Measured 2026-09-23 on production: 1,267 correct per-question rows across
   * finished sessions, each with the question, the student's choice and the
   * answer key. The rows themselves are the server's to remove at finish
   * (KNOWN_ISSUES 79, blocked on the database token); until it does, nothing
   * in the app reads one.
   */
  async listSessionAttempts(ctx: ServiceContext, sessionId: string) {
    assertCanConsume(ctx, "practice");
    const { data, error } = await getClient(toRepoContext(ctx))
      .from("question_attempts")
      .select("*")
      .eq("session_id", sessionId)
      .eq("user_id", ctx.userId)
      .or("is_correct.is.false,is_correct.is.null,skipped.is.true")
      .order("created_at", { ascending: true });
    throwIfError(error, "Failed to load practice attempts");
    return data ?? [];
  },

  /**
   * The latest finished sessions the student actually sat, newest first.
   *
   * "Sat" is _practice_session_attempted's rule — something answered or
   * skipped. A session that loaded nothing is finished too, and without this
   * "Save latest result" would save that instead of the student's last real
   * session.
   */
  async listRecentFinished(ctx: ServiceContext, limit = 40) {
    assertCanConsume(ctx, "practice");
    const { data, error } = await getClient(toRepoContext(ctx))
      .from("practice_sessions")
      .select(PRACTICE_SESSION_LIST_SELECT)
      .eq("user_id", ctx.userId)
      .not("finished_at", "is", null)
      .or("correct_count.gt.0,wrong_count.gt.0,skipped_count.gt.0")
      .order("finished_at", { ascending: false })
      .limit(limit);
    throwIfError(error, "Failed to load practice history");
    return (data ?? []) as PracticeSessionRow[];
  },

  /**
   * Practice History: finished sessions that were sat, newest first.
   *
   * History is a PRACTICE_HISTORY_WINDOW_DAYS window unless the caller names
   * dates; a session worth keeping longer is saved (Saved Sessions has no
   * window). The screen says so — it used to promise "your most recent 100
   * sessions" and "every session you finish", and show a student who last
   * practised eight days ago "No practice history yet".
   *
   * The RPC is the only path. A fallback query used to run on ANY error from
   * it, with different filters and no attempted-rule, so a failure showed a
   * different list rather than an error.
   */
  async listHistory(
    ctx: ServiceContext,
    opts?: {
      limit?: number;
      subject?: string | null;
      practiceMode?: string | null;
      /** ISO instants. Pass the student's LOCAL day boundaries for a day filter. */
      dateFrom?: string | null;
      dateTo?: string | null;
      search?: string | null;
      sort?:
        | "finished_at_desc"
        | "accuracy_desc"
        | "accuracy_asc"
        | "xp_desc"
        | "xp_asc"
        | null;
    },
  ) {
    assertCanConsume(ctx, "practice");
    const dateFrom =
      opts?.dateFrom ||
      new Date(Date.now() - PRACTICE_HISTORY_WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString();
    const subject = opts?.subject?.trim();
    const practiceMode = opts?.practiceMode?.trim();
    const search = opts?.search?.trim();
    const { data, error } = await getClient(toRepoContext(ctx)).rpc("rpc_list_practice_history", {
      _limit: opts?.limit ?? 100,
      _date_from: dateFrom,
      _sort: opts?.sort || "finished_at_desc",
      ...(subject ? { _subject: subject } : {}),
      ...(practiceMode ? { _practice_mode: practiceMode } : {}),
      ...(opts?.dateTo ? { _date_to: opts.dateTo } : {}),
      ...(search ? { _search: search } : {}),
    });
    throwIfError(error, "Failed to load practice history");
    return (data ?? []) as PracticeSessionRow[];
  },

  async listSavedSessions(ctx: ServiceContext, limit = 30) {
    assertCanConsume(ctx, "practice");
    const { data, error } = await getClient(toRepoContext(ctx))
      .from("practice_sessions")
      .select(PRACTICE_SESSION_LIST_SELECT)
      .eq("user_id", ctx.userId)
      .not("saved_at", "is", null)
      .order("saved_at", { ascending: false })
      .limit(limit);
    throwIfError(error, "Failed to load saved practice sessions");
    return (data ?? []) as PracticeSessionRow[];
  },

  /**
   * Finish the sessions this student walked away from, from the answers they
   * already recorded.
   *
   * The runner finishes a session when the student navigates away in the app,
   * but a closed tab or a lost connection takes the request with it. Without
   * this, those sessions stay open for ever: 52 of them on 2026-09-17, holding
   * answers that earned no XP, moved no streak, wrote no chapter tally and
   * appeared in no history — and resuming was removed with the v2 redesign, so
   * nothing was ever going to come back for them.
   *
   * Only sessions whose newest answer is older than ABANDONED_AFTER_MS: a
   * session being sat right now, in another tab, has fresher answers than that
   * and must not be closed underneath the student.
   *
   * Returns how many were settled. Best effort by design — the hub calls it on
   * the way past, and one that fails is simply tried again next time.
   */
  async settleAbandonedSessions(ctx: ServiceContext): Promise<number> {
    assertCanOwn(ctx, "practice");
    const client = getClient(toRepoContext(ctx));
    const { data: open, error } = await client
      .from("practice_sessions")
      .select("id")
      .eq("user_id", ctx.userId)
      .is("finished_at", null)
      .order("created_at", { ascending: false })
      .limit(20);
    throwIfError(error, "Failed to load unfinished practice sessions");
    const ids = (open ?? []).map((r) => (r as { id: string }).id);
    if (ids.length === 0) return 0;

    const { data: attempts, error: attErr } = await client
      .from("question_attempts")
      .select("session_id, created_at")
      .eq("user_id", ctx.userId)
      .in("session_id", ids);
    throwIfError(attErr, "Failed to load unfinished practice attempts");

    const newest = new Map<string, number>();
    for (const row of attempts ?? []) {
      const r = row as { session_id: string | null; created_at: string };
      if (!r.session_id) continue;
      const at = new Date(r.created_at).getTime();
      if (at > (newest.get(r.session_id) ?? 0)) newest.set(r.session_id, at);
    }

    const now = Date.now();
    let settled = 0;
    for (const id of ids) {
      const last = newest.get(id);
      // No answer at all: the student opened it and never answered. There is
      // nothing to record, and finishing it would add a session that never
      // happened to their history.
      if (last == null) continue;
      // Still warm (another tab, a long think) or too old to credit today.
      if (last > now - ABANDONED_AFTER_MS || last < now - SETTLE_WITHIN_MS) continue;
      try {
        await this.finish(ctx, {
          _session_id: id,
          _attempts: [],
          _ended_by_user: true,
          _ended_normally: false,
        });
        settled += 1;
      } catch (e) {
        console.warn("[PracticeService.settleAbandonedSessions]", e instanceof Error ? e.message : e);
      }
    }
    return settled;
  },

  /**
   * Save a finished session, with its analysis frozen (idempotent — a second
   * save returns already_saved and keeps the first snapshot).
   *
   * The snapshot is built HERE, from the session row and its recorded
   * attempts, for every caller. It used to be built by each screen: the result
   * page froze the questions and a "Practice" type label, the hub's "Save
   * latest result" froze no questions at all — two saves of one session, two
   * different records.
   */
  async saveSession(ctx: ServiceContext, sessionId: string) {
    assertCanOwn(ctx, "practice");
    const session = await this.getSession(ctx, sessionId);
    if (!session) throw new Error("That practice session could not be found.");
    const attempts = await this.listSessionAttempts(ctx, sessionId);
    if (attempts.length === 0) throw new Error("Nothing was answered in this session, so there is nothing to save.");
    const snapshot = buildPracticeAnalysisSnapshot(session, attempts as PracticeAttemptRecord[]);
    const { data, error } = await getClient(toRepoContext(ctx)).rpc("rpc_save_practice_session", {
      _session_id: sessionId,
      _snapshot: snapshot as unknown as Json,
    });
    throwIfError(error, "Failed to save practice session");
    broadcastAcademicWrite(ctx.schoolId, ["profile"], {
      studentId: ctx.studentId,
      source: "PracticeService.saveSession",
    });
    return data as {
      session_id: string;
      saved: boolean;
      already_saved: boolean;
      saved_at: string;
    };
  },

  async resolveSchoolBoard(ctx: ServiceContext): Promise<string> {
    const scope = await this.resolveCurriculumScope(ctx);
    return scope.board;
  },

  /**
   * The student's class level, board and stream, from the shared copy when it
   * is fresh (SCOPE_TTL_MS). Every question load resolved it again — a round
   * trip to schools, and sometimes students and classes, one after another
   * before the pool could be asked for — for a scope that does not change
   * within a visit. Measured 2026-09-22: ~300 ms of every Start Practice.
   * Keyed on everything the scope is derived from; a failed resolve is not kept.
   */
  resolveCurriculumScope(ctx: ServiceContext): Promise<CurriculumScope> {
    const key = [
      ctx.userId, ctx.schoolId, ctx.studentId, ctx.classId, ctx.classLabel, ctx.classCategory,
      ctx.schoolKind, ctx.examId,
    ]
      .map((v) => v ?? "").join("|");
    const hit = scopeCache.get(key);
    if (hit && Date.now() - hit.at < SCOPE_TTL_MS) return hit.promise;
    const promise = this.computeCurriculumScope(ctx);
    scopeCache.set(key, { at: Date.now(), promise });
    promise.catch(() => {
      if (scopeCache.get(key)?.promise === promise) scopeCache.delete(key);
    });
    return promise;
  },

  /**
   * Resolve student's class_level + school board/stream for bank filtering.
   * class_level comes from students → classes name/display (e.g. "10-A" → 10, "12-C" → 12).
   * Used for EVERY class — never dump other class levels.
   * stream from schools.stream, else class category/label (commerce/science/…).
   */
  async computeCurriculumScope(ctx: ServiceContext): Promise<CurriculumScope> {
    const client = getClient(toRepoContext(ctx));
    let board = "rbse";
    let schoolStream: AcademicStream | null = null;
    let schoolKind: "school" | "individual" | null = ctx.schoolKind ?? null;
    let examId: string | null = ctx.examId ?? null;
    let examCode: string | null = ctx.examCode ?? null;
    let examName: string | null = ctx.examName ?? null;

    // Prefer board+stream+kind; fall back to board-only if stream column not migrated yet.
    {
      const withStream = await client
        .from("schools")
        .select("board, stream, kind")
        .eq("id", ctx.schoolId)
        .maybeSingle();
      if (withStream.error) {
        const boardOnly = await client
          .from("schools")
          .select("board, kind")
          .eq("id", ctx.schoolId)
          .maybeSingle();
        const raw = boardOnly.data as { board?: string | null; kind?: string | null } | null;
        const rawBoard = raw?.board;
        if (rawBoard && typeof rawBoard === "string" && rawBoard.trim()) {
          board = rawBoard.trim().toLowerCase();
        }
        if (raw?.kind === "school" || raw?.kind === "individual") schoolKind = raw.kind;
      } else {
        const school = withStream.data as {
          board?: string | null;
          stream?: string | null;
          kind?: string | null;
        } | null;
        if (school?.board && typeof school.board === "string" && school.board.trim()) {
          board = school.board.trim().toLowerCase();
        }
        schoolStream = normalizeStream(school?.stream ?? null);
        if (school?.kind === "school" || school?.kind === "individual") schoolKind = school.kind;
      }
    }

    // Individual: exam is the scope. Never invent rbse / a class level.
    if (schoolKind === "individual") {
      if (!examId) {
        const { data: ea } = await client
          .from("exam_accounts")
          .select("exam_id, competitive_exams(code, name)")
          .eq("school_id", ctx.schoolId)
          .maybeSingle();
        examId = ea?.exam_id ?? null;
        type ExamJoin = { code?: string | null; name?: string | null };
        const rawExam = (ea as { competitive_exams?: ExamJoin | ExamJoin[] | null } | null)?.competitive_exams;
        const exam = Array.isArray(rawExam) ? rawExam[0] : rawExam;
        examCode = exam?.code ?? null;
        examName = exam?.name ?? null;
      }
      return {
        classLevel: null,
        board: "cuet",
        stream: null,
        classLabel: examName || examCode || ctx.classLabel || null,
        examId,
        examCode,
        examName,
      };
    }

    let classLabel: string | null = ctx.classLabel ?? null;
    let classCategory: string | null = ctx.classCategory ?? null;
    // Identity RPC metadata is authoritative; avoid re-querying students/classes
    // when its label or category already identifies the class level.
    let classLevel: number | null =
      parseClassLevel(classLabel) ?? parseClassLevel(classCategory);
    let resolvedClassId: string | null = ctx.classId ?? null;

    type ClassJoin = {
      name?: string | null;
      section?: string | null;
      display_name?: string | null;
      category?: string | null;
    };

    const readClass = (raw: ClassJoin | ClassJoin[] | null | undefined) => {
      const c = Array.isArray(raw) ? raw[0] : raw;
      if (!c) return;
      classCategory = c.category ?? classCategory;
      const base = [c.name, c.section].filter(Boolean).join("-");
      classLabel = c.display_name || base || classLabel || null;
      classLevel =
        parseClassLevel(classLabel) ??
        parseClassLevel(c.name) ??
        parseClassLevel(base) ??
        parseClassLevel(classCategory);
    };

    if (!resolvedClassId && ctx.studentId) {
      const { data: stu } = await client
        .from("students")
        .select("class_id, classes(name, section, display_name, category)")
        .eq("id", ctx.studentId)
        .maybeSingle();
      resolvedClassId = (stu as { class_id?: string | null } | null)?.class_id ?? resolvedClassId;
      readClass((stu as { classes?: ClassJoin | ClassJoin[] | null } | null)?.classes);
    } else if (!resolvedClassId && ctx.userId) {
      const { data: stu } = await client
        .from("students")
        .select("class_id, classes(name, section, display_name, category)")
        .eq("user_id", ctx.userId)
        .maybeSingle();
      resolvedClassId = (stu as { class_id?: string | null } | null)?.class_id ?? resolvedClassId;
      readClass((stu as { classes?: ClassJoin | ClassJoin[] | null } | null)?.classes);
    }

    // A label/category can be unparseable. Fetch once by the identity-provided
    // class id (also handles an RLS-blocked embedded class join).
    if (resolvedClassId && classLevel == null) {
      const { data: c } = await client
        .from("classes")
        .select("name, section, display_name, category")
        .eq("id", resolvedClassId)
        .maybeSingle();
      readClass(c as ClassJoin | null);
    }

    // Last resort: parse label already present on ServiceContext (shared AcademicContext).
    if (classLevel == null && classLabel) {
      classLevel = parseClassLevel(classLabel);
    }

    // A school tagged "commerce" still has Class 9 and 10, and they have no
    // stream. Returning the school's tag for them labelled 441 Class 10
    // practice sessions "commerce" and put a commerce filter in every caller.
    const stream = streamForClass(
      schoolStream ?? inferStreamFromText(classCategory, classLabel) ?? null,
      classLevel,
    );

    return {
      classLevel,
      board,
      stream,
      classLabel,
      examId: null,
      examCode: null,
      examName: null,
    };
  },

  /**
   * The subjects and chapters a class can be served, with question counts —
   * counted by the database (rpc_practice_bank_catalog), under the student's
   * own read policies, in the same class / board / stream scope listBankQuestions
   * serves from.
   *
   * Both pickers used to read 800 question rows in no order and list whatever
   * subjects and chapters those rows happened to hold. Class 10 has 3,045
   * servable rows: Social Science, with 953 questions, was never offered.
   * Class 12 commerce lost Hindi and English.
   */
  async listBankCatalog(
    ctx: ServiceContext,
    opts: { subject?: string | null; classLevel?: number | null } = {},
  ): Promise<{ scope: CurriculumScope; classLevel: number | null; rows: { subject: string; chapter: string | null; questions: number }[] }> {
    const scope = await this.resolveCurriculumScope(ctx);
    // Individual exam practice: catalog by exam_id (no class required).
    if (scope.examId) {
      const { data, error } = await getClient(toRepoContext(ctx)).rpc("rpc_practice_bank_catalog", {
        // SQL ignores class/board when _exam_id is set; pass placeholders for the required args.
        _class_level: 0,
        _board: scope.board || "cuet",
        _exam_id: scope.examId,
        ...(opts.subject ? { _subject: opts.subject } : {}),
      });
      throwIfError(error, "Failed to load the practice question bank");
      return { scope, classLevel: null, rows: data ?? [] };
    }
    const classLevel = opts.classLevel ?? scope.classLevel;
    // Never list another class's bank when the student's class is unknown.
    if (classLevel == null || !Number.isFinite(classLevel)) return { scope, classLevel: null, rows: [] };
    const { data, error } = await getClient(toRepoContext(ctx)).rpc("rpc_practice_bank_catalog", {
      _class_level: classLevel,
      _board: scope.board,
      // Below Class 11 the catalog is asked without a stream, so its own
      // stream filter cannot narrow a secondary student's bank.
      ...((): { _stream?: string } => {
        const stream = contentStreamForClass(scope.stream, classLevel);
        return stream ? { _stream: stream } : {};
      })(),
      ...(opts.subject ? { _subject: opts.subject } : {}),
    });
    throwIfError(error, "Failed to load the practice question bank");
    return { scope, classLevel, rows: data ?? [] };
  },

  /** Subjects the student can practise (class+board+stream, or exam). */
  async listBankSubjects(
    ctx: ServiceContext,
    opts: { classLevel?: number | null } = {},
  ): Promise<string[]> {
    assertCanConsume(ctx, "practice");
    assertStudentContext(ctx);
    const { scope, classLevel, rows } = await this.listBankCatalog(ctx, opts);
    if (!scope.examId && (classLevel == null || !ctx.classId)) {
      assertStudentClassContext(ctx);
    }
    const seen = new Map<string, string>();
    for (const row of rows) {
      const raw = row.subject.trim();
      if (!raw) continue;
      if (!scope.examId && !isSubjectAllowedForScope(raw, scope.stream, classLevel)) continue;
      const label = displaySubject(raw);
      const key = label.toLowerCase();
      if (!seen.has(key)) seen.set(key, label);
    }
    if (scope.examId) return [...seen.values()].sort((a, b) => a.localeCompare(b));
    return filterSubjectsForStream([...seen.values()], scope.stream, classLevel);
  },

  /** Chapters for a subject (`id` = the stored chapter, `displayName` for UI). */
  async listBankChapters(
    ctx: ServiceContext,
    opts: { subject: string; classLevel?: number | null },
  ): Promise<AcademicTermRef[]> {
    assertCanConsume(ctx, "practice");
    const { scope, classLevel, rows } = await this.listBankCatalog(ctx, opts);
    if (!scope.examId && classLevel == null) return [];
    if (!scope.examId && !isSubjectAllowedForScope(opts.subject, scope.stream, classLevel)) return [];

    const seen = new Map<string, AcademicTermRef>();
    for (const row of rows) {
      const raw = String(row.chapter ?? "").trim();
      if (!raw) continue;
      const term = toPresentedTerm(raw, "chapter");
      if (!term) continue;
      // Never surface unresolved mojibake chips (à¤… / OCR-lookalike äèµ…).
      if (looksLikeUnresolvedMojibake(term.displayName)) continue;
      // Dedupe clean + corrupt + em-dash/hyphen variants of the same chapter.
      const key = academicMatchKey(term.displayName) || term.displayName.toLowerCase();
      if (!key) continue;
      const existing = seen.get(key);
      if (!existing) {
        // Prefer a clean Devanagari/Latin DB id so session filters hit repaired rows.
        seen.set(key, {
          id: isCleanAcademicLabel(raw) ? raw : term.displayName,
          displayName: term.displayName,
        });
        continue;
      }
      if (!isCleanAcademicLabel(existing.id) && isCleanAcademicLabel(raw)) {
        seen.set(key, { id: raw, displayName: term.displayName });
      }
    }
    return [...seen.values()].sort((a, b) => a.displayName.localeCompare(b.displayName, "hi"));
  },

  /**
   * The topics a student can practise in a subject (+ optional chapter), from
   * the questions their class, board and stream can actually be served.
   *
   * `id` is the topic's id and is what listBankQuestions filters on. Topics are
   * per chapter, so without a chapter the same name can appear once per
   * chapter that teaches it — the chapter is then part of the label, never
   * merged away. `chapter` is carried so a caller that started from a topic can
   * name the session's chapter.
   */
  async listBankTopics(
    ctx: ServiceContext,
    opts: { subject: string; chapter?: string | null; classLevel?: number | null },
  ): Promise<(AcademicTermRef & { chapter: string | null })[]> {
    assertCanConsume(ctx, "practice");
    const client = getClient(toRepoContext(ctx));
    const scope = await this.resolveCurriculumScope(ctx);
    const classLevel = opts.classLevel ?? scope.classLevel;

    if (!scope.examId && (classLevel == null || !Number.isFinite(classLevel))) return [];
    if (!scope.examId && !isSubjectAllowedForScope(opts.subject, scope.stream, classLevel)) return [];

    // Paged: a whole subject can hold more servable questions than one
    // PostgREST response, and a truncated read would silently hide topics.
    const PAGE = 1000;
    const rows: { topic_id: string | null; chapter: string | null; topics: { name: string } | null }[] = [];
    for (let from = 0; ; from += PAGE) {
      let query = client
        .from("question_bank_student")
        .select("topic_id, chapter, topics(name)")
        .eq("is_approved", true)
        .eq("is_active", true)
        .ilike("subject", opts.subject)
        .not("topic_id", "is", null)
        .order("id")
        .range(from, from + PAGE - 1);
      const topicStream = contentStreamForClass(scope.stream, classLevel);
      if (scope.examId) {
        query = query.eq("exam_id", scope.examId);
      } else {
        query = query
          .eq("class_level", classLevel!)
          .is("exam_id", null)
          .or(`board.eq.${scope.board},board.eq.both,board.is.null`);
        if (topicStream) {
          query = query.or(`stream.eq.${topicStream},stream.is.null`);
        }
      }
      const { data, error } = await query;
      throwIfError(error, "Failed to load practice topics");
      const page = (data ?? []) as unknown as typeof rows;
      rows.push(...page);
      if (page.length < PAGE) break;
    }

    const seen = new Map<string, AcademicTermRef & { chapter: string | null }>();
    for (const r of rows) {
      if (!r.topic_id || !r.topics?.name || seen.has(r.topic_id)) continue;
      // The chapter is a chip from listBankChapters — a label of this bank — so
      // it is that chapter exactly: "Circles" is not "Areas Related to Circles".
      if (opts.chapter && !academicLabelEquals(r.chapter, opts.chapter)) continue;
      const chapterLabel = r.chapter ? displayChapter(r.chapter) || r.chapter : null;
      seen.set(r.topic_id, {
        id: r.topic_id,
        displayName: opts.chapter || !chapterLabel ? r.topics.name : `${r.topics.name} · ${chapterLabel}`,
        chapter: r.chapter,
      });
    }
    return [...seen.values()].sort((a, b) => a.displayName.localeCompare(b.displayName, "hi"));
  },

  /** Weak concepts from concept_mastery (honest empty if none tracked). */
  async listWeakConcepts(
    ctx: ServiceContext,
    opts: {
      threshold?: number;
      limit?: number;
      /**
       * "weighted" (default) reads the legacy mastery_score, so Recovery /
       * Revision / Nova keep their existing numbers untouched.
       * "simple" reads the Practice Engine's V1 confidence classification.
       * Both live on concept_mastery — there is only ever one confidence table.
       */
      source?: "simple" | "weighted";
    } = {},
  ): Promise<Array<{
    subject: string;
    chapter: string | null;
    concept: string;
    concept_label: string;
    mastery_score: number;
  }>> {
    assertCanConsume(ctx, "practice");

    // Decision Engine Slice 1 swap-in -- only for the "simple" (Practice
    // Engine V1) path, behind an explicit, default-off flag. The
    // "weighted" path below (legacy mastery_score, read by contextApis.ts)
    // is completely untouched -- the flag has zero effect on it.
    if (opts.source === "simple" && DECISION_ENGINE_FEATURE_FLAGS.weakAreasV2) {
      return loadWeakConceptsFromDecisionEngineV2(ctx, opts.limit ?? 12);
    }
    void emitEventBestEffort(toRepoContext(ctx), {
      eventType: "practice.weak_areas.path_used",
      entityType: "practice",
      studentId: ctx.studentId ?? null,
      payload: { path: "v1" },
    });

    // Align with EIE / Nova / Recovery: mastery < WEAK_CONCEPT_THRESHOLD.
    const threshold = opts.threshold ?? WEAK_CONCEPT_THRESHOLD;
    const limit = opts.limit ?? 12;
    // confidence_score/classification only exist once the Practice Engine
    // migration is applied. Fall back to the legacy weighted score rather
    // than erroring, so Weak Areas Practice still works either way.
    const useSimple = opts.source === "simple" && confidenceAvailable !== false;
    const client = getClient(toRepoContext(ctx));
    const scoreColumn = useSimple ? "confidence_score" : "mastery_score";
    const runQuery = (simple: boolean) => {
      let q = client
        .from("concept_mastery")
        .select(`subject, chapter, concept, ${simple ? "confidence_score" : "mastery_score"}`)
        .eq("user_id", ctx.userId);
      q = simple ? q.eq("classification", "weak") : q.lt("mastery_score", threshold);
      return q.order(simple ? "confidence_score" : "mastery_score", { ascending: true }).limit(limit);
    };
    let { data, error } = await runQuery(useSimple);
    if (error && useSimple && isMissingSchema(error)) {
      confidenceAvailable = false;
      ({ data, error } = await runQuery(false));
    } else if (!error && opts.source === "simple") {
      confidenceAvailable = true;
    }
    throwIfError(error, "Failed to load weak concepts");
    const effectiveScoreColumn =
      useSimple && confidenceAvailable !== false ? scoreColumn : "mastery_score";
    const scope = await this.resolveCurriculumScope(ctx);
    return (data ?? [])
      .map((r) => {
        const subjectRaw = String((r as { subject: string }).subject ?? "");
        const chapterRaw = (r as { chapter?: string | null }).chapter ?? null;
        const conceptRaw = String((r as { concept: string }).concept ?? "");
        return {
          subjectRaw,
          chapterRaw,
          conceptRaw,
          // Keep raw concept for mastery keys / filters; callers should display via displayConcept.
          subject: displaySubject(subjectRaw) || subjectRaw,
          chapter:
            chapterRaw && !isPlaceholderAcademicLabel(chapterRaw)
              ? displayChapter(chapterRaw)
              : null,
          concept: conceptRaw,
          concept_label: displayConcept(conceptRaw),
          // Whichever column was actually selected; callers treat this as "the score".
          mastery_score:
            Number(
              (r as Record<string, unknown>)[effectiveScoreColumn] as number | undefined,
            ) || 0,
        };
      })
      .filter(
        (r) =>
          r.subject &&
          r.concept &&
          !isPlaceholderAcademicLabel(r.subjectRaw) &&
          !isPlaceholderAcademicLabel(r.conceptRaw) &&
          isSubjectAllowedForScope(r.subject, scope.stream, scope.classLevel),
      )
      .map(({ subjectRaw: _s, chapterRaw: _c, conceptRaw: _k, ...row }) => row);
  },

  /**
   * Question ids in a given state, newest first.
   *
   * Chunk 7B. This used to read question_records.current_status, which stored
   * 'correct' as well as 'wrong' — a per-question record of correct answers,
   * which the storage rule forbids outright. That table is retired.
   *
   * The status union no longer admits "correct". No caller ever asked for it,
   * and now none can: the storage rule is enforced by the type, not by a
   * convention someone has to remember.
   *
   * Wrong lives in student_mistakes (the nominated mistake book). The Mistake
   * Book is still self-clearing — a question leaves it when the mistake is
   * cleared, which is the same behaviour current_status gave, without
   * recording correctness to get it.
   *
   * ── SKIPPED READS question_attempts, NOT practice_skipped ─────────────────
   *
   * 7B batch 1 created practice_skipped, carried the historical rows across
   * from question_records, and in the same migration stripped the
   * `PERFORM public._upsert_question_record(...)` call out of
   * rpc_record_question_attempt and dropped the function. That call was the
   * only thing that had ever written a skip. practice_skipped was left with
   * one reader (this function) and NO writer, so "Skipped Questions" could
   * only ever return skips made before 2026-08-28 — the mode was dead for
   * every skip since.
   *
   * question_attempts is where a skip actually lands, and always has:
   * rpc_record_question_attempt forces `skipped = true` (with is_correct
   * false and score 0) for a skip or a timeout, on both the bank and the
   * template path. It is the authority, and practice_skipped was a second
   * home for the same fact that never got filled. So the reader moves to the
   * authority rather than a writer being added to the duplicate — see the
   * migration that drops practice_skipped.
   *
   * Reading `skipped = true` surfaces no correctness, so §10.8 is untouched.
   * Skips are now resolved on the server (rpc_my_skipped_questions): a
   * question counts while its LATEST answer is a skip, which needs DISTINCT
   * ON — PostgREST has none — and must match what Analysis counts.
   */
  async listQuestionIdsByStatus(
    ctx: ServiceContext,
    status: "wrong" | "skipped",
    opts: { limit?: number; chapterId?: string | null } = {},
  ): Promise<string[]> {
    assertCanConsume(ctx, "practice");
    const limit = Math.min(200, Math.max(1, opts.limit ?? 60));
    const client = getClient(toRepoContext(ctx));
    if (status === "skipped") {
      // ONE definition of "a question you skipped", on the server: its LATEST
      // answer by this student was a skip. This read every skipped row, so a
      // question skipped once and answered since came back in Skipped mode,
      // and Analysis's "you skipped 6 questions in this chapter" would have
      // opened a session of more. rpc_student_chapter_analysis counts from
      // the same function.
      const { data, error } = await client.rpc("rpc_my_skipped_questions" as never, {
        _chapter_id: opts.chapterId ?? null,
        _limit: limit,
      } as never);
      throwIfError(error, "Failed to load skipped questions");
      return Array.isArray(data) ? (data as unknown[]).filter((id): id is string => typeof id === "string") : [];
    }
    const { data, error } = await client
      .from("student_mistakes")
      .select("question_id, last_wrong_at")
      .eq("user_id", ctx.userId)
      .eq("status", "open")
      .not("question_id", "is", null)
      .order("last_wrong_at", { ascending: false })
      .limit(limit);
    throwIfError(error, "Failed to load wrong questions");
    const ids = (data ?? [])
      .map((r) => (r as { question_id?: string | null }).question_id)
      .filter((id): id is string => Boolean(id));
    return dedupePreservingOrder(ids).slice(0, limit);
  },

  /**
   * Wrong questions as practice-ready rows (honest empty if none).
   *
   * Spec §9 / Incorrect mode: bank mistakes load from question_bank; upload
   * mistakes (source=upload) load from student_upload_questions; screen-capture
   * mistakes (source=screen_capture) load from student_capture_questions.
   * Never invents a question that is not on the mistake row or a private table.
   */
  async listMistakeQuestions(
    ctx: ServiceContext,
    opts: { limit?: number; includeInactive?: boolean } = {},
  ) {
    assertCanConsume(ctx, "practice");
    const limit = Math.min(90, Math.max(1, opts.limit ?? 20));
    const client = getClient(toRepoContext(ctx));
    const fetchWindow = Math.min(200, Math.max(limit * 4, limit));

    type MistakeListRow = {
      id: string;
      source: string;
      source_id: string | null;
      question_id: string | null;
      upload_question_id?: string | null;
      capture_question_id?: string | null;
      last_wrong_at: string;
      question_text: string;
      options: unknown;
      correct_answer: unknown;
      explanation: string | null;
      difficulty: string | null;
      subject: string;
      chapter: string | null;
      chapter_id: string | null;
    };

    const baseSelect =
      "id, source, source_id, question_id, last_wrong_at, question_text, options, correct_answer, explanation, difficulty, subject, chapter, chapter_id";
    const withPrivateSelect = `${baseSelect}, upload_question_id, capture_question_id`;
    const withUploadSelect = `${baseSelect}, upload_question_id`;

    const runSelect = (cols: string) =>
      client
        .from("student_mistakes")
        .select(cols)
        .eq("user_id", ctx.userId)
        .eq("status", "open")
        .order("last_wrong_at", { ascending: false })
        .limit(fetchWindow);

    let { data, error } = await runSelect(withPrivateSelect);
    if (error && isMissingSchema(error)) {
      ({ data, error } = await runSelect(withUploadSelect));
    }
    if (error && isMissingSchema(error)) {
      ({ data, error } = await runSelect(baseSelect));
    }
    throwIfError(error, "Failed to load mistake questions");

    const rows = (data ?? []) as unknown as MistakeListRow[];
    if (rows.length === 0) return [];

    const bankIds = dedupePreservingOrder(
      rows
        .filter(
          (r) =>
            r.source !== "upload" &&
            r.source !== "screen_capture" &&
            Boolean(r.question_id),
        )
        .map((r) => r.question_id as string),
    );
    const uploadQids = dedupePreservingOrder(
      rows
        .filter((r) => r.source === "upload")
        .map((r) => r.upload_question_id)
        .filter((id): id is string => Boolean(id)),
    );
    const captureQids = dedupePreservingOrder(
      rows
        .filter((r) => r.source === "screen_capture")
        .map((r) => r.capture_question_id)
        .filter((id): id is string => Boolean(id)),
    );

    /** PostgREST may return a many-embed as an array — same helper as upload/capture loaders. */
    const chapterEmbed = (raw: unknown): {
      name?: string;
      curriculum_subjects?: { name?: string } | null;
    } | null => {
      if (!raw) return null;
      if (Array.isArray(raw)) {
        const first = raw[0];
        return first && typeof first === "object"
          ? (first as { name?: string; curriculum_subjects?: { name?: string } | null })
          : null;
      }
      if (typeof raw === "object") {
        return raw as { name?: string; curriculum_subjects?: { name?: string } | null };
      }
      return null;
    };

    type PracticeReady = {
      id: string;
      subject: string;
      chapter: string | null;
      difficulty: string | null;
      question: string;
      options: unknown;
      correct_index: number;
      explanation: string | null;
      from_upload?: true;
      from_capture?: true;
      ai_answered?: boolean;
      chapter_id?: string | null;
      /** Spec §9.1 — student_uploads.id when from_upload. */
      upload_id?: string | null;
    };

    const bankById = new Map<string, PracticeReady>();
    if (bankIds.length > 0) {
      const bankRows = await this.listBankQuestions(ctx, {
        ids: bankIds.slice(0, fetchWindow),
        limit: fetchWindow,
        includeInactive: opts.includeInactive,
      });
      for (const q of bankRows) bankById.set(q.id, q);
    }

    const uploadById = new Map<string, PracticeReady>();
    if (uploadQids.length > 0) {
      const { data: uploadRows, error: uploadError } = await client
        .from("student_upload_questions")
        .select(
          "id, upload_id, question_text, options, correct_index, explanation, difficulty, chapter_id, answer_source, chapters(name, curriculum_subjects(name))",
        )
        .eq("owner_id", ctx.userId)
        .in("id", uploadQids);
      throwIfError(uploadError, "Failed to load upload mistake questions");
      for (const row of uploadRows ?? []) {
        const ch = chapterEmbed(row.chapters);
        const options = row.options;
        const correct =
          typeof row.correct_index === "number" && Number.isInteger(row.correct_index)
            ? row.correct_index
            : null;
        if (!row.id || !row.question_text || correct == null) continue;
        if (!Array.isArray(options) || options.length < 2) continue;
        uploadById.set(row.id as string, {
          id: row.id as string,
          subject: ch?.curriculum_subjects?.name?.trim() || "",
          chapter: ch?.name ?? null,
          difficulty: (row.difficulty as string | null) ?? "medium",
          question: row.question_text as string,
          options,
          correct_index: correct,
          explanation: (row.explanation as string | null) ?? null,
          from_upload: true,
          ai_answered: row.answer_source === "ai",
          chapter_id: (row.chapter_id as string | null) ?? null,
          upload_id: (row.upload_id as string | null) ?? null,
        });
      }
    }

    // Spec §7.4 / Incorrect mode — one loader for private captures (same as
    // recovery tier-0 in Practice.tsx). Do not re-query student_capture_questions
    // here; listCaptureQuestionsByIds owns embed shape + from_capture.
    const captureById = new Map<string, PracticeReady>();
    if (captureQids.length > 0) {
      const captureRows = await listCaptureQuestionsByIds(ctx, captureQids);
      for (const row of captureRows) {
        captureById.set(row.id, {
          id: row.id,
          subject: row.subject?.trim() || "",
          chapter: row.chapter,
          difficulty: row.difficulty ?? "medium",
          question: row.question,
          options: row.options,
          correct_index: row.correct_index as number,
          explanation: row.explanation,
          from_capture: true,
          chapter_id: row.chapter_id,
        });
      }
    }

    const snapshotPrivate = (
      r: MistakeListRow,
      kind: "upload" | "capture",
    ): PracticeReady | null => {
      const options = r.options;
      if (!Array.isArray(options) || options.length < 2) return null;
      const correct = answerToIndex(r.correct_answer, options);
      if (correct == null || !r.question_text?.trim()) return null;
      const id =
        kind === "upload"
          ? r.upload_question_id || r.id
          : r.capture_question_id || r.id;
      return {
        id,
        subject: r.subject || "",
        chapter: r.chapter,
        difficulty: r.difficulty ?? "medium",
        question: r.question_text,
        options,
        correct_index: correct,
        explanation: r.explanation,
        ...(kind === "upload"
          ? {
              from_upload: true as const,
              ai_answered: false,
              // Mistake source_id is the upload id when the original attempt followed §9.1.
              upload_id: r.source_id,
            }
          : { from_capture: true as const }),
        chapter_id: r.chapter_id,
      };
    };

    const out: PracticeReady[] = [];
    const seenBank = new Set<string>();
    const seenUpload = new Set<string>();
    const seenCapture = new Set<string>();
    for (const r of rows) {
      if (out.length >= limit) break;
      if (r.source === "upload") {
        const uqid = r.upload_question_id ?? null;
        if (uqid && uploadById.has(uqid)) {
          if (seenUpload.has(uqid)) continue;
          seenUpload.add(uqid);
          out.push(uploadById.get(uqid)!);
          continue;
        }
        const snap = snapshotPrivate(r, "upload");
        if (!snap) continue;
        if (seenUpload.has(snap.id)) continue;
        seenUpload.add(snap.id);
        out.push(snap);
        continue;
      }
      if (r.source === "screen_capture") {
        const cqid = r.capture_question_id ?? null;
        if (cqid && captureById.has(cqid)) {
          if (seenCapture.has(cqid)) continue;
          seenCapture.add(cqid);
          out.push(captureById.get(cqid)!);
          continue;
        }
        const snap = snapshotPrivate(r, "capture");
        if (!snap) continue;
        if (seenCapture.has(snap.id)) continue;
        seenCapture.add(snap.id);
        out.push(snap);
        continue;
      }
      if (!r.question_id || !bankById.has(r.question_id)) continue;
      if (seenBank.has(r.question_id)) continue;
      seenBank.add(r.question_id);
      out.push(bankById.get(r.question_id)!);
    }
    return out;
  },

  /** Previously skipped questions (honest empty if none). */
  async listSkippedBankQuestions(
    ctx: ServiceContext,
    opts: { limit?: number; chapterId?: string | null } = {},
  ) {
    const limit = Math.min(90, Math.max(1, opts.limit ?? 20));
    const ids = await this.listQuestionIdsByStatus(ctx, "skipped", { limit: limit * 2, chapterId: opts.chapterId });
    if (ids.length === 0) return [];
    return this.listBankQuestions(ctx, { ids: ids.slice(0, limit), limit });
  },

  /** Bookmarked questions. Bookmarks are permanent and independent of status. */
  async listBookmarkedQuestions(
    ctx: ServiceContext,
    opts: { limit?: number; includeInactive?: boolean } = {},
  ) {
    assertCanConsume(ctx, "practice");
    const limit = Math.min(90, Math.max(1, opts.limit ?? 20));
    const client = getClient(toRepoContext(ctx));
    const { data, error } = await client
      .from("practice_bookmarks")
      .select("question_id")
      .eq("user_id", ctx.userId)
      .order("created_at", { ascending: false })
      .limit(limit * 2);
    throwIfError(error, "Failed to load bookmarked questions");
    const ids = (data ?? [])
      .map((r) => (r as { question_id: string }).question_id)
      .filter(Boolean);
    if (ids.length === 0) return [];
    return this.listBankQuestions(ctx, {
      ids: ids.slice(0, limit),
      limit,
      includeInactive: opts.includeInactive,
    });
  },

  /**
   * Add or remove a bookmark. Only the student changes this — answering
   * correctly must never clear it.
   */
  async toggleBookmark(
    ctx: ServiceContext,
    questionId: string,
    bookmarked: boolean,
  ): Promise<void> {
    assertCanOwn(ctx, "practice_attempt");
    const client = getClient(toRepoContext(ctx));
    const { error } = await client.rpc("rpc_toggle_question_bookmark", {
      _question_id: questionId,
      _bookmarked: bookmarked,
    });
    if (error) {
      if (isMissingSchema(error)) {
        throw new Error("Bookmarks aren't available yet — this school hasn't updated to the new Practice Engine.");
      }
      throwIfError(error, "Failed to update bookmark");
    }
  },
  /** Approved bank questions for student practice sessions (honest empty if none). */
  async listBankQuestions(
    ctx: ServiceContext,
    opts: {
      subject?: string | null;
      chapter?: string | null;
      /**
       * A topic: its id (what listBankTopics offers — exact, and per chapter),
       * or its NAME (what a /student/practice?topic= link carries).
       */
      topic?: string | null;
      difficulty?: string | null;
      classLevel?: number | null;
      limit?: number;
      pyqOnly?: boolean;
      /** Previous Year Questions — restrict to a single exam year. */
      examYear?: number | null;
      ids?: string[];
      /**
       * Weak-area mode: each target is a chapter, or a topic NAMED within its
       * chapter (concept_mastery keys a topic by its name inside the chapter).
       */
      weakTargets?: Array<{ subject?: string; chapter?: string | null; concept?: string }>;
      /**
       * Include soft-deleted (is_active=false) questions. Only for historical
       * views such as the Mistake Book — never for generating new practice.
       */
      includeInactive?: boolean;
    } = {},
  ) {
    assertCanConsume(ctx, "practice");
    const client = getClient(toRepoContext(ctx));
    const limit = Math.min(90, Math.max(1, opts.limit ?? 20));
    const scope = await this.resolveCurriculumScope(ctx);
    const classLevel = opts.classLevel ?? scope.classLevel;

    // Never dump all classes when class cannot be resolved (unless fetching by id
    // or practising under an exam account).
    const byIds = opts.ids && opts.ids.length > 0;
    if (!byIds && !scope.examId && (classLevel == null || !Number.isFinite(classLevel))) {
      return [];
    }
    if (
      !scope.examId &&
      opts.subject &&
      opts.subject !== "Mixed" &&
      !isSubjectAllowedForScope(opts.subject, scope.stream, classLevel)
    ) {
      return [];
    }

    // ── THE CHAPTER FILTER MUST REACH THE DATABASE TOO ──────────────────
    //
    // Same defect the weakTargets block below was fixed for, in the same
    // function, left in place for ordinary chapter practice. The chapter was
    // matched ONLY client-side, over a window capped at
    // min(400, max(80, limit * 8)) rows — so the query was "any approved
    // question for this class, board and subject", and the chapter was picked
    // out of whatever came back.
    //
    // Measured on production 2026-09-15, driving the real app in a browser as
    // arjun.mehta (Class 10, rbse) and opening Arithmetic Progressions:
    //
    //     questions in that class/board/subject pool ....... 569
    //     questions in Arithmetic Progressions ............. 43
    //     of those, inside the 160-row window .............. 3
    //
    // The screen said "No questions for this chapter in the bank yet" for a
    // chapter holding 43 of them. And because PostgREST returns no guaranteed
    // order without an ORDER BY, the same tap can return 3, 0 or 20 — so the
    // failure is intermittent, which is why it survived.
    //
    // Pushed down case-insensitively. The client-side pass further down is
    // still the precision filter; this only guarantees the window it filters
    // actually contains candidates.
    //
    // A COMMA IS PART OF A CHAPTER'S NAME, NOT A LIST SEPARATOR. This was a
    // raw `or(chapter.ilike.<name>)` string, and PostgREST's or() is comma and
    // parenthesis delimited — so any chapter carrying one had to be dropped
    // from the narrowing rather than change the shape of the filter. Five
    // chapters in the live bank carry commas ("Acids, Bases and Salts",
    // "Work, Energy and Power", "Gender, Religion and Caste", "Depreciation,
    // Provisions and Reserves", "Private, Public and Global Enterprises"), and
    // every session on one of them read the whole subject and left the client
    // pass to decide. `.ilike()` takes the value as a value, so the comma is
    // just a character and the narrowing applies to every chapter.
    //
    // Only `chapter` is narrowed here: it is the one real label COLUMN. The
    // topic lives on the embedded topics row (topic_id -> topics.name) and is
    // narrowed separately below — question_bank has no `topic`, `concept` or
    // `topic_group` column (20261020010000), and naming one fails the whole
    // request with 42703, which is how practice once stopped starting.
    const chapterFilter = chapterFilterOf(opts.chapter);

    /**
     * The topic, narrowed IN THE DATABASE — never picked out of a window.
     *
     * Topic practice can be started without a chapter (its start button is
     * gated on subject + topic only), so chapter narrowing does not help it,
     * and the fetch window is 400 rows against banks that are bigger than
     * that: Mathematics class 12 holds 695 approved questions over 125 topics,
     * Social Science class 10 holds 953. A topic in the unfetched remainder
     * came back empty and the screen said "No questions for this topic in the
     * bank yet", which was false.
     *
     * Two shapes reach here, and each is narrowed the way it can be:
     *
     *   an ID    from the topic picker. topic_id = id. Exact: topics are per
     *            chapter (§10.22), so the id is one chapter's topic and never
     *            a same-named topic of another chapter. Applied on every pass,
     *            because an id cannot be a mojibake or slugged spelling.
     *
     *   a NAME   from a ?topic= link. topics!inner(name) + topics.name=ilike
     *            filters the PARENT rows by the embedded relation (an inner
     *            join, so rows with no topic drop out — right, since they
     *            cannot be in a named topic). When the link also names a
     *            chapter, the chapter narrows it to that chapter's topic. A
     *            name that matches no topic narrows to zero rows, and the
     *            un-narrowed retry below runs, where the client pass still
     *            accepts a value that is really a chapter name.
     */
    const topicId = topicIdOf(opts.topic);
    const topicName = topicNameOf(opts.topic);

    // ── THE WHOLE POOL, NOT A WINDOW OF IT ─────────────────────────────────
    //
    // This query used to ask for min(400, limit x 8) FULL rows with no order,
    // and the session was drawn from whatever came back. PostgREST returns an
    // unordered read in the same physical order every time, so it was the SAME
    // rows on every request. Measured 2026-09-18 as the Class 10 student:
    //
    //     Subject Practice, Social Science, 20 questions
    //         -> the same 160 of 953 questions, every session
    //     Custom Practice, all subjects, 10 questions
    //         -> an 80-row window of 62 English, 11 Maths, 0 Social Science,
    //            0 Hindi: "all subjects" meant English
    //
    // So the pool is read whole: the light columns the filters below need,
    // paged in id order, every question the filters admit. The session is
    // drawn from all of it, and the questions themselves are fetched only for
    // the ones drawn.
    const buildQuery = (applyActiveFilter: boolean, narrowToLabels: boolean, withCount = false) => {
      const narrowTopicName = narrowToLabels && !byIds && topicName !== null;
      let query = studentBankQuery(
        client,
        `id, subject, chapter, topic_id, topics${narrowTopicName ? "!inner" : ""}(name)`,
        scope,
        classLevel,
        { subject: opts.subject, activeOnly: applyActiveFilter, withCount, previousYearOnly: opts.pyqOnly },
      );
      if (byIds) {
        query = query.in("id", opts.ids!);
      }
      // The chapter NARROWS; the client-side pass below is still what decides.
      // Skipped on the fallback pass so a chapter stored under a mojibake or
      // slugged label is still reachable the way it was before.
      if (narrowToLabels && !byIds && chapterFilter) {
        query = query.ilike("chapter", chapterFilter);
      }
      if (topicId && !byIds) {
        query = query.eq("topic_id", topicId);
      }
      // Applies to the embedded relation, which the !inner above turns into a
      // filter on the parent rows rather than just on what is nested.
      if (narrowTopicName) {
        query = query.ilike("topics.name", topicName!);
      }
      if (opts.difficulty && opts.difficulty !== "mixed") {
        query = query.eq("difficulty", opts.difficulty);
      }
      // ── WEAK AREAS: the filter must reach the DATABASE ──────────────────
      //
      // weakTargets used to be matched ONLY client-side, over whatever this
      // query happened to return. With no chapter or concept predicate the
      // query is "every approved active question for this class and board",
      // capped at 400 of 21,681 — an arbitrary window that almost never
      // contained the handful of questions matching a given student's weak
      // concepts. The mode then loaded nothing.
      //
      // Measured on production before this fix: the busiest student had 16
      // finished sessions, 14 of them practice_mode 'weak' with ZERO attempts
      // — 20-question shells auto-finished at 0% because the loader came back
      // empty. Those zeros were then averaged into Analysis.
      //
      // So the targets' chapters are pushed down. A weak topic is always held
      // with its chapter, so the chapter narrows the window to rows that can
      // match; the client-side pass below then picks the topic by name INSIDE
      // that chapter, which is where the name is unique.
      //
      // Pushed down only when it cannot drop a target: chapters when every
      // target has one, topic names when none does. A mixed list is left to
      // the client-side pass rather than narrowed in a way that loses half.
      if (opts.weakTargets && opts.weakTargets.length > 0) {
        //
        // `.in()` rather than a hand-built in.() string: the client library
        // quotes values holding commas and parentheses ("Areas Related to
        // Circles"), which a hand-built list had to remember to do itself.
        const withChapter = opts.weakTargets.filter((w) => Boolean(w.chapter));
        if (withChapter.length === opts.weakTargets.length) {
          query = query.in("chapter", Array.from(new Set(withChapter.map((w) => w.chapter as string))));
        } else if (withChapter.length === 0) {
          const names = Array.from(
            new Set(opts.weakTargets.map((w) => w.concept).filter((c): c is string => Boolean(c))),
          );
          if (names.length) query = query.in("topics.name", names).not("topics", "is", null);
        }
      }
      if (opts.examYear != null && Number.isFinite(opts.examYear)) {
        query = query.eq("exam_year", opts.examYear);
      }
      return query;
    };

    /** Every row the filters admit, up to POOL_CAP (readAllPages). */
    const readPool = (applyActiveFilter: boolean, narrowToLabels: boolean) =>
      readAllPages<{ id: string }>((withCount) => buildQuery(applyActiveFilter, narrowToLabels, withCount));

    // Retired (is_active = false) questions are left out unless a historical
    // view asks for them. The column is always there; the probe that once
    // guarded against it not being migrated yet is gone.
    const applyActiveFilter = !opts.includeInactive;
    const first = await readPool(applyActiveFilter, true);
    const error = first.error;
    let data = first.data;
    // A narrowed query that found nothing is retried WITHOUT the label
    // predicate. The predicate is an exact (case-insensitive) match, and this
    // bank holds slugged and mojibake-encoded labels that only
    // academicLabelMatches can resolve — so the narrowing must never be the
    // thing that makes a chapter unreachable. One extra round trip, and only
    // on the path that would otherwise have shown an empty screen.
    if (!error && (data?.length ?? 0) === 0 && !byIds && (chapterFilter || topicName)) {
      const retry = await readPool(applyActiveFilter, false);
      if (!retry.error) ({ data } = retry);
    }
    throwIfError(error, "Failed to load practice questions");
    type BankRow = {
      id: string;
      subject: string;
      chapter: string | null;
      topic_id: string | null;
      topics: { name: string | null } | null;
    };

    // The bank has ONE taxonomy label per question, and it arrives embedded:
    // every pass below reads `r.topics?.name` (and `r.topic_id` for an id).
    let rows = (data ?? []) as unknown as BankRow[];

    // Senior stream allowlists (commerce / science 11–12) — covers null-stream legacy rows.
    rows = rows.filter((r) => isSubjectAllowedForScope(r.subject, scope.stream, classLevel));

    // EQUAL CHAPTERS, NEVER ONE INSIDE THE OTHER.
    //
    // academicLabelMatches falls back to containment either way, which is the
    // same defect the weak targets below were fixed for. Measured over the
    // live bank on 2026-09-23, chapters of the SAME class and subject that
    // contain one another — 34 ordered pairs, including:
    //
    //   Circles          <- Areas Related to Circles          (Maths 10)
    //   Triangles        <- Areas of Parallelograms and Triangles (Maths 9)
    //   Integrals        <- Application of Integrals           (Maths 12)
    //   Motion           <- Force and Laws of Motion           (Science 9)
    //   Resources        <- Human Resources, Mineral and Power Resources,
    //                       Land Soil Water Natural Vegetation and Wildlife
    //                       Resources                          (Social 8)
    //   Introduction     <- Introduction to Macroeconomics     (Economics 12)
    //
    // The database narrowing hid most of it — an exact ilike returns only the
    // chapter asked for — but the fallback pass has no narrowing, and until
    // today neither did any chapter carrying a comma. Equality still resolves
    // a slug, a mojibake spelling or an alias (academicMatchKey), which is
    // what the fallback is for; it just refuses a different chapter.
    if (opts.chapter) {
      rows = rows.filter((r) => academicLabelEquals(r.chapter, opts.chapter));
    }
    if (topicId) {
      rows = rows.filter((r) => r.topic_id === topicId);
    } else if (opts.topic) {
      // A name: the topic's own name, or — from an old link — a chapter name.
      // A TOPIC is matched loosely on purpose (an old link may carry a
      // shortened or differently-punctuated name), but a CHAPTER named here
      // is the same chapter or none.
      const needle = opts.topic;
      rows = rows.filter((r) =>
        academicLabelMatches(r.topics?.name ?? null, needle) ||
        academicLabelEquals(r.chapter, needle),
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
          if (!w.chapter && !w.concept) return true;
          // Equal labels, never one inside the other. A containment match let
          // the weak topic "Areas of Similar Triangles" stand for its chapter
          // "Triangles", and every Triangles question into the session with it
          // (4 of the school's 31 weak topics contain their chapter's name).
          if (w.chapter && !academicLabelEquals(r.chapter, w.chapter)) return false;
          // A weak topic is a name INSIDE its chapter: matched only there, so
          // "Journal Entries" weak in one chapter does not pull another's.
          if (w.concept) {
            return (
              academicLabelEquals(r.topics?.name ?? null, w.concept) ||
              // A mastery row with no topic of its own names its chapter.
              (!!w.chapter && academicLabelEquals(w.chapter, w.concept))
            );
          }
          return Boolean(w.chapter);
        }),
      );
    }

    // Draw the session from the whole pool (Fisher-Yates), so every question
    // the filters admit has the same chance of being asked.
    for (let i = rows.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [rows[i], rows[j]] = [rows[j], rows[i]];
    }
    const drawn = rows.slice(0, limit);
    if (drawn.length === 0) return [];

    // The questions themselves, for the ones drawn and no others — and NO ANSWER.
    //
    // correct_index and explanation used to be fetched here, and a student
    // could read them straight off question_bank anyway: measured 2026-09-22,
    // including `?correct_index=eq.2`, which enumerates the answers by
    // filtering on them. question_bank is staff-only now (20261049000000) and
    // question_bank_student has no such columns. Nothing here needed them to
    // grade: rpc_record_question_attempt grades every bank question server-side
    // and returns its verdict, which is what the feedback screen shows.
    const { data: full, error: fullError } = await client
      .from("question_bank_student")
      .select("id, difficulty, question, options")
      .in("id", drawn.map((r) => r.id));
    throwIfError(fullError, "Failed to load practice questions");
    type QuestionText = { id: string; difficulty: string | null; question: string; options: unknown };
    const text = new Map(((full ?? []) as QuestionText[]).map((q) => [q.id, q]));
    return drawn.flatMap((r) => {
      const q = text.get(r.id);
      if (!q) return [];
      return [{
        id: r.id,
        subject: displaySubject(r.subject) || r.subject,
        chapter: r.chapter ? displayChapter(r.chapter) : r.chapter,
        difficulty: q.difficulty,
        question: q.question,
        options: q.options,
      }];
    });
  },

  /**
   * How many questions a set of filters would actually serve.
   *
   * CUSTOM PRACTICE COULD BE CONFIGURED INTO A DEAD END. Subject, chapter,
   * topic and difficulty are each optional and each narrows the bank, and the
   * screen offered every combination of them — including the ones that hold
   * nothing. The student picked, pressed Start, waited for a session to load,
   * and got "No questions match those filters yet" on a screen they could
   * only leave. Measured on the live bank 2026-09-23: 4 of 237
   * chapter-and-difficulty pairs at Class 10 hold no question at all, and a
   * topic narrows it further again.
   *
   * So the config screen asks first. Same scope as the draw
   * (studentBankQuery) and the same chapter, topic and difficulty narrowing,
   * so what this counts is exactly what a session would draw from — a count
   * from a different query would be a second answer to the same question.
   *
   * It is a HEAD request: the count, never the rows.
   */
  async countBankPool(
    ctx: ServiceContext,
    opts: { subject?: string | null; chapter?: string | null; topic?: string | null; difficulty?: string | null } = {},
  ): Promise<number> {
    assertCanConsume(ctx, "practice");
    const scope = await this.resolveCurriculumScope(ctx);
    const classLevel = scope.classLevel;
    if (classLevel == null || !Number.isFinite(classLevel)) return 0;
    if (opts.subject && opts.subject !== "Mixed" && !isSubjectAllowedForScope(opts.subject, scope.stream, classLevel)) {
      return 0;
    }

    const topicId = topicIdOf(opts.topic);
    const topicName = topicNameOf(opts.topic);
    const chapter = chapterFilterOf(opts.chapter);

    let query = studentBankQuery(
      getClient(toRepoContext(ctx)),
      `id, topics${topicName ? "!inner" : ""}(name)`,
      scope,
      classLevel,
      { subject: opts.subject, activeOnly: true, withCount: true },
    );
    if (chapter) query = query.ilike("chapter", chapter);
    if (topicId) query = query.eq("topic_id", topicId);
    if (topicName) query = query.ilike("topics.name", topicName);
    if (opts.difficulty && opts.difficulty !== "mixed") query = query.eq("difficulty", opts.difficulty);

    const { count, error } = await query.range(0, 0);
    throwIfError(error, "Failed to count practice questions");
    return count ?? 0;
  },

  /**
   * The exam years Previous Year Questions can serve this student, newest
   * first, each with the number of questions it holds.
   *
   * Read off the same pool the session draws from (studentBankQuery, with the
   * same stream allowlist after it), so every year offered starts a session
   * with questions in it. The screen used to offer the last six calendar
   * years whatever the bank held: 0 of 21,876 questions carry an exam year
   * (KNOWN_ISSUES 57), so every one of those chips led to an empty session.
   * An empty list here means the bank holds no past papers for this student.
   */
  async listPyqYears(
    ctx: ServiceContext,
    opts: { subject?: string | null } = {},
  ): Promise<Array<{ year: number; count: number }>> {
    assertCanConsume(ctx, "practice");
    const scope = await this.resolveCurriculumScope(ctx);
    const classLevel = scope.classLevel;
    if (classLevel == null || !Number.isFinite(classLevel)) return [];
    if (opts.subject && opts.subject !== "Mixed" && !isSubjectAllowedForScope(opts.subject, scope.stream, classLevel)) {
      return [];
    }
    const client = getClient(toRepoContext(ctx));
    const { data, error } = await readAllPages<{ id: string; subject: string; exam_year: number | null }>((withCount) =>
      studentBankQuery(client, "id, subject, exam_year", scope, classLevel, {
        subject: opts.subject,
        activeOnly: true,
        withCount,
        previousYearOnly: true,
      }),
    );
    throwIfError(error, "Failed to load past-paper years");
    const byYear = new Map<number, number>();
    for (const r of data ?? []) {
      if (r.exam_year == null || !isSubjectAllowedForScope(r.subject, scope.stream, classLevel)) continue;
      byYear.set(r.exam_year, (byYear.get(r.exam_year) ?? 0) + 1);
    }
    return [...byYear.entries()].map(([year, count]) => ({ year, count })).sort((a, b) => b.year - a.year);
  },

  /** Clear student mistakes after a successful retry practice. */
  async completeMistakeRetry(
    ctx: ServiceContext,
    attempts: Array<{
      mistakeId: string;
      bankQuestionId?: string | null;
      subject: string;
      chapter?: string | null;
      concept?: string | null;
      questionText: string;
      options: string[];
      selectedIndex: number;
      correctIndex: number;
      explanation?: string | null;
      difficulty?: string | null;
    }>,
  ): Promise<{ score: number; clearedIds: string[]; sessionId: string | null; persisted: boolean }> {
    assertCanOwn(ctx, "practice");
    if (!attempts.length) return { score: 0, clearedIds: [], sessionId: null, persisted: false };
    const correctN = attempts.filter((a) => a.selectedIndex === a.correctIndex).length;
    // Chunk 10: one definition of accuracy. This one had no guard at all —
    // attempts.length of 0 gave NaN, which renders as "NaN%".
    const score = valueOr(sessionAccuracy(correctN, attempts.length), 0);
    const subjectRaw = attempts[0]?.subject?.trim() || "";
    const chapterRaw =
      attempts[0]?.chapter?.trim() ||
      attempts[0]?.concept?.trim() ||
      "";
    const subject =
      subjectRaw && !isPlaceholderAcademicLabel(subjectRaw) ? subjectRaw : "";
    const chapter =
      chapterRaw && !isPlaceholderAcademicLabel(chapterRaw) ? chapterRaw : null;
    if (!subject) {
      console.warn("mistake retry start: missing real subject");
      return { score, clearedIds: [], sessionId: null, persisted: false };
    }
    let sessionId: string | null = null;
    try {
      sessionId = (await this.start(ctx, {
        _subject: subject, _chapter: chapter, _count: attempts.length, _practice_mode: "incorrect",
      })) as string;
    } catch (e) {
      console.warn("mistake retry start:", e instanceof Error ? e.message : e);
      return { score, clearedIds: [], sessionId: null, persisted: false };
    }
    const finishPayload: Array<Record<string, unknown>> = [];
    for (const a of attempts) {
      const isCorrect = a.selectedIndex === a.correctIndex;
      const generatedQuestion = {
        question: a.questionText, options: a.options, bank_question_id: a.bankQuestionId ?? null,
        subject: a.subject, chapter: a.chapter ?? null, concept: a.concept ?? null,
        practice_mode: "incorrect", mistake_id: a.mistakeId,
      };
      // The SAME shape practice itself writes ({ index, text }), not the
      // legacy { correct_index } this used to send. Two writers disagreeing on
      // the key is how readers ended up guessing, and how the Mistake Book came
      // to mark every answer wrong. `selected_index` is kept alongside `index`
      // because that is exactly what the practice snapshot stores today, and
      // dropping it would break the readers that look for it.
      const selectedAnswer = {
        index: a.selectedIndex, selected_index: a.selectedIndex,
        text: a.options[a.selectedIndex] ?? "",
      };
      const correctAnswer = {
        index: a.correctIndex,
        text: Number.isInteger(a.correctIndex) ? a.options[a.correctIndex] ?? "" : "",
      };
      try {
        await this.recordAttempt(ctx, {
          sessionId, bankQuestionId: a.bankQuestionId ?? null, generatedQuestion, selectedAnswer, correctAnswer,
          isCorrect, score: isCorrect ? 1 : 0, subject: a.subject, chapter: a.chapter ?? undefined,
          concept: a.concept ?? undefined, difficulty: a.difficulty ?? undefined,
          practiceMode: "incorrect", source: "mistake_book", sourceId: a.mistakeId,
        });
      } catch (e) { console.warn("mistake retry attempt:", e instanceof Error ? e.message : e); }
      finishPayload.push({
        bank_question_id: a.bankQuestionId ?? null, selected_answer: selectedAnswer, correct_answer: correctAnswer,
        is_correct: isCorrect, score: isCorrect ? 1 : 0, generated_question: generatedQuestion,
        practice_mode: "incorrect", source_id: a.mistakeId,
      });
    }
    try {
      await this.finish(ctx, { _session_id: sessionId, _attempts: finishPayload });
    } catch (e) {
      console.warn("mistake retry finish:", e instanceof Error ? e.message : e);
      return { score, clearedIds: [], sessionId, persisted: false };
    }
    const clearedIds = score >= 70
      ? attempts.filter((a) => a.selectedIndex === a.correctIndex).map((a) => a.mistakeId) : [];
    if (clearedIds.length) await this.markMistakesCleared(ctx, clearedIds);
    return { score, clearedIds, sessionId, persisted: true };
  },

  async markMistakesCleared(ctx: ServiceContext, mistakeIds: string[]): Promise<void> {
    assertCanOwn(ctx, "practice");
    if (!mistakeIds.length) return;
    const { error } = await getClient(toRepoContext(ctx))
      .from("student_mistakes")
      .update({ status: "cleared", cleared_at: new Date().toISOString() })
      .eq("user_id", ctx.userId)
      .in("id", mistakeIds);
    throwIfError(error, "Failed to clear mistakes");
    broadcastAcademicWrite(ctx.schoolId, ["profile"], {
      studentId: ctx.studentId,
      source: "PracticeService.markMistakesCleared",
    });
  },
};
