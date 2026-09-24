// Send FCM push notification using HTTP v1 API
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { fcmAccessToken, sendFcm, type FcmServiceAccount } from "../_shared/fcm.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// The OAuth exchange and the send itself live in _shared/fcm.ts, which
// notification-push uses too.
async function sendToTokens(sa: FcmServiceAccount, tokens: string[], title: string, body: string): Promise<number> {
  if (tokens.length === 0) return 0;
  const accessToken = await fcmAccessToken(sa);
  let sent = 0;
  for (const token of tokens) {
    if ((await sendFcm(sa, accessToken, { token, title, body })).status === "sent") sent++;
  }
  return sent;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const auth = req.headers.get("Authorization");
    if (!auth) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: corsHeaders });
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: userData } = await supabase.auth.getUser(auth.replace("Bearer ", ""));
    if (!userData.user) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: corsHeaders });

    const { data: callerProfile } = await supabase
      .from("profiles")
      .select("school_id, is_active")
      .eq("id", userData.user.id)
      .maybeSingle();
    if (!callerProfile?.school_id) {
      return new Response(JSON.stringify({ error: "No school context" }), { status: 403, headers: corsHeaders });
    }
    if (callerProfile.is_active === false) {
      return new Response(JSON.stringify({ error: "Account disabled" }), { status: 403, headers: corsHeaders });
    }
    const schoolId = callerProfile.school_id as string;

    const payload = await req.json();
    const { title, body, audience = "all", class_id, user_id } = payload;
    if (!title || !body) return new Response(JSON.stringify({ error: "title & body required" }), { status: 400, headers: corsHeaders });

    const saJson = Deno.env.get("FCM_SERVICE_ACCOUNT_JSON");
    if (!saJson) throw new Error("FCM_SERVICE_ACCOUNT_JSON secret not configured");
    const sa = JSON.parse(saJson) as FcmServiceAccount;

    // Peer DM push: any authenticated school member may notify one same-school user
    if (audience === "user") {
      if (!user_id || user_id === userData.user.id) {
        return new Response(JSON.stringify({ error: "user_id required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      const { data: target } = await supabase
        .from("profiles")
        .select("id, school_id, is_active")
        .eq("id", user_id)
        .maybeSingle();
      if (!target || target.school_id !== schoolId || target.is_active === false) {
        return new Response(JSON.stringify({ error: "Target outside school" }), { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      // Prefer recent DM evidence; allow same-school notify as MVP fallback
      const { data: recent } = await supabase
        .from("messages")
        .select("id")
        .eq("sender_id", userData.user.id)
        .eq("receiver_id", user_id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (!recent) {
        return new Response(JSON.stringify({ error: "No message to notify" }), { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      const { data: tokens } = await supabase.from("device_tokens").select("token").eq("user_id", user_id);
      const sent = await sendToTokens(sa, (tokens ?? []).map((t) => t.token), title, body);
      return new Response(JSON.stringify({ success: true, sent }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Roles come from memberships at THIS institution, not from the global
    // user_roles table (Chunk 1.5). An admin elsewhere is not an admin here.
    const { data: roleRow } = await supabase
      .from("memberships")
      .select("role")
      .eq("account_id", userData.user.id)
      .eq("school_id", schoolId)
      .eq("role", "admin")
      .eq("status", "active")
      .maybeSingle();
    if (!roleRow) return new Response(JSON.stringify({ error: "Admin only" }), { status: 403, headers: corsHeaders });

    // Resolve target user_ids by audience — always scoped to caller's school
    let userIds: string[] = [];
    if (audience === "all") {
      const { data } = await supabase.from("profiles").select("id").eq("school_id", schoolId).eq("is_active", true);
      userIds = (data ?? []).map((r) => r.id);
    } else if (["teacher", "student", "parent", "admin"].includes(audience)) {
      // Membership already carries the institution, so the audience is scoped
      // by construction — no second lookup through profiles.school_id.
      const { data: roleRows } = await supabase
        .from("memberships")
        .select("account_id")
        .eq("school_id", schoolId)
        .eq("role", audience)
        .eq("status", "active");
      const roleIds = (roleRows ?? []).map((r) => r.account_id).filter(Boolean);
      if (roleIds.length > 0) {
        const { data: schoolUsers } = await supabase
          .from("profiles")
          .select("id")
          .eq("is_active", true)
          .in("id", roleIds);
        userIds = (schoolUsers ?? []).map((r) => r.id);
      }
    } else if (audience === "class" && class_id) {
      const { data: cls } = await supabase
        .from("classes")
        .select("id, school_id")
        .eq("id", class_id)
        .maybeSingle();
      if (!cls || cls.school_id !== schoolId) {
        return new Response(JSON.stringify({ error: "Class is outside your school" }), { status: 403, headers: corsHeaders });
      }
      const { data: studs } = await supabase
        .from("students")
        .select("user_id, parent_user_id")
        .eq("class_id", class_id)
        .eq("school_id", schoolId);
      userIds = (studs ?? []).flatMap((s) => [s.user_id, s.parent_user_id].filter(Boolean));
    }
    if (userIds.length === 0) return new Response(JSON.stringify({ success: true, sent: 0 }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const { data: tokens } = await supabase.from("device_tokens").select("token").in("user_id", userIds);
    const sent = await sendToTokens(sa, (tokens ?? []).map((t) => t.token), title, body);
    return new Response(JSON.stringify({ success: true, sent }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    console.error(e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
