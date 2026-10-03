/**
 * loadAuthContext falls back to its old reads ONLY when get_auth_context does
 * not exist. Any other failure of that read is thrown — its fallback reads fail
 * the same way and come back empty, which used to turn a dropped connection into
 * an account with no role.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ authContext: { data: null as unknown, error: null as unknown } }));

const chain = () => {
  const c: Record<string, unknown> = {};
  for (const m of ["select", "eq"]) c[m] = () => c;
  c.maybeSingle = () => Promise.resolve({ data: { id: "u1", email: null, full_name: "Asha", photo_url: null, school_id: null, is_active: true }, error: null });
  c.then = (res: (v: unknown) => unknown) => Promise.resolve({ data: [{ role: "student" }], error: null }).then(res);
  return c;
};

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: (name: string) => {
      if (name === "get_auth_context") return Promise.resolve(h.authContext);
      if (name === "get_my_role") return Promise.resolve({ data: "student", error: null });
      return Promise.resolve({ data: null, error: null });
    },
    from: () => chain(),
  },
}));

import { isMissingFunction, loadAuthContext } from "./session";

describe("reading the account", () => {
  beforeEach(() => {
    h.authContext = { data: null, error: null };
  });

  it("a failed read is thrown, not turned into an empty account", async () => {
    h.authContext = { data: null, error: { message: "TypeError: Failed to fetch", code: "" } };
    await expect(loadAuthContext("u1")).rejects.toThrow(/could not load the account: TypeError: Failed to fetch/);
    h.authContext = { data: null, error: { message: "canceling statement due to statement timeout", code: "57014" } };
    await expect(loadAuthContext("u1")).rejects.toThrow(/statement timeout/);
  });

  it("CONTROL: an environment without get_auth_context still falls back, and the account is read", async () => {
    h.authContext = { data: null, error: { message: "Could not find the function", code: "PGRST202" } };
    const ctx = await loadAuthContext("u1");
    expect(ctx?.role).toBe("student");
    expect(ctx?.profile.fullName).toBe("Asha");
    expect(isMissingFunction({ code: "42883" })).toBe(true);
    expect(isMissingFunction({ code: "" })).toBe(false);
  });
});
