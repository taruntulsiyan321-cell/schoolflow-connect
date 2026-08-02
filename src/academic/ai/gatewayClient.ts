/**
 * Thin client — all AI Coach academic Q&A goes through the AI Gateway.
 * Never calls OpenRouter / Qwen / Gemini directly.
 */

import { invokeEdgeFunction } from "@/lib/edgeFunction";
import { presentAcademicLabel } from "@/lib/academicPresentation";
import type { AiActorRole, AiClientRequest, AiGatewayResponse } from "./envelope";
import { mapIntentToCapability } from "./intentMapper";
import { getCapability } from "./capabilityCatalog";

/** Shown when generative path is down (402 / kill switch / missing key). */
export const AI_BILLING_UNAVAILABLE_MSG =
  "AI temporarily unavailable (billing/credits). Deterministic help still works.";

export function isAiBillingOrCreditsIssue(
  response: Pick<AiGatewayResponse, "error_code" | "message" | "data">,
): boolean {
  const code = response.error_code ?? "";
  if (
    code === "openrouter_billing" ||
    code === "budget_exhausted" ||
    code === "openrouter_not_configured" ||
    code === "generative_disabled"
  ) {
    return true;
  }
  const blob = `${response.message ?? ""} ${JSON.stringify(response.data ?? {})}`;
  return /openrouter_billing|402|credits|billing|generative_kill_switch|openrouter_not_configured/i.test(
    blob,
  );
}

export async function invokeAiGateway<T = unknown>(
  body: AiClientRequest,
): Promise<AiGatewayResponse<T>> {
  const result = await invokeEdgeFunction<Record<string, unknown>>(
    "ai-gateway",
    body as unknown as Record<string, unknown>,
  ) as unknown as { data: (AiGatewayResponse<T> & { error?: string }) | null; error?: string };

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
  /** When set, refuse role-mismatched feature_id / intent hits (Student Panel → student). */
  role?: AiActorRole;
}): { feature_id: string } | { unsupported: true; message: string } {
  if (input.feature_id) {
    const cap = getCapability(input.feature_id);
    if (cap) {
      if (input.role && !cap.allowed_roles.includes(input.role)) {
        return {
          unsupported: true,
          message: `That action is not available for your role. Try attendance, homework, marks, timetable, mastery, or chat with Nova.`,
        };
      }
      return { feature_id: input.feature_id };
    }
  }
  const mapped = mapIntentToCapability(input.text ?? "", {
    role: input.role,
  });
  if (mapped) return { feature_id: mapped.feature_id };

  const text = (input.text ?? "").trim();
  // Free-form Nova chat — Gateway → Model Router (Qwen); never invent local pedagogy.
  const nova = getCapability("student.nova.chat");
  if (text && nova && (!input.role || nova.allowed_roles.includes(input.role))) {
    return { feature_id: "student.nova.chat" };
  }

  return {
    unsupported: true,
    message:
      "I can answer attendance, homework due, marks, today's timetable, mastery/revision, next practice recommendation, concept help, performance summary, or a free chat with Nova. Ask one of those, or use Practice / Doubts for learning help.",
  };
}

