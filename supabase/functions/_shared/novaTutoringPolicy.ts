/**
 * Edge Nova tutoring policy — mirror of src/academic/ai/novaTutoringPolicy.ts
 */
import {
  canonicalizeSubjectLabel,
  dedupeSubjects,
  normalizeLabelKey,
} from "./novaContextBuilder.ts";

type NovaTutoringMode = "socratic" | "full" | "mistake_review";

const WANTS_FULL_ANSWER =
  /\b((just\s+)?(tell|give|show)\s+me\s+(the\s+)?(full\s+)?(answer|solution)|don'?t\s+(hint|quiz)|spoil(ers?| it)|full\s+solution|what('?s| is)\s+the\s+(correct\s+)?answer)\b/i;

export function expandSubjectsForMatch(
  subjects: Array<string | null | undefined> | null | undefined,
): string[] | null {
  const base = dedupeSubjects(subjects ?? []);
  if (!base.length) return null;
  const out = new Set<string>();
  for (const s of base) {
    out.add(s);
    const key = normalizeLabelKey(s);
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
  if (input.sessionTurnCount >= 2 || input.priorSocraticAttempts >= 2) {
    return { mode: "full", nextSocraticAttempts: input.priorSocraticAttempts };
  }
  return {
    mode: "socratic",
    nextSocraticAttempts: input.priorSocraticAttempts + 1,
  };
}

