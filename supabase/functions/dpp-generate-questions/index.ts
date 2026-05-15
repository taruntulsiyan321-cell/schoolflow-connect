// Edge function: generate DPP questions using Lovable AI Gateway.
// Input: { topic, subject, chapter?, difficulty, count, source_text? }
// Output: { questions: [{ question, options[4], correct_index, explanation }] }
//
// LOVABLE_API_KEY is auto-provisioned — no user setup required.

import "https://deno.land/x/xhr@0.1.0/mod.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

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
    } = body ?? {};

    const n = Math.max(1, Math.min(20, Number(count) || 5));
    if (!topic && !source_text) {
      return new Response(
        JSON.stringify({ error: "Provide a topic or source text" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) {
      return new Response(
        JSON.stringify({ error: "AI gateway not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const sys =
      "You are an expert academic question setter for Indian school students. " +
      "Generate accurate, curriculum-aligned multiple-choice questions. " +
      "Each question must have exactly 4 options, one unambiguously correct answer, " +
      "and a one-line explanation. Avoid trick questions and ambiguity.";

    const user = [
      `Subject: ${subject || "General"}`,
      chapter ? `Chapter: ${chapter}` : "",
      `Topic: ${topic || "(derive from source)"}`,
      `Difficulty: ${difficulty}`,
      `Count: ${n}`,
      source_text ? `\nReference material:\n${source_text.slice(0, 6000)}` : "",
      "\nReturn ONLY a JSON object via the provided tool — no prose.",
    ].filter(Boolean).join("\n");

    const tool = {
      type: "function",
      function: {
        name: "emit_questions",
        description: "Emit the generated MCQs",
        parameters: {
          type: "object",
          additionalProperties: false,
          properties: {
            questions: {
              type: "array",
              minItems: 1,
              items: {
                type: "object",
                additionalProperties: false,
                required: ["question", "options", "correct_index", "explanation"],
                properties: {
                  question: { type: "string" },
                  options: { type: "array", minItems: 4, maxItems: 4, items: { type: "string" } },
                  correct_index: { type: "integer", minimum: 0, maximum: 3 },
                  explanation: { type: "string" },
                },
              },
            },
          },
          required: ["questions"],
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
        tool_choice: { type: "function", function: { name: "emit_questions" } },
      }),
    });

    if (aiRes.status === 429) {
      return new Response(
        JSON.stringify({ error: "Rate limit reached — try again in a moment." }),
        { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
    if (aiRes.status === 402) {
      return new Response(
        JSON.stringify({ error: "AI credits exhausted. Top up in Lovable AI settings." }),
        { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
    if (!aiRes.ok) {
      const txt = await aiRes.text();
      return new Response(
        JSON.stringify({ error: `AI gateway error: ${txt.slice(0, 300)}` }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const json = await aiRes.json();
    const call = json?.choices?.[0]?.message?.tool_calls?.[0];
    const args = call?.function?.arguments;
    if (!args) {
      return new Response(
        JSON.stringify({ error: "AI returned no questions" }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
    const parsed = typeof args === "string" ? JSON.parse(args) : args;
    const questions = (parsed?.questions ?? []).slice(0, n);

    return new Response(JSON.stringify({ questions }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(
      JSON.stringify({ error: (err as Error).message ?? "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