function formatDeterministicReply(featureId: string, data: unknown): string {
  if (!data || typeof data !== "object") {
    return "No records found yet for that question.";
  }
  const d = data as Record<string, unknown>;

  switch (featureId) {
    case "student.attendance.query": {
      const total = Number(d.total_marked ?? 0);
      if (total <= 0) {
        return (
          `**Attendance (school records)**\n` +
          `No attendance days have been marked for you yet.\n` +
          `_Source: Academic Engine · no estimates._`
        );
      }
      const pct = d.attendance_pct ?? 0;
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
        `• ${presentAcademicLabel(c.subject, "subject")}: **${presentAcademicLabel(c.concept, "concept")}** — ${c.mastery_score}% (${c.band})`,
      );
      const strongLines = strong.slice(0, 4).map((c: { concept?: string; subject?: string; mastery_score?: number }) =>
        `• ${presentAcademicLabel(c.subject, "subject")}: **${presentAcademicLabel(c.concept, "concept")}** — ${c.mastery_score}%`,
      );
      const revLines = rev.slice(0, 4).map((r: { topic?: string; subject?: string; priority?: number }) =>
        `• ${presentAcademicLabel(r.subject, "subject")}: ${presentAcademicLabel(r.topic ?? "topic", "topic")} (priority ${r.priority})`,
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
    case "parent.child.narrative": {
      if (typeof d.body === "string" && d.body.trim()) return d.body;
      if (typeof d.narrative === "string" && d.narrative.trim()) return d.narrative;
      const lines = Array.isArray(d.paragraphs) ? d.paragraphs.map(String) : [];
      if (lines.length) return lines.join("\n\n");
      return "Parent progress narrative is not available yet for this child.";
    }
    case "student.concept.explain": {
      if (typeof d.explanation === "string" && d.explanation.trim()) {
        return d.explanation;
      }
      const concept = d.concept as Record<string, unknown> | undefined;
      if (concept?.name || concept?.concept) {
        return (
          `**Concept: ${presentAcademicLabel(String(concept.name ?? concept.concept), "concept")}** (${presentAcademicLabel(String(concept.subject ?? "Subject"), "subject")})\n` +
          `Your mastery: **${concept.mastery_score ?? "—"}%**` +
          (concept.band ? ` (${concept.band})` : "") +
          `\n_Generative explanation unavailable — showing Educational Intelligence facts._`
        );
      }
      return "No concept mastery facts are available yet for that topic.";
    }
    case "student.recommendation.next": {
      const actions = Array.isArray(d.actions) ? d.actions : [];
      if (actions.length === 0) {
        return "**Next steps** — no recommendation seeds yet (practice a few concepts first).";
      }
      const lines = actions.slice(0, 5).map(
        (a: {
          title?: string;
          kind?: string;
          subject?: string | null;
          priority?: number;
          reason_codes?: string[];
        }) =>
          `• **${a.title ?? "Action"}**` +
          (a.subject ? ` (${a.subject})` : "") +
          ` — priority ${a.priority ?? 0}` +
          (a.reason_codes?.length ? ` [${a.reason_codes[0]}]` : ""),
      );
      return (
        `**Recommended next steps** (Educational Intelligence)\n` +
        `${lines.join("\n")}\n` +
        `_Deterministic package · LLM does not invent recommendations._`
      );
    }
    case "student.performance.explain": {
      if (typeof d.explanation === "string" && d.explanation.trim()) {
        return d.explanation;
      }
      const facts = d.facts as Record<string, unknown> | undefined;
      if (facts?.attendance && facts?.eie) {
        const att = facts.attendance as { attendance_pct?: number; total_marked?: number };
        const eie = facts.eie as { avg_mastery?: number; total_tracked?: number; weak_concepts?: { concept?: string }[] };
        const weak = (eie.weak_concepts ?? [])
          .slice(0, 3)
          .map((c) => presentAcademicLabel(c.concept, "concept"))
          .filter(Boolean);
        const attMarked = Number(att.total_marked ?? 0);
        const attBit = attMarked > 0 ? `Attendance **${att.attendance_pct ?? 0}%**` : `Attendance **not marked yet**`;
        const masteryBit =
          Number(eie.total_tracked ?? 0) > 0
            ? `Avg mastery **${eie.avg_mastery ?? 0}%**`
            : `Mastery **not tracked yet**`;
        return (
          `**Performance (facts only)**\n` +
          `${attBit} · ${masteryBit}` +
          (weak.length ? `\nFocus concepts: ${weak.join(", ")}` : "") +
          `\n_Generative explanation unavailable — showing Academic Engine + EIE facts._`
        );
      }
      return "Performance facts are not available yet.";
    }
    case "student.nova.chat": {
      if (typeof d.reply === "string" && d.reply.trim()) return d.reply;
      if (typeof d.explanation === "string" && d.explanation.trim()) return d.explanation;
      const facts = d.facts as Record<string, unknown> | undefined;
      if (facts?.attendance || facts?.eie || facts?.marks || facts?.homework || facts?.progression) {
        const att = facts.attendance as { attendance_pct?: number; total_marked?: number } | undefined;
        const marks = facts.marks as { average_pct?: number | null; exams_count?: number } | undefined;
        const eie = facts.eie as {
          avg_mastery?: number;
          total_tracked?: number;
          weak_concepts?: { concept?: string; subject?: string; mastery_score?: number }[];
        } | undefined;
        const hw = facts.homework as { pending_count?: number } | undefined;
        const prog = facts.progression as {
          xp?: number;
          level?: number;
          study_streak?: number;
          battleground_wins?: number;
          practice_sessions?: number;
          weak_concepts?: string[];
        } | undefined;
        if (d.facts_empty === true) {
          return (
            "I do not have enough Academic Engine / mastery records for you yet, so I cannot cite personal attendance, marks, or mastery. " +
            "Ask about a study concept, or check attendance / homework / marks once your school data is synced."
          );
        }
        const progBits = [
          prog?.xp != null ? `XP **${prog.xp}**` : null,
          prog?.level != null ? `Level **${prog.level}**` : null,
          prog?.study_streak != null ? `Streak **${prog.study_streak}d**` : null,
          prog?.practice_sessions != null ? `Practice **${prog.practice_sessions}**` : null,
          prog?.battleground_wins != null ? `Battle wins **${prog.battleground_wins}**` : null,
        ].filter(Boolean);
        const weakFromEie = (eie?.weak_concepts ?? [])
          .slice(0, 3)
          .map((c) => presentAcademicLabel(c.concept, "concept"))
          .filter(Boolean);
        const weakFromProg = (prog?.weak_concepts ?? []).slice(0, 3).filter(Boolean);
        const weakBits = weakFromEie.length ? weakFromEie : weakFromProg;
        const attMarked = Number(att?.total_marked ?? 0);
        const attLine =
          attMarked > 0
            ? `Attendance **${att?.attendance_pct ?? 0}%** (${attMarked} days marked)`
            : `Attendance **not marked yet**`;
        const marksLine =
          Number(marks?.exams_count ?? 0) > 0
            ? `Marks avg **${marks?.average_pct == null ? "—" : `${marks.average_pct}%`}**`
            : `Marks **none published yet**`;
        const masteryLine =
          Number(eie?.total_tracked ?? 0) > 0
            ? `Mastery **${eie?.avg_mastery ?? 0}%**`
            : `Mastery **not tracked yet**`;
        return (
          `**Nova (facts only)**\n` +
          `${attLine}` +
          ` · Homework pending **${hw?.pending_count ?? 0}**` +
          ` · ${marksLine}` +
          ` · ${masteryLine}` +
          (progBits.length ? `\nProgression: ${progBits.join(" · ")}` : "") +
          (weakBits.length ? `\nWeak areas: ${weakBits.join(", ")}` : "") +
          `\n_Generative reply unavailable — showing Academic Engine + EIE + Progression facts._`
        );
      }
      return AI_BILLING_UNAVAILABLE_MSG;
    }
    case "student.knowledge.retrieve": {
      const chunks = Array.isArray(d.chunks) ? d.chunks : Array.isArray(d.hits) ? d.hits : [];
      if (chunks.length === 0) {
        return "**Knowledge retrieve** — no approved notes matched that query yet.";
      }
      const lines = chunks.slice(0, 5).map((c: { title?: string; snippet?: string; text?: string }) =>
        `• **${c.title ?? "Note"}**: ${(c.snippet ?? c.text ?? "").slice(0, 160)}`,
      );
      return `**From approved notes**\n${lines.join("\n")}`;
    }
    default:
      return "Here is what your school records show.";
  }
}

/**
 * Ask the AI Coach a question via Gateway. Deterministic intents get live AE/EIE answers;
 * free-form maps to student.nova.chat (Qwen via OpenRouter).
 */
export async function askAiCoach(input: {
  text: string;
  studentId?: string;
  feature_id?: string;
  channel?: AiClientRequest["channel"];
  locale?: string;
  /** Defaults to student for Gurukul student panel callers. */
  role?: AiActorRole;
  /** Continue an existing Nova multi-turn session */
  session_id?: string;
  /** Open a new session when capability supports memory (default: true for nova chat) */
  open_session?: boolean;
}): Promise<{ text: string; response: AiGatewayResponse }> {
  const role = input.role ?? "student";
  const resolved = resolveCoachCapability({
    feature_id: input.feature_id,
    text: input.text,
    role,
  });
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

  const wantsSession =
    resolved.feature_id === "student.nova.chat" ||
    input.open_session === true ||
    Boolean(input.session_id);

  const response = await invokeAiGateway({
    feature_id: resolved.feature_id,
    intent_hint: input.text,
    input: { text: input.text },
    target_refs: input.studentId ? { studentId: input.studentId } : undefined,
    channel: input.channel ?? "student_app",
    locale: input.locale,
    client_context_version: "gurukul-aicoach/1",
    session_id: input.session_id,
    open_session: input.session_id ? false : wantsSession && input.open_session !== false,
  });

  if (isAiBillingOrCreditsIssue(response) && resolved.feature_id === "student.nova.chat") {
    const d = response.data as Record<string, unknown> | null;
    if (d && (d.facts || d.facts_empty === true)) {
      return {
        text:
          (response.message?.trim() && d.facts_empty === true
            ? response.message.trim()
            : null) || formatDeterministicReply(resolved.feature_id, response.data),
        response,
      };
    }
    const msg = response.message?.trim() || AI_BILLING_UNAVAILABLE_MSG;
    return { text: msg, response };
  }

  if (response.error_code && !response.data) {
    if (isAiBillingOrCreditsIssue(response)) {
      return {
        text: response.message?.trim() || AI_BILLING_UNAVAILABLE_MSG,
        response,
      };
    }
    return {
      text: response.message ?? "I could not load that from your school records right now.",
      response,
    };
  }

  // Generative path returned data but reply null (degraded with facts/empty)
  if (resolved.feature_id === "student.nova.chat") {
    const d = response.data as Record<string, unknown> | null;
    const reply =
      (typeof d?.reply === "string" && d.reply.trim()) ||
      (typeof d?.explanation === "string" && d.explanation.trim()) ||
      "";
    if (reply) {
      return { text: reply, response };
    }
    // Prefer honest gateway message, else format facts-only strip (never invent metrics).
    if (response.message?.trim() && d?.facts_empty === true) {
      return { text: response.message.trim(), response };
    }
    return {
      text: formatDeterministicReply(resolved.feature_id, response.data),
      response,
    };
  }

  // Soft toast path for optional_explain features when generative is down
  if (
    isAiBillingOrCreditsIssue(response) &&
    (resolved.feature_id === "student.performance.explain" ||
      resolved.feature_id === "student.concept.explain")
  ) {
    // Still format facts-only reply; UI may toast separately via error_code
  }

  return {
    text: formatDeterministicReply(resolved.feature_id, response.data),
    response,
  };
}

/** Feedback Loop hook — like / accept / retry from Coach or parent surfaces. */
export async function recordAiFeedback(input: {
  request_id?: string | null;
  school_id?: string | null;
  actor_user_id: string;
  actor_role?: string | null;
  feature_id?: string | null;
  signal_type: import("./feedbackLoop").FeedbackSignalType;
  comment?: string | null;
}) {
  const { supabase } = await import("@/integrations/supabase/client");
  const { captureFeedbackSignal } = await import("./feedbackLoop");
  return captureFeedbackSignal(supabase, input);
}
