// Battle performance AI report — OpenRouter (Qwen).
// Student-only: this generates a battle report in the student's own voice
// for the student who played. There is deliberately no teacher-facing
// variant — teachers see the same raw battle stats without an AI layer
// (product decision). Ownership is verified server-side: the caller must
// be the actual participant, not just any authenticated user passing an
// arbitrary participant_id (the previous version had no such check).
import { corsHeaders, generateStructured, jsonResponse } from "../_shared/structuredCompletion.ts";
import { requireUserJwt } from "../_shared/requireAuth.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const __auth = await requireUserJwt(req);
  if (!__auth.ok) return __auth.response;

  try {
    const body = await req.json();
    const {
      participant_id = "",
      display_name = "Student",
      report = {},
    } = body ?? {};

    if (!participant_id) {
      return jsonResponse({ error: "participant_id is required" }, 400);
    }

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const { data: participant } = await admin
      .from("battle_participants")
      .select("id, user_id")
      .eq("id", participant_id)
      .maybeSingle();
    if (!participant || participant.user_id !== __auth.value.user.id) {
      return jsonResponse({ error: "Not your battle participation" }, 403);
    }

    const battle = report.battle ?? {};
    const summary = report.summary ?? {};
    const topics = report.topics ?? { strong: [], weak: [] };
    const speed = report.speed ?? {};
    const comparison = report.comparison ?? {};

    const system =
      "You are an expert Indian school academic coach (CBSE/NCERT). " +
      "Write for the student who just played. Be encouraging, specific, and motivating — never harsh. " +
      "Base insights ONLY on the stats provided — do not invent scores.";

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

    const schema = {
      type: "object",
      properties: {
        headline: { type: "string" },
        insights: { type: "array", items: { type: "string" } },
        focus_areas: { type: "array", items: { type: "string" } },
        praise: { type: "string" },
        recommendation: { type: "string" },
      },
      required: ["headline", "insights", "focus_areas", "praise", "recommendation"],
    };

    const result = await generateStructured<{
      headline: string;
      insights: string[];
      focus_areas: string[];
      praise: string;
      recommendation: string;
    }>({ system, user, schema, toolName: "emit_battle_insights" });

    if (!result.ok) return jsonResponse({ error: result.error }, result.status);

    return jsonResponse({
      headline: result.data.headline ?? "",
      insights: result.data.insights ?? [],
      focus_areas: result.data.focus_areas ?? [],
      praise: result.data.praise ?? "",
      recommendation: result.data.recommendation ?? "",
      source: result.source,
    });
  } catch (err) {
    return jsonResponse({ error: (err as Error).message ?? "Unknown error" }, 500);
  }
});
