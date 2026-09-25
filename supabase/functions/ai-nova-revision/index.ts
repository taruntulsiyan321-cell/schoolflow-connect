// Nova Revision mode — gist of any topic, then a Feynman cross-questioning loop.
// All validation, prompts and output checks live in ../_shared/novaRevision.ts.
import { corsHeaders, generateStructuredWithFallback, jsonResponse } from "../_shared/structuredCompletion.ts";
import { requireUserJwt } from "../_shared/requireAuth.ts";
import {
  buildGistPrompt,
  buildTurnPrompt,
  normaliseGist,
  normaliseTurn,
  parseRevisionRequest,
  retryNote,
  turnQualityIssue,
} from "../_shared/novaRevision.ts";

/**
 * One model call, validated, with one retry when the output fails validation.
 * Measured before adding it: 1 turn in 8 came back with a field missing, and a
 * student mid-explanation should not see an error for the model's formatting.
 * An unsafe verdict is an answer, not a malformed one, so it is never retried.
 *
 * A reply can also be valid but poor (`issue`). That is retried once too —
 * with `note` telling the model what was wrong, because the same prompt twice
 * gives the same draft twice — and the first reply is kept: if the second is
 * no better, or fails outright, the student still gets a reply, not an error.
 */
type Checked<T> =
  | { ok: true; value: T; issue?: string | null; note?: string }
  | { ok: false; error: string; retry: boolean };

async function callValidated<T>(
  prompt: { system: string; user: string; schema: Record<string, unknown> },
  opts: { temperature: number; max_tokens: number },
  validate: (raw: unknown) => Checked<T>,
): Promise<Response> {
  let last = "Nova's reply was incomplete — try again";
  let fallback: T | null = null;
  let current = prompt;
  for (let attempt = 1; attempt <= 2; attempt++) {
    const result = await generateStructuredWithFallback<unknown>(current, opts);
    if (!result.ok) {
      if (fallback) break;
      return jsonResponse({ error: result.error }, result.status);
    }
    const checked = validate(result.data);
    if (checked.ok) {
      if (!checked.issue || attempt === 2) return jsonResponse(checked.value as Record<string, unknown>);
      fallback = checked.value;
      if (checked.note) current = { ...prompt, user: `${prompt.user}\n\n${checked.note}` };
      console.warn(`ai-nova-revision: attempt ${attempt} valid but poor (${checked.issue}); asking once more`);
      continue;
    }
    if (!checked.retry) return jsonResponse({ error: checked.error }, 422);
    last = checked.error;
    const keys = result.data && typeof result.data === "object" ? Object.keys(result.data as object) : [];
    console.warn(`ai-nova-revision: attempt ${attempt} failed validation (${checked.error}); keys=${keys.join(",")}`);
  }
  if (fallback) return jsonResponse(fallback as Record<string, unknown>);
  return jsonResponse({ error: last }, 502);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "POST only" }, 405);

  const auth = await requireUserJwt(req);
  if (!auth.ok) return auth.response;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: "Request body must be JSON" }, 400);
  }

  const parsed = parseRevisionRequest(body);
  if (!parsed.ok) return jsonResponse({ error: parsed.error }, 400);
  const request = parsed.value;

  try {
    if (request.mode === "gist") {
      return await callValidated(buildGistPrompt(request), { temperature: 0.4, max_tokens: 1400 }, (raw) => {
        const gist = normaliseGist(raw);
        return gist.ok
          ? { ok: true, value: { gist: gist.gist } }
          : { ok: false, error: gist.error, retry: gist.reason === "malformed" };
      });
    }
    return await callValidated(buildTurnPrompt(request), { temperature: 0.3, max_tokens: 700 }, (raw) => {
      const turn = normaliseTurn(raw, request);
      if (!turn.ok) return { ok: false, error: turn.error, retry: true };
      const issue = turnQualityIssue(turn.value, request);
      return { ok: true, value: { turn: turn.value }, issue, note: issue ? retryNote(issue, turn.value) : undefined };
    });
  } catch (err) {
    return jsonResponse({ error: (err as Error).message ?? "Unknown error" }, 500);
  }
});
