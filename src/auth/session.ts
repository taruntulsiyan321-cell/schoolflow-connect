import { supabase } from "@/integrations/supabase/client";
import { clearAppStorage } from "@/lib/clientStorage";
import type { AuthContextData, AppRole } from "./types";

type AuthContextRow = {
  user_id: string;
  email: string | null;
  full_name: string | null;
  photo_url: string | null;
  is_active: boolean | null;
  role: AppRole | null;
  school_id: string | null;
  school_name: string | null;
  school_slug: string | null;
  school_logo_url: string | null;
};

/**
 * Which app a multi-role account lands in, highest precedence first.
 *
 * MIRRORED IN THE DATABASE as `public._role_precedence` (20260906000000). The
 * database uses it to pick a DEFAULT active membership when an account holds
 * several and has chosen none; if the two orders disagree, the client renders
 * one role's app while the database activates another's membership -- a
 * fully-drawn screen on which nothing works. `rolePrecedenceParity.test.ts`
 * fails if they diverge. Exported for that test.
 *
 * Not a privilege ordering, and not an authorization check.
 */
export const ROLE_PRIORITY: AppRole[] = [
  "super_admin",
  "admin",
  "principal",
  "teacher",
  "student",
  "parent",
];

function pickRole(roles: { role: string }[] | null | undefined): AppRole | null {
  const owned = (roles ?? []).map((r) => r.role as AppRole);
  return ROLE_PRIORITY.find((p) => owned.includes(p)) ?? null;
}

function mapRow(row: AuthContextRow): AuthContextData {
  return {
    userId: row.user_id,
    profile: {
      id: row.user_id,
      email: row.email,
      fullName: row.full_name ?? "",
      photoUrl: row.photo_url,
      isActive: row.is_active !== false,
    },
    role: row.role,
    // Never invent a tenant — missing school_id must fail closed for Academic Engine.
    school: row.school_id
      ? {
          id: row.school_id,
          name: row.school_name ?? "School",
          slug: row.school_slug,
          logoUrl: row.school_logo_url,
        }
      : null,
  };
}

/**
 * Role resolution: bind the session → ask the database which membership the
 * caller is ACTING IN. Priority is a fallback, not the rule: it decides only
 * which membership becomes the DEFAULT for an account that has chosen none,
 * and that decision is made in the database (`_role_precedence`, 20260906000000).
 * Missing role fails closed to null → AuthStatus missing_role /unauthorized.
 *
 * Since Chunk 1.5 `memberships` is the only authority for a role; `user_roles`
 * is frozen (read-only at the table level) and no longer written by any path,
 * so a new account never gets a row there. It is still consulted as a last
 * resort so accounts predating the migration cannot be locked out, but a value
 * from it means the account has no membership and should be re-invited.
 */
async function resolveRole(userId: string): Promise<AppRole | null> {
  try {
    await supabase.rpc("link_portal_on_auth", { _uid: userId });
  } catch {
    /* optional - portal linking may not exist in all envs */
  }

  // Binds this GoTrue session to a sessions row and materialises an active
  // membership: an explicit choice already recorded on the session is preserved
  // (rpc_start_session COALESCEs it), and only an account that has chosen
  // nothing gets the highest-precedence default.
  try {
    await (supabase.rpc as any)("rpc_start_session");
  } catch {
    /* optional - pre-Chunk-1 environments have no session table */
  }

  // THE DATABASE DECIDES WHICH MEMBERSHIP THE CALLER IS ACTING IN.
  //
  // `get_my_role()` is `effective_role(auth.uid())`, which resolves through
  // `active_membership_id()` — the same function the 111 RLS policies are keyed
  // on. Asking it is the only way this answer cannot disagree with the one every
  // query in the app is about to be judged by.
  //
  // Re-deriving the role here instead (pickRole, below) is what made
  // `rpc_switch_membership` decorative. The RPC recorded the switch on
  // `sessions.active_membership_id` and the database honoured it — measured:
  // the dual-role account's session rows carry the parent membership — but this
  // function then re-picked `teacher` by precedence, so the client routed a
  // switched-to-parent account to /parent and ProtectedRoute sent it to
  // /unauthorized. G9: two homes for one decision.
  try {
    // No `as any` cast: unlike the two RPCs either side of it, `get_my_role`
    // IS in the generated types (Args: never, Returns: app_role), so the typed
    // call compiles and costs the lint baseline nothing.
    const { data: dbRole } = await supabase.rpc("get_my_role");
    if (dbRole) return dbRole as AppRole;
  } catch {
    /* optional - resolved by the fallbacks below in older environments */
  }

  // FALLBACKS ONLY, for an environment where the RPC above is absent. A switch
  // cannot take effect on this path; nothing that has get_my_role uses it.
  const { data: memberships } = await supabase
    .from("memberships")
    .select("role")
    .eq("account_id", userId)
    .eq("status", "active");

  if (memberships && memberships.length > 0) return pickRole(memberships);

  // Transitional fallback only. Never reached by an account that has a membership.
  const { data: legacy } = await supabase.from("user_roles").select("role").eq("user_id", userId);
  return pickRole(legacy);
}

