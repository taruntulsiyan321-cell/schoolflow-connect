/**
 * Tagging a student's own question to a chapter of their stream's syllabus.
 * Pure: no Deno, no network — the edge loads the syllabus and calls the model.
 *
 * Ruled 2026-09-25: no question in a student's stream stays untagged, and a
 * question outside the stream is not the student's CUET work and is not
 * saved. So every question ends in exactly one of two states:
 *
 *   tagged    a chapter_id from the stream's syllabus (and a topic when the
 *             chapter has one that fits)
 *   outside   its subject is not one the stream studies
 *
 * The model answers with a CODE from a numbered list of the syllabus, never
 * a free-text chapter name, so an answer is either one of our chapters or
 * rejected — there is no "closest spelling" step that could land a question
 * in a chapter nobody chose.
 */

export type SyllabusTopic = { id: string; name: string };

export type SyllabusChapter = {
  /** "C1".."Cn", in syllabus order — what the model answers with. */
  code: string;
  chapter_id: string;
  chapter: string;
  subject: string;
  topics: SyllabusTopic[];
};

export type ChapterTag = { kind: "tagged"; chapter_id: string; topic_id: string | null; subject: string; chapter: string };
export type OutsideTag = { kind: "outside"; subject: string | null };
export type Tag = ChapterTag | OutsideTag;

/** The code the model uses for "not one of this stream's subjects". */
export const OUTSIDE = "OUTSIDE";

export function withCodes(
  rows: ReadonlyArray<Omit<SyllabusChapter, "code">>,
): SyllabusChapter[] {
  return rows.map((r, i) => ({ ...r, code: `C${i + 1}` }));
}

export function streamSubjects(syllabus: ReadonlyArray<SyllabusChapter>): string[] {
  return [...new Set(syllabus.map((c) => c.subject))];
}

/** The numbered syllabus, as the model is shown it. */
export function syllabusPrompt(syllabus: ReadonlyArray<SyllabusChapter>): string {
  return syllabus
    .map((c) => {
      const topics = c.topics.length ? ` (topics: ${c.topics.map((t) => t.name).join("; ")})` : "";
      return `${c.code} · ${c.subject} › ${c.chapter}${topics}`;
    })
    .join("\n");
}

export function taggingSystemPrompt(streamLabel: string, syllabus: ReadonlyArray<SyllabusChapter>): string {
  const subjects = streamSubjects(syllabus);
  return [
    `You file a ${streamLabel} student's exam questions under the chapters of their syllabus.`,
    "",
    "For each question, FIRST decide its academic subject from what it tests —",
    "not from the chapters below. A rate constant or a pH is Chemistry, a force",
    "or a current is Physics, a cell is Biology, a war or a dynasty is History,",
    "however a formula in it might look like mathematics.",
    `- subject: exactly one of ${subjects.map((s) => `"${s}"`).join(", ")} when the question`,
    "  is from one of those; otherwise the subject's own name (e.g. \"Chemistry\").",
    `- code: when the subject is one of those, the code of the ONE chapter OF THAT`,
    "  SUBJECT it tests — the closest one when none fits exactly; never leave it out.",
    `  When the subject is not one of those, "${OUTSIDE}".`,
    "- topic: the chapter's listed topic it tests, copied exactly, or null.",
    "",
    "SYLLABUS:",
    syllabusPrompt(syllabus),
  ].join("\n");
}

export type TagItem = { index: number; question: string; options?: string[] | null };

export function taggingUserPrompt(items: ReadonlyArray<TagItem>): string {
  return [
    "Questions:",
    ...items.map((q) => {
      const opts = q.options?.length ? `\n   options: ${q.options.join(" | ")}` : "";
      return `${q.index}. ${q.question.trim()}${opts}`;
    }),
    "",
    'Return {"tags":[{"index":<n>,"subject":<its subject>,"code":"C<k>" or "OUTSIDE","topic":<topic or null>}]} — one entry per question.',
  ].join("\n");
}

export const TAG_REPLY_SHAPE = {
  type: "object",
  properties: {
    tags: {
      type: "array",
      items: {
        type: "object",
        properties: {
          index: { type: "integer" },
          subject: { type: "string" },
          code: { type: "string" },
          topic: { type: ["string", "null"] },
        },
        required: ["index", "subject", "code"],
      },
    },
  },
  required: ["tags"],
} as const;

type RawTag = { index?: unknown; code?: unknown; subject?: unknown; topic?: unknown };

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/** A topic of the chapter the model named, matched exactly after normalising. */
export function topicFor(chapter: SyllabusChapter, label: unknown): string | null {
  if (typeof label !== "string" || !label.trim()) return null;
  const want = norm(label);
  return chapter.topics.find((t) => norm(t.name) === want)?.id ?? null;
}

/**
 * The model's reply, checked against the syllabus. The SUBJECT decides: a
 * subject the stream does not study is outside, whatever code came with it
 * (a kinetics question once came back as Mathematics › Differential Equations);
 * a stream subject is filed only under a chapter OF THAT SUBJECT. Anything
 * else — no subject, an unknown code, a chapter of another subject — comes
 * back in `unanswered`, for the caller to ask again.
 */
export function readTagReply(
  reply: unknown,
  syllabus: ReadonlyArray<SyllabusChapter>,
  indexes: ReadonlyArray<number>,
): { tags: Map<number, Tag>; unanswered: number[] } {
  const byCode = new Map(syllabus.map((c) => [c.code.toUpperCase(), c]));
  const subjects = new Set(streamSubjects(syllabus).map(norm));
  const tags = new Map<number, Tag>();
  const raw = (reply as { tags?: unknown } | null)?.tags;
  for (const t of Array.isArray(raw) ? (raw as RawTag[]) : []) {
    const index = typeof t.index === "number" ? t.index : Number(t.index);
    if (!indexes.includes(index) || tags.has(index)) continue;
    const subject = typeof t.subject === "string" && t.subject.trim() ? t.subject.trim() : null;
    if (!subject) continue;
    if (!subjects.has(norm(subject))) {
      tags.set(index, { kind: "outside", subject });
      continue;
    }
    const code = typeof t.code === "string" ? t.code.trim().toUpperCase() : "";
    const chapter = byCode.get(code);
    if (!chapter || norm(chapter.subject) !== norm(subject)) continue;
    tags.set(index, {
      kind: "tagged",
      chapter_id: chapter.chapter_id,
      topic_id: topicFor(chapter, t.topic),
      subject: chapter.subject,
      chapter: chapter.chapter,
    });
  }
  return { tags, unanswered: indexes.filter((i) => !tags.has(i)) };
}

/** Say which stream subjects a refused question is not in, for the student. */
export function outsideMessage(subject: string | null, streamLabel: string): string {
  return subject
    ? `${subject} isn't one of your ${streamLabel} subjects, so it wasn't saved.`
    : `This isn't from one of your ${streamLabel} subjects, so it wasn't saved.`;
}
