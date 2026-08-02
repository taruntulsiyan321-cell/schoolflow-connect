/**
 * Require a valid Supabase user JWT on edge function requests.
 * Prevents anonymous credit burn / unauthenticated AI invoke.
 */
import { createClient, type SupabaseClient, type User } from "https://esm.sh/@supabase/supabase-js@2.45.0";

export type AuthedRequest = {
  user: User;
  userClient: SupabaseClient;
  authHeader: string;
};

export async function requireUserJwt(req: Request): Promise<
  | { ok: true; value: AuthedRequest }
  | { ok: false; response: Response }
> {
  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader.startsWith("Bearer ")) {
    return {
      ok: false,
      response: new Response(
        JSON.stringify({ error: "Not authenticated", error_code: "unauthenticated" }),
        {
          status: 401,
          headers: {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Headers":
              "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
          },
        },
      ),
    };
  }

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
  const userClient = createClient(SUPABASE_URL, ANON, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data, error } = await userClient.auth.getUser();
  if (error || !data?.user) {
    return {
      ok: false,
      response: new Response(
        JSON.stringify({ error: "Not authenticated", error_code: "unauthenticated" }),
        {
          status: 401,
          headers: {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Headers":
              "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
          },
        },
      ),
    };
  }

  return { ok: true, value: { user: data.user, userClient, authHeader } };
}
