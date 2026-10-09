/**
 * Writing new questions for one chapter — the one home of the pipeline every
 * chapter-writing path shares: AI Practice (a student's request, the owner's
 * ruling 2026-10-02) and chapter supply (a background run that fills a chapter
 * the bank cannot serve, TODO A2/B6).
 *
 *   1. Written in batches by the form asked for (aiPractice.writePlan, the
 *      writer told the rubric it will be judged by), each draft read and
 *      checked (readWrittenQuestion).
 *   2. A draft the bank already holds by meaning, or one already written in
 *      this run, is dropped before anything is paid to gate it — and the
 *      bank's twin is offered to the caller (onTwin), which may serve it.
 *   3. The rest pass the quality gate (questionGate.ts) a wave at a time,
 *      until enough are kept.
 *   4. Everything that passed is offered to the bank door
 *      (store_generated_questions) with its review — and nothing that did not
 *      pass ever is. Every draft gated is recorded in question_gate_outcomes.
 *
 * The model calls and the database come in as arguments (WriterDeps), so
 * questionWriter.test.ts runs the whole pipeline with no network;
 * questionWriterDb.ts is the database half the functions pass in.
 */
import type { Think } from "./answerCheck.ts";
import {
  cosine,
  type Difficulty,
  readModelJson,
  readTopicDraft,
  readWrittenQuestion,
  SAME_QUESTION_SIMILARITY,
  type StyleExample,
  topicDraftPrompt,
  type WrittenQuestion,
  writePlan,
  writeSystemPrompt,
  writeUserPrompt,
} from "./aiPractice.ts";
import { gateQuestion, type GateOutcome, type GateTally, tallyGate } from "./questionGate.ts";
import { type ChapterScope, type ReviewRecord, whyChapterNotWritten, type WrittenForm } from "./questionRubric.ts";

/**
 * Drafts gated at once. Each is two calls that reason first (completeThinking —
 * the check with reasoning off got correctly keyed Accountancy wrong,
 * question-explanations 2026-10-02): the solve and the review. Gating stops at
 * the first wave that leaves enough kept, so a request of 30 is two waves at
 * most and stays inside a function's 150 seconds.
 */
export const GATE_CONCURRENCY = 20;

export type Complete = (input: { system: string; user: string; temperature: number; max_tokens: number }) =>
  Promise<{ ok: true; text: string; finish_reason?: string | null } | { ok: false; error: string }>;
export type Embed = (text: string) => Promise<{ ok: true; embedding: number[] } | { ok: false }>;

export type Topic = { id: string; name: string };
export type Chapter = { chapter_id: string; chapter: string; subject: string };

/** One row of question_gate_outcomes (20261148000000). */
export type GateRecord = {
  writer: "ai_practice" | "chapter_supply";
  ref: string;
  exam_id: string;
  subject: string;
  chapter_id: string;
  topic_id: string;
  form: string;
  question: string;
  options: string[];
  correct_index: number;
  stage: "kept" | "rule" | "answer" | "review";
  reason: string | null;
  failed: string[];
  review: ReviewRecord | null;
  question_id: string | null;
};

export type StoreItem = {
  topic_id: string;
  exam_id: string;
  question: string;
  options: string[];
  correct_index: number;
  explanation: string;
  difficulty: string;
  source: string;
  quality_review: ReviewRecord;
};
export type StoreResult =
  | { ok: true; inserted: Array<{ index: number; id: string }>; skipped: Array<{ index: number; reason: string; existing_id?: string }> }
  | { ok: false; error: string };

export type WriterDb = {
  /** Up to three of the chapter's approved questions, in the form when one is asked, for the writer's sense of level and style. */
  examples(examId: string, chapterId: string, form: WrittenForm | null): Promise<StyleExample[]>;
  /** The bank's question of this exam and subject nearest the vector, when it is the same question. */
  twinOf(embedding: number[], examId: string, subject: string): Promise<string | null>;
  store(items: StoreItem[]): Promise<StoreResult>;
  record(rows: GateRecord[]): Promise<void>;
  topicsOf(chapterId: string): Promise<Topic[]>;
  /** The chapter's official syllabus in this exam, when it has one (20261149000000). */
  scopeOf(examId: string, chapterId: string): Promise<ChapterScope | null>;
  addTopic(chapterId: string, name: string): Promise<void>;
};

