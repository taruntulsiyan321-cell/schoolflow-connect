/**
 * Thin client — all AI Coach academic Q&A goes through the AI Gateway.
 * Never calls OpenRouter / Qwen / Gemini directly.
 */

import { invokeEdgeFunction } from "@/lib/edgeFunction";
import type { AiClientRequest, AiGatewayResponse } from "./envelope";
import { mapIntentToCapability } from "./intentMapper";
import { getCapability } from "./capabilityCatalog";

export async function invokeAiGateway<T = unknown>(
  body: AiClientRequest,
): Promise<AiGatewayResponse<T>> {
  const result = await invokeEdgeFunction<AiGatewayResponse<T> & { error?: string }>(
    "ai-gateway",
    body as unknown as Record<string, unknown>,
  );

  if (result.error) {
    return {
      request_id: body.request_id ?? "local",
      feature_id: body.feature_id,
      decision: "degraded",
      route_class: "unsupported",
      used_model: false,
      cache_hit: false,
      data: null,
      message: result.error,
      error_code: "gateway_invoke_failed",
    };
  }

  if (!result.data) {
    return {
      request_id: body.request_id ?? "local",
      feature_id: body.feature_id,
      decision: "degraded",
      route_class: "unsupported",
      used_model: false,
      cache_hit: false,
      data: null,
      message: "Empty gateway response",
      error_code: "empty_response",
    };
  }

  return result.data;
}

/** Resolve capability from explicit feature_id or free-text intent. */
export function resolveCoachCapability(input: {
  feature_id?: string;
  text?: string;
}): { feature_id: string } | { unsupported: true; message: string } {
  if (input.feature_id && getCapability(input.feature_id)) {
    return { feature_id: input.feature_id };
  }
  const mapped = mapIntentToCapability(input.text ?? "");
  if (mapped) return { feature_id: mapped.feature_id };
  return {
    unsupported: true,
    message:
      "I can answer attendance, homework due, marks, today's timetable, mastery/revision, or a performance summary from your school records. Ask one of those, or use Practice / Doubts for learning help.",
  };
}

