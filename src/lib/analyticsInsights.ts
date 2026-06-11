import { invokeEdgeFunction, isAiUnavailableError } from "@/lib/edgeFunction";
import {
  fetchMistakesForAnalytics,
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

export function normalizeSeverity(raw: string | undefined): "critical" | "moderate" | "mild" {
  const l = (raw ?? "").toLowerCase();
  if (l.includes("crit") || l.includes("urgent") || l.includes("severe")) return "critical";
  if (l.includes("mod") || l.includes("work") || l.includes("need")) return "moderate";
  return "mild";
}

export function severityFromWrong(totalWrong: number, mistakeCount: number): "critical" | "moderate" | "mild" {
  if (totalWrong >= 5 || mistakeCount >= 4) return "critical";
  if (totalWrong >= 3 || mistakeCount >= 2) return "moderate";
  return "mild";
}

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

export function aggregatesToWeakConcepts(aggregates: MistakeConceptAggregate[]): WeakConceptInsight[] {
  return aggregates.map((a) => ({
    concept: a.concept,
    subject: a.subject,
    chapter: a.chapter ?? undefined,
    severity: severityFromWrong(a.total_wrong, a.mistake_count),
    why_weak: `You missed ${a.mistake_count} question${a.mistake_count === 1 ? "" : "s"} on this concept (${a.total_wrong} logged error${a.total_wrong === 1 ? "" : "s"}).`,
    fix_hint: `Open Recovery Zone and practise remedial questions on "${a.concept}" before new chapters.`,
    mistake_count: a.mistake_count,
  }));
}

export function buildRuleAnalyticsInsights(
  aggregates: MistakeConceptAggregate[],
  mastery: ConceptMasteryItem[],
  snapshot: AcademicSnapshot | null,
): AnalyticsInsights {
  const weak_concepts = aggregatesToWeakConcepts(aggregates).slice(0, 8);

  const strong_concepts: StrongConceptInsight[] = mastery
    .filter((m) => m.mastery_score >= 75 && m.mistake_count <= 1)
    .slice(0, 4)
    .map((m) => ({
      concept: m.concept,
      subject: m.subject,
      note: `${Math.round(m.mastery_score)}% mastery with few recent errors.`,
    }));

  const readiness = snapshot?.exam_readiness?.score ?? 0;
  const headline =
    weak_concepts.length === 0
      ? "No concept gaps from mistakes yet"
      : weak_concepts[0].severity === "critical"
        ? `${weak_concepts[0].concept} needs urgent attention`
        : `${weak_concepts.length} concept${weak_concepts.length === 1 ? "" : "s"} to fix from your mistake book`;

  const summary =
    weak_concepts.length === 0
      ? "Wrong answers are saved to your mistake book. Concept-level gaps appear here after practice, DPP, or battles."
      : `Based on ${aggregates.reduce((s, a) => s + a.mistake_count, 0)} mistakes grouped into ${weak_concepts.length} concept${weak_concepts.length === 1 ? "" : "s"}. Readiness: ${readiness}%.`;

  const next_steps: string[] = [];
  if (weak_concepts.length > 0) {
    next_steps.push(`Fix mistakes on "${weak_concepts[0].concept}" in Recovery Zone today.`);
    if (weak_concepts.length > 1) {
      next_steps.push(`Revise "${weak_concepts[1].concept}" within 48 hours.`);
    }
    next_steps.push("Re-attempt similar problems in Practice after each recovery session.");
  } else {
    next_steps.push("Start a practice session — wrong answers unlock concept gap analysis.");
    next_steps.push("Check your Mistake book after each session.");
  }

  return { headline, summary, weak_concepts, strong_concepts, next_steps, source: "rule" };
}

export function linkForActionStep(text: string): { to: string; label: string } {
  const t = text.toLowerCase();
  if (t.includes("recovery") || t.includes("fix mistake") || t.includes("remedial")) {
    return { to: "/student/recovery", label: "Recovery zone" };
  }
  if (t.includes("mistake book") || t.includes("mistake")) {
    return { to: "/student/mistakes", label: "Mistake book" };
  }
  if (t.includes("revision") || t.includes("revise")) {
    return { to: "/student/revision", label: "Revision" };
  }
  if (t.includes("dpp")) {
    return { to: "/student/dpp", label: "Daily DPP" };
  }
  if (t.includes("practice")) {
    return { to: "/student/practice/math12", label: "Practice" };
  }
  return { to: "/student/recovery", label: "Take action" };
}

function normalizeGeminiInsights(
  data: AnalyticsInsights & { source?: string },
  ruleFallback: AnalyticsInsights,
): AnalyticsInsights {
  return {
    headline: data.headline || ruleFallback.headline,
    summary: data.summary || ruleFallback.summary,
    weak_concepts: (data.weak_concepts ?? []).map((w) => ({
      concept: w.concept,
      subject: w.subject,
      chapter: w.chapter,
      severity: normalizeSeverity(w.severity),
      why_weak: w.why_weak,
      fix_hint: w.fix_hint,
      mistake_count: Math.max(1, w.mistake_count ?? 1),
    })),
    strong_concepts: data.strong_concepts?.length ? data.strong_concepts : ruleFallback.strong_concepts,
    next_steps: data.next_steps?.length ? data.next_steps : ruleFallback.next_steps,
    source: data.source === "gemini" ? "gemini" : "rule",
  };
}

export async function fetchMistakeAnalyticsBase(snapshot: AcademicSnapshot | null, mastery: ConceptMasteryItem[]) {
  const mistakes = await fetchMistakesForAnalytics(25);
  const aggregates = aggregateWeakConceptsFromMistakes(mistakes);
  const insights = buildRuleAnalyticsInsights(aggregates, mastery, snapshot);
  return { mistakes, aggregates, insights, mistakeCount: mistakes.length };
}

export async function enhanceAnalyticsWithGemini(
  snapshot: AcademicSnapshot | null,
  mastery: ConceptMasteryItem[],
  mistakes: MistakeRecord[],
  aggregates: MistakeConceptAggregate[],
  ruleFallback: AnalyticsInsights,
  displayName?: string,
): Promise<AnalyticsInsights> {
  if (mistakes.length === 0) return ruleFallback;

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

  if (data && !error) {
    const normalized = normalizeGeminiInsights(data, ruleFallback);
    if (normalized.weak_concepts.length > 0) return normalized;
  }

  if (error && !isAiUnavailableError(error)) {
    console.warn("analytics insights:", error);
  }

  return ruleFallback;
}
