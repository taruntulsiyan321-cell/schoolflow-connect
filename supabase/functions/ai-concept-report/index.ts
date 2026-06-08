// Edge function: AI concept recovery report after assessment.
// Input:  { report: ConceptRecoveryReport, display_name? }
// Output: { headline, bullets[], next_steps[], source: "ai" }

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
    const { report, display_name = "Student" } = body ?? {};

    if (!report) return json({ error: "report payload required" }, 400);

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) {
      return json({ error: "AI gateway not configured — add LOVABLE_API_KEY to enable AI concept reports." }, 503);
    }

    const weak = (report.weak_concepts ?? [])
      .map((w: { concept: string; accuracy: number }) => `${w.concept} (${w.accuracy}%)`)
      .join(", ");

    const sys =
      "You are an expert CBSE/NCERT academic coach for Indian school students. " +
      "Given a post-assessment concept recovery report, produce actionable insights. " +
      "Be encouraging but honest. No invented URLs. Use tool output only.";

    const user = [
      `Student: ${display_name}`,
      `Accuracy: ${report.accuracy_pct}% (${report.correct_count}/${report.total_count})`,
      `Time: ${report.time_minutes ?? 0} minutes`,
      `Weak concepts: ${weak || "none"}`,
      `Recovery assignments queued: ${(report.recovery_assignments ?? []).length}`,
    ].join("\n");

    const tool = {
      type: "function",
      function: {
        name: "concept_report",
        description: "Structured concept recovery insights",
        parameters: {
          type: "object",
          properties: {
            headline: { type: "string" },
            bullets: { type: "array", items: { type: "string" } },
            next_steps: { type: "array", items: { type: "string" } },
          },
          required: ["headline", "bullets", "next_steps"],
        },
      },
    };

    const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
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
        tool_choice: { type: "function", function: { name: "concept_report" } },
      }),
    });

    if (!res.ok) {
      const t = await res.text();
      return json({ error: `AI gateway ${res.status}: ${t.slice(0, 200)}` }, res.status);
    }

    const data = await res.json();
    const call = data.choices?.[0]?.message?.tool_calls?.[0];
    const args = call?.function?.arguments ? JSON.parse(call.function.arguments) : null;

    if (!args) return json({ error: "AI returned no structured output" }, 502);

    return json({ ...args, source: "ai" });
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});
