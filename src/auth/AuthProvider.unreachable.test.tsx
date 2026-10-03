/**
 * An account that could not be READ is not an account without a profile.
 *
 * Measured 2026-10-03 with three browsers loading the app at once: the auth
 * context timed out, was set to null, and every screen read null as "missing
 * profile" — the student was sent to "Profile unavailable — try signing in
 * again". A fast failure was worse: the context came back with no role, and the
 * page said "Account not set up — sign out and pick your exam". Both were a
 * slow connection. It is its own status now, and the answer is to try again.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

const h = vi.hoisted(() => ({
  loadAuthContext: vi.fn(),
  queryClient: { clear: () => {} },
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: {
      onAuthStateChange: (cb: (event: string, session: unknown) => void) => {
        queueMicrotask(() => cb("INITIAL_SESSION", { access_token: "t", user: { id: "u1", email: "u1@x.test" } }));
        return { data: { subscription: { unsubscribe: () => {} } } };
      },
    },
  },
}));
vi.mock("./session", () => ({ loadAuthContext: (...a: unknown[]) => h.loadAuthContext(...a), clearClientAuthCaches: () => {} }));
vi.mock("@tanstack/react-query", () => ({ useQueryClient: () => h.queryClient }));

import { AuthProvider, useAuth } from "./AuthProvider";
import { ProtectedRoute } from "@/components/ProtectedRoute";

function Status() {
  const { status } = useAuth();
  return <p data-testid="status">{status}</p>;
}

function app() {
  return render(
    <AuthProvider>
      <MemoryRouter initialEntries={["/student"]}>
        <Routes>
          <Route path="/student" element={<ProtectedRoute allow={["student"]}><p>the student panel</p></ProtectedRoute>} />
          <Route path="/unauthorized" element={<p>unauthorized page</p>} />
        </Routes>
        <Status />
      </MemoryRouter>
    </AuthProvider>,
  );
}

const context = { role: "student", profile: { id: "u1", isActive: true }, school: null };

describe("an account that could not be read", () => {
  beforeEach(() => {
    h.loadAuthContext.mockReset();
  });

  it("is 'unreachable', not 'missing profile' — and the student is offered a retry, not sent away", async () => {
    h.loadAuthContext.mockRejectedValueOnce(new Error("could not load the account: Failed to fetch"));
    app();
    expect(await screen.findByText("We could not reach Gurukul")).toBeInTheDocument();
    expect(screen.getByTestId("status")).toHaveTextContent("unreachable");
    expect(screen.queryByText("unauthorized page")).toBeNull();
  });

  it("Try again reads the account again, and the panel opens", async () => {
    h.loadAuthContext.mockRejectedValueOnce(new Error("Timed out loading auth context"));
    h.loadAuthContext.mockResolvedValue(context);
    app();
    await screen.findByText("We could not reach Gurukul");
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Try again" })); });
    expect(await screen.findByText("the student panel")).toBeInTheDocument();
    expect(screen.getByTestId("status")).toHaveTextContent("authenticated");
  });

  it("CONTROL: an account read with no role is still 'missing role', and is sent to the page that says so", async () => {
    h.loadAuthContext.mockResolvedValue({ ...context, role: null });
    app();
    await waitFor(() => expect(screen.getByTestId("status")).toHaveTextContent("missing_role"));
    expect(await screen.findByText("unauthorized page")).toBeInTheDocument();
  });
});
