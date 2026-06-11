// Analytics dashboard — weak concepts from mistake book via Google Gemini Flash.
import { corsHeaders, generateStructured, jsonResponse } from "./gemini.ts";

type MistakeSummary = {
  concept: string;
  subject: string;
  chapter?: string;
  mistake_count: number;
  total_wrong: number;
  sample_question?: string;
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const body = await req.json();
    const {
      display_name = "Student",
      exam_readiness = {},
      mistake_summary = [],
      concept_mastery = [],
      mistakes_detail = "",
    } = body ?? {};

    const mistakes = (mistake_summary as MistakeSummary[]) ?? [];
    if (mistakes.length === 0 && !mistakes_detail) {
      return jsonResponse({
        headline: "No mistakes logged yet",
        summary: "Complete practice sessions — wrong answers are saved to your mistake book for concept-level analysis.",
        weak_concepts: [],
        strong_concepts: [],
        next_steps: [
          "Start a Class 12 practice session and attempt mixed questions.",
          "Review incorrect answers in your Mistake book after each session.",
        ],
        source: "rule",
      });
    }

    const masteryLines = (concept_mastery as { concept: string; subject: string; mastery_score: number; mistake_count?: number }[])
      .slice(0, 12)
      .map((m) => `${m.concept} (${m.subject}): ${Math.round(m.mastery_score)}% mastery, ${m.mistake_count ?? 0} mistakes`)
      .join("\n");

    const mistakeLines = mistakes
      .slice(0, 10)
      .map(
        (m) =>
          `- ${m.concept} [${m.subject}${m.chapter ? ` · ${m.chapter}` : ""}]: ${m.mistake_count} distinct wrong Qs, ${m.total_wrong} total errors`,
      )
      .join("\n");

    const system =
      "You are an expert CBSE Class 12 NCERT coach for Indian school students. " +
      "Analyse the student's MISTAKE BOOK (questions they got wrong in practice) and identify WEAK CONCEPTS — not just chapters. " +
      "Group errors by underlying NCERT concept/skill (e.g. 'chain rule', 'definite integrals as area', 'L'Hôpital'). " +
      "Be specific, encouraging, and actionable. Do not invent URLs. " +
      "Prioritise concepts with more mistakes and repeated errors.";

    const user = [
      `Student: ${display_name}`,
      `Exam readiness: ${exam_readiness.score ?? 0}% (accuracy ${exam_readiness.accuracy_pct ?? 0}%, attendance ${exam_readiness.attendance_pct ?? 0}%)`,
      "",
      "Aggregated mistakes by concept:",
      mistakeLines || "(see detail below)",
      "",
      "Concept mastery scores:",
      masteryLines || "none yet",
      "",
      mistakes_detail ? `Recent mistake detail:\n${String(mistakes_detail).slice(0, 6000)}` : "",
    ].join("\n");

    const schema = {
      type: "object",
      properties: {
        headline: { type: "string" },
        summary: { type: "string" },
        weak_concepts: {
          type: "array",
          items: {
            type: "object",
            properties: {
              concept: { type: "string" },
              subject: { type: "string" },
              chapter: { type: "string" },
              severity: { type: "string", enum: ["critical", "moderate", "mild"] },
              why_weak: { type: "string" },
              fix_hint: { type: "string" },
              mistake_count: { type: "number" },
            },
            required: ["concept", "subject", "severity", "why_weak", "fix_hint", "mistake_count"],
          },
        },
        strong_concepts: {
          type: "array",
          items: {
            type: "object",
            properties: {
              concept: { type: "string" },
              subject: { type: "string" },
              note: { type: "string" },
            },
            required: ["concept", "subject", "note"],
          },
        },
        next_steps: { type: "array", items: { type: "string" } },
      },
      required: ["headline", "summary", "weak_concepts", "next_steps"],
    };

    const result = await generateStructured<{
      headline: string;
      summary: string;
      weak_concepts: {
        concept: string;
        subject: string;
        chapter?: string;
        severity: "critical" | "moderate" | "mild";
        why_weak: string;
        fix_hint: string;
        mistake_count: number;
      }[];
      strong_concepts?: { concept: string; subject: string; note: string }[];
      next_steps: string[];
    }>({ system, user, schema, toolName: "analytics_insights" });

    if (!result.ok) return jsonResponse({ error: result.error }, result.status);

    return jsonResponse({
      headline: result.data.headline ?? "",
      summary: result.data.summary ?? "",
      weak_concepts: result.data.weak_concepts ?? [],
      strong_concepts: result.data.strong_concepts ?? [],
      next_steps: result.data.next_steps ?? [],
      source: result.source,
    });
  } catch (e) {
    return jsonResponse({ error: String(e) }, 500);
  }
});
