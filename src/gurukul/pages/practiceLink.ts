import { isPlaceholderAcademicLabel } from "@/lib/academicPresentation";
import { drillFor, type MistakeDrill } from "@/lib/questionMarks";

/**
 * What a /student/practice?subject=&chapter=&topic=&drill= link asks for —
 * the links Analysis, the syllabus map, a session's result and Mistake Types
 * send. Read here, apart from the Practice screen, so what a link starts can
 * be checked without drawing the screen.
 *
 *   none         the link names no subject, chapter or topic: not this kind
 *                of link (an instant ?mode= link, or no link at all)
 *   placeholder  it names only placeholder labels ("General", "Mixed"…), so
 *                there is nothing real to practise
 *   session      a session to start
 *
 * ?revision=<uuid> USED TO BE READ HERE and is deliberately gone. It turned
 * the session into a §5.4 check by chapter alone, leaving the ordinary loader
 * to pick the questions — and the ordinary loader cannot exclude what the
 * student has already seen. A check starts from router state, not a link.
 */
export type LabelledLink =
  | { kind: "none" }
  | { kind: "placeholder" }
  | {
      kind: "session";
      mode: "chapter" | "topic" | "subject";
      subject: string | null;
      chapter: string | null;
      topic: string | null;
      /**
       * ?drill=<mistake type> from Mistake Types (C5): only a drill a link can
       * carry, a kind of question or fresh questions from the chapter the link
       * names. An "again" drill's questions come in router state, never in a
       * link. An unknown type is no drill.
       */
      drill: LinkDrill | null;
    };

export type LinkDrill = Extract<MistakeDrill, { draws: "kind" | "chapter" }>;

function linkDrill(raw: string | null, chapter: string | null): LinkDrill | null {
  const drill = drillFor(raw);
  if (drill?.draws === "kind") return drill;
  if (drill?.draws === "chapter" && chapter) return drill;
  return null;
}

const real = (raw: string | null) => (raw && !isPlaceholderAcademicLabel(raw) ? raw.trim() : null);

export function readLabelledLink(params: URLSearchParams): LabelledLink {
  const chapterRaw = params.get("chapter");
  const subjectRaw = params.get("subject");
  const topicRaw = params.get("topic");
  if (!chapterRaw && !subjectRaw && !topicRaw) return { kind: "none" };

  const chapter = real(chapterRaw);
  const subject = real(subjectRaw);
  const topic = real(topicRaw);
  if (!chapter && !subject && !topic) return { kind: "placeholder" };

  // A topic WITHOUT a chapter is topic mode, not chapter mode.
  //
  // `chapter: chapter || topic` used to copy the topic into the chapter, from
  // when the topic could not be narrowed server-side and had to act as a
  // chapter needle. It did active harm: the query required
  // question_bank.chapter to equal a TOPIC name, which no row satisfies, so the
  // narrowed fetch returned nothing and fell back to the 400-row window this
  // was meant to avoid. It also wrote the topic name into
  // practice_sessions.chapter, inventing a chapter that does not exist.
  const mode = chapter ? "chapter" : topic ? "topic" : "subject";
  return { kind: "session", mode, subject, chapter, topic, drill: linkDrill(params.get("drill"), chapter) };
}
