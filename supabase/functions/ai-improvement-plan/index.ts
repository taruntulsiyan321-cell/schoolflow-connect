// AI improvement plan for weak topics — Google Gemini Flash (primary).
import { corsHeaders, generateStructured, jsonResponse } from "../_shared/gemini.ts";

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

    const label = [subject, chapter, topic].filter(Boolean).join(" · ");

    const system =
      "You are an expert Indian school academic coach (CBSE/NCERT). " +
      "Create a concise, actionable improvement plan for the weak topic below. " +
      "Steps must be realistic for a school student (15–45 min each). " +
      "Resources should name free types (NCERT section, Khan Academy topic, school DPP) — no invented URLs.";

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

    const schema = {
      type: "object",
      properties: {
        headline: { type: "string" },
        steps: { type: "array", items: { type: "string" } },
        resources: { type: "array", items: { type: "string" } },
        timeframe: { type: "string" },
      },
      required: ["headline", "steps", "resources", "timeframe"],
    };

    const result = await generateStructured<{
      headline: string;
      steps: string[];
      resources: string[];
      timeframe: string;
    }>({ system, user, schema, toolName: "emit_improvement_plan" });

    if (!result.ok) return jsonResponse({ error: result.error }, result.status);

    return jsonResponse({
      headline: result.data.headline ?? "",
      steps: result.data.steps ?? [],
      resources: result.data.resources ?? [],
      timeframe: result.data.timeframe ?? "",
      source: result.source,
    });
  } catch (err) {
    return jsonResponse({ error: (err as Error).message ?? "Unknown error" }, 500);
  }
});
