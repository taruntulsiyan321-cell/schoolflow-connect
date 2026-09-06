import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "./AuthProvider";
import { dashboardForRole } from "./rbac";
import type { AppRole } from "./types";

/**
 * The membership picker §10.18 always implied and nothing provided.
 *
 * `memberships` is UNIQUE on (account_id, school_id, role) precisely so one
 * account can hold several roles at one institution — a teacher whose child
 * attends the same school is most of the staff at an Indian school. Until
 * 20260906000000 such an account resolved `active_membership_id()` to NULL and
 * was refused by all 111 policies. That migration made it default to the
 * highest-precedence membership, which turned a lockout into a one-way door:
 * the teacher-parent lands in `teacher` and has no way to reach their own
 * child's parent surfaces, which are frozen scope.
 *
 * This is the door handle. `rpc_switch_membership` already existed, already
 * worked, and had zero callers.
 *
 * DELIBERATELY SMALL
 *   · Renders NOTHING for a single-membership account, which is every account
 *     in the database today — so the cost to the 111-policy majority is zero.
 *   · No settings page. No local persistence: the choice lives in
 *     `sessions.active_membership_id` and nowhere else, so it survives a reload
 *     and cannot disagree with what the database thinks is active.
 *   · Re-resolves auth and returns to the role's home, because the role decides
 *     which app is mounted; leaving the user on a teacher route after switching
 *     to parent would render a screen every query is now refused on — the exact
 *     failure this feature exists to end.
 *
 * The switch itself is asserted in probe13: `has_role` flips both ways and the
 * same upload is permitted and then refused.
 */

type MembershipRow = {
  id: string;
  role: AppRole;
  school_id: string;
  schools: { name: string | null } | null;
};

const ROLE_LABEL: Record<string, string> = {
  super_admin: "Super admin",
  admin: "Admin",
  principal: "Principal",
  teacher: "Teacher",
  student: "Student",
  parent: "Parent",
};

export function MembershipSwitcher({ className = "" }: { className?: string }) {
  const { user, role, refreshAuth } = useAuth();
  const navigate = useNavigate();
  const [rows, setRows] = useState<MembershipRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!user?.id) {
      setRows([]);
      return;
    }
    void (async () => {
      // `memberships_select_own` is `account_id = auth.uid()`, so this read does
      // not itself depend on an active membership — which is what makes the
      // picker reachable from the broken state it exists to fix.
      const { data, error: readErr } = await supabase
        .from("memberships")
        .select("id, role, school_id, schools(name)")
        .eq("account_id", user.id)
        .eq("status", "active");
      if (cancelled) return;
      if (readErr) {
        // Not fatal: the header simply does not offer a switch. Saying so beats
        // an empty element that looks deliberate.
        console.warn("[MembershipSwitcher] could not read memberships:", readErr.message);
        setRows([]);
        return;
      }
      setRows((data ?? []) as unknown as MembershipRow[]);
    })();
    return () => {
      cancelled = true;
    };
  }, [user?.id]);

  // The whole point of the "only when it matters" rule: one membership, no UI.
  if (rows.length < 2) return null;

  const current = rows.find((r) => r.role === role) ?? null;

  const switchTo = async (membershipId: string) => {
    if (busy || membershipId === current?.id) return;
    setBusy(true);
    setError(null);
    const { error: rpcErr } = await supabase.rpc("rpc_switch_membership", {
      _membership_id: membershipId,
    });
    if (rpcErr) {
      // A failed switch must not look like a successful one. Leaving the user in
      // the old role is correct; telling them is the part that was missing.
      setError(rpcErr.message);
      setBusy(false);
      return;
    }
    await refreshAuth();
    setBusy(false);

    // NAVIGATE TO THE TARGET ROLE'S HOME, NOT `homePath`.
    //
    // This is why the RPC worked when called directly and the UI switch did
    // not take effect. `homePath` is `dashboardForRole(role)` from the auth
    // context, and this closure captured it AT THE RENDER THAT CREATED IT —
    // before the switch. `refreshAuth()` updates the context, but the `const`
    // in this closure is still the OLD role's path, so the user was navigated
    // straight back into the app they had just left, where every query is
    // refused. It looked like the switch had failed; it had succeeded and then
    // sent them back.
    //
    // The target membership's role is already in hand, so the destination is
    // derived from it rather than from state that has to have caught up.
    const target = rows.find((r) => r.id === membershipId);
    navigate(dashboardForRole(target?.role ?? role), { replace: true });
  };

  return (
    <div className={`flex flex-col items-end gap-1 ${className}`}>
      <label className="sr-only" htmlFor="membership-switcher">
        Switch role
      </label>
      <select
        id="membership-switcher"
        className="h-8 rounded-lg border border-border bg-card px-2 text-xs font-semibold text-foreground disabled:opacity-60"
        value={current?.id ?? ""}
        disabled={busy}
        onChange={(e) => void switchTo(e.target.value)}
      >
        {!current && (
          <option value="" disabled>
            Choose a role
          </option>
        )}
        {rows.map((r) => (
          <option key={r.id} value={r.id}>
            {ROLE_LABEL[r.role] ?? r.role}
            {r.schools?.name ? ` · ${r.schools.name}` : ""}
          </option>
        ))}
      </select>
      {error && (
        <span className="text-[10px] text-destructive max-w-[14rem] text-right">
          Could not switch role: {error}
        </span>
      )}
    </div>
  );
}

export default MembershipSwitcher;
