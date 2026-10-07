/**
 * A student's marks on questions: why they say a question went wrong.
 *
 * Ruled 2026-10-02. Any question of a finished practice session can be marked
 * — wrong, skipped, or right by a guess — with tags from public.mark_tags, a
 * text note and a voice note; the Mistake Book marks, re-marks and unmarks the
 * same thing, and Mistake Types groups every mark by tag.
 *
 * ONE mark per student per question (20261137000000). The question is a bank
 * question, an uploaded one or a captured one, and its id is the mark's
 * question_ref — so the result screen and the Mistake Book, holding the same
 * question by different rows, find the same mark. An empty mark is not stored:
 * saving one deletes the row.
 */
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";

/**
 * The database refuses anything longer (question_marks' CHECKs);
 * questionMarks.test.ts reads the migration and fails if these drift from it.
 * Characters are counted as Postgres counts them — code points — so the
 * counter on screen and the database agree on an emoji.
 */
export const NOTE_MAX_CHARS = 500;
export const VOICE_MAX_SECONDS = 60;

export const VOICE_NOTE_BUCKET = "question-voice-notes";

export type QuestionRefKind = "bank" | "upload" | "capture";
export type QuestionRef = { kind: QuestionRefKind; id: string };

export type MarkTag = { key: string; label: string; group: string; position: number; active: boolean };
export type MarkTagGroup = { label: string; tags: MarkTag[] };

export type QuestionMark = {
  ref: QuestionRef;
  questionText: string;
  subject: string | null;
  chapter: string | null;
  tags: string[];
  note: string | null;
  voicePath: string | null;
  voiceSeconds: number | null;
  /** When the question was first marked — what the mistake-type trend counts by. */
  createdAt: string;
  updatedAt: string;
};

/** What the student is saving. A voice note is already uploaded when it gets here. */
export type MarkDraft = {
  tags: string[];
  note: string;
  voice: { path: string; seconds: number } | null;
};

/** What the student saw, kept on the mark so Mistake Types can list it. */
export type MarkedQuestion = { text: string; subject: string | null; chapter: string | null };

type MarkRow = Database["public"]["Tables"]["question_marks"]["Row"];

const MARK_COLUMNS =
  "bank_question_id, upload_question_id, capture_question_id, question_ref, question_text, subject, chapter, tags, note, voice_path, voice_seconds, created_at, updated_at";

