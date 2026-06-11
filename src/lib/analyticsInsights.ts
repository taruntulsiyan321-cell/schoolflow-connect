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
  misconception?: string;
  why_weak: string;
  root_cause: string;
  error_pattern?: string;
  fix_hint: string;
  micro_drills?: string[];
  evidence?: string;
  ncert_ref?: string;
  mistake_count: number;
  total_wrong?: number;
  last_seen?: string | null;
};

/** @deprecated use TopicGapInsight */
export type WeakConceptInsight = TopicGapInsight;

export type StrongConceptInsight = {
  concept: string;
  subject: string;
  topic?: string;
  note: string;
};

export type StudyPlanItem = {
  topic: string;
  chapter: string;
  subject: string;
  time_minutes: number;
  action: string;
  priority: number;
};

export type MomentumSignal = {
  topic: string;
  subject: string;
  direction: "improving" | "slipping" | "steady";
  note: string;
};

export type RecurringError = {
  label: string;
  subjects: string[];
  explanation: string;
};

export type AnalyticsInsights = {
  headline: string;
  summary: string;
  diagnosis: string;
  today_focus: string;
  error_patterns: string[];
  recurring_errors: RecurringError[];
  weak_topics: TopicGapInsight[];
  weak_concepts: TopicGapInsight[];
  strong_concepts: StrongConceptInsight[];
  study_priority: string[];
  weekly_plan: StudyPlanItem[];
  momentum: MomentumSignal[];
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
  last_seen: string | null;
};

/** @deprecated alias */
export type MistakeConceptAggregate = MistakeTopicAggregate;

function pickAnswerText(m: MistakeRecord, kind: "student" | "correct"): string {
  const idx = kind === "student" ? m.student_answer?.selected_index : m.correct_answer?.correct_index;
  if (idx != null && m.options[idx]) return m.options[idx];
  const text = kind === "student" ? m.student_answer?.text : m.correct_answer?.text;
  return text ?? "(unknown)";
}

function normalizeTopicKey(topic: string, chapter: string | null, subject: string): string {
  const t = topic.trim().toLowerCase().replace(/\s+/g, " ");
  const c = (chapter ?? "general").trim().toLowerCase();
  const s = subject.trim().toLowerCase();
  return `${s}::${c}::${t}`;
}

