// Deep student analytics — topic-level diagnosis from mistake book via Gemini.
import { corsHeaders, generateStructured, jsonResponse } from "./gemini.ts";

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
        last_seen?: string;
      }[]
    )
      .slice(0, 12)
      .map(
        (t) =>
          `- TOPIC: "${t.topic}" | Chapter: ${t.chapter ?? "unknown"} | ${t.subject} | ${t.mistake_count} wrong Qs, ${t.total_wrong} errors${t.concept ? ` | skill: ${t.concept}` : ""}${t.last_seen ? ` | last seen: ${t.last_seen}` : ""}`,
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
        times_wrong: number;
        last_wrong_at?: string;
      }[]
    )
      .slice(0, 18)
      .map(
        (m, i) =>
          `${i + 1}. [${m.subject}${m.chapter ? ` · ${m.chapter}` : ""}${m.topic ? ` · TOPIC: ${m.topic}` : ""}]
   Q: ${m.question}
   Student picked: ${m.student_pick}
   Correct: ${m.correct_pick}
   Wrong ${m.times_wrong}x${m.last_wrong_at ? ` (last: ${m.last_wrong_at})` : ""}`,
      )
      .join("\n\n");

    const system =
      "You are a senior CBSE Class 12 NCERT tutor for Indian school students. " +
      "Write like a smart, caring tutor explaining what's wrong and exactly what to do — plain language, no jargon about models or AI.\n\n" +
      "The student ALREADY knows which chapters are weak — do NOT only repeat chapter names.\n" +
      "Your job is DEEP TOPIC-LEVEL analysis from their mistake book:\n" +
      "1. Name the exact NCERT TOPIC within each chapter (e.g. 'Integration by substitution', NOT just 'Integrals').\n" +
      "2. For each weak topic: give a short misconception label (2-5 words), why they likely got it wrong, root cause, and 2-3 micro_drills (plain-text check questions or mini-tasks they can do in 5 min).\n" +
      "3. Detect recurring_errors across subjects — label the error TYPE (e.g. 'sign errors in algebra', 'limits vs continuity confusion') with which subjects it appears in.\n" +
      "4. error_patterns: short chip-friendly phrases summarising cross-topic patterns.\n" +
      "5. today_focus: ONE concrete sentence — what to do in the next 20-30 minutes today.\n" +
      "6. weekly_plan: 3-5 prioritised study blocks with time_minutes (15-45) and a specific action per topic.\n" +
      "7. momentum: topics improving (mastery high, few mistakes) vs slipping (recent mistakes, low mastery) if data supports it.\n" +
      "8. NCERT section references when confident (e.g. 'NCERT Maths Ch 7 §7.2').\n" +
      "9. diagnosis: 2-3 sentences on how they think and where they're slipping overall.\n" +
      "Be specific, honest, encouraging. No invented URLs.";

    const user = [
      `Student: ${display_name}`,
      `Exam readiness: ${exam_readiness.score ?? 0}% | accuracy ${exam_readiness.accuracy_pct ?? 0}% | attendance ${exam_readiness.attendance_pct ?? 0}%`,
      "",
      "=== Mistakes grouped by TOPIC ===",
      topicLines || "(infer from raw mistakes below)",
      "",
      "=== Concept mastery ===",
      masteryLines || "none yet",
      "",
      "=== Raw wrong answers (analyse deeply) ===",
      rawLines || mistakes_detail.slice(0, 8000) || "none",
    ].join("\n");

    const gapItemSchema = {
      type: "object",
      properties: {
        topic: { type: "string", description: "Specific NCERT topic name, not just chapter" },
        chapter: { type: "string" },
        subject: { type: "string" },
        concept: { type: "string", description: "Micro-skill within topic" },
        severity: { type: "string", enum: ["critical", "moderate", "mild"] },
        misconception: { type: "string", description: "Short 2-5 word label for the wrong thinking" },
        why_weak: { type: "string", description: "Plain explanation of what they get wrong and why" },
        root_cause: { type: "string", description: "Underlying reason: conceptual, procedural, careless" },
        error_pattern: { type: "string", description: "Recurring mistake pattern for this topic" },
        fix_hint: { type: "string", description: "Concrete fix: what to revise and practise today" },
        micro_drills: {
          type: "array",
          items: { type: "string" },
          description: "2-3 quick check questions or 5-min tasks",
        },
        evidence: { type: "string", description: "Brief evidence from their mistakes" },
        ncert_ref: { type: "string", description: "NCERT reference if known" },
        mistake_count: { type: "number" },
      },
      required: [
        "topic",
        "chapter",
        "subject",
        "severity",
        "misconception",
        "why_weak",
        "root_cause",
        "fix_hint",
        "micro_drills",
        "mistake_count",
      ],
    };

    const schema = {
      type: "object",
      properties: {
        headline: { type: "string" },
        summary: { type: "string" },
        diagnosis: { type: "string" },
        today_focus: { type: "string", description: "One actionable sentence for today" },
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
            required: ["label", "subjects", "explanation"],
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
            required: ["concept", "subject", "note"],
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
            required: ["topic", "chapter", "subject", "time_minutes", "action", "priority"],
          },
        },
        momentum: {
          type: "array",
          items: {
            type: "object",
            properties: {
              topic: { type: "string" },
              subject: { type: "string" },
              direction: { type: "string", enum: ["improving", "slipping", "steady"] },
              note: { type: "string" },
            },
            required: ["topic", "subject", "direction", "note"],
          },
        },
        next_steps: { type: "array", items: { type: "string" } },
      },
      required: [
        "headline",
        "summary",
        "diagnosis",
        "today_focus",
        "weak_topics",
        "error_patterns",
        "study_priority",
        "weekly_plan",
        "next_steps",
      ],
    };

    const result = await generateStructured<{
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
        severity: "critical" | "moderate" | "mild";
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
      momentum?: { topic: string; subject: string; direction: "improving" | "slipping" | "steady"; note: string }[];
      next_steps: string[];
    }>({ system, user, schema, toolName: "deep_analytics" });

    if (!result.ok) return jsonResponse({ error: result.error }, result.status);

    return jsonResponse({
      headline: result.data.headline ?? "",
      summary: result.data.summary ?? "",
      diagnosis: result.data.diagnosis ?? "",
      today_focus: result.data.today_focus ?? "",
      error_patterns: result.data.error_patterns ?? [],
      recurring_errors: result.data.recurring_errors ?? [],
      weak_topics: result.data.weak_topics ?? [],
      strong_concepts: result.data.strong_concepts ?? [],
      study_priority: result.data.study_priority ?? [],
      weekly_plan: result.data.weekly_plan ?? [],
      momentum: result.data.momentum ?? [],
      next_steps: result.data.next_steps ?? [],
      source: result.source,
    });
  } catch (e) {
    return jsonResponse({ error: String(e) }, 500);
  }
});