export type WriterDeps = { complete: Complete; think: Think; embed: Embed; model: string; db: WriterDb };

export type WriteRequest = {
  writer: GateRecord["writer"];
  /** What the bank row's source says produced it. */
  source: string;
  /** The gate record's ref: the AI Practice request, or the supply run. */
  ref: string;
  examId: string;
  examLabel: string;
  chapter: Chapter;
  topics: Topic[];
  topicId: string | null;
  focus: string;
  difficulty: Difficulty | null;
  form: WrittenForm | null;
  /** How many to write for. */
  shortfall: number;
  /** How many more are still wanted — gating stops once this many are kept. */
  stillNeeded: () => number;
  /** Questions not to write again. */
  avoid: string[];
  /** A draft the bank already holds: its question's id, which the caller may serve. */
  onTwin: (bankId: string) => void;
};

/** What became of the drafts, kept on an AI Practice request row (20261142000000, 20261148000000). */
export type DraftNotes = {
  batches: Array<Record<string, unknown>>;
  drafted: number;
  gated: number;
  kept: number;
  /** Why the bank door could not be reached, when it could not: what passed is then stored nowhere. */
  store_failed?: string;
};

export type WriteResult = {
  written: string[];
  discarded: number;
  notes: DraftNotes;
  gate: GateTally;
  /** Why nothing was written for this chapter at all (questionRubric.CHAPTERS_NOT_WRITTEN), or null. */
  notWritten: string | null;
};

const textKey = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();

/** A chapter's topics, drafted once when it has none (a written question is filed under one). */
export async function ensureTopics(deps: Pick<WriterDeps, "complete" | "db">, examLabel: string, chapter: Chapter): Promise<Topic[]> {
  const have = await deps.db.topicsOf(chapter.chapter_id);
  if (have.length) return have;
  const p = topicDraftPrompt(examLabel, chapter.subject, chapter.chapter);
  const drafted = await deps.complete({ system: p.system, user: p.user, temperature: 0, max_tokens: 400 });
  let names: string[] | null = null;
  if (drafted.ok) {
    try { names = readTopicDraft(readModelJson(drafted.text)); } catch { names = null; }
  }
  for (const name of names ?? []) await deps.db.addTopic(chapter.chapter_id, name);
  return deps.db.topicsOf(chapter.chapter_id);
}

