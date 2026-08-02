// Improvement plans + deep mistake analytics (mode=mistake_analytics) — Google Gemini.
import { corsHeaders, generateStructured, jsonResponse } from "./gemini.ts";
import { handleMistakeAnalyticsRequest } from "../_shared/mistakeAnalytics.ts";
import { requireUserJwt } from "../_shared/requireAuth.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const __auth = await requireUserJwt(req);
  if (!__auth.ok) return __auth.response;

  try {
    const body = await req.json();

    // Full question-level mistake analysis (same engine as ai-analytics-insights).
    if (body?.mode === "mistake_analytics") {
      return await handleMistakeAnalyticsRequest(body);
    }

    const {
      subject = "General",
      chapter = "",
      topic = "",
      accuracy = 0,
      attempts = 0,
      mistake_count = 0,
      display_name = "Student",
      mistakes_detail = "",
    } = body ?? {};

    const label = [subject, chapter, topic].filter(Boolean).join(" · ");

    const system =
      "You are an expert Indian school academic coach (CBSE/NCERT). " +
      "Create a concise, actionable improvement plan for the weak topic below. " +
      "If mistakes_detail is provided, reference the student's ACTUAL wrong answers and explain the thinking error. " +
      "Steps must be realistic for a school student (15–45 min each). " +
      "Resources should name free types (NCERT section, Khan Academy topic, school DPP) — no invented URLs.";

    const user = [
      `Student: ${display_name}`,
      `Weak topic: ${label}`,
      `Accuracy: ${accuracy}% over ${attempts} attempts`,
      `Mistake book entries: ${mistake_count}`,
      mistakes_detail ? `\n=== Student's wrong answers ===\n${mistakes_detail.slice(0, 8000)}` : "",
      accuracy < 45
        ? "Severity: critical — rebuild fundamentals first."
        : accuracy < 60
        ? "Severity: moderate — practice and error correction."
        : "Severity: mild — consolidation and timed practice.",
    ]
      .filter(Boolean)
      .join("\n");

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
