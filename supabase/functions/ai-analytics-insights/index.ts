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
        error_patterns: [],
        weak_topics: [],
        strong_concepts: [],
        study_priority: [],
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
      }[]
    )
      .slice(0, 12)
      .map(
        (t) =>
          `- TOPIC: "${t.topic}" | Chapter: ${t.chapter ?? "unknown"} | ${t.subject} | ${t.mistake_count} wrong Qs, ${t.total_wrong} errors${t.concept ? ` | skill: ${t.concept}` : ""}`,
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
      }[]
    )
      .slice(0, 18)
      .map(
        (m, i) =>
          `${i + 1}. [${m.subject}${m.chapter ? ` · ${m.chapter}` : ""}${m.topic ? ` · TOPIC: ${m.topic}` : ""}]
   Q: ${m.question}
   Student picked: ${m.student_pick}
   Correct: ${m.correct_pick}
   Wrong ${m.times_wrong}x`,
      )
      .join("\n\n");

    const system =
      "You are a senior CBSE Class 12 NCERT diagnostician for Indian school students. " +
      "The student ALREADY knows which chapters are weak — do NOT only repeat chapter names. " +
      "Your job is DEEP TOPIC-LEVEL analysis from their mistake book:\n" +
      "1. Name the exact NCERT TOPIC within each chapter (e.g. 'Integration by substitution', NOT just 'Integrals').\n" +
      "2. Identify ROOT CAUSE: conceptual gap, formula misapplication, sign/algebra error, misread question, careless step.\n" +
      "3. Detect ERROR PATTERNS across multiple mistakes (e.g. 'repeatedly confuses indefinite vs definite integral limits').\n" +
      "4. Give NCERT section references when confident (e.g. 'NCERT Maths Ch 7 §7.2').\n" +
      "5. study_priority: ordered list of specific topics to fix this week (topic names, not just chapters).\n" +
      "6. diagnosis: 2-3 sentence overall assessment of how they think and where they're slipping.\n" +
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
        why_weak: { type: "string", description: "What exactly they get wrong" },
        root_cause: { type: "string", description: "Underlying reason: conceptual, procedural, careless" },
        error_pattern: { type: "string", description: "Recurring mistake pattern for this topic" },
        fix_hint: { type: "string", description: "Concrete fix: what to revise and practise" },
        ncert_ref: { type: "string", description: "NCERT reference if known" },
        mistake_count: { type: "number" },
      },
      required: ["topic", "chapter", "subject", "severity", "why_weak", "root_cause", "fix_hint", "mistake_count"],
    };

    const schema = {
      type: "object",
      properties: {
        headline: { type: "string" },
        summary: { type: "string" },
        diagnosis: { type: "string" },
        error_patterns: { type: "array", items: { type: "string" } },
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
        next_steps: { type: "array", items: { type: "string" } },
      },
      required: ["headline", "summary", "diagnosis", "weak_topics", "error_patterns", "study_priority", "next_steps"],
    };

    const result = await generateStructured<{
      headline: string;
      summary: string;
      diagnosis: string;
      error_patterns: string[];
      weak_topics: {
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
      }[];
      strong_concepts?: { concept: string; subject: string; topic?: string; note: string }[];
      study_priority: string[];
      next_steps: string[];
    }>({ system, user, schema, toolName: "deep_analytics" });

    if (!result.ok) return jsonResponse({ error: result.error }, result.status);

    return jsonResponse({
      headline: result.data.headline ?? "",
      summary: result.data.summary ?? "",
      diagnosis: result.data.diagnosis ?? "",
      error_patterns: result.data.error_patterns ?? [],
      weak_topics: result.data.weak_topics ?? [],
      strong_concepts: result.data.strong_concepts ?? [],
      study_priority: result.data.study_priority ?? [],
      next_steps: result.data.next_steps ?? [],
      source: result.source,
    });
  } catch (e) {
    return jsonResponse({ error: String(e) }, 500);
  }
});
