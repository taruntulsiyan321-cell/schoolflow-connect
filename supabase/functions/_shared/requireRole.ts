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

  // ASK AS THE CALLER, NOT AS THE SERVICE ROLE.
  //
  // `has_role(user, role)` asks "is this caller ACTING in this role right now",
  // and answers from `active_membership_id()`, which is derived from
  // `auth.uid()`. Asked through the service client above, `auth.uid()` is NULL,
  // the predicate falls to its cross-account branch, that branch resolves the
  // institution with `get_my_school_id()` -- also NULL without a session -- and
  // the answer was false for every role and every caller. That is the whole of
  // KNOWN_ISSUES 1: a genuine teacher's JWT got 403 insufficient_role.
  //
  // WHY NOT THE THREE-ARGUMENT FORM HERE. Naming the school is the right fix
  // where the caller knows which institution it means. This gate does not: it
  // is shared by every function and every role list, and the only server-side
  // source of a school for an arbitrary caller is `profiles.school_id`, which
  // is NULL for 44 of 62 accounts -- including one holding an active parent
  // membership. Sourcing it there would refuse most students outright.
  //
  // The membership a caller is acting in lives in their SESSION and nowhere
  // else, so the session is what has to be asked. `requireUserJwt` already
  // returns a client bound to the caller's JWT for exactly this purpose, and
  // `authenticated` holds EXECUTE on both overloads.
  const matched: string[] = [];
  for (const role of roles) {
    const { data, error } = await auth.value.userClient.rpc("has_role", {
      _user_id: auth.value.user.id,
      _role: role,
    });
    // A predicate that could not be EVALUATED is not a denial. The previous
    // version discarded this error, so an outage was indistinguishable from a
    // caller who genuinely lacked the role.
    if (error) {
      return {
        ok: false,
        response: new Response(
          JSON.stringify({
            error: `Could not check the ${role} role: ${error.message}`,
            error_code: "role_check_failed",
          }),
          { status: 500, headers: corsJsonHeaders },
        ),
      };
    }
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

  // Disabled accounts must not invoke privileged edges. Read with the service
  // client deliberately: a disabled account may not be able to read its own
  // profile row, and "I could not tell" must not become "not disabled".
  const { data: profile, error: profileErr } = await admin
    .from("profiles")
    .select("is_active, school_id")
    .eq("id", auth.value.user.id)
    .maybeSingle();
  if (profileErr) {
    return {
      ok: false,
      response: new Response(
        JSON.stringify({
          error: `Could not read the caller's profile: ${profileErr.message}`,
          error_code: "profile_lookup_failed",
        }),
        { status: 500, headers: corsJsonHeaders },
      ),
    };
  }
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
