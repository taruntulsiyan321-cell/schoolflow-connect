import { invokeEdgeFunction, isAiUnavailableError } from "@/lib/edgeFunction";
import { fetchMistakesForAnalytics, type MistakeRecord } from "@/lib/mistakeRecovery";
import type { AcademicSnapshot } from "@/hooks/useStudentAcademicSnapshot";
import type { ConceptMasteryItem } from "@/hooks/useConceptMastery";

export type TopicGapInsight = {
  topic: string;
  chapter: string;
  subject: string;
  concept?: string;
  severity: "critical" | "moderate" | "mild";
  why_weak: string;
  root_cause: string;
  error_pattern?: string;
  fix_hint: string;
  ncert_ref?: string;
  mistake_count: number;
};

/** @deprecated use TopicGapInsight */
export type WeakConceptInsight = TopicGapInsight;

export type StrongConceptInsight = {
  concept: string;
  subject: string;
  topic?: string;
  note: string;
};

export type AnalyticsInsights = {
  headline: string;
  summary: string;
  diagnosis: string;
  error_patterns: string[];
  weak_topics: TopicGapInsight[];
  weak_concepts: TopicGapInsight[];
  strong_concepts: StrongConceptInsight[];
  study_priority: string[];
  next_steps: string[];
  source: "gemini" | "rule";
};

export type MistakeTopicAggregate = {
  topic: string;
  chapter: string | null;
  subject: string;
  concept: string | null;
  mistake_count: number;
  total_wrong: number;
  sample_question: string;
  sample_wrong?: string;
  sample_correct?: string;
};

/** @deprecated alias */
export type MistakeConceptAggregate = MistakeTopicAggregate;

function pickAnswerText(m: MistakeRecord, kind: "student" | "correct"): string {
  const idx = kind === "student" ? m.student_answer?.selected_index : m.correct_answer?.correct_index;
  if (idx != null && m.options[idx]) return m.options[idx];
  const text = kind === "student" ? m.student_answer?.text : m.correct_answer?.text;
  return text ?? "(unknown)";
}

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

export function aggregateMistakesByTopic(mistakes: MistakeRecord[]): MistakeTopicAggregate[] {
  const map = new Map<string, MistakeTopicAggregate>();

  for (const m of mistakes) {
    const topic = m.topic || m.concept || "Specific skills in this chapter";
    const chapter = m.chapter || "General";
    const key = `${m.subject}::${chapter}::${topic}`;
    const existing = map.get(key);
    if (existing) {
      existing.mistake_count += 1;
      existing.total_wrong += m.times_wrong;
    } else {
      map.set(key, {
        topic,
        chapter: m.chapter,
        subject: m.subject,
        concept: m.concept,
        mistake_count: 1,
        total_wrong: m.times_wrong,
        sample_question: m.question_text.slice(0, 200),
        sample_wrong: pickAnswerText(m, "student"),
        sample_correct: pickAnswerText(m, "correct"),
      });
    }
  }

  return [...map.values()].sort(
    (a, b) => b.total_wrong - a.total_wrong || b.mistake_count - a.mistake_count,
  );
}

/** @deprecated */
export const aggregateWeakConceptsFromMistakes = aggregateMistakesByTopic;

export function aggregatesToTopicGaps(aggregates: MistakeTopicAggregate[]): TopicGapInsight[] {
  return aggregates.map((a) => ({
    topic: a.topic,
    chapter: a.chapter ?? "General",
    subject: a.subject,
    concept: a.concept ?? undefined,
    severity: severityFromWrong(a.total_wrong, a.mistake_count),
    why_weak: `Missed ${a.mistake_count} question${a.mistake_count === 1 ? "" : "s"} on "${a.topic}"${a.chapter ? ` in ${a.chapter}` : ""}. You picked "${a.sample_wrong ?? "?"}" instead of "${a.sample_correct ?? "?"}".`,
    root_cause: "Review the exact step where your approach diverged from the correct method.",
    error_pattern: a.mistake_count >= 2 ? `Repeated errors on ${a.topic}` : undefined,
    fix_hint: `Re-read NCERT on "${a.topic}"${a.chapter ? ` (${a.chapter})` : ""}, then fix mistakes in Recovery Zone.`,
    mistake_count: a.mistake_count,
  }));
}