/** A recording's length as a clock: 75 → "1:15". */
export function formatClock(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** Marks with a note or a recording but no tag yet. */
export const NO_TAG = "__no_tag__";

export type MarkBucket = { key: string; label: string; marks: QuestionMark[] };

/**
 * Every question the student has marked, grouped by the tags they chose — the
 * most common reason first, a tie in the catalogue's order, the untagged
 * last. A question with two tags is in both groups.
 */
export function bucketMarks(marks: QuestionMark[], tags: MarkTag[]): MarkBucket[] {
  const label = new Map(tags.map((t) => [t.key, t.label]));
  const position = new Map(tags.map((t) => [t.key, t.position]));
  const byTag = new Map<string, QuestionMark[]>();
  for (const m of marks) {
    for (const key of m.tags.length > 0 ? m.tags : [NO_TAG]) {
      byTag.set(key, [...(byTag.get(key) ?? []), m]);
    }
  }
  return [...byTag.entries()]
    .map(([key, list]) => ({ key, label: key === NO_TAG ? "No tag yet" : label.get(key) ?? key, marks: list }))
    .sort((a, b) => {
      if (a.key === NO_TAG) return 1;
      if (b.key === NO_TAG) return -1;
      return b.marks.length - a.marks.length || (position.get(a.key) ?? 99) - (position.get(b.key) ?? 99);
    });
}

export type TagTrend = { key: string; label: string; recent: number; before: number };

const DAY_MS = 86_400_000;

/**
 * Each mistake type: how many questions were first marked with it in the last
 * `days`, and in the same length of time just before. Equal windows, so the two
 * counts are read against each other as they stand — no rate, no verdict.
 * The type grown most lately comes first.
 */
export function tagTrend(marks: QuestionMark[], tags: MarkTag[], now: Date, days: number): TagTrend[] {
  const end = now.getTime();
  const mid = end - days * DAY_MS;
  const start = mid - days * DAY_MS;
  const label = new Map(tags.map((t) => [t.key, t.label]));
  const counts = new Map<string, { recent: number; before: number }>();
  for (const m of marks) {
    const at = Date.parse(m.createdAt);
    if (!(at >= start && at <= end)) continue;
    for (const key of m.tags) {
      const c = counts.get(key) ?? { recent: 0, before: 0 };
      if (at >= mid) c.recent += 1;
      else c.before += 1;
      counts.set(key, c);
    }
  }
  return [...counts]
    .map(([key, c]) => ({ key, label: label.get(key) ?? key, ...c }))
    .sort((a, b) => (b.recent - b.before) - (a.recent - a.before) || b.recent - a.recent || a.label.localeCompare(b.label));
}

/** The mistake type marked more often lately than before, by the most; null when none was. */
export function risingTag(trend: TagTrend[]): TagTrend | null {
  const top = trend[0];
  return top && top.recent > top.before ? top : null;
}

export function countChars(text: string): number {
  return Array.from(text).length;
}

/** The note as it may be typed: cut at the limit, by code point. */
export function clampNote(text: string): string {
  const chars = Array.from(text);
  return chars.length > NOTE_MAX_CHARS ? chars.slice(0, NOTE_MAX_CHARS).join("") : text;
}

export function isEmptyDraft(draft: MarkDraft): boolean {
  return draft.tags.length === 0 && draft.note.trim() === "" && draft.voice === null;
}

function refFromRow(row: Pick<MarkRow, "bank_question_id" | "upload_question_id" | "capture_question_id">): QuestionRef | null {
  if (row.bank_question_id) return { kind: "bank", id: row.bank_question_id };
  if (row.upload_question_id) return { kind: "upload", id: row.upload_question_id };
  if (row.capture_question_id) return { kind: "capture", id: row.capture_question_id };
  return null;
}

function toMark(row: Pick<MarkRow, "bank_question_id" | "upload_question_id" | "capture_question_id" | "question_text" | "subject" | "chapter" | "tags" | "note" | "voice_path" | "voice_seconds" | "created_at" | "updated_at">): QuestionMark | null {
  const ref = refFromRow(row);
  if (!ref) return null;
  return {
    ref,
    questionText: row.question_text,
    subject: row.subject,
    chapter: row.chapter,
    tags: row.tags ?? [],
    note: row.note,
    voicePath: row.voice_path,
    voiceSeconds: row.voice_seconds,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * The question a practice attempt asked, from either shape the result screen
 * holds: this device's own log (ids on generated_question) or a
 * question_attempts row (bank_question_id column; the brought-question ids on
 * generated_question). A question with none of them — a saved session's
 * frozen snapshot — cannot be marked.
 */
export function markRefFromAttempt(a: {
  bank_question_id?: string | null;
  generated_question?: { bank_question_id?: string | null; upload_question_id?: string | null; capture_question_id?: string | null } | null;
}): QuestionRef | null {
  const gq = a.generated_question ?? {};
  if (gq.upload_question_id) return { kind: "upload", id: gq.upload_question_id };
  if (gq.capture_question_id) return { kind: "capture", id: gq.capture_question_id };
  const bank = a.bank_question_id ?? gq.bank_question_id;
  return bank ? { kind: "bank", id: bank } : null;
}

/**
 * The question a Mistake Book row is about. A school test's mistake carries a
 * test_questions id in question_id, not a bank one, so it has nothing to mark.
 */
export function markRefFromMistake(m: {
  source: string;
  questionId: string | null;
  uploadQuestionId: string | null;
  captureQuestionId: string | null;
}): QuestionRef | null {
  if (m.uploadQuestionId) return { kind: "upload", id: m.uploadQuestionId };
  if (m.captureQuestionId) return { kind: "capture", id: m.captureQuestionId };
  if (m.questionId && m.source !== "test") return { kind: "bank", id: m.questionId };
  return null;
}

let tagsPromise: Promise<MarkTag[]> | null = null;

/** The tag catalogue, read once per page load. */
export function loadMarkTags(): Promise<MarkTag[]> {
  if (!tagsPromise) {
    tagsPromise = (async () => {
      const { data, error } = await supabase
        .from("mark_tags")
        .select("key, label, group_label, position, active")
        .order("position");
      if (error) throw new Error(error.message);
      return (data ?? []).map((t) => ({ key: t.key, label: t.label, group: t.group_label, position: t.position, active: t.active }));
    })();
    // A failed read is not cached: the next screen asks again.
    tagsPromise.catch(() => { tagsPromise = null; });
  }
  return tagsPromise;
}

/**
 * The tags to offer, in their groups; a group appears where its first tag
 * does. A retired tag is offered only to a mark that already carries it, so
 * the student can still see it and take it off.
 */
export function groupMarkTags(tags: MarkTag[], kept: readonly string[] = []): MarkTagGroup[] {
  const groups: MarkTagGroup[] = [];
  for (const tag of [...tags].filter((t) => t.active || kept.includes(t.key)).sort((a, b) => a.position - b.position)) {
    const group = groups.find((g) => g.label === tag.group);
    if (group) group.tags.push(tag);
    else groups.push({ label: tag.group, tags: [tag] });
  }
  return groups;
}

/** Every mark this student has made, by question id. */
export async function loadMyMarks(userId: string): Promise<Map<string, QuestionMark>> {
  const { data, error } = await supabase
    .from("question_marks")
    .select(MARK_COLUMNS)
    .eq("user_id", userId)
    .order("updated_at", { ascending: false });
  if (error) throw new Error(error.message);
  const out = new Map<string, QuestionMark>();
  for (const row of data ?? []) {
    const mark = toMark(row);
    if (mark) out.set(mark.ref.id, mark);
  }
  return out;
}

function refColumns(ref: QuestionRef) {
  return {
    bank_question_id: ref.kind === "bank" ? ref.id : null,
    upload_question_id: ref.kind === "upload" ? ref.id : null,
    capture_question_id: ref.kind === "capture" ? ref.id : null,
  };
}

/**
 * Save the student's mark on a question — or, when the draft is empty, remove
 * it. Returns the mark as stored (tags in the catalogue's order), or null when
 * there is none any more.
 */
export async function saveMark(
  userId: string,
  ref: QuestionRef,
  question: MarkedQuestion,
  draft: MarkDraft,
): Promise<QuestionMark | null> {
  if (isEmptyDraft(draft)) {
    await deleteMark(userId, ref);
    return null;
  }
  const note = draft.note.trim();
  const { data, error } = await supabase
    .from("question_marks")
    .upsert(
      {
        ...refColumns(ref),
        question_text: question.text,
        subject: question.subject,
        chapter: question.chapter,
        tags: draft.tags,
        note: note === "" ? null : note,
        voice_path: draft.voice?.path ?? null,
        voice_seconds: draft.voice?.seconds ?? null,
      },
      { onConflict: "user_id,question_ref" },
    )
    .select(MARK_COLUMNS)
    .single();
  if (error) throw new Error(error.message);
  const mark = toMark(data);
  if (!mark) throw new Error("The mark was saved without its question.");
  return mark;
}

export async function deleteMark(userId: string, ref: QuestionRef): Promise<void> {
  const { error } = await supabase
    .from("question_marks")
    .delete()
    .eq("user_id", userId)
    .eq("question_ref", ref.id);
  if (error) throw new Error(error.message);
}

const AUDIO_EXTENSION: Record<string, string> = {
  "audio/webm": "webm",
  "audio/ogg": "ogg",
  "audio/mp4": "m4a",
  "audio/mpeg": "mp3",
  "audio/aac": "aac",
};

/** The recorder's type without its codec — the bucket allows base types only. */
export function baseAudioType(mime: string): string {
  return mime.split(";")[0].trim().toLowerCase();
}

/** Upload a recording into the student's own folder; returns its key. */
export async function uploadVoiceNote(userId: string, blob: Blob): Promise<string> {
  const type = baseAudioType(blob.type || "audio/webm");
  const ext = AUDIO_EXTENSION[type];
  if (!ext) throw new Error("This browser recorded in a format we can't keep.");
  const path = `${userId}/${crypto.randomUUID()}.${ext}`;
  const { error } = await supabase.storage.from(VOICE_NOTE_BUCKET).upload(path, blob, { contentType: type, upsert: false });
  if (error) throw new Error(error.message);
  return path;
}

/** A short-lived link to play one of the student's own recordings. */
export async function voiceNoteUrl(path: string): Promise<string> {
  const { data, error } = await supabase.storage.from(VOICE_NOTE_BUCKET).createSignedUrl(path, 3600);
  if (error || !data?.signedUrl) throw new Error(error?.message ?? "No link for this recording.");
  return data.signedUrl;
}

/**
 * Best-effort: a recording whose mark no longer points at it. The mark is
 * already right; a file left behind is only storage.
 */
export async function removeVoiceNotes(paths: string[]): Promise<void> {
  const keep = paths.filter(Boolean);
  if (keep.length === 0) return;
  await supabase.storage.from(VOICE_NOTE_BUCKET).remove(keep).catch(() => undefined);
}

/**
 * The recordings on marks of brought questions about to be deleted. The marks
 * go with the questions (ON DELETE CASCADE); the files would stay in the
 * bucket, so the caller removes these once its delete has succeeded.
 */
export async function voiceNotesForQuestions(kind: "upload" | "capture", ids: string[]): Promise<string[]> {
  if (ids.length === 0) return [];
  const column = kind === "upload" ? "upload_question_id" : "capture_question_id";
  const { data } = await supabase
    .from("question_marks")
    .select("voice_path")
    .in(column, ids)
    .not("voice_path", "is", null);
  return (data ?? []).map((r) => r.voice_path ?? "").filter(Boolean);
}
