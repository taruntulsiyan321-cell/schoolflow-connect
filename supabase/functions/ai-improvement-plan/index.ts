// Edge function: AI improvement plan for a weak academic topic.
// Input:  { subject, chapter?, topic?, accuracy, attempts, mistake_count, display_name? }
// Output: { headline, steps[], resources[], timeframe }

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
      subject = "General",
      chapter = "",
      topic = "",
      accuracy = 0,
      attempts = 0,
      mistake_count = 0,
      display_name = "Student",
    } = body ?? {};

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) {
      return json({ error: "AI gateway not configured — add LOVABLE_API_KEY to enable AI plans." }, 503);
    }

    const label = [subject, chapter, topic].filter(Boolean).join(" · ");

    const sys =
      "You are an expert Indian school academic coach (CBSE/NCERT). " +
      "Create a concise, actionable improvement plan for the weak topic below. " +
      "Steps must be realistic for a school student (15–45 min each). " +
      "Resources should name free types (NCERT section, Khan Academy topic, school DPP) — no invented URLs. " +
      "Return structured output via the tool only.";

    const user = [
      `Student: ${display_name}`,
      `Weak topic: ${label}`,
      `Accuracy: ${accuracy}% over ${attempts} attempts`,
      `Mistake book entries: ${mistake_count}`,
      accuracy < 45
        ? "Severity: critical — rebuild fundamentals first."
        : accuracy < 60
        ? "Severity: moderate — practice and error correction."
        : "Severity: mild — consolidation and timed practice.",
    ].join("\n");

    const tool = {
      type: "function",
      function: {
        name: "emit_improvement_plan",
        description: "Emit personalized topic improvement plan",
        parameters: {
          type: "object",
          additionalProperties: false,
          required: ["headline", "steps", "resources", "timeframe"],
          properties: {
            headline: { type: "string", description: "Motivating one-line goal for this topic." },
            steps: {
              type: "array",
              minItems: 3,
              maxItems: 6,
              items: { type: "string" },
              description: "Ordered actionable steps.",
            },
            resources: {
              type: "array",
              minItems: 1,
              maxItems: 4,
              items: { type: "string" },
              description: "Study resources or practice types.",
            },
            timeframe: { type: "string", description: "e.g. 3–5 days" },
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
        tool_choice: { type: "function", function: { name: "emit_improvement_plan" } },
      }),
    });

    if (aiRes.status === 429) return json({ error: "Rate limit — try again shortly." }, 429);
    if (aiRes.status === 402) return json({ error: "AI credits exhausted." }, 402);
    if (!aiRes.ok) {
      const txt = await aiRes.text();
      return json({ error: `AI error: ${txt.slice(0, 300)}` }, 502);
    }

    const data = await aiRes.json();
    const call = data?.choices?.[0]?.message?.tool_calls?.[0];
    const args = call?.function?.arguments;
    if (!args) return json({ error: "AI returned no plan" }, 502);

    const parsed = typeof args === "string" ? JSON.parse(args) : args;
    return json({
      headline: parsed?.headline ?? "",
      steps: parsed?.steps ?? [],
      resources: parsed?.resources ?? [],
      timeframe: parsed?.timeframe ?? "",
    });
  } catch (err) {
    return json({ error: (err as Error).message ?? "Unknown error" }, 500);
  }
});