/** @deprecated */
export const aggregatesToWeakConcepts = aggregatesToTopicGaps;

function buildMistakesRawPayload(mistakes: MistakeRecord[]) {
  return mistakes.slice(0, 20).map((m) => ({
    subject: m.subject,
    chapter: m.chapter ?? undefined,
    topic: m.topic ?? undefined,
    concept: m.concept ?? undefined,
    question: m.question_text.slice(0, 350),
    student_pick: pickAnswerText(m, "student"),
    correct_pick: pickAnswerText(m, "correct"),
    times_wrong: m.times_wrong,
  }));
}

export function buildRuleAnalyticsInsights(
  aggregates: MistakeTopicAggregate[],
  mastery: ConceptMasteryItem[],
  snapshot: AcademicSnapshot | null,
): AnalyticsInsights {
  const weak_topics = aggregatesToTopicGaps(aggregates).slice(0, 10);

  const strong_concepts: StrongConceptInsight[] = mastery
    .filter((m) => m.mastery_score >= 75 && m.mistake_count <= 1)
    .slice(0, 4)
    .map((m) => ({
      concept: m.concept,
      subject: m.subject,
      topic: m.chapter,
      note: `${Math.round(m.mastery_score)}% mastery — keep revising with mixed problems.`,
    }));

  const readiness = snapshot?.exam_readiness?.score ?? 0;
  const top = weak_topics[0];

  const headline =
    weak_topics.length === 0
      ? "Topic analysis unlocks after your first mistakes"
      : top.severity === "critical"
        ? `"${top.topic}" needs urgent work`
        : `${weak_topics.length} topic${weak_topics.length === 1 ? "" : "s"} need focused revision`;

  const summary =
    weak_topics.length === 0
      ? "We analyse each wrong answer to find the exact NCERT topic and skill you're missing — not just the chapter."
      : `Deep dive on ${aggregates.reduce((s, a) => s + a.mistake_count, 0)} mistakes across ${weak_topics.length} topics. Readiness: ${readiness}%.`;

  const diagnosis =
    weak_topics.length === 0
      ? ""
      : `Your mistakes cluster around ${weak_topics.slice(0, 3).map((t) => `"${t.topic}" (${t.chapter})`).join(", ")}. Focus on topic-level revision before moving to new chapters.`;

  const error_patterns =
    weak_topics.length >= 2
      ? [`Multiple errors in ${top.chapter}: ${top.topic}`, `Review pattern: wrong answer choices on similar question types`]
      : weak_topics.length === 1
        ? [`Errors concentrated in topic: ${top.topic}`]
        : [];

  const study_priority = weak_topics.slice(0, 5).map(
    (t, i) => `${i + 1}. ${t.topic} (${t.chapter}, ${t.subject})`,
  );

  const next_steps: string[] = [];
  if (weak_topics.length > 0) {
    next_steps.push(`Today: Recovery Zone on "${weak_topics[0].topic}" in ${weak_topics[0].chapter}.`);
    if (weak_topics.length > 1) {
      next_steps.push(`This week: NCERT revision of "${weak_topics[1].topic}" then 5 practice questions.`);
    }
    next_steps.push("After each fix, re-attempt a similar question in Practice without hints.");
  } else {
    next_steps.push("Start practice — each wrong answer feeds topic-level analysis here.");
  }

  return {
    headline,
    summary,
    diagnosis,
    error_patterns,
    weak_topics,
    weak_concepts: weak_topics,
    strong_concepts,
    study_priority,
    next_steps,
    source: "rule",
  };
}

