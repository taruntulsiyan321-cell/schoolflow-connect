/**
 * Require JWT user to hold at least one of the given roles (via has_role RPC).
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { requireUserJwt, type AuthedRequest } from "./requireAuth.ts";

const corsJsonHeaders = {
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

export async function requireAnyRole(
  req: Request,
  roles: string[],
): Promise<
  | { ok: true; value: AuthedRequest & { roles: string[] } }
  | { ok: false; response: Response }
> {
  const auth = await requireUserJwt(req);
  if (!auth.ok) return auth;

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const matched: string[] = [];
  for (const role of roles) {
    const { data } = await admin.rpc("has_role", {
      _user_id: auth.value.user.id,
      _role: role,
    });
    if (data) matched.push(role);
  }

  if (matched.length === 0) {
    return {
      ok: false,
      response: new Response(
        JSON.stringify({ error: "Forbidden", error_code: "insufficient_role" }),
        { status: 403, headers: corsJsonHeaders },
      ),
    };
  }

  // Disabled accounts must not invoke privileged edges
  const { data: profile } = await admin
    .from("profiles")
    .select("is_active, school_id")
    .eq("id", auth.value.user.id)
    .maybeSingle();
  if (profile && profile.is_active === false) {
    return {
      ok: false,
      response: new Response(
        JSON.stringify({ error: "Account disabled", error_code: "account_disabled" }),
        { status: 403, headers: corsJsonHeaders },
      ),
    };
  }

  return {
    ok: true,
    value: { ...auth.value, roles: matched },
  };
}

export async function getCallerSchoolId(userId: string): Promise<string | null> {
  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
  const { data } = await admin
    .from("profiles")
    .select("school_id")
    .eq("id", userId)
    .maybeSingle();
  return data?.school_id ?? null;
}
