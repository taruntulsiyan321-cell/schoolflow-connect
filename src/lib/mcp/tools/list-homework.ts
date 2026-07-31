import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { supabaseForUser, textResult, errorResult } from "../supabase";

export default defineTool({
  name: "list_homework",
  title: "List homework",
  description:
    "List homework assignments visible to the signed-in user, newest first, optionally filtered by class or subject.",
  inputSchema: {
    class_id: z.string().describe("Optional class id from list_classes.").nullable(),
    subject: z.string().trim().describe("Optional subject filter.").nullable(),
    limit: z.number().int().describe("Maximum rows to return, default 25.").nullable(),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ class_id, subject, limit }, ctx) => {
    if (!ctx.isAuthenticated()) return errorResult("Not authenticated");
    const supabase = supabaseForUser(ctx);
    let query = supabase
      .from("homework")
      .select("id, title, description, subject, class_id, due_date, due_time, priority, status, created_at")
      .order("due_date", { ascending: false, nullsFirst: false })
      .limit(Math.min(Math.max(limit ?? 25, 1), 100));
    if (class_id) query = query.eq("class_id", class_id);
    if (subject) query = query.ilike("subject", `%${subject}%`);
    const { data, error } = await query;
    if (error) return errorResult(error.message);
    return textResult({ homework: data ?? [] });
  },
});
