import { supabase } from "@/integrations/supabase/client";
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

const ROLE_PRIORITY: AppRole[] = [
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
 * Same role resolution as the pre-refactor AuthProvider:
 * link portal -> read user_roles -> ensure_default_role if empty -> pick by priority.
 */
async function resolveRole(userId: string): Promise<AppRole | null> {
  try {
    await supabase.rpc("link_portal_on_auth", { _uid: userId });
  } catch {
    /* optional - portal linking may not exist in all envs */
  }

  let { data } = await supabase.from("user_roles").select("role").eq("user_id", userId);

  if (!data || data.length === 0) {
    try {
      await supabase.rpc("ensure_default_role");
    } catch {
      /* optional */
    }
    const again = await supabase.from("user_roles").select("role").eq("user_id", userId);
    data = again.data ?? [];
  }

  return pickRole(data);
}

/**
 * Load profile + role + school for the signed-in user.
 *
 * Role resolution always uses the proven user_roles path (same as before the
 * auth refactor). Optional get_auth_context / school columns enrich the
 * payload but must never wipe a successfully resolved role.
 */
export async function loadAuthContext(userId: string): Promise<AuthContextData | null> {
  // 1) Resolve role first - this is what broke after the refactor
  const role = await resolveRole(userId);

  // 2) Optional enriched context (may be missing until migrations are applied)
  const { data: rpcData, error: rpcError } = await (supabase.rpc as any)("get_auth_context");
  if (!rpcError && Array.isArray(rpcData) && rpcData.length > 0) {
    const row = rpcData[0] as AuthContextRow;
    // Prefer user_roles pickRole (priority) over RPC's arbitrary multi-role row.
    // RPC may still enrich profile/school; role must stay aligned with get_my_role.
    return mapRow({
      ...row,
      role: role ?? row.role,
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
  try {
    const keys = Object.keys(localStorage);
    for (const key of keys) {
      if (key.startsWith("gurukul:") || key.startsWith("sf-cache:")) {
        localStorage.removeItem(key);
      }
    }
  } catch {
    /* ignore */
  }
}
