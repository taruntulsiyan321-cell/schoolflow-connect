/**
 * Nova tutoring policy — Socratic mode + subject-aware semantic match helpers.
 * Client copy; edge mirror: supabase/functions/_shared/novaTutoringPolicy.ts
 */

import {
  canonicalizeSubjectLabel,
  dedupeSubjects,
  normalizeLabelKey,
} from "./novaContextBuilder";

export type NovaTutoringMode = "socratic" | "full" | "mistake_review";

const WANTS_FULL_ANSWER =
  /\b((just\s+)?(tell|give|show)\s+me\s+(the\s+)?(full\s+)?(answer|solution)|don'?t\s+(hint|quiz)|spoil(ers?| it)|full\s+solution|what('?s| is)\s+the\s+(correct\s+)?answer)\b/i;

/** Expand profile subjects with aliases so Maths/Math both hit bank/cache filters. */
export function expandSubjectsForMatch(
  subjects: Array<string | null | undefined> | null | undefined,
): string[] | null {
  const base = dedupeSubjects(subjects ?? []);
  if (!base.length) return null;
  const out = new Set<string>();
  for (const s of base) {
    out.add(s);
    const key = normalizeLabelKey(s);
    // Common spellings the bank may store
    if (key === "mathematics") {
      out.add("Math");
      out.add("Maths");
      out.add("Mathematics");
    } else if (key === "accountancy") {
      out.add("Accounts");
      out.add("Accounting");
      out.add("Accountancy");
    } else if (key === "business studies") {
      out.add("BST");
      out.add("Business Studies");
    } else {
      out.add(canonicalizeSubjectLabel(s));
    }
  }
  return [...out];
}

export type SemanticCandidate = {
  similarity: number;
  question: string;
  subject?: string | null;
  __source: "question_bank" | "ai_answer_cache";
  [key: string]: unknown;
};

/**
 * Among retrieved candidates, pick the best EXACT match (sim >= 0.78 + numbersMatch).
 * Prefers a subject-aligned exact hit over a higher-sim wrong-subject exact.
 */
export function pickExactSemanticMatch(
  candidates: SemanticCandidate[],
  query: string,
  preferredSubjects: string[] | null,
  numbersMatch: (a: string, b: string) => boolean,
  exactFloor = 0.78,
): SemanticCandidate | null {
  const exact = candidates.filter(
    (c) =>
      Number(c.similarity) >= exactFloor &&
      numbersMatch(query, String(c.question ?? "")),
  );
  if (!exact.length) return null;

  const pref = new Set(
    (preferredSubjects ?? []).map((s) => normalizeLabelKey(canonicalizeSubjectLabel(s))),
  );
  if (pref.size) {
    const subjectHit = exact.find((c) => {
      if (!c.subject || typeof c.subject !== "string") return false;
      return pref.has(normalizeLabelKey(canonicalizeSubjectLabel(c.subject)));
    });
    if (subjectHit) return subjectHit;
  }
  return [...exact].sort((a, b) => Number(b.similarity) - Number(a.similarity))[0] ?? null;
}

/** Subject to stamp on a new ai_answer_cache row — never invent. */
export function resolveCacheSubject(input: {
  matchedSubjectHint?: string | null;
  profileSubjects?: Array<string | null | undefined>;
  weakConceptSubjects?: Array<string | null | undefined>;
}): string | null {
  if (input.matchedSubjectHint && String(input.matchedSubjectHint).trim()) {
    return canonicalizeSubjectLabel(String(input.matchedSubjectHint));
  }
  const fromWeak = dedupeSubjects(input.weakConceptSubjects ?? []);
  if (fromWeak.length === 1) return fromWeak[0]!;
  const fromProfile = dedupeSubjects(input.profileSubjects ?? []);
  if (fromProfile.length === 1) return fromProfile[0]!;
  return null;
}

export function resolveNovaTutoringMode(input: {
  question: string;
  hasQuestionContext: boolean;
  sessionTurnCount: number;
  priorSocraticAttempts: number;
}): { mode: NovaTutoringMode; nextSocraticAttempts: number } {
  if (input.hasQuestionContext) {
    return { mode: "mistake_review", nextSocraticAttempts: input.priorSocraticAttempts };
  }
  if (WANTS_FULL_ANSWER.test(input.question)) {
    return { mode: "full", nextSocraticAttempts: input.priorSocraticAttempts };
  }
  // After two tutoring turns (or two prior socratic replies), open the full solution.
  if (input.sessionTurnCount >= 2 || input.priorSocraticAttempts >= 2) {
    return { mode: "full", nextSocraticAttempts: input.priorSocraticAttempts };
  }
  return {
    mode: "socratic",
    nextSocraticAttempts: input.priorSocraticAttempts + 1,
  };
}

export const NOVA_CHAT_SYSTEM_V3 =
  "You are Nova, Gurukul's academic tutor for doubts and study questions only. Ground answers ONLY in learning facts: EIE mastery/weak topics, recovery, practice, mistakes book, and revision/progression (plus student profile subjects/class label when present). Refuse attendance, marks, homework due dates, calendar/events, class rank, and “how am I doing?” school summaries — say you only help with concepts and academic doubts; do not send the student elsewhere. Never invent mastery scores, XP, ranks, or classmate names. If a learning metric is missing or facts are empty, say learning records are not available yet — do not guess. " +
  "Tutoring mode is facts.tutoring.mode: " +
  "\"socratic\" = ask at most ONE clarifying question OR give a short hint/first step — do NOT give the full final answer yet; " +
  "\"full\" = student asked for the answer or already tried — give a clear stepwise full solution; " +
  "\"mistake_review\" = question_context has their answer — explain the mistake gently and show the correct approach. " +
  "Keep under 180 words. Respond in {{language}} when possible.";
