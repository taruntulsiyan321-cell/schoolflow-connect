// Edge function: AI performance report for a completed battle.
// Input:  { participant_id, report (summary object), display_name?, for_teacher? }
// Output: { insights[], focus_areas[], praise, recommendation, headline }
//
// Client caches result in battle_reports.ai_insights via update.

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
      participant_id = "",
      display_name = "Student",
      for_teacher = false,
      report = {},
    } = body ?? {};

    const battle = report.battle ?? {};
    const summary = report.summary ?? {};
    const topics = report.topics ?? { strong: [], weak: [] };
    const speed = report.speed ?? {};
    const comparison = report.comparison ?? {};

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) return json({ error: "AI gateway not configured" }, 500);

    const audience = for_teacher
      ? "Write for a teacher reviewing this student's battle performance. Be diagnostic and actionable for classroom intervention."
      : "Write for the student who just played. Be encouraging, specific, and motivating — never harsh.";

    const sys =
      "You are an expert Indian school academic coach (CBSE/NCERT). " +
      audience + " " +
      "Base insights ONLY on the stats provided — do not invent scores. " +
      "Return structured output via the tool only.";

    const weakList = (topics.weak ?? [])
      .map((t: { label?: string; accuracy?: number }) => `${t.label} (${t.accuracy ?? 0}%)`)
      .join(", ") || "none flagged";
    const strongList = (topics.strong ?? [])
      .map((t: { label?: string }) => t.label)
      .join(", ") || "none yet";

    const user = [
      `Student: ${display_name}`,
      `Subject: ${battle.subject ?? "—"}`,
      battle.chapter ? `Chapter: ${battle.chapter}` : "",
      battle.topic ? `Topic: ${battle.topic}` : "",
      `Score: ${summary.score ?? 0} · Rank #${summary.rank ?? "—"} of ${summary.total_participants ?? "—"}`,
      `Accuracy: ${summary.accuracy_pct ?? 0}% (${summary.correct_count ?? 0}/${summary.answered_count ?? 0})`,
      `Avg time per Q: ${summary.avg_time_ms ?? 0}ms`,
      `Skipped: ${summary.skipped_count ?? 0}`,
      `Under time pressure accuracy: ${speed.under_pressure_accuracy ?? "n/a"}%`,
      `Comfort zone accuracy: ${speed.comfort_zone_accuracy ?? "n/a"}%`,
      `Strong areas: ${strongList}`,
      `Weak areas: ${weakList}`,
      `Vs class avg accuracy: ${comparison.vs_avg_accuracy ?? "n/a"} pts`,
      participant_id ? `Report ref: ${participant_id}` : "",
    ].filter(Boolean).join("\n");

    const tool = {
      type: "function",
      function: {
        name: "emit_battle_insights",
        description: "Emit personalized battle performance insights",
        parameters: {
          type: "object",
          additionalProperties: false,
          required: ["headline", "insights", "focus_areas", "praise", "recommendation"],
          properties: {
            headline: { type: "string", description: "One punchy sentence summarizing performance." },
            insights: {
              type: "array",
              minItems: 2,
              maxItems: 5,
              items: { type: "string" },
              description: "Specific observations e.g. accuracy drops under time pressure.",
            },
            focus_areas: {
              type: "array",
              minItems: 1,
              maxItems: 4,
              items: { type: "string" },
              description: "Topics/concepts to revise.",
            },
            praise: { type: "string", description: "What they did well." },
            recommendation: { type: "string", description: "One concrete next step." },
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
        tool_choice: { type: "function", function: { name: "emit_battle_insights" } },
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
    if (!args) return json({ error: "AI returned no insights" }, 502);

    const parsed = typeof args === "string" ? JSON.parse(args) : args;
    return json({
      headline: parsed?.headline ?? "",
      insights: parsed?.insights ?? [],
      focus_areas: parsed?.focus_areas ?? [],
      praise: parsed?.praise ?? "",
      recommendation: parsed?.recommendation ?? "",
    });
  } catch (err) {
    return json({ error: (err as Error).message ?? "Unknown error" }, 500);
  }
});
