// Deep student analytics — topic-level diagnosis from mistake book via Gemini.
import { corsHeaders, generateStructuredWithFallback, jsonResponse } from "./gemini.ts";

const ANALYTICS_MODELS = [
  "gemini-2.5-flash",
  "gemini-2.0-flash",
  "gemini-2.5-flash-lite",
  "gemini-2.0-flash-lite",
];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const body = await req.json();
    const {
      display_name = "Student",
      exam_readiness = {},
      topic_summary = [],
      concept_mastery = [],
      mistakes_detail = "",
      mistakes_raw = [],
    } = body ?? {};

    const topics = (topic_summary as unknown[]) ?? [];
    const raw = (mistakes_raw as unknown[]) ?? [];

    if (topics.length === 0 && raw.length === 0 && !mistakes_detail) {
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
        next_steps: [
          "Start a Class 12 practice session with mixed questions.",
          "Review each wrong answer in your Mistake book.",
        ],
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
      topics as {
        topic: string;
        chapter?: string;
        subject: string;
        concept?: string;
        mistake_count: number;
        total_wrong: number;
        sample_question?: string;
        sample_wrong?: string;
        sample_correct?: string;
        last_seen?: string;
      }[]
    )
      .slice(0, 12)
      .map(
        (t) =>
          `- TOPIC: "${t.topic}" | Chapter: ${t.chapter ?? "unknown"} | ${t.subject} | ${t.mistake_count} wrong Qs, ${t.total_wrong} errors${t.concept ? ` | skill: ${t.concept}` : ""}${t.last_seen ? ` | last: ${t.last_seen}` : ""}${t.sample_wrong ? ` | picked "${t.sample_wrong}" not "${t.sample_correct ?? "?"}"` : ""}`,
      )
      .join("\n");

    const rawLines = (
      raw as {
        subject: string;
        chapter?: string;
        topic?: string;
        concept?: string;
        question: string;
        student_pick: string;
        correct_pick: string;
        explanation?: string;
        times_wrong: number;
        last_wrong_at?: string;
      }[]
    )
      .slice(0, 22)
      .map(
        (m, i) =>
          `${i + 1}. [${m.subject}${m.chapter ? ` · ${m.chapter}` : ""}${m.topic ? ` · TOPIC: ${m.topic}` : ""}]
   Q: ${m.question}
   Student picked: ${m.student_pick}
   Correct: ${m.correct_pick}${m.explanation ? `\n   Solution hint: ${m.explanation.slice(0, 450)}` : ""}
   Wrong ${m.times_wrong}x${m.last_wrong_at ? ` (last: ${m.last_wrong_at})` : ""}`,
      )
      .join("\n\n");

    const system =
      "You are a senior CBSE Class 12 NCERT tutor for Indian school students. " +
      "Analyse the student's ACTUAL wrong answers below — quote their mistakes, explain the thinking error, and prescribe fixes.\n\n" +
      "CRITICAL RULES:\n" +
      "- Name exact NCERT TOPICS (e.g. 'Integration by substitution'), NOT just chapter names.\n" +
      "- For EACH weak topic: read what they picked vs correct answer; explain WHY that wrong choice happens (misconception label + root cause).\n" +
      "- micro_drills: 2-3 tiny 5-minute tasks tied to THEIR specific errors.\n" +
      "- recurring_errors: cross-subject patterns (sign errors, formula mix-ups, etc.).\n" +
      "- today_focus: ONE concrete 20-30 min action for TODAY.\n" +
      "- weekly_plan: 3-5 blocks with time_minutes (15-45) and specific actions.\n" +
      "- momentum: improving vs slipping topics when mastery data supports it.\n" +
      "- diagnosis: 2-3 sentences on how this student thinks and where they slip.\n" +
      "Be specific, honest, encouraging. No invented URLs. No mention of AI or models.";

    const user = [
      `Student: ${display_name}`,
      `Exam readiness: ${exam_readiness.score ?? 0}% | accuracy ${exam_readiness.accuracy_pct ?? 0}% | attendance ${exam_readiness.attendance_pct ?? 0}%`,
      "",
      "=== Mistakes grouped by TOPIC ===",
      topicLines || "(infer topics from raw mistakes)",
      "",
      "=== Concept mastery ===",
      masteryLines || "none yet",
      "",
      "=== Raw wrong answers (analyse each deeply — use student_pick vs correct_pick) ===",
      rawLines || mistakes_detail.slice(0, 10000) || "none",
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
      required: ["topic", "subject", "why_weak", "fix_hint", "misconception"],
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
    }>({ system, user, schema, toolName: "deep_analytics" }, {
      models: ANALYTICS_MODELS,
      temperature: 0.7,
    });

    if (!result.ok) return jsonResponse({ error: result.error }, result.status);

    const normalizeSeverity = (s: string | undefined): "critical" | "moderate" | "mild" => {
      const l = (s ?? "").toLowerCase();
      if (l.includes("crit") || l.includes("urgent") || l.includes("severe")) return "critical";
      if (l.includes("mod") || l.includes("work")) return "moderate";
      return "mild";
    };

    const weak_topics = (result.data.weak_topics ?? []).map((w) => ({
      topic: w.topic ?? "Topic",
      chapter: w.chapter ?? "General",
      subject: w.subject ?? "General",
      concept: w.concept,
      severity: normalizeSeverity(w.severity),
      misconception: w.misconception ?? "Concept mix-up",
      why_weak: w.why_weak ?? "",
      root_cause: w.root_cause ?? "Review the underlying concept and method.",
      error_pattern: w.error_pattern,
      fix_hint: w.fix_hint ?? "",
      micro_drills: w.micro_drills ?? [],
      evidence: w.evidence,
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
        direction: ["improving", "slipping", "steady"].includes(m.direction)
          ? m.direction
          : "steady",
      })),
      next_steps: result.data.next_steps ?? [],
      source: "gemini",
    });
  } catch (e) {
    return jsonResponse({ error: String(e) }, 500);
  }
});
