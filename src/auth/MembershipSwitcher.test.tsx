import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

/**
 * The regression: the switch succeeded and then sent the user back.
 *
 * `switchTo` closed over `homePath` from `useAuth()`, which is
 * `dashboardForRole(role)` for the role at the render that created the closure
 * — the role BEFORE the switch. `refreshAuth()` updated the context, but the
 * captured const did not, so a teacher-parent switching to `parent` was
 * navigated straight back to `/teacher`, where every query is refused. It
 * presented as "the RPC works but the UI switch does not take effect".
 *
 * These assert the destination, because that is the whole defect.
 */

const navigate = vi.fn();
const rpc = vi.fn();
const refreshAuth = vi.fn();

const MEMBERSHIPS = [
  { id: "m-teacher", role: "teacher", school_id: "s1", schools: { name: "Wisdom Campus" } },
  { id: "m-parent", role: "parent", school_id: "s1", schools: { name: "Wisdom Campus" } },
];

vi.mock("react-router-dom", () => ({ useNavigate: () => navigate }));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: () => ({
      select: () => ({
        eq: () => ({
          eq: () => Promise.resolve({ data: MEMBERSHIPS, error: null }),
        }),
      }),
    }),
    rpc: (...args: unknown[]) => rpc(...args),
  },
}));

// The account is acting as `teacher`, so homePath would be the teacher home.
// That is exactly the stale value the component must NOT navigate to.
vi.mock("@/auth/AuthProvider", () => ({
  useAuth: () => ({
    user: { id: "dual-role-account" },
    role: "teacher",
    refreshAuth,
    homePath: "/teacher",
  }),
}));

vi.mock("./AuthProvider", () => ({
  useAuth: () => ({
    user: { id: "dual-role-account" },
    role: "teacher",
    refreshAuth,
    homePath: "/teacher",
  }),
}));

import { MembershipSwitcher } from "./MembershipSwitcher";
import { dashboardForRole } from "./rbac";

async function switchToParent() {
  render(<MembershipSwitcher />);
  const select = await screen.findByLabelText("Switch role");
  // fireEvent rather than user-event: the latter is not a dependency of this
  // project and one regression test is not a reason to add one.
  fireEvent.change(select, { target: { value: "m-parent" } });
}

describe("MembershipSwitcher", () => {
  beforeEach(() => {
    navigate.mockReset();
    refreshAuth.mockReset();
    rpc.mockReset().mockResolvedValue({ error: null });
  });

  it("calls rpc_switch_membership with the chosen membership", async () => {
    await switchToParent();
    await waitFor(() => expect(rpc).toHaveBeenCalledWith("rpc_switch_membership", {
      _membership_id: "m-parent",
    }));
  });

  it("navigates to the TARGET role's home, not the role it started in", async () => {
    await switchToParent();

    await waitFor(() => expect(navigate).toHaveBeenCalled());
    const dest = navigate.mock.calls[0][0];

    expect(dest).toBe(dashboardForRole("parent"));
    // The defect, stated as an assertion: it must not go back to /teacher.
    expect(dest).not.toBe("/teacher");
  });

  it("re-resolves auth before navigating", async () => {
    // Without this the new shell mounts against the old role context.
    await switchToParent();
    await waitFor(() => expect(refreshAuth).toHaveBeenCalled());
  });

  it("does not navigate when the switch itself failed", async () => {
    rpc.mockResolvedValue({ error: { message: "nope" } });
    await switchToParent();

    await waitFor(() => expect(screen.getByText(/Could not switch role/)).toBeTruthy());
    expect(navigate).not.toHaveBeenCalled();
    expect(refreshAuth).not.toHaveBeenCalled();
  });

  it("renders nothing for a single-membership account (positive control)", async () => {
    // Every account but the dual-role one. Without this a switcher that
    // rendered for everybody would pass all of the above.
    MEMBERSHIPS.splice(1, 1);
    const { container } = render(<MembershipSwitcher />);
    await waitFor(() => expect(container.firstChild).toBeNull());
    MEMBERSHIPS.push({ id: "m-parent", role: "parent", school_id: "s1", schools: { name: "Wisdom Campus" } });
  });
});
