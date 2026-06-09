// Explain a quiz answer — Google Gemini Flash (primary).
import { corsHeaders, generateStructured, jsonResponse } from "./gemini.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const body = await req.json();
    const {
      question = "",
      options = [],
      correct_index = null,
      selected_index = null,
      correct_text = "",
      selected_text = "",
      subject = "",
      chapter = "",
      topic = "",
      grade = "",
    } = body ?? {};

    if (!question || String(question).trim().length === 0) {
      return jsonResponse({ error: "A question is required" }, 400);
    }

    const optLines = Array.isArray(options) && options.length
      ? options.map((o: string, i: number) => `${String.fromCharCode(65 + i)}. ${o}`).join("\n")
      : "(no options provided)";

    const correctLabel = typeof correct_index === "number" && correct_index >= 0
      ? `${String.fromCharCode(65 + correct_index)}. ${options?.[correct_index] ?? correct_text}`
      : correct_text || "(see explanation)";

    const chosenLabel = typeof selected_index === "number" && selected_index >= 0
      ? `${String.fromCharCode(65 + selected_index)}. ${options?.[selected_index] ?? selected_text}`
      : selected_index === -1
        ? "(left blank / timed out)"
        : selected_text || "(unknown)";

    const wasCorrect =
      typeof selected_index === "number" &&
      typeof correct_index === "number" &&
      selected_index === correct_index;

    const system =
      "You are an expert CBSE/NCERT Mathematics and Science tutor for Indian Class 6–12 students. " +
      "The student just answered an MCQ. Your job is a short, high-quality coaching explanation.\n\n" +
      "Rules:\n" +
      "- Be specific to THIS exact question and the option they chose — never generic advice.\n" +
      "- If wrong: name the misconception, show why their option fails, then the correct method in 2–4 clear steps.\n" +
      "- If correct: confirm the reasoning in one sentence, then one deeper NCERT insight.\n" +
      "- Use simple English, warm tone, no jargon without defining it.\n" +
      "- summary: max 2 sentences. why_wrong: 3–5 sentences with steps. concept: the rule/formula tested. how_to_improve: one actionable drill.";

    const user = [
      subject ? `Subject: ${subject}` : "",
      chapter ? `Chapter: ${chapter}` : "",
      topic ? `Topic: ${topic}` : "",
      grade ? `Grade/Class: ${grade}` : "",
      `Question: ${question}`,
      `Options:\n${optLines}`,
      `Correct answer: ${correctLabel}`,
      `Student answered: ${chosenLabel}`,
      `Outcome: ${wasCorrect ? "CORRECT" : "INCORRECT / BLANK"}`,
    ].filter(Boolean).join("\n");

    const schema = {
      type: "object",
      properties: {
        summary: { type: "string", description: "One sentence: the correct answer and why." },
        why_wrong: {
          type: "string",
          description: "2-4 sentences: why the student's choice is wrong OR why correct option works; include brief steps.",
        },
        concept: { type: "string", description: "NCERT concept name + key formula/rule in one line." },
        how_to_improve: { type: "string", description: "One actionable tip tied to this exact question type." },
      },
      required: ["summary", "why_wrong", "concept", "how_to_improve"],
    };

    const result = await generateStructured<{
      summary: string;
      why_wrong: string;
      concept: string;
      how_to_improve: string;
    }>({ system, user, schema, toolName: "emit_explanation" });

    if (!result.ok) return jsonResponse({ error: result.error }, result.status);

    return jsonResponse({
      summary: result.data.summary ?? "",
      why_wrong: result.data.why_wrong ?? "",
      concept: result.data.concept ?? "",
      how_to_improve: result.data.how_to_improve ?? "",
      source: result.source,
    });
  } catch (err) {
    return jsonResponse({ error: (err as Error).message ?? "Unknown error" }, 500);
  }
});