export function formatLastSeen(iso: string | null | undefined): string {
  if (!iso) return "Recently";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "Recently";
  const days = Math.floor((Date.now() - then) / (1000 * 60 * 60 * 24));
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 7) return `${days} days ago`;
  if (days < 30) return `${Math.floor(days / 7)} wk ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
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

function inferMisconception(sampleWrong: string | undefined, sampleCorrect: string | undefined): string {
  if (!sampleWrong || !sampleCorrect || sampleWrong === "(unknown)") {
    return "Method or concept mix-up";
  }
  if (sampleWrong.length < 8 && sampleCorrect.length < 8) {
    return "Wrong option choice";
  }
  return "Applied the wrong method or formula";
}

function buildMicroDrills(topic: string, chapter: string | null): string[] {
  const ch = chapter ? ` (${chapter})` : "";
  return [
    `Without looking at notes, write the key formula or rule for "${topic}"${ch}.`,
    `Solve one easy NCERT example on "${topic}" — explain each step out loud.`,
    `Re-attempt your most recent wrong question on this topic without hints.`,
  ];
}

export function aggregateMistakesByTopic(mistakes: MistakeRecord[]): MistakeTopicAggregate[] {
  const map = new Map<string, MistakeTopicAggregate>();

  for (const m of mistakes) {
    const topic = (m.topic || m.concept || "Specific skills in this chapter").trim();
    const chapter = m.chapter?.trim() || null;
    const key = normalizeTopicKey(topic, chapter, m.subject);
    const seenAt = m.last_wrong_at ?? null;
    const existing = map.get(key);

    if (existing) {
      existing.mistake_count += 1;
      existing.total_wrong += m.times_wrong;
      if (seenAt && (!existing.last_seen || seenAt > existing.last_seen)) {
        existing.last_seen = seenAt;
      }
    } else {
      map.set(key, {
        topic,
        chapter,
        subject: m.subject,
        concept: m.concept,
        mistake_count: 1,
        total_wrong: m.times_wrong,
        sample_question: m.question_text.slice(0, 200),
        sample_wrong: pickAnswerText(m, "student"),
        sample_correct: pickAnswerText(m, "correct"),
        last_seen: seenAt,
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
  return aggregates.map((a) => {
    const misconception = inferMisconception(a.sample_wrong, a.sample_correct);
    return {
      topic: a.topic,
      chapter: a.chapter ?? "General",
      subject: a.subject,
      concept: a.concept ?? undefined,
      severity: severityFromWrong(a.total_wrong, a.mistake_count),
      misconception,
      why_weak: `You missed ${a.mistake_count} question${a.mistake_count === 1 ? "" : "s"} on "${a.topic}"${a.chapter ? ` in ${a.chapter}` : ""}. On a recent one you chose "${a.sample_wrong ?? "?"}" instead of "${a.sample_correct ?? "?"}".`,
      root_cause:
        a.mistake_count >= 2
          ? "This keeps coming up — likely a conceptual gap, not a one-off slip."
          : "Walk through where your working diverged from the correct approach.",
      error_pattern: a.mistake_count >= 2 ? `Repeated errors on ${a.topic}` : undefined,
      fix_hint: `Open NCERT on "${a.topic}"${a.chapter ? ` (${a.chapter})` : ""}, do the quick checks below, then fix matching mistakes in Recovery.`,
      micro_drills: buildMicroDrills(a.topic, a.chapter),
      evidence: a.sample_question ? `Recent question: "${a.sample_question.slice(0, 120)}…"` : undefined,
      mistake_count: a.mistake_count,
      total_wrong: a.total_wrong,
      last_seen: a.last_seen,
    };
  });
}

/** @deprecated */
export const aggregatesToWeakConcepts = aggregatesToTopicGaps;

function buildMomentumFromMastery(mastery: ConceptMasteryItem[]): MomentumSignal[] {
  const signals: MomentumSignal[] = [];

  for (const m of mastery) {
    if (m.mastery_score >= 78 && m.mistake_count <= 1 && m.total_attempts >= 3) {
      signals.push({
        topic: m.concept,
        subject: m.subject,
        direction: "improving",
        note: `${Math.round(m.mastery_score)}% mastery — keep mixing in harder questions.`,
      });
    } else if (m.mastery_score < 55 && m.mistake_count >= 2) {
      signals.push({
        topic: m.concept,
        subject: m.subject,
        direction: "slipping",
        note: `${m.mistake_count} recent mistakes — revisit before your next test.`,
      });
    }
  }

  return signals.slice(0, 5);
}

function buildWeeklyPlanFromGaps(gaps: TopicGapInsight[]): StudyPlanItem[] {
  return gaps.slice(0, 5).map((g, i) => ({
    topic: g.topic,
    chapter: g.chapter,
    subject: g.subject,
    time_minutes: g.severity === "critical" ? 45 : g.severity === "moderate" ? 30 : 20,
    action:
      i === 0
        ? `Fix mistakes in Recovery, then re-read NCERT on ${g.topic}.`
        : `Revise ${g.topic} and attempt 3 practice questions without hints.`,
    priority: i + 1,
  }));
}

function buildRecurringErrors(gaps: TopicGapInsight[]): RecurringError[] {
  const patterns = new Map<string, { subjects: Set<string>; count: number }>();

  for (const g of gaps) {
    const label = g.misconception || g.error_pattern || "Repeated wrong approach";
    const entry = patterns.get(label) ?? { subjects: new Set<string>(), count: 0 };
    entry.subjects.add(g.subject);
    entry.count += g.mistake_count;
    patterns.set(label, entry);
  }

  return [...patterns.entries()]
    .filter(([, v]) => v.count >= 2)
    .slice(0, 4)
    .map(([label, v]) => ({
      label,
      subjects: [...v.subjects],
      explanation: `Shows up across ${v.count} mistakes in ${[...v.subjects].join(", ")}.`,
    }));
}

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
    last_wrong_at: m.last_wrong_at ?? undefined,
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
  const momentum = buildMomentumFromMastery(mastery);
  const weekly_plan = buildWeeklyPlanFromGaps(weak_topics);
  const recurring_errors = buildRecurringErrors(weak_topics);

  const headline =
    weak_topics.length === 0
      ? "Your topic breakdown appears after your first mistakes"
      : top.severity === "critical"
        ? `"${top.topic}" needs urgent attention`
        : `${weak_topics.length} topic${weak_topics.length === 1 ? "" : "s"} to sharpen this week`;

  const summary =
    weak_topics.length === 0
      ? "Each wrong answer is traced to the exact NCERT topic and skill — not just the chapter name."
      : `We reviewed ${aggregates.reduce((s, a) => s + a.mistake_count, 0)} mistakes across ${weak_topics.length} topics. Exam readiness: ${readiness}%.`;

  const diagnosis =
    weak_topics.length === 0
      ? ""
      : `Mistakes cluster around ${weak_topics
          .slice(0, 3)
          .map((t) => `"${t.topic}" (${t.chapter})`)
          .join(", ")}. Tackle the highest-severity topic first — small daily fixes beat cramming.`;

  const today_focus =
    weak_topics.length === 0
      ? "Start a 15-minute practice session — your first mistakes unlock a personalised study plan."
      : `Today: spend 20–30 min on "${top.topic}" — re-read the NCERT section, do the quick checks, then fix ${top.mistake_count} mistake${top.mistake_count === 1 ? "" : "s"} in Recovery.`;

  const error_patterns =
    recurring_errors.length > 0
      ? recurring_errors.map((r) => r.label)
      : weak_topics.length >= 2
        ? [`Multiple errors in ${top.chapter}: ${top.topic}`, "Similar wrong-answer patterns on related question types"]
        : weak_topics.length === 1
          ? [`Errors concentrated in: ${top.topic}`]
          : [];

  const study_priority = weekly_plan.map(
    (item) => `${item.priority}. ${item.topic} (${item.chapter}, ${item.subject}) — ~${item.time_minutes} min`,
  );

  const next_steps: string[] = [];
  if (weak_topics.length > 0) {
    next_steps.push(today_focus.replace(/^Today:\s*/i, ""));
    if (weak_topics.length > 1) {
      next_steps.push(
        `This week: ${weak_topics[1].topic} — ${weak_topics[1].fix_hint.split(".")[0]}.`,
      );
    }
    next_steps.push("After each fix, re-attempt a similar question in Practice without hints.");
  } else {
    next_steps.push("Start practice — each wrong answer feeds topic-level analysis here.");
  }

  return {
    headline,
    summary,
    diagnosis,
    today_focus,
    error_patterns,
    recurring_errors,
    weak_topics,
    weak_concepts: weak_topics,
    strong_concepts,
    study_priority,
    weekly_plan,
    momentum,
    next_steps,
    source: "rule",
  };
}

export function linkForTopicGap(gap: TopicGapInsight): { to: string; label: string } {
  const params = new URLSearchParams({
    fix: "1",
    subject: gap.subject,
    chapter: gap.chapter,
    concept: gap.topic,
  });
  return { to: `/student/recovery?${params.toString()}`, label: "Fix this topic" };
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
  const weak_topics: TopicGapInsight[] = ((data.weak_topics as TopicGapInsight[]) ?? []).map((w, i) => {
    const fallback = ruleFallback.weak_topics[i] ?? ruleFallback.weak_topics[0];
    return {
      topic: w.topic || fallback?.topic || "Topic",
      chapter: w.chapter || fallback?.chapter || "General",
      subject: w.subject || fallback?.subject || "General",
      concept: w.concept ?? fallback?.concept,
      severity: normalizeSeverity(w.severity),
      misconception: w.misconception || fallback?.misconception,
      why_weak: w.why_weak || fallback?.why_weak || "",
      root_cause: w.root_cause || fallback?.root_cause || "Conceptual or procedural gap from your wrong answers.",
      error_pattern: w.error_pattern ?? fallback?.error_pattern,
      fix_hint: w.fix_hint || fallback?.fix_hint || "",
      micro_drills:
        (w.micro_drills as string[])?.length ? (w.micro_drills as string[]) : fallback?.micro_drills,
      evidence: w.evidence ?? fallback?.evidence,
      ncert_ref: w.ncert_ref ?? fallback?.ncert_ref,
      mistake_count: Math.max(1, w.mistake_count ?? fallback?.mistake_count ?? 1),
      total_wrong: w.total_wrong ?? fallback?.total_wrong,
      last_seen: w.last_seen ?? fallback?.last_seen,
    };
  });

  const weekly_plan: StudyPlanItem[] = ((data.weekly_plan as StudyPlanItem[]) ?? []).length
    ? (data.weekly_plan as StudyPlanItem[])
    : ruleFallback.weekly_plan;

  const momentum: MomentumSignal[] = ((data.momentum as MomentumSignal[]) ?? []).length
    ? (data.momentum as MomentumSignal[])
    : ruleFallback.momentum;

  const recurring_errors: RecurringError[] = ((data.recurring_errors as RecurringError[]) ?? []).length
    ? (data.recurring_errors as RecurringError[])
    : ruleFallback.recurring_errors;

  return {
    headline: String(data.headline || ruleFallback.headline),
    summary: String(data.summary || ruleFallback.summary),
    diagnosis: String(data.diagnosis || ruleFallback.diagnosis),
    today_focus: String(data.today_focus || ruleFallback.today_focus),
    error_patterns: (data.error_patterns as string[])?.length
      ? (data.error_patterns as string[])
      : ruleFallback.error_patterns,
    recurring_errors,
    weak_topics: weak_topics.length ? weak_topics : ruleFallback.weak_topics,
    weak_concepts: weak_topics.length ? weak_topics : ruleFallback.weak_topics,
    strong_concepts: (data.strong_concepts as StrongConceptInsight[])?.length
      ? (data.strong_concepts as StrongConceptInsight[])
      : ruleFallback.strong_concepts,
    study_priority: (data.study_priority as string[])?.length
      ? (data.study_priority as string[])
      : ruleFallback.study_priority,
    weekly_plan,
    momentum,
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
      last_seen: a.last_seen ?? undefined,
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
