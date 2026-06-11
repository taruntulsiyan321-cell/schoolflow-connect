import { invokeEdgeFunction, isAiUnavailableError } from "@/lib/edgeFunction";
import {
  fetchPracticeMistakesForAnalytics,
  formatMistakesForPrompt,
  type MistakeRecord,
} from "@/lib/mistakeRecovery";
import type { AcademicSnapshot } from "@/hooks/useStudentAcademicSnapshot";
import type { ConceptMasteryItem } from "@/hooks/useConceptMastery";

export type WeakConceptInsight = {
  concept: string;
  subject: string;
  chapter?: string;
  severity: "critical" | "moderate" | "mild";
  why_weak: string;
  fix_hint: string;
  mistake_count: number;
};

export type StrongConceptInsight = {
  concept: string;
  subject: string;
  note: string;
};

export type AnalyticsInsights = {
  headline: string;
  summary: string;
  weak_concepts: WeakConceptInsight[];
  strong_concepts: StrongConceptInsight[];
  next_steps: string[];
  source: "gemini" | "rule";
};

export type MistakeConceptAggregate = {
  concept: string;
  subject: string;
  chapter: string | null;
  mistake_count: number;
  total_wrong: number;
  sample_question: string;
};

export function aggregateWeakConceptsFromMistakes(mistakes: MistakeRecord[]): MistakeConceptAggregate[] {
  const map = new Map<string, MistakeConceptAggregate>();

  for (const m of mistakes) {
    const concept = m.concept || m.topic || m.chapter || "General skill";
    const key = `${m.subject}::${concept}`;
    const existing = map.get(key);
    if (existing) {
      existing.mistake_count += 1;
      existing.total_wrong += m.times_wrong;
    } else {
      map.set(key, {
        concept,
        subject: m.subject,
        chapter: m.chapter,
        mistake_count: 1,
        total_wrong: m.times_wrong,
        sample_question: m.question_text.slice(0, 140),
      });
    }
  }

  return [...map.values()].sort(
    (a, b) => b.total_wrong - a.total_wrong || b.mistake_count - a.mistake_count,
  );
}

function severityFromWrong(totalWrong: number, mistakeCount: number): "critical" | "moderate" | "mild" {
  if (totalWrong >= 5 || mistakeCount >= 4) return "critical";
  if (totalWrong >= 3 || mistakeCount >= 2) return "moderate";
  return "mild";
}

export function buildRuleAnalyticsInsights(
  aggregates: MistakeConceptAggregate[],
  mastery: ConceptMasteryItem[],
  snapshot: AcademicSnapshot | null,
): AnalyticsInsights {
  const weak_concepts: WeakConceptInsight[] = aggregates.slice(0, 8).map((a) => ({
    concept: a.concept,
    subject: a.subject,
    chapter: a.chapter ?? undefined,
    severity: severityFromWrong(a.total_wrong, a.mistake_count),
    why_weak: `You missed ${a.mistake_count} question${a.mistake_count === 1 ? "" : "s"} on this concept (${a.total_wrong} logged error${a.total_wrong === 1 ? "" : "s"} in your mistake book).`,
    fix_hint: `Use Recovery Zone for remedial practice on "${a.concept}" before moving to new chapters.`,
    mistake_count: a.mistake_count,
  }));

  const strong_concepts: StrongConceptInsight[] = mastery
    .filter((m) => m.mastery_score >= 75 && m.mistake_count <= 1)
    .slice(0, 4)
    .map((m) => ({
      concept: m.concept,
      subject: m.subject,
      note: `${Math.round(m.mastery_score)}% mastery with few recent errors — maintain with mixed revision.`,
    }));

  const readiness = snapshot?.exam_readiness?.score ?? 0;
  const headline =
    weak_concepts.length === 0
      ? "No concept gaps from practice yet"
      : weak_concepts[0].severity === "critical"
        ? `${weak_concepts[0].concept} needs urgent attention`
        : `Focus on ${weak_concepts.length} concept${weak_concepts.length === 1 ? "" : "s"} from your mistake book`;

  const summary =
    weak_concepts.length === 0
      ? "Wrong answers from Practice are saved automatically. Once you attempt questions, weak concepts appear here — not just chapters."
      : `Based on ${aggregates.reduce((s, a) => s + a.mistake_count, 0)} recent mistakes across practice. Exam readiness is ${readiness}%.`;

  const next_steps: string[] = [];
  if (weak_concepts.length > 0) {
    next_steps.push(`Fix mistakes on "${weak_concepts[0].concept}" in Recovery Zone today.`);
    if (weak_concepts.length > 1) {
      next_steps.push(`Schedule revision for "${weak_concepts[1].concept}" within 48 hours.`);
    }
    next_steps.push("Re-attempt similar problems in Practice after each recovery session.");
  } else {
    next_steps.push("Start a Class 12 practice session to build your mistake profile.");
    next_steps.push("Check back here after each session for concept-level gap analysis.");
  }

  return {
    headline,
    summary,
    weak_concepts,
    strong_concepts,
    next_steps,
    source: "rule",
  };
}

export async function loadAnalyticsInsights(
  snapshot: AcademicSnapshot | null,
  mastery: ConceptMasteryItem[],
  displayName?: string,
): Promise<{ insights: AnalyticsInsights; aggregates: MistakeConceptAggregate[]; mistakeCount: number }> {
  const mistakes = await fetchPracticeMistakesForAnalytics(25);
  const aggregates = aggregateWeakConceptsFromMistakes(mistakes);
  const ruleFallback = buildRuleAnalyticsInsights(aggregates, mastery, snapshot);

  if (mistakes.length === 0) {
    return { insights: ruleFallback, aggregates, mistakeCount: 0 };
  }

  const { data, error } = await invokeEdgeFunction<AnalyticsInsights & { source?: string }>(
    "ai-analytics-insights",
    {
      display_name: displayName ?? snapshot?.student?.full_name?.split(" ")[0] ?? "Student",
      exam_readiness: snapshot?.exam_readiness ?? {},
      mistake_summary: aggregates.slice(0, 12).map((a) => ({
        concept: a.concept,
        subject: a.subject,
        chapter: a.chapter ?? undefined,
        mistake_count: a.mistake_count,
        total_wrong: a.total_wrong,
        sample_question: a.sample_question,
      })),
      concept_mastery: mastery.slice(0, 15).map((m) => ({
        concept: m.concept,
        subject: m.subject,
        chapter: m.chapter,
        mastery_score: m.mastery_score,
        mistake_count: m.mistake_count,
      })),
      mistakes_detail: formatMistakesForPrompt(mistakes.slice(0, 12)),
    },
  );

  if (data && !error && data.weak_concepts) {
    return {
      insights: {
        headline: data.headline,
        summary: data.summary,
        weak_concepts: data.weak_concepts,
        strong_concepts: data.strong_concepts ?? ruleFallback.strong_concepts,
        next_steps: data.next_steps?.length ? data.next_steps : ruleFallback.next_steps,
        source: data.source === "gemini" ? "gemini" : "rule",
      },
      aggregates,
      mistakeCount: mistakes.length,
    };
  }

  if (error && !isAiUnavailableError(error)) {
    console.warn("analytics insights:", error);
  }

  return { insights: ruleFallback, aggregates, mistakeCount: mistakes.length };
}