function formatDeterministicReply(featureId: string, data: unknown): string {
  if (!data || typeof data !== "object") {
    return "No records found yet for that question.";
  }
  const d = data as Record<string, unknown>;

  switch (featureId) {
    case "student.attendance.query": {
      const pct = d.attendance_pct ?? 0;
      const total = d.total_marked ?? 0;
      return (
        `**Attendance (school records)**\n` +
        `Marked days: **${total}** · Present: **${d.present ?? 0}** · Absent: **${d.absent ?? 0}** · Late: **${d.late ?? 0}**\n` +
        `Attendance rate: **${pct}%**\n` +
        `_Source: Academic Engine · no estimates._`
      );
    }
    case "student.homework.due": {
      const items = Array.isArray(d.due_soon) ? d.due_soon : [];
      if (items.length === 0) {
        return "**Homework** — nothing pending in your class list right now.";
      }
      const lines = items.slice(0, 8).map((h: { title?: string; subject?: string; due_date?: string; display_status?: string }) =>
        `• **${h.subject ?? "Subject"}**: ${h.title ?? "Homework"} — ${h.due_date ?? "no due date"} (${h.display_status ?? "pending"})`,
      );
      return `**Homework due / pending** (${d.pending_count ?? items.length})\n${lines.join("\n")}`;
    }
    case "student.marks.summary": {
      const avg = d.average_pct;
      const subjects = Array.isArray(d.subjects) ? d.subjects : [];
      const subLines = subjects
        .slice(0, 8)
        .map((s: { subject?: string; average_pct?: number; count?: number }) =>
          `• **${s.subject}**: ${s.average_pct}% (${s.count} exams)`,
        );
      return (
        `**Marks summary (published only)**\n` +
        `Exams: **${d.exams_count ?? 0}** · Average: **${avg == null ? "—" : `${avg}%`}**\n` +
        (subLines.length ? `${subLines.join("\n")}\n` : "") +
        `_Only published results are shown._`
      );
    }
    case "student.timetable.today": {
      const periods = Array.isArray(d.periods) ? d.periods : [];
      if (!d.has_timetable || periods.length === 0) {
        return "**Today's timetable** — none set up for your class yet.";
      }
      const lines = periods.map((p: { period?: string; subject?: string }) =>
        `• Period **${p.period}**: ${p.subject}`,
      );
      return `**Today's timetable** (${d.day_key})\n${lines.join("\n")}`;
    }
    case "student.eie.mastery_summary": {
      const weak = Array.isArray(d.weak_concepts) ? d.weak_concepts : [];
      const strong = Array.isArray(d.strong_concepts) ? d.strong_concepts : [];
      const rev = Array.isArray(d.revision_priority) ? d.revision_priority : [];
      const weakLines = weak.slice(0, 5).map((c: { concept?: string; subject?: string; mastery_score?: number; band?: string }) =>
        `• ${c.subject}: **${c.concept}** — ${c.mastery_score}% (${c.band})`,
      );
      const strongLines = strong.slice(0, 4).map((c: { concept?: string; subject?: string; mastery_score?: number }) =>
        `• ${c.subject}: **${c.concept}** — ${c.mastery_score}%`,
      );
      const revLines = rev.slice(0, 4).map((r: { topic?: string; subject?: string; priority?: number }) =>
        `• ${r.subject}: ${r.topic ?? "topic"} (priority ${r.priority})`,
      );
      return (
        `**Mastery & revision (Educational Intelligence)**\n` +
        `Average mastery: **${d.avg_mastery ?? 0}%** · Concepts tracked: **${d.total_tracked ?? 0}**\n` +
        (weakLines.length ? `Weak:\n${weakLines.join("\n")}\n` : "Weak: —\n") +
        (strongLines.length ? `Strong:\n${strongLines.join("\n")}\n` : "") +
        (revLines.length ? `Revision priority:\n${revLines.join("\n")}\n` : "") +
        `_Computed by EIE · LLM does not calculate mastery._`
      );
    }
    case "parent.child.summary": {
      return (
        `**Child academic summary**\n` +
        `Attendance: **${d.attendance_pct ?? 0}%** · Homework completion: **${d.homework_completion_pct ?? 0}%**\n` +
        `Tests avg: **${d.tests_avg_pct ?? 0}%** · Exams avg: **${d.exams_avg_pct ?? 0}%**\n` +
        `_Linked-child records only._`
      );
    }
    case "student.performance.explain": {
      if (typeof d.explanation === "string" && d.explanation.trim()) {
        return d.explanation;
      }
      const facts = d.facts as Record<string, unknown> | undefined;
      if (facts?.attendance && facts?.eie) {
        const att = facts.attendance as { attendance_pct?: number };
        const eie = facts.eie as { avg_mastery?: number; weak_concepts?: { concept?: string }[] };
        const weak = (eie.weak_concepts ?? []).slice(0, 3).map((c) => c.concept).filter(Boolean);
        return (
          `**Performance (facts only)**\n` +
          `Attendance **${att.attendance_pct ?? 0}%** · Avg mastery **${eie.avg_mastery ?? 0}%**` +
          (weak.length ? `\nFocus concepts: ${weak.join(", ")}` : "") +
          `\n_Generative explanation unavailable — showing Academic Engine + EIE facts._`
        );
      }
      return "Performance facts are not available yet.";
    }
    default:
      return "Here is what your school records show.";
  }
}

/**
 * Ask the AI Coach a question via Gateway. Deterministic intents get live AE/EIE answers.
 */
export async function askAiCoach(input: {
  text: string;
  studentId?: string;
  feature_id?: string;
  channel?: AiClientRequest["channel"];
}): Promise<{ text: string; response: AiGatewayResponse }> {
  const resolved = resolveCoachCapability({ feature_id: input.feature_id, text: input.text });
  if ("unsupported" in resolved) {
    return {
      text: resolved.message,
      response: {
        request_id: "local",
        feature_id: "unsupported",
        decision: "rejected",
        route_class: "unsupported",
        used_model: false,
        cache_hit: false,
        data: null,
        message: resolved.message,
        error_code: "unsupported_intent",
      },
    };
  }

  const response = await invokeAiGateway({
    feature_id: resolved.feature_id,
    intent_hint: input.text,
    input: { text: input.text },
    target_refs: input.studentId ? { studentId: input.studentId } : undefined,
    channel: input.channel ?? "student_app",
    client_context_version: "gurukul-aicoach/1",
  });

  if (response.error_code && !response.data) {
    return {
      text: response.message ?? "I could not load that from your school records right now.",
      response,
    };
  }

  return {
    text: formatDeterministicReply(resolved.feature_id, response.data),
    response,
  };
}