export async function writeForChapter(deps: WriterDeps, req: WriteRequest): Promise<WriteResult> {
  const notes: DraftNotes = { batches: [], drafted: 0, gated: 0, kept: 0 };
  let discarded = 0;
  const notWritten = whyChapterNotWritten(req.chapter.chapter);
  if (notWritten) return { written: [], discarded, notes, gate: tallyGate([]), notWritten };

  // ── 1. Write, and read what came back ──────────────────────────────────────
  const [examples, scope] = await Promise.all([
    deps.db.examples(req.examId, req.chapter.chapter_id, req.form),
    deps.db.scopeOf(req.examId, req.chapter.chapter_id),
  ]);
  const plan = writePlan(req.form, req.shortfall);
  const sizes = plan.batches;
  const replies = await Promise.all(sizes.map((n) => deps.complete({
    system: writeSystemPrompt(req.examLabel),
    user: writeUserPrompt({
      subject: req.chapter.subject, chapter: req.chapter.chapter, topics: req.topics, topicId: req.topicId,
      focus: req.focus, difficulty: req.difficulty, form: req.form, count: n, examples, avoid: req.avoid, scope,
    }),
    temperature: 0.7,
    max_tokens: plan.maxTokens(n),
  })));

  const drafts: WrittenQuestion[] = [];
  const seenText = new Set(req.avoid.map(textKey));
  for (const [b, reply] of replies.entries()) {
    // A batch that failed, was cut off, or is not JSON writes nothing: every
    // question asked of it counts as discarded, and the notes say why.
    if (!reply.ok) { discarded += sizes[b]; notes.batches.push({ asked: sizes[b], failed: reply.error }); continue; }
    let list: unknown[] = [];
    let unreadable: string | null = null;
    try {
      const parsed = readModelJson<{ questions?: unknown }>(reply.text).questions;
      if (Array.isArray(parsed)) list = parsed; else unreadable = "no questions list in the reply";
    } catch (e) {
      unreadable = (e instanceof Error ? e.message : String(e)).slice(0, 160);
    }
    const refused: string[] = [];
    for (const raw of list) {
      const r = readWrittenQuestion(raw, req.topics, req.topicId);
      if (!r.ok || seenText.has(textKey(r.question.question))) { discarded++; refused.push(r.ok ? "already written" : r.reason); continue; }
      seenText.add(textKey(r.question.question));
      drafts.push(r.question);
    }
    discarded += Math.max(0, sizes[b] - list.length);
    notes.batches.push({
      asked: sizes[b], read: list.length, finish: reply.finish_reason ?? null, refused,
      ...(unreadable ? { unreadable, tail: reply.text.slice(-200) } : {}),
    });
  }
  notes.drafted = drafts.length;

  // ── 2. The same question by meaning is not paid for twice ──────────────────
  const fresh: WrittenQuestion[] = [];
  const vectors: number[][] = [];
  // Every vector at once: one at a time they added seconds a question to a request near its limit.
  const embedded = await Promise.all(drafts.map((q) => deps.embed(q.question)));
  for (const [k, q] of drafts.entries()) {
    const e = embedded[k];
    if (e.ok) {
      if (vectors.some((v) => cosine(v, e.embedding) >= SAME_QUESTION_SIMILARITY)) { discarded++; continue; }
      const twin = await deps.db.twinOf(e.embedding, req.examId, req.chapter.subject);
      if (twin) { req.onTwin(twin); discarded++; continue; }
      vectors.push(e.embedding);
    }
    fresh.push(q);
  }

  // ── 3. The quality gate, a wave at a time, until enough are kept ───────────
  const gate = { think: deps.think, model: deps.model };
  const topicName = (id: string) => req.topics.find((t) => t.id === id)?.name ?? null;
  const outcomes: GateOutcome[] = [];
  const keptSoFar = () => outcomes.filter((o) => o.kept).length;
  for (let i = 0; i < fresh.length && keptSoFar() < req.stillNeeded(); i += GATE_CONCURRENCY) {
    const wave = fresh.slice(i, i + GATE_CONCURRENCY);
    outcomes.push(...await Promise.all(wave.map((q) => gateQuestion(gate, req.examLabel, {
      subject: req.chapter.subject, chapter: req.chapter.chapter, topic: topicName(q.topicId),
      form: q.form, question: q.question, options: q.options, correctIndex: q.correctIndex, scope,
    }, { difficulty: req.difficulty }))));
  }
  notes.gated = outcomes.length;
  // Every draft that passed is stored — a good question is worth keeping
  // beyond this request — and the caller takes what it needs.
  const kept = outcomes.flatMap((o, i) => (o.kept ? [{ at: i, q: fresh[i], review: o.review }] : []));
  discarded += fresh.length - kept.length;

  // ── 4. Only what passed reaches the bank door; every draft is recorded ─────
  const written: string[] = [];
  const storedAs = new Map<number, string>();
  if (kept.length) {
    const stored = await deps.db.store(kept.map(({ q, review }) => ({
      topic_id: q.topicId,
      exam_id: req.examId,
      question: q.question,
      options: q.options,
      correct_index: q.correctIndex,
      explanation: q.explanation,
      // The review's judgement, by the rubric's definitions (and the one asked for, when asked).
      difficulty: review.difficulty,
      source: req.source,
      quality_review: review,
    })));
    if (stored.ok) {
      for (const r of stored.inserted) {
        storedAs.set(kept[r.index].at, r.id);
        written.push(r.id);
      }
      for (const k of stored.skipped) {
        discarded++;
        if (k.existing_id) req.onTwin(k.existing_id);
      }
    } else {
      discarded += kept.length;
      notes.store_failed = stored.error;
    }
  }
  notes.kept = written.length;

  if (outcomes.length) {
    await deps.db.record(outcomes.map((o, i) => ({
      writer: req.writer,
      ref: req.ref,
      exam_id: req.examId,
      subject: req.chapter.subject,
      chapter_id: req.chapter.chapter_id,
      topic_id: fresh[i].topicId,
      form: fresh[i].form,
      question: fresh[i].question,
      options: fresh[i].options,
      correct_index: fresh[i].correctIndex,
      stage: o.kept ? "kept" : o.stage,
      reason: o.kept ? null : o.reason,
      failed: o.kept ? [] : o.failed,
      review: o.review,
      question_id: storedAs.get(i) ?? null,
    })));
  }

  return { written, discarded, notes, gate: tallyGate(outcomes), notWritten: null };
}
