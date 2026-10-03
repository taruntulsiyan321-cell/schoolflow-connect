/**
 * Readiness: what a CUET paper in one subject would score today, read from the
 * student's practice in that subject (owner-approved analysis, 2026-10-03 —
 * "only with enough data").
 *
 * A domain paper is one subject: so is the estimate. It is said only when the
 * student has practised at least READINESS_MIN_COVERAGE_PCT of the subject's
 * syllabus chapters AND has as many answers in it as the paper has questions;
 * otherwise what is missing is said instead. The figure answers every question
 * at the student's practice accuracy p, so each is worth
 * p × marks_correct + (1 − p) × marks_wrong — on the CUET paper 6p − 1, which
 * is below nothing when p is under one in six.
 *
 * An estimate, and the screen says on what: the accuracy, the answers behind
 * it, and the chapters practised. Nothing here is praise (§10.8).
 */
import type { PaperShape } from "./examPaper";
import { subjectsOnMap, type SyllabusMap } from "./syllabusMap";
import { READINESS_MIN_COVERAGE_PCT } from "./thresholds";

export type SubjectBasis = {
  subject: string;
  /** Answered questions in the subject (not skipped), and how many were right. */
  answered: number;
  correct: number;
  /** The subject's syllabus chapters, and how many the student has practised. */
  chapters: number;
  practised: number;
};

export type Readiness =
  | { subject: string; kind: "estimate"; accuracy: number; answered: number; practised: number; chapters: number; marks: number; maxMarks: number; perQuestion: number }
  | { subject: string; kind: "not_yet"; practised: number; chapters: number; answered: number; needChapters: number; needAnswers: number };

export function readiness(b: SubjectBasis, paper: PaperShape): Readiness {
  const needChapters = Math.ceil((b.chapters * READINESS_MIN_COVERAGE_PCT) / 100);
  const needAnswers = paper.questions;
  if (b.chapters <= 0 || b.practised < needChapters || b.answered < needAnswers) {
    return { subject: b.subject, kind: "not_yet", practised: b.practised, chapters: b.chapters, answered: b.answered, needChapters, needAnswers };
  }
  const p = b.correct / b.answered;
  const perQuestion = p * paper.marks_correct + (1 - p) * paper.marks_wrong;
  return {
    subject: b.subject,
    kind: "estimate",
    accuracy: Math.round(p * 100),
    answered: b.answered,
    practised: b.practised,
    chapters: b.chapters,
    marks: Math.round(paper.questions * perQuestion),
    maxMarks: paper.questions * paper.marks_correct,
    perQuestion: Math.round(perQuestion * 100) / 100,
  };
}

/** One subject's name as both sources write it: a case- and space-insensitive key. */
export const subjectKey = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");

/**
 * Every syllabus subject the student has practised, read for readiness. A
 * subject's accuracy is the one "Subjects at a glance" shows (practice
 * analytics, by_subject — its one home); how much of its syllabus is practised
 * is the map's count. A subject never practised says nothing yet: it is on the
 * map, untouched.
 */
export function readinessRows(
  paper: PaperShape,
  map: SyllabusMap,
  bySubject: ReadonlyArray<{ subject: string; answered: number; correct: number }>,
): Readiness[] {
  const practice = new Map(bySubject.map((s) => [subjectKey(s.subject), s]));
  return subjectsOnMap(map)
    .map((s) => {
      const p = practice.get(subjectKey(s.subject));
      return readiness({ subject: s.subject, answered: p?.answered ?? 0, correct: p?.correct ?? 0, chapters: s.chapters.length, practised: s.practised }, paper);
    })
    .filter((r) => r.kind === "estimate" || r.practised > 0);
}
