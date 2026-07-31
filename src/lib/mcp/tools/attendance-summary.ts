import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { supabaseForUser, textResult, errorResult } from "../supabase";

export default defineTool({
  name: "attendance_summary",
  title: "Attendance summary",
  description:
    "Summarise attendance (present/absent/late counts and percentage) for a class or a single student over a date range.",
  inputSchema: {
    class_id: z.string().describe("Class id to summarise.").nullable(),
    student_id: z.string().describe("Student id to summarise.").nullable(),
    from_date: z.string().describe("Start date, YYYY-MM-DD. Defaults to 30 days ago.").nullable(),
    to_date: z.string().describe("End date, YYYY-MM-DD. Defaults to today.").nullable(),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ class_id, student_id, from_date, to_date }, ctx) => {
    if (!ctx.isAuthenticated()) return errorResult("Not authenticated");
    if (!class_id && !student_id) return errorResult("Provide class_id or student_id");

    const to = to_date ?? new Date().toISOString().slice(0, 10);
    const from =
      from_date ?? new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10);

    const supabase = supabaseForUser(ctx);
    let query = supabase
      .from("attendance")
      .select("student_id, date, status")
      .gte("date", from)
      .lte("date", to)
      .limit(5000);
    if (class_id) query = query.eq("class_id", class_id);
    if (student_id) query = query.eq("student_id", student_id);

    const { data, error } = await query;
    if (error) return errorResult(error.message);

    const rows = data ?? [];
    const counts: Record<string, number> = {};
    for (const row of rows) counts[row.status] = (counts[row.status] ?? 0) + 1;
    const present = (counts.present ?? 0) + (counts.late ?? 0);
    const pct = rows.length ? Math.round((present / rows.length) * 1000) / 10 : null;

    return textResult({
      from,
      to,
      class_id: class_id ?? null,
      student_id: student_id ?? null,
      total_records: rows.length,
      by_status: counts,
      attendance_pct: pct,
    });
  },
});
