// Expand the Class 12 question bank with fresh Gemini-generated MCQs.
// Caches results into public.question_templates as template_type='ai_mcq'.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { corsHeaders, generateStructured, jsonResponse } from "./gemini.ts";
import { requireUserJwt } from "../_shared/requireAuth.ts";

type GenQ = {
  question: string;
  options: string[];
  correct_index: number;
  explanation: string;
  difficulty?: "easy" | "medium" | "hard";
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const __auth = await requireUserJwt(req);
  if (!__auth.ok) return __auth.response;

  try {
    const body = await req.json();
    const klass = Number(body?.class ?? 12);
    const subject = String(body?.subject ?? "").trim();
    const chapter = String(body?.chapter ?? "").trim();
    const want = Math.max(1, Math.min(15, Number(body?.count ?? 8)));
    const ensureTotal = Math.max(want, Math.min(60, Number(body?.ensure_total ?? 30)));

    if (!subject || !chapter) {
      return jsonResponse({ error: "subject and chapter are required" }, 400);
    }

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // How many AI MCQs already cached?
    const { count: existing } = await admin
      .from("question_templates")
      .select("id", { count: "exact", head: true })
      .eq("class", klass)
      .eq("subject", subject)
      .eq("chapter", chapter)
      .eq("template_type", "ai_mcq")
      .eq("is_active", true);

    const toGenerate = Math.max(
      want,
      Math.max(0, ensureTotal - (existing ?? 0)),
    );

    if (toGenerate === 0) {
      return jsonResponse({ inserted: 0, existing: existing ?? 0, source: "cache" });
    }

    const system =
      "You are a senior CBSE NCERT question setter for Indian Class 12 students. " +
      "Generate fresh, exam-style MCQs strictly from the given subject and chapter. " +
      "Each question MUST be: factually correct, NCERT-aligned, unambiguous, with exactly 4 distinct options and ONE correct answer. " +
      "Vary the format: numerical, conceptual, formula-based, assertion-style, true-of-statements, diagrammatic-described. " +
      "Vary difficulty across easy/medium/hard. Avoid duplicates and avoid stale wording.";

    const user = [
      `Class: ${klass}`,
      `Subject: ${subject}`,
      `Chapter: ${chapter}`,
      `Generate ${toGenerate} brand-new MCQs.`,
      "Use LaTeX with $...$ for math/physics symbols where helpful (e.g. $\\vec{E}$, $\\mu_0$, $\\frac{q}{4\\pi\\epsilon_0 r^2}$).",
      "Make values realistic. Explanation must be 1-3 lines stating the principle and the calculation.",
    ].join("\n");

    const schema = {
      type: "object",
      properties: {
        questions: {
          type: "array",
          items: {
            type: "object",
            properties: {
              question: { type: "string" },
              options: { type: "array", items: { type: "string" } },
              correct_index: { type: "integer" },
              explanation: { type: "string" },
              difficulty: { type: "string" },
            },
            required: ["question", "options", "correct_index", "explanation"],
          },
        },
      },
      required: ["questions"],
    };

    const result = await generateStructured<{ questions: GenQ[] }>({
      system,
      user,
      schema,
      toolName: "emit_questions",
    });

    if (!result.ok) return jsonResponse({ error: result.error }, result.status);

    // Sanity-filter
    const seen = new Set<string>();
    const rows = (result.data.questions ?? [])
      .filter((q) => {
        if (!q?.question || !Array.isArray(q.options) || q.options.length !== 4) return false;
        if (typeof q.correct_index !== "number" || q.correct_index < 0 || q.correct_index > 3) return false;
        const key = q.question.trim().toLowerCase();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .slice(0, toGenerate)
      .map((q) => ({
        class: klass,
        subject,
        chapter,
        template_type: "ai_mcq",
        template_data: {
          question: q.question,
          options: q.options,
          correct_index: q.correct_index,
          difficulty: q.difficulty ?? "medium",
          generated_at: new Date().toISOString(),
        },
        explanation_template: q.explanation ?? "",
        is_active: true,
      }));

    if (rows.length === 0) {
      return jsonResponse({ error: "Gemini returned no valid questions", inserted: 0 }, 502);
    }

    const { error: insErr, data: inserted } = await admin
      .from("question_templates")
      .insert(rows)
      .select("id");

    if (insErr) return jsonResponse({ error: insErr.message }, 500);

    return jsonResponse({
      inserted: inserted?.length ?? 0,
      existing: existing ?? 0,
      total: (existing ?? 0) + (inserted?.length ?? 0),
      source: result.source,
    });
  } catch (err) {
    return jsonResponse({ error: (err as Error).message ?? "Unknown error" }, 500);
  }
});
