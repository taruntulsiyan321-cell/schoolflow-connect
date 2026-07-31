import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { supabaseForUser, textResult, errorResult } from "../supabase";

export default defineTool({
  name: "list_classes",
  title: "List classes",
  description:
    "List the classes visible to the signed-in user (name, section, academic year). Use the returned class id with the other tools.",
  inputSchema: {
    search: z.string().trim().describe("Optional filter on class name or section.").nullable(),
    limit: z.number().int().describe("Maximum rows to return, default 50.").nullable(),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ search, limit }, ctx) => {
    if (!ctx.isAuthenticated()) return errorResult("Not authenticated");
    const supabase = supabaseForUser(ctx);
    let query = supabase
      .from("classes")
      .select("id, name, section, display_name, academic_year, category")
      .order("name")
      .limit(Math.min(Math.max(limit ?? 50, 1), 200));
    if (search) query = query.or(`name.ilike.%${search}%,section.ilike.%${search}%`);
    const { data, error } = await query;
    if (error) return errorResult(error.message);
    return textResult({ classes: data ?? [] });
  },
});
