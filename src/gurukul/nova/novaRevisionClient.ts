import { invokeEdgeFunction } from "@/lib/edgeFunction";
import { academicLabelEquals } from "@/academic/taxonomy";
import {
  REVISION_LIMITS,
  type RevisionGist,
  type RevisionPoint,
  type RevisionStyle,
  type RevisionTurn,
  type RevisionTurnResult,
} from "../../../supabase/functions/_shared/novaRevision.ts";

/**
 * The browser side of `ai-nova-revision`. Types and limits are imported from
 * the edge function's own module, so the contract has one home.
 *
 * Every response is checked here before a screen sees it. The server already
 * validates what the model said; this checks what the server said, so a
 * deploy that changes the shape shows up as an error, not as a blank screen.
 */

export { REVISION_LIMITS };
export type { RevisionGist, RevisionPoint, RevisionStyle, RevisionTurn, RevisionTurnResult };

export type Result<T> = { ok: true; value: T } | { ok: false; error: string };

export const CONTRACT_ERROR = "Nova sent a reply this screen can't read. Please try again.";
const GIST_TIMEOUT_MS = 60_000;
const TURN_TIMEOUT_MS = 45_000;

const isText = (v: unknown): v is string => typeof v === "string" && v.trim().length > 0;
const isIndexList = (v: unknown): v is number[] => Array.isArray(v) && v.every((n) => Number.isInteger(n) && n >= 0);

export function parseGist(data: unknown): RevisionGist | null {
  const g = (data as { gist?: unknown } | null)?.gist as Record<string, unknown> | undefined;
  if (!g || typeof g !== "object") return null;
  const points = g.key_points;
  if (
    !isText(g.title) || !isText(g.one_liner) || !isText(g.what_is_it) || !isText(g.opening_question) ||
    !Array.isArray(points) || points.length < REVISION_LIMITS.POINTS_MIN ||
    !points.every((p) => isText((p as RevisionPoint)?.heading) && isText((p as RevisionPoint)?.detail)) ||
    !Array.isArray(g.examples) || !g.examples.every(isText)
  ) {
    return null;
  }
  return g as unknown as RevisionGist;
}

export function parseTurn(data: unknown, pointCount: number): RevisionTurnResult | null {
  const t = (data as { turn?: unknown } | null)?.turn as Record<string, unknown> | undefined;
  if (!t || typeof t !== "object") return null;
  if (
    !isText(t.feedback) || !isText(t.next_question) ||
    !isIndexList(t.explained) || !isIndexList(t.covered) ||
    t.covered.some((i) => i >= pointCount) ||
    typeof t.complete !== "boolean" ||
    !(t.misconception === null || isText(t.misconception))
  ) {
    return null;
  }
  return t as unknown as RevisionTurnResult;
}

/**
 * The subject a typed topic belongs to, when the topic IS one of the student's
 * own chapters and only one subject has a chapter by that name; "" otherwise.
 *
 * Revision takes any topic, and a topic with no subject is written up in its
 * everyday sense. Measured 2026-09-25 on www.gurukul.study: a CUET Business
 * Studies student typed "Planning" and got planning a road trip — "Creating a
 * Timeline" as a key idea — not the chapter they are examined on.
 */
export function subjectForTopic(topic: string, chapters: { subject: string; chapter: string | null }[]): string {
  const subjects = new Set(chapters.filter((c) => academicLabelEquals(c.chapter, topic)).map((c) => c.subject));
  return subjects.size === 1 ? [...subjects][0] : "";
}

export async function fetchRevisionGist(
  input: { topic: string; subject?: string; grade?: string; style?: RevisionStyle },
  signal?: AbortSignal,
): Promise<Result<RevisionGist> | null> {
  const { data, error } = await invokeEdgeFunction<Record<string, unknown>>(
    "ai-nova-revision",
    { mode: "gist", topic: input.topic, subject: input.subject ?? "", grade: input.grade ?? "", style: input.style ?? "standard" },
    { signal, timeoutMs: GIST_TIMEOUT_MS },
  );
  if (signal?.aborted) return null;
  if (error) return { ok: false, error };
  const gist = parseGist(data);
  return gist ? { ok: true, value: gist } : { ok: false, error: CONTRACT_ERROR };
}

export async function sendRevisionAnswer(
  input: {
    topic: string;
    subject?: string;
    grade?: string;
    points: RevisionPoint[];
    covered: number[];
    history: RevisionTurn[];
    answer: string;
  },
  signal?: AbortSignal,
): Promise<Result<RevisionTurnResult> | null> {
  const { data, error } = await invokeEdgeFunction<Record<string, unknown>>(
    "ai-nova-revision",
    {
      mode: "turn",
      topic: input.topic,
      subject: input.subject ?? "",
      grade: input.grade ?? "",
      points: input.points,
      covered: input.covered,
      // The server refuses more than HISTORY_MAX turns rather than trimming
      // silently, so the trimming is done here, where the choice is visible.
      history: input.history.slice(-REVISION_LIMITS.HISTORY_MAX),
      answer: input.answer.slice(0, REVISION_LIMITS.ANSWER_MAX),
    },
    { signal, timeoutMs: TURN_TIMEOUT_MS },
  );
  if (signal?.aborted) return null;
  if (error) return { ok: false, error };
  const turn = parseTurn(data, input.points.length);
  return turn ? { ok: true, value: turn } : { ok: false, error: CONTRACT_ERROR };
}
