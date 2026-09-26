/**
 * The prompt for `ai-concept-report` — the "Get insights" coach on a finished
 * practice session, test, battle or recovery round. Pure, so it is tested
 * (src/lib/conceptReportPrompt.test.ts) rather than read.
 *
 * Measured 2026-09-26 on www.gurukul.study, a CUET account's Business Studies
 * practice session with 4 answers, all wrong, and 1 skip: the coach wrote that
 * the "assessment was submitted without answering any questions or
 * encountered a technical error", told the student to "contact your school's
 * IT support", and said "no recovery assignments were queued". The prompt
 * gave it "Accuracy: 0% (0/4)" and nothing saying 4 were answered, called
 * every source a "post-assessment" for "Indian school students", and passed
 * a count of recovery assignments from an engine that no longer exists.
 */

export type ConceptReportInput = {
  source_type?: string | null;
  accuracy_pct?: number | null;
  correct_count?: number | null;
  total_count?: number | null;
  time_minutes?: number | null;
  weak_concepts?: Array<{ concept?: string | null; chapter?: string | null; subject?: string | null; accuracy?: number | null }>;
};

const SOURCE_NOUN: Record<string, string> = {
  practice_session: "practice session",
  test_attempt: "test",
  battle_participant: "battle",
  recovery_assignment: "recovery round",
};

const count = (n: unknown): number => (typeof n === "number" && Number.isFinite(n) && n > 0 ? Math.floor(n) : 0);

export function buildConceptReportPrompt(report: ConceptReportInput): { system: string; user: string } {
  const noun = SOURCE_NOUN[report.source_type ?? ""] ?? "session";

  const system = [
    "You are an academic coach for an Indian student studying NCERT-based syllabi — a school board, or an entrance exam such as CUET.",
    `Given the facts of ONE finished ${noun}, write short, actionable insights addressed to the student.`,
    "Use only the facts given. Every count is exact: never suggest that questions went unanswered, that the student submitted by mistake, or that there was a technical error, and never refer the student to school staff or IT support.",
    "Be encouraging but honest. No invented URLs.",
  ].join("\n");

  const marked = count(report.total_count);
  const correct = Math.min(count(report.correct_count), marked);
  const weak = (report.weak_concepts ?? [])
    .map((w) => {
      const concept = (w.concept ?? "").trim();
      const chapter = (w.chapter ?? "").trim();
      const name = concept || chapter || (w.subject ?? "").trim();
      if (!name) return null;
      const where = chapter && chapter !== name ? `${chapter}, ` : "";
      return `${name} (${where}${count(w.accuracy)}%)`;
    })
    .filter((l): l is string => l !== null)
    .join("; ");

  const user = [
    `This was a ${noun}.`,
    marked === 0
      ? "No question was answered, so there is no accuracy."
      : `Questions answered: ${marked} — ${correct} correct, ${marked - correct} wrong` +
        (report.accuracy_pct == null ? "." : ` (accuracy ${report.accuracy_pct}%).`),
    report.time_minutes == null || report.time_minutes <= 0
      ? "Time: not recorded."
      : `Time spent answering: ${report.time_minutes} minutes.`,
    `Weak concepts, with their chapter: ${weak || "none"}.`,
  ].join("\n");

  return { system, user };
}
