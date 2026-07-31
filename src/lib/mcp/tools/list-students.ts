import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { supabaseForUser, textResult, errorResult } from "../supabase";

export default defineTool({
  name: "list_students",
  title: "List students",
  description:
    "List students the signed-in user may see, optionally filtered by class id or a name/admission-number search.",
  inputSchema: {
    class_id: z.string().describe("Optional class id from list_classes.").nullable(),
    search: z.string().trim().describe("Optional name, roll number or admission number filter.").nullable(),
    limit: z.number().int().describe("Maximum rows to return, default 50.").nullable(),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ class_id, search, limit }, ctx) => {
    if (!ctx.isAuthenticated()) return errorResult("Not authenticated");
    const supabase = supabaseForUser(ctx);
    let query = supabase
      .from("students")
      .select("id, full_name, admission_number, roll_number, class_id, parent_name")
      .order("roll_number", { nullsFirst: false })
      .limit(Math.min(Math.max(limit ?? 50, 1), 200));
    if (class_id) query = query.eq("class_id", class_id);
    if (search) {
      query = query.or(
        `full_name.ilike.%${search}%,admission_number.ilike.%${search}%,roll_number.ilike.%${search}%`,
      );
    }
    const { data, error } = await query;
    if (error) return errorResult(error.message);
    return textResult({ students: data ?? [], count: data?.length ?? 0 });
  },
});
