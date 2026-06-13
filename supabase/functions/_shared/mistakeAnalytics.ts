import { generateStructuredWithFallback, jsonResponse } from "./gemini.ts";

const ANALYTICS_MODELS = [
  "gemini-2.5-flash",
  "gemini-2.0-flash",
  "gemini-2.5-flash-lite",
  "gemini-2.0-flash-lite",
];

type TopicMistakeBundle = {
  topic: string;
  chapter?: string;
  subject: string;
  mistake_count: number;
  questions: {
    question: string;
    options?: string[];
    student_pick: string;
    correct_pick: string;
    explanation?: string;
    times_wrong?: number;
  }[];
};

function normalizeSeverity(s: string | undefined): "critical" | "moderate" | "mild" {
  const l = (s ?? "").toLowerCase();
  if (l.includes("crit") || l.includes("urgent") || l.includes("severe")) return "critical";
  if (l.includes("mod") || l.includes("work")) return "moderate";
  return "mild";
}

function formatOptions(options: string[] | undefined): string {
  if (!options?.length) return "";
  return options.map((o, j) => `${String.fromCharCode(65 + j)}. ${o}`).join(" | ");
}

export async function handleMistakeAnalyticsRequest(body: Record<string, unknown>): Promise<Response> {
  const display_name = (body.display_name as string) ?? "Student";
  const exam_readiness = (body.exam_readiness as Record<string, unknown>) ?? {};
  const topic_summary = (body.topic_summary as unknown[]) ?? [];
  const concept_mastery = (body.concept_mastery as unknown[]) ?? [];
  const mistakes_detail = (body.mistakes_detail as string) ?? "";
  const mistakes_raw = (body.mistakes_raw as unknown[]) ?? [];
  const topic_mistakes = (body.topic_mistakes as TopicMistakeBundle[]) ?? [];

  if (topic_summary.length === 0 && mistakes_raw.length === 0 && !mistakes_detail && topic_mistakes.length === 0) {
    return jsonResponse({
      headline: "No mistakes logged yet",
      summary: "Complete practice — wrong answers unlock deep topic-level analysis here.",
      diagnosis: "",
      today_focus: "Start a 15-minute practice session today.",
      error_patterns: [],
      recurring_errors: [],
      weak_topics: [],
      strong_concepts: [],
      study_priority: [],
      weekly_plan: [],
      momentum: [],
      next_steps: ["Start a practice session and review each wrong answer in Recovery."],
      source: "rule",
    });
  }

  const masteryLines = (
    concept_mastery as { concept: string; subject: string; chapter?: string; mastery_score: number; mistake_count?: number }[]
  )
    .slice(0, 15)
    .map(
      (m) =>
        `${m.concept} | ${m.subject}${m.chapter ? ` · ${m.chapter}` : ""}: ${Math.round(m.mastery_score)}% mastery, ${m.mistake_count ?? 0} mistakes`,
    )
    .join("\n");

  const topicLines = (
    topic_summary as {
      topic: string;
      chapter?: string;
      subject: string;
      concept?: string;
      mistake_count: number;
      total_wrong: number;
      sample_wrong?: string;
      sample_correct?: string;
    }[]
  )
    .slice(0, 12)
    .map(
      (t) =>
        `- TOPIC: "${t.topic}" | Chapter: ${t.chapter ?? "unknown"} | ${t.subject} | ${t.mistake_count} wrong Qs${t.sample_wrong ? ` | picked "${t.sample_wrong}" not "${t.sample_correct ?? "?"}"` : ""}`,
    )
    .join("\n");

  const bundleLines = topic_mistakes
    .slice(0, 10)
    .map((bundle) => {
      const qs = bundle.questions
        .slice(0, 5)
        .map((q, i) => {
          const opts = formatOptions(q.options);
          return `   Q${i + 1}: ${q.question}
   Options: ${opts || "(not provided)"}
   Student picked: "${q.student_pick}"
   Correct: "${q.correct_pick}"${q.explanation ? `\n   Solution: ${q.explanation.slice(0, 500)}` : ""}${q.times_wrong ? ` (wrong ${q.times_wrong}x)` : ""}`;
        })
        .join("\n");
      return `### ${bundle.topic} (${bundle.chapter ?? "chapter?"}) · ${bundle.subject} — ${bundle.mistake_count} mistakes\n${qs}`;
    })
    .join("\n\n");

  const rawLines = (
    mistakes_raw as {
      subject: string;
      chapter?: string;
      topic?: string;
      question: string;
      options?: string[];
      student_pick: string;
      correct_pick: string;
      explanation?: string;
      times_wrong: number;
    }[]
  )
    .slice(0, 28)
    .map(
      (m, i) =>
        `${i + 1}. [${m.subject}${m.chapter ? ` · ${m.chapter}` : ""}${m.topic ? ` · ${m.topic}` : ""}]
   Q: ${m.question}
   Options: ${formatOptions(m.options) || "—"}
   Student picked: "${m.student_pick}"
   Correct: "${m.correct_pick}"${m.explanation ? `\n   Solution: ${m.explanation.slice(0, 500)}` : ""}
   Wrong ${m.times_wrong}x`,
    )
    .join("\n\n");

  const system =
    "You are a senior CBSE Class 12 NCERT tutor. Analyse EVERY wrong answer below.\n\n" +
    "MANDATORY FOR EACH weak_topic:\n" +
    "1. Quote the actual question snippet and what the student picked vs the correct answer.\n" +
    "2. Label the thinking error (misconception) — e.g. sign error, wrong formula, misread question.\n" +
    "3. Explain root_cause in plain language a student understands.\n" +
    "4. evidence field MUST cite their specific wrong pick.\n" +
    "5. micro_drills: 2-4 five-minute tasks tied to THEIR exact errors.\n\n" +
    "Also provide: diagnosis (how this student thinks), today_focus (one 20-30 min action), " +
    "recurring_errors across topics, weekly_plan with time_minutes.\n" +
    "No invented URLs. Never mention AI, Gemini, or models.";

  const user = [
    `Student: ${display_name}`,
    `Exam readiness: ${exam_readiness.score ?? 0}% | accuracy ${exam_readiness.accuracy_pct ?? 0}%`,
    "",
    "=== Topics with mistake counts ===",
    topicLines || "(infer from questions below)",
    "",
    "=== Questions grouped by topic (PRIMARY SOURCE — analyse each) ===",
    bundleLines || "(see flat list below)",
    "",
    "=== All wrong answers (flat list) ===",
    rawLines || mistakes_detail.slice(0, 12000) || "none",
    "",
    "=== Concept mastery ===",
    masteryLines || "none yet",
  ].join("\n");

  const gapItemSchema = {
    type: "object",
    properties: {
      topic: { type: "string" },
      chapter: { type: "string" },
      subject: { type: "string" },
      concept: { type: "string" },
      severity: { type: "string" },
      misconception: { type: "string" },
      why_weak: { type: "string" },
      root_cause: { type: "string" },
      error_pattern: { type: "string" },
      fix_hint: { type: "string" },
      micro_drills: { type: "array", items: { type: "string" } },
      evidence: { type: "string" },
      ncert_ref: { type: "string" },
      mistake_count: { type: "number" },
    },
    required: ["topic", "subject", "why_weak", "fix_hint", "misconception", "evidence"],
  };

  const schema = {
    type: "object",
    properties: {
      headline: { type: "string" },
      summary: { type: "string" },
      diagnosis: { type: "string" },
      today_focus: { type: "string" },
      error_patterns: { type: "array", items: { type: "string" } },
      recurring_errors: {
        type: "array",
        items: {
          type: "object",
          properties: {
            label: { type: "string" },
            subjects: { type: "array", items: { type: "string" } },
            explanation: { type: "string" },
          },
        },
      },
      weak_topics: { type: "array", items: gapItemSchema },
      strong_concepts: {
        type: "array",
        items: {
          type: "object",
          properties: {
            concept: { type: "string" },
            subject: { type: "string" },
            topic: { type: "string" },
            note: { type: "string" },
          },
        },
      },
      study_priority: { type: "array", items: { type: "string" } },
      weekly_plan: {
        type: "array",
        items: {
          type: "object",
          properties: {
            topic: { type: "string" },
            chapter: { type: "string" },
            subject: { type: "string" },
            time_minutes: { type: "number" },
            action: { type: "string" },
            priority: { type: "number" },
          },
        },
      },
      momentum: {
        type: "array",
        items: {
          type: "object",
          properties: {
            topic: { type: "string" },
            subject: { type: "string" },
            direction: { type: "string" },
            note: { type: "string" },
          },
        },
      },
      next_steps: { type: "array", items: { type: "string" } },
    },
    required: ["headline", "diagnosis", "today_focus", "weak_topics", "next_steps"],
  };

  const result = await generateStructuredWithFallback<{
    headline: string;
    summary: string;
    diagnosis: string;
    today_focus: string;
    error_patterns: string[];
    recurring_errors?: { label: string; subjects: string[]; explanation: string }[];
    weak_topics: {
      topic: string;
      chapter: string;
      subject: string;
      concept?: string;
      severity: string;
      misconception: string;
      why_weak: string;
      root_cause: string;
      error_pattern?: string;
      fix_hint: string;
      micro_drills: string[];
      evidence?: string;
      ncert_ref?: string;
      mistake_count: number;
    }[];
    strong_concepts?: { concept: string; subject: string; topic?: string; note: string }[];
    study_priority: string[];
    weekly_plan: {
      topic: string;
      chapter: string;
      subject: string;
      time_minutes: number;
      action: string;
      priority: number;
    }[];
    momentum?: { topic: string; subject: string; direction: string; note: string }[];
    next_steps: string[];
  }>({ system, user, schema, toolName: "deep_mistake_analytics" }, {
    models: ANALYTICS_MODELS,
    temperature: 0.55,
  });

  if (!result.ok) return jsonResponse({ error: result.error }, result.status);

  const weak_topics = (result.data.weak_topics ?? []).map((w) => ({
    topic: w.topic ?? "Topic",
    chapter: w.chapter ?? "General",
    subject: w.subject ?? "General",
    concept: w.concept,
    severity: normalizeSeverity(w.severity),
    misconception: w.misconception ?? "Method mix-up",
    why_weak: w.why_weak ?? "",
    root_cause: w.root_cause ?? "Review where your working diverged from the correct method.",
    error_pattern: w.error_pattern,
    fix_hint: w.fix_hint ?? "",
    micro_drills: w.micro_drills ?? [],
    evidence: w.evidence ?? "",
    ncert_ref: w.ncert_ref,
    mistake_count: Math.max(1, w.mistake_count ?? 1),
  }));

  return jsonResponse({
    headline: result.data.headline ?? "",
    summary: result.data.summary ?? "",
    diagnosis: result.data.diagnosis ?? "",
    today_focus: result.data.today_focus ?? "",
    error_patterns: result.data.error_patterns ?? [],
    recurring_errors: result.data.recurring_errors ?? [],
    weak_topics,
    strong_concepts: result.data.strong_concepts ?? [],
    study_priority: result.data.study_priority ?? [],
    weekly_plan: result.data.weekly_plan ?? [],
    momentum: (result.data.momentum ?? []).map((m) => ({
      ...m,
      direction: ["improving", "slipping", "steady"].includes(m.direction) ? m.direction : "steady",
    })),
    next_steps: result.data.next_steps ?? [],
    source: "gemini",
  });
}
