import { supabase } from "@/integrations/supabase/client";

/**
 * Resolve every student id linked to a parent account.
 *
 * A parent-child link is recorded through EITHER of two mechanisms that
 * coexist in this schema: the legacy direct `students.parent_user_id`
 * column, or the `parents` → `parent_students` join table. The admin's
 * actual parent-linking screen (gurukul-admin/Parents.tsx) only ever writes
 * the join-table form — it never sets `parent_user_id` — so any caller that
 * checks `parent_user_id` alone silently sees zero children for every
 * parent linked through that real admin flow. Always resolve through both;
 * do not reintroduce a `parent_user_id`-only lookup (this file exists
 * because five separate call sites already had, independently).
 */
export async function resolveParentLinkedStudentIds(
  schoolId: string,
  parentUserId: string,
): Promise<string[]> {
  const ids = new Set<string>();

  const { data: direct } = await supabase
    .from("students")
    .select("id")
    .eq("school_id", schoolId)
    .eq("parent_user_id", parentUserId);
  for (const row of direct ?? []) ids.add(row.id as string);

  const { data: parentRow } = await supabase
    .from("parents")
    .select("id")
    .eq("school_id", schoolId)
    .eq("user_id", parentUserId)
    .maybeSingle();
  if (parentRow?.id) {
    const { data: links } = await supabase
      .from("parent_students")
      .select("student_id")
      .eq("school_id", schoolId)
      .eq("parent_id", parentRow.id);
    for (const row of links ?? []) {
      if (row.student_id) ids.add(row.student_id as string);
    }
  }

  return [...ids];
}
