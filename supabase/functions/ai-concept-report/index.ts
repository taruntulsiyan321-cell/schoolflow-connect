// Post-assessment concept recovery report — Google Gemini Flash (primary).
import { corsHeaders, generateStructured, jsonResponse } from "./gemini.ts";
import { requireUserJwt } from "../_shared/requireAuth.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const __auth = await requireUserJwt(req);
  if (!__auth.ok) return __auth.response;

  try {
    const body = await req.json();
    const { report, display_name = "Student" } = body ?? {};

    if (!report) return jsonResponse({ error: "report payload required" }, 400);

    const weak = (report.weak_concepts ?? [])
      .map((w: { concept: string; accuracy: number }) => `${w.concept} (${w.accuracy}%)`)
      .join(", ");

    const system =
      "You are an expert CBSE/NCERT academic coach for Indian school students. " +
      "Given a post-assessment concept recovery report, produce actionable insights. " +
      "Be encouraging but honest. No invented URLs.";

    const user = [
      `Student: ${display_name}`,
      `Accuracy: ${report.accuracy_pct}% (${report.correct_count}/${report.total_count})`,
      `Time: ${report.time_minutes ?? 0} minutes`,
      `Weak concepts: ${weak || "none"}`,
      `Recovery assignments queued: ${(report.recovery_assignments ?? []).length}`,
    ].join("\n");

    const schema = {
      type: "object",
      properties: {
        headline: { type: "string" },
        bullets: { type: "array", items: { type: "string" } },
        next_steps: { type: "array", items: { type: "string" } },
      },
      required: ["headline", "bullets", "next_steps"],
    };

    const result = await generateStructured<{
      headline: string;
      bullets: string[];
      next_steps: string[];
    }>({ system, user, schema, toolName: "concept_report" });

    if (!result.ok) return jsonResponse({ error: result.error }, result.status);

    return jsonResponse({
      headline: result.data.headline ?? "",
      bullets: result.data.bullets ?? [],
      next_steps: result.data.next_steps ?? [],
      source: "ai",
    });
  } catch (e) {
    return jsonResponse({ error: String(e) }, 500);
  }
});
