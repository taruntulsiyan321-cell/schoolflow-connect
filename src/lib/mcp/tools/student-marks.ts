import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { supabaseForUser, textResult, errorResult } from "../supabase";

export default defineTool({
  name: "student_marks",
  title: "Student exam marks",
  description:
    "Return a student's recorded exam marks with exam name, subject, max marks and score percentage.",
  inputSchema: {
    student_id: z.string().describe("Student id from list_students."),
    limit: z.number().int().describe("Maximum rows to return, default 30.").nullable(),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ student_id, limit }, ctx) => {
    if (!ctx.isAuthenticated()) return errorResult("Not authenticated");
    const supabase = supabaseForUser(ctx);
    const { data, error } = await supabase
      .from("marks")
      .select("id, marks_obtained, remarks, created_at, exams(id, name, subject, exam_type, max_marks, exam_date)")
      .eq("student_id", student_id)
      .order("created_at", { ascending: false })
      .limit(Math.min(Math.max(limit ?? 30, 1), 200));
    if (error) return errorResult(error.message);

    const marks = (data ?? []).map((row) => {
      const exam = row.exams as unknown as
        | { name?: string; subject?: string; exam_type?: string; max_marks?: number; exam_date?: string }
        | null;
      const max = exam?.max_marks ?? null;
      return {
        exam: exam?.name ?? null,
        subject: exam?.subject ?? null,
        exam_type: exam?.exam_type ?? null,
        exam_date: exam?.exam_date ?? null,
        marks_obtained: row.marks_obtained,
        max_marks: max,
        percentage: max ? Math.round((Number(row.marks_obtained) / max) * 1000) / 10 : null,
        remarks: row.remarks,
      };
    });

    return textResult({ student_id, marks });
  },
});
