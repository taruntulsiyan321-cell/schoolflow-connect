// Edge function: explain a question using the Lovable AI Gateway (Google Gemini).
// Turns "Wrong Answer" into a teaching moment.
//
// Input:  { question, options[], correct_index, selected_index?, correct_text?,
//           selected_text?, subject?, chapter?, topic?, grade? }
// Output: { summary, why_wrong, concept, how_to_improve }
//
// LOVABLE_API_KEY is auto-provisioned — no user setup required.

import "https://deno.land/x/xhr@0.1.0/mod.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

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
      return json({ error: "A question is required" }, 400);
    }

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) return json({ error: "AI gateway not configured" }, 500);

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

    const sys =
      "You are an encouraging, expert Indian school tutor (CBSE/NCERT aligned). " +
      "A student just answered a quiz question. Explain it so they actually LEARN. " +
      "Be concise, warm, and specific. Never be condescending. " +
      "Always ground explanations in the relevant concept and how to apply it. " +
      "If the student was correct, reinforce WHY and add one deeper insight. " +
      "If wrong or blank, gently diagnose the likely misconception. " +
      "Return ONLY the structured object via the provided tool — no prose.";

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

    const tool = {
      type: "function",
      function: {
        name: "emit_explanation",
        description: "Emit a structured tutoring explanation",
        parameters: {
          type: "object",
          additionalProperties: false,
          required: ["summary", "why_wrong", "concept", "how_to_improve"],
          properties: {
            summary: {
              type: "string",
              description: "One-line plain-language explanation of the correct answer.",
            },
            why_wrong: {
              type: "string",
              description:
                "If incorrect/blank: the likely misconception and why the chosen option fails. If correct: why this option is right and the common trap others fall for.",
            },
            concept: {
              type: "string",
              description: "The core concept / formula / rule being tested, stated crisply.",
            },
            how_to_improve: {
              type: "string",
              description: "One concrete, actionable tip or practice suggestion to master this.",
            },
          },
        },
      },
    };

    const aiRes = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: sys },
          { role: "user", content: user },
        ],
        tools: [tool],
        tool_choice: { type: "function", function: { name: "emit_explanation" } },
      }),
    });

    if (aiRes.status === 429) return json({ error: "Rate limit reached — try again in a moment." }, 429);
    if (aiRes.status === 402) return json({ error: "AI credits exhausted. Top up in Lovable AI settings." }, 402);
    if (!aiRes.ok) {
      const txt = await aiRes.text();
      return json({ error: `AI gateway error: ${txt.slice(0, 300)}` }, 502);
    }

    const data = await aiRes.json();
    const call = data?.choices?.[0]?.message?.tool_calls?.[0];
    const args = call?.function?.arguments;
    if (!args) return json({ error: "AI returned no explanation" }, 502);

    const parsed = typeof args === "string" ? JSON.parse(args) : args;
    return json({
      summary: parsed?.summary ?? "",
      why_wrong: parsed?.why_wrong ?? "",
      concept: parsed?.concept ?? "",
      how_to_improve: parsed?.how_to_improve ?? "",
    });
  } catch (err) {
    return json({ error: (err as Error).message ?? "Unknown error" }, 500);
  }
});
