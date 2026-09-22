/**
 * A refreshed token does not tear the app down.
 *
 * Measured 2026-09-22: every auth event that carried a session — the hourly
 * TOKEN_REFRESHED among them — set loading=true and reloaded role, profile and
 * school. ProtectedRoute renders a spinner while loading, so the whole student
 * panel unmounted and a timed practice session in progress was finished as
 * "left" with one answer, at the very second its token was refreshed.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import { useEffect } from "react";

const h = vi.hoisted(() => ({
  listener: null as null | ((event: string, session: unknown) => void),
  loadAuthContext: vi.fn(),
  mounts: 0,
  // One client for the life of the app, as the real QueryClientProvider gives.
  queryClient: { clear: () => {} },
}));

const sessionFor = (id: string, token = "t1") => ({ access_token: token, user: { id, email: `${id}@x.test` } });

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: {
      onAuthStateChange: (cb: (event: string, session: unknown) => void) => {
        h.listener = cb;
        return { data: { subscription: { unsubscribe: () => {} } } };
      },
      getSession: () => Promise.resolve({ data: { session: sessionFor("u1") } }),
    },
  },
}));
vi.mock("./session", () => ({ loadAuthContext: (...a: unknown[]) => h.loadAuthContext(...a), clearClientAuthCaches: () => {} }));
vi.mock("@tanstack/react-query", () => ({ useQueryClient: () => h.queryClient }));

import { AuthProvider, useAuth } from "./AuthProvider";

// Stands in for ProtectedRoute: the page exists only while auth is not loading.
function Gate() {
  const { loading, user } = useAuth();
  if (loading) return <p>spinner</p>;
  return <Page userId={user?.id ?? ""} />;
}
function Page({ userId }: { userId: string }) {
  useEffect(() => { h.mounts += 1; }, []);
  return <p>page for {userId}</p>;
}

const context = (id: string) => ({
  role: "student", profile: { id, isActive: true }, school: { id: "s1" },
});

describe("AuthProvider — the same user's auth events", () => {
  beforeEach(() => {
    h.mounts = 0;
    h.loadAuthContext.mockReset();
    h.loadAuthContext.mockImplementation((id: string) => Promise.resolve(context(id)));
  });

  const boot = async () => {
    render(<AuthProvider><Gate /></AuthProvider>);
    await screen.findByText("page for u1");
    await waitFor(() => expect(h.loadAuthContext).toHaveBeenCalled());
  };

  it("a refreshed token keeps the page mounted and reloads nothing", async () => {
    await boot();
    const loadsAfterBoot = h.loadAuthContext.mock.calls.length;
    const mountsAfterBoot = h.mounts;
    act(() => { h.listener?.("TOKEN_REFRESHED", sessionFor("u1", "t2")); });
    act(() => { h.listener?.("SIGNED_IN", sessionFor("u1", "t3")); }); // a tab regaining focus
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.getByText("page for u1")).toBeInTheDocument();
    expect(screen.queryByText("spinner")).toBeNull();
    expect(h.mounts, "the page was torn down and built again").toBe(mountsAfterBoot);
    expect(h.loadAuthContext).toHaveBeenCalledTimes(loadsAfterBoot);
  });

  it("POSITIVE CONTROL: a different user signing in does reload", async () => {
    await boot();
    const loadsAfterBoot = h.loadAuthContext.mock.calls.length;
    act(() => { h.listener?.("SIGNED_IN", sessionFor("u2")); });
    expect(await screen.findByText("page for u2")).toBeInTheDocument();
    expect(h.loadAuthContext).toHaveBeenCalledTimes(loadsAfterBoot + 1);
    expect(h.loadAuthContext).toHaveBeenLastCalledWith("u2");
  });
});
