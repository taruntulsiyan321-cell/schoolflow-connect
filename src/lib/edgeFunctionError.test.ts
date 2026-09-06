import { describe, expect, it } from "vitest";
import { edgeFunctionErrorMessage, readEdgeFunctionError } from "./edgeFunctionError";

/**
 * The shape `supabase.functions.invoke` actually throws for a non-2xx: a
 * FunctionsHttpError whose own message says nothing useful, with the server's
 * body hanging off `context` as an unread Response.
 */
function functionsHttpError(status: number, body: unknown, opts: { raw?: string } = {}) {
  const payload = opts.raw ?? JSON.stringify(body);
  const err = new Error("Edge Function returned a non-2xx status code") as Error & {
    context?: Response;
  };
  err.context = new Response(payload, { status });
  return err;
}

describe("readEdgeFunctionError", () => {
  it("recovers the budget message a 429 carries", async () => {
    const err = functionsHttpError(429, {
      error: "Daily AI generation budget for this school has been reached",
      error_code: "budget_exhausted",
      units_used: 400,
      hard_limit: 400,
    });

    const failure = await readEdgeFunctionError(err);

    expect(failure.status).toBe(429);
    expect(failure.message).toBe("Daily AI generation budget for this school has been reached");
    expect(failure.errorCode).toBe("budget_exhausted");
    expect(failure.body?.units_used).toBe(400);
  });

  it("distinguishes a budget that could not be read from one that was exhausted", async () => {
    const unreadable = await readEdgeFunctionError(
      functionsHttpError(503, { error: "Could not check this school's AI budget", error_code: "budget_check_failed" }),
    );
    const exhausted = await readEdgeFunctionError(
      functionsHttpError(429, { error: "Daily AI generation budget ...", error_code: "budget_exhausted" }),
    );

    expect(unreadable.status).toBe(503);
    expect(unreadable.errorCode).toBe("budget_check_failed");
    expect(exhausted.status).toBe(429);
    expect(exhausted.errorCode).toBe("budget_exhausted");
  });

  it("does not drain the caller's copy of the body", async () => {
    // The regression this guards: reading `context` directly instead of a clone
    // leaves the Response empty for anyone who looks at it afterwards.
    const err = functionsHttpError(403, { error: "Forbidden", error_code: "insufficient_role" });

    await readEdgeFunctionError(err);

    await expect(err.context!.text()).resolves.toContain("insufficient_role");
  });

  it("hands back a non-JSON body rather than nothing", async () => {
    const failure = await readEdgeFunctionError(
      functionsHttpError(502, null, { raw: "upstream timeout" }),
    );

    expect(failure.status).toBe(502);
    expect(failure.message).toBe("upstream timeout");
    expect(failure.errorCode).toBeNull();
  });

  it("returns an empty failure for an error that is not an edge-function error", async () => {
    for (const notOne of [new Error("network down"), null, undefined, "a string", { context: 42 }]) {
      const failure = await readEdgeFunctionError(notOne);
      expect(failure).toEqual({ status: null, message: null, errorCode: null, body: null });
    }
  });

  it("survives a body that cannot be read at all", async () => {
    const err = new Error("boom") as Error & { context?: unknown };
    err.context = {
      status: 500,
      text: () => Promise.reject(new Error("stream already consumed")),
      clone() { return this; },
    };

    const failure = await readEdgeFunctionError(err);

    // The status is still evidence even when the body is gone.
    expect(failure.status).toBe(500);
    expect(failure.message).toBeNull();
  });

  it("treats an empty body as no message, not as an empty message", async () => {
    const failure = await readEdgeFunctionError(functionsHttpError(500, null, { raw: "   " }));
    expect(failure.message).toBeNull();
  });
});

describe("edgeFunctionErrorMessage", () => {
  it("prefers the function's own words", async () => {
    const msg = await edgeFunctionErrorMessage(
      functionsHttpError(429, { error: "Daily AI generation budget for this school has been reached" }),
      "Question generation failed",
    );
    expect(msg).toBe("Daily AI generation budget for this school has been reached");
  });

  it("falls back when the function sent nothing usable", async () => {
    const msg = await edgeFunctionErrorMessage(new Error("network down"), "Question generation failed");
    expect(msg).toBe("Question generation failed");
  });
});