export function linkForActionStep(text: string): { to: string; label: string } {
  const t = text.toLowerCase();
  if (t.includes("recovery") || t.includes("fix mistake") || t.includes("remedial")) {
    return { to: "/student/recovery", label: "Recovery zone" };
  }
  if (t.includes("mistake book") || t.includes("mistake")) {
    return { to: "/student/mistakes", label: "Mistake book" };
  }
  if (t.includes("revision") || t.includes("revise") || t.includes("ncert")) {
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
  data: Record<string, unknown>,
  ruleFallback: AnalyticsInsights,
): AnalyticsInsights {
  const weak_topics: TopicGapInsight[] = ((data.weak_topics as TopicGapInsight[]) ?? []).map((w) => ({
    topic: w.topic || ruleFallback.weak_topics[0]?.topic || "Topic",
    chapter: w.chapter || "General",
    subject: w.subject || "General",
    concept: w.concept,
    severity: normalizeSeverity(w.severity),
    why_weak: w.why_weak,
    root_cause: w.root_cause || "Conceptual or procedural gap identified from your wrong answers.",
    error_pattern: w.error_pattern,
    fix_hint: w.fix_hint,
    ncert_ref: w.ncert_ref,
    mistake_count: Math.max(1, w.mistake_count ?? 1),
  }));

  return {
    headline: String(data.headline || ruleFallback.headline),
    summary: String(data.summary || ruleFallback.summary),
    diagnosis: String(data.diagnosis || ruleFallback.diagnosis),
    error_patterns: (data.error_patterns as string[])?.length
      ? (data.error_patterns as string[])
      : ruleFallback.error_patterns,
    weak_topics: weak_topics.length ? weak_topics : ruleFallback.weak_topics,
    weak_concepts: weak_topics.length ? weak_topics : ruleFallback.weak_topics,
    strong_concepts: (data.strong_concepts as StrongConceptInsight[])?.length
      ? (data.strong_concepts as StrongConceptInsight[])
      : ruleFallback.strong_concepts,
    study_priority: (data.study_priority as string[])?.length
      ? (data.study_priority as string[])
      : ruleFallback.study_priority,
    next_steps: (data.next_steps as string[])?.length
      ? (data.next_steps as string[])
      : ruleFallback.next_steps,
    source: data.source === "gemini" ? "gemini" : "rule",
  };
}

export async function fetchMistakeAnalyticsBase(snapshot: AcademicSnapshot | null, mastery: ConceptMasteryItem[]) {
  const mistakes = await fetchMistakesForAnalytics(35);
  const aggregates = aggregateMistakesByTopic(mistakes);
  const insights = buildRuleAnalyticsInsights(aggregates, mastery, snapshot);
  return { mistakes, aggregates, insights, mistakeCount: mistakes.length };
}

export async function enhanceAnalyticsWithGemini(
  snapshot: AcademicSnapshot | null,
  mastery: ConceptMasteryItem[],
  mistakes: MistakeRecord[],
  aggregates: MistakeTopicAggregate[],
  ruleFallback: AnalyticsInsights,
  displayName?: string,
): Promise<AnalyticsInsights> {
  if (mistakes.length === 0) return ruleFallback;

  const { data, error } = await invokeEdgeFunction<Record<string, unknown>>("ai-analytics-insights", {
    display_name: displayName ?? snapshot?.student?.full_name?.split(" ")[0] ?? "Student",
    exam_readiness: snapshot?.exam_readiness ?? {},
    topic_summary: aggregates.slice(0, 15).map((a) => ({
      topic: a.topic,
      chapter: a.chapter ?? undefined,
      subject: a.subject,
      concept: a.concept ?? undefined,
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
    mistakes_raw: buildMistakesRawPayload(mistakes),
  });

  if (data && !error) {
    const normalized = normalizeGeminiInsights(data, ruleFallback);
    if (normalized.weak_topics.length > 0) return normalized;
  }

  if (error && !isAiUnavailableError(error)) {
    console.warn("analytics insights:", error);
  }

  return ruleFallback;
}
