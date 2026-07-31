import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { supabaseForUser, textResult, errorResult } from "../supabase";

export default defineTool({
  name: "list_notices",
  title: "List notices",
  description:
    "List school notices and announcements visible to the signed-in user, newest first.",
  inputSchema: {
    class_id: z.string().describe("Optional class id to filter class-specific notices.").nullable(),
    limit: z.number().int().describe("Maximum rows to return, default 20.").nullable(),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ class_id, limit }, ctx) => {
    if (!ctx.isAuthenticated()) return errorResult("Not authenticated");
    const supabase = supabaseForUser(ctx);
    let query = supabase
      .from("notices")
      .select("id, title, body, audience, class_id, priority, status, created_at, expires_at")
      .is("revoked_at", null)
      .order("created_at", { ascending: false })
      .limit(Math.min(Math.max(limit ?? 20, 1), 100));
    if (class_id) query = query.eq("class_id", class_id);
    const { data, error } = await query;
    if (error) return errorResult(error.message);
    return textResult({ notices: data ?? [] });
  },
});
