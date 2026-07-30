import { supabase } from "@/integrations/supabase/client";
import type { AuthContextData, AppRole } from "./types";
import { DEFAULT_SCHOOL_ID } from "./constants";

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
 * Load profile + role + school for the signed-in user.
 * Prefers the `get_auth_context` RPC; falls back to direct queries
 * if the migration has not been applied yet.
 */
export async function loadAuthContext(userId: string): Promise<AuthContextData | null> {
  const { data: rpcData, error: rpcError } = await supabase.rpc("get_auth_context");

  if (!rpcError && Array.isArray(rpcData) && rpcData.length > 0) {
    return mapRow(rpcData[0] as AuthContextRow);
  }

  try {
    await supabase.rpc("link_portal_on_auth", { _uid: userId });
  } catch {
    /* optional */
  }

  const [{ data: profile }, { data: roles }] = await Promise.all([
    supabase
      .from("profiles")
      .select("id, email, full_name, photo_url, school_id, is_active")
      .eq("id", userId)
      .maybeSingle(),
    supabase.from("user_roles").select("role").eq("user_id", userId),
  ]);

  if (!profile) {
    return {
      userId,
      profile: {
        id: userId,
        email: null,
        fullName: "",
        photoUrl: null,
        isActive: true,
      },
      role: null,
      school: {
        id: DEFAULT_SCHOOL_ID,
        name: "Wisdom Campus",
        slug: "wisdom-campus",
        logoUrl: null,
      },
    };
  }

  const priority: AppRole[] = [
    "super_admin",
    "admin",
    "principal",
    "teacher",
    "student",
    "parent",
  ];
  const owned = (roles ?? []).map((r) => r.role as AppRole);
  const role = priority.find((p) => owned.includes(p)) ?? null;

  const schoolId = profile.school_id ?? DEFAULT_SCHOOL_ID;
  const isActive = profile.is_active !== false;

  let schoolName = "Wisdom Campus";
  let schoolSlug: string | null = "wisdom-campus";
  let schoolLogo: string | null = null;

  if (profile.school_id) {
    const { data: school } = await supabase
      .from("schools")
      .select("name, slug, logo_url")
      .eq("id", profile.school_id)
      .maybeSingle();
    if (school) {
      schoolName = school.name;
      schoolSlug = school.slug;
      schoolLogo = school.logo_url;
    }
  }

  return {
    userId,
    profile: {
      id: profile.id,
      email: profile.email,
      fullName: profile.full_name ?? "",
      photoUrl: profile.photo_url,
      isActive,
    },
    role,
    school: {
      id: schoolId,
      name: schoolName,
      slug: schoolSlug,
      logoUrl: schoolLogo,
    },
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
