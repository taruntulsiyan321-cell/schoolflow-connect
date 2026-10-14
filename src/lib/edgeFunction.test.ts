/**
 * What an edge-function call tells the screen, for each way it can end. Each
 * case is the error class supabase-js itself produces.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FunctionsFetchError, FunctionsHttpError } from "@supabase/supabase-js";

const invoke = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({ supabase: { functions: { invoke: (...a: unknown[]) => invoke(...a) } } }));

import { invokeEdgeFunction, UNREACHED } from "./edgeFunction";

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

beforeEach(() => {
  invoke.mockReset();
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

describe("invokeEdgeFunction", () => {
  it("a request that got no answer says it did not reach the service, not that the service is down", async () => {
    invoke.mockResolvedValue({ data: null, error: new FunctionsFetchError(new TypeError("Failed to fetch")) });
    const r = await invokeEdgeFunction("ai-nova-revision", { mode: "gist" });
    expect(r.error).toBe(UNREACHED);
    expect(r.error).not.toMatch(/unavailable/i);
    expect(r.data).toBeNull();
  });

  it("CONTROL: a refusal from the function keeps the function's own words", async () => {
    invoke.mockResolvedValue({ data: null, error: new FunctionsHttpError(json(400, { error: "Keep the topic under 120 characters" })) });
    const r = await invokeEdgeFunction("ai-nova-revision", { mode: "gist" });
    expect(r.error).toBe("Keep the topic under 120 characters");
  });

  it("a plan's refusal is handed over as the plan notice", async () => {
    const refusal = {
      error_code: "plan_limit",
      premium: { ok: false, feature: "nova.message", period: "day", limit: 5, used: 5, remaining: 0, reason: "limit_reached", applies: true, enforced: true },
    };
    invoke.mockResolvedValue({ data: null, error: new FunctionsHttpError(json(402, refusal)) });
    const r = await invokeEdgeFunction("ai-nova-revision", { mode: "gist" });
    expect(r.planLimit).toBeTruthy();
    expect(r.error).toBe(r.planLimit?.message);
  });

  it("a call that outlasts its budget says Nova is taking longer, and one the caller cancelled says nothing", async () => {
    invoke.mockImplementation((_name: string, opts: { signal: AbortSignal }) =>
      new Promise((_, reject) => opts.signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")))));
    const late = await invokeEdgeFunction("ai-nova-revision", {}, { timeoutMs: 5 });
    expect(late.error).toBe("Nova is taking longer than expected. Please try again.");

    const mine = new AbortController();
    const pending = invokeEdgeFunction("ai-nova-revision", {}, { signal: mine.signal, timeoutMs: 60_000 });
    mine.abort();
    expect(await pending).toMatchObject({ data: null, error: null });
  });
});
