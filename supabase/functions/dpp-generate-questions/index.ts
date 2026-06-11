// Generate DPP MCQs — Google Gemini Flash (primary).
import { corsHeaders, generateStructured, jsonResponse } from "./gemini.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const body = await req.json();
    const {
      topic = "",
      subject = "",
      chapter = "",
      difficulty = "medium",
      count = 5,
      source_text = "",
      source_url = "",
    } = body ?? {};

    const n = Math.max(1, Math.min(20, Number(count) || 5));

    let fetchedText = "";
    if (source_url && /^https?:\/\//i.test(source_url)) {
      try {
        const res = await fetch(source_url, {
          headers: { "User-Agent": "Mozilla/5.0 (SchoolFlow DPP Bot)" },
          signal: AbortSignal.timeout(15000),
        });
        if (res.ok) {
          const html = await res.text();
          fetchedText = html
            .replace(/<script[\s\S]*?<\/script>/gi, " ")
            .replace(/<style[\s\S]*?<\/style>/gi, " ")
            .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
            .replace(/<\/(p|div|section|article|li|h[1-6]|br)>/gi, "\n")
            .replace(/<[^>]+>/g, " ")
            .replace(/&nbsp;/g, " ")
            .replace(/&amp;/g, "&")
            .replace(/&lt;/g, "<")
            .replace(/&gt;/g, ">")
            .replace(/&quot;/g, '"')
            .replace(/[ \t]+/g, " ")
            .replace(/\n{3,}/g, "\n\n")
            .trim()
            .slice(0, 8000);
        }
      } catch {
        /* ignore fetch errors */
      }
    }

    const combined_source = [source_text, fetchedText].filter(Boolean).join("\n\n").slice(0, 9000);

    if (!topic && !combined_source) {
      return jsonResponse({ error: "Provide a topic, URL, or source text" }, 400);
    }

    const system =
      "You are an expert CBSE Class 12 question setter for Indian schools (NCERT-aligned). " +
      "GENERATE fresh MCQs — each question must test a DIFFERENT sub-concept or skill. " +
      "Never repeat the same question stem or pattern. Vary numbers, scenarios, and wording. " +
      "If reference material lists student mistakes, generate remedial MCQs that test the same underlying skills with new numbers and wording — never copy listed mistake questions verbatim. " +
      "If the student made recent mistakes, target those weak concepts first with remedial questions. " +
      "Exactly 4 options per question, one unambiguously correct answer, clear step-by-step explanation.";

    const user = [
      `Subject: ${subject || "(infer from source)"}`,
      chapter ? `Chapter: ${chapter}` : "",
      `Topic: ${topic || "(derive from source)"}`,
      `Difficulty: ${difficulty}`,
      `Count: up to ${n} questions`,
      source_url ? `Source URL: ${source_url}` : "",
      combined_source
        ? `\nReference material:\n${combined_source}`
        : "",
    ].filter(Boolean).join("\n");

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
            },
            required: ["question", "options", "correct_index", "explanation"],
          },
        },
      },
      required: ["questions"],
    };

    const result = await generateStructured<{ questions: Array<{
      question: string;
      options: string[];
      correct_index: number;
      explanation: string;
    }> }>({ system, user, schema, toolName: "emit_questions" });

    if (!result.ok) return jsonResponse({ error: result.error }, result.status);

    const questions = (result.data.questions ?? []).slice(0, n);
    return jsonResponse({ questions, source: result.source });
  } catch (err) {
    return jsonResponse({ error: (err as Error).message ?? "Unknown error" }, 500);
  }
});