/**
 * Load profile + role + school for the signed-in user.
 *
 * The role comes from the database (`effective_role`, via get_auth_context or
 * get_my_role) so it agrees with the active membership every RLS policy is
 * keyed on. The local precedence pick survives only as a fallback for an
 * environment where neither RPC answers, and must never wipe a resolved role.
 */
export async function loadAuthContext(userId: string): Promise<AuthContextData | null> {
  // 1) Resolve role first - this is what broke after the refactor
  const role = await resolveRole(userId);

  // 2) Optional enriched context (may be missing until migrations are applied)
  const { data: rpcData, error: rpcError } = await (supabase.rpc as any)("get_auth_context");
  if (!rpcError && Array.isArray(rpcData) && rpcData.length > 0) {
    const row = rpcData[0] as AuthContextRow;
    // `row.role` IS `get_my_role()`: get_auth_context selects
    // `effective_role(_uid)`. The comment this replaces asked for the role to
    // "stay aligned with get_my_role" and then overrode it with the client-side
    // precedence pick — the exact disagreement it warned about. `role` is kept
    // only for an environment where the RPC resolved nothing.
    return mapRow({
      ...row,
      role: row.role ?? role,
    });
  }

  // 3) Profile fallback - use columns that always existed; school fields optional
  const { data: profile } = await supabase
    .from("profiles")
    .select("id, email, full_name, photo_url")
    .eq("id", userId)
    .maybeSingle();

  // Best-effort school fields (ignore errors if columns not migrated yet)
  let schoolId: string | null = null;
  let isActive = true;
  let schoolName = "School";
  let schoolSlug: string | null = null;
  let schoolLogo: string | null = null;

  const enriched = await supabase
    .from("profiles")
    .select("school_id, is_active")
    .eq("id", userId)
    .maybeSingle();

  if (!enriched.error && enriched.data) {
    schoolId = (enriched.data as { school_id?: string | null }).school_id ?? null;
    isActive = (enriched.data as { is_active?: boolean }).is_active !== false;

    if (schoolId) {
      const { data: school } = await supabase
        .from("schools")
        .select("name, slug, logo_url")
        .eq("id", schoolId)
        .maybeSingle();
      if (school) {
        schoolName = school.name;
        schoolSlug = school.slug;
        schoolLogo = school.logo_url;
      }
    }
  }

  return {
    userId,
    profile: {
      id: profile?.id ?? userId,
      email: profile?.email ?? null,
      fullName: profile?.full_name ?? "",
      photoUrl: profile?.photo_url ?? null,
      isActive,
    },
    role,
    school: schoolId
      ? {
          id: schoolId,
          name: schoolName,
          slug: schoolSlug,
          logoUrl: schoolLogo,
        }
      : null,
  };
}

/** Clear client-side caches that may hold tenant/user data */
export function clearClientAuthCaches() {
  clearAppStorage();
}
