// "Get insights" on a finished session's concept report — OpenRouter (Qwen).
// The prompt lives in ../_shared/conceptReportPrompt.ts.
import { corsHeaders, generateStructured, jsonResponse } from "../_shared/structuredCompletion.ts";
import { requireUserJwt } from "../_shared/requireAuth.ts";
import { buildConceptReportPrompt } from "../_shared/conceptReportPrompt.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const __auth = await requireUserJwt(req);
  if (!__auth.ok) return __auth.response;

  try {
    const body = await req.json();
    const { report } = body ?? {};

    if (!report) return jsonResponse({ error: "report payload required" }, 400);

    const { system, user } = buildConceptReportPrompt(report);

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
