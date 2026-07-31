import { defineTool } from "@lovable.dev/mcp-js";
import { supabaseForUser, textResult, errorResult } from "../supabase";

export default defineTool({
  name: "whoami",
  title: "Who am I",
  description:
    "Return the signed-in SchoolFlow user's profile, app role and school. Call this first to know what the caller can access.",
  inputSchema: {},
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async (_input, ctx) => {
    if (!ctx.isAuthenticated()) return errorResult("Not authenticated");
    const supabase = supabaseForUser(ctx);
    const userId = ctx.getUserId();

    const [{ data: profile }, { data: roles }] = await Promise.all([
      supabase.from("profiles").select("id, full_name, email, phone, school_id").eq("id", userId).maybeSingle(),
      supabase.from("user_roles").select("role").eq("user_id", userId),
    ]);

    return textResult({
      user_id: userId,
      email: ctx.getUserEmail() ?? profile?.email ?? null,
      full_name: profile?.full_name ?? null,
      school_id: profile?.school_id ?? null,
      roles: (roles ?? []).map((r) => r.role),
    });
  },
});
