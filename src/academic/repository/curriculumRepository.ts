import { getClient, throwIfError, type RepoContext } from "./base";

/**
 * The curriculum tree — board → class → subject → chapter.
 *
 * These four tables carry NO `school_id`. They are global reference data, the
 * same way `question_bank` is (§10.9), and their policies say so: every one is
 * `read: auth.uid() IS NOT NULL`, write super-admin only. So nothing here
 * scopes by tenant, and `RepoContext.schoolId` is unused on purpose.
 *
 * WHY THIS EXISTS. §10.22: "Chapter is picked, never typed." Everything
 * downstream keys on `chapter_id` (§10.10), and
 * `question_bank_active_must_be_keyed` makes that structural — an active
 * question with no `chapter_id` is refused by the database. A screen that lets
 * a teacher type a chapter name cannot produce a `chapter_id`, so it cannot
 * save. This is the list it picks from instead.
 */

export type CurriculumSubjectRow = { id: string; name: string };
export type CurriculumChapterRow = { id: string; name: string; sequence: number | null };

/**
 * Class levels the curriculum actually covers, ascending.
 *
 * Read rather than hardcoded: the bank's own screen offered 6–12 while the
 * seeded tree runs 5–12, so Class 5 was unreachable and every level was a
 * literal in a component.
 */
export async function listCurriculumClassLevels(ctx: RepoContext): Promise<number[]> {
  const { data, error } = await getClient(ctx)
    .from("curriculum_classes")
    .select("level")
    .order("level");
  throwIfError(error, "Failed to load curriculum classes");
  const levels = new Set<number>();
  for (const r of data ?? []) {
    const n = Number((r as { level?: number }).level);
    if (Number.isFinite(n)) levels.add(n);
  }
  return [...levels].sort((a, b) => a - b);
}

/**
 * Subjects taught at one class level, de-duplicated by name.
 *
 * De-duplication is by NAME, not by row: with more than one board seeded, two
 * `curriculum_subjects` rows would both be called "Mathematics" at Class 10.
 * The picker shows one entry per name and carries every matching id, so the
 * chapter list below is the union across boards rather than one board's half.
 * With the single board seeded today this is a no-op that costs nothing.
 */
export async function listCurriculumSubjects(
  ctx: RepoContext,
  classLevel: number,
): Promise<CurriculumSubjectRow[]> {
  const client = getClient(ctx);
  const { data: classes, error: classErr } = await client
    .from("curriculum_classes")
    .select("id")
    .eq("level", classLevel);
  throwIfError(classErr, "Failed to load curriculum classes");
  const classIds = (classes ?? []).map((c) => (c as { id: string }).id);
  if (classIds.length === 0) return [];

  const { data, error } = await client
    .from("curriculum_subjects")
    .select("id, name")
    .in("curriculum_class_id", classIds)
    .order("name");
  throwIfError(error, "Failed to load curriculum subjects");
  return (data ?? []).map((r) => r as CurriculumSubjectRow);
}

/**
 * Chapters under one or more curriculum subjects, in teaching order.
 *
 * Takes a LIST because a subject name can resolve to several rows (see above).
 * `sequence` is nullable, so a chapter without one sorts last by name rather
 * than vanishing — PostgREST's `nullsFirst: false` is explicit for that reason.
 */
export async function listCurriculumChapters(
  ctx: RepoContext,
  curriculumSubjectIds: string[],
): Promise<CurriculumChapterRow[]> {
  if (curriculumSubjectIds.length === 0) return [];
  const { data, error } = await getClient(ctx)
    .from("chapters")
    .select("id, name, sequence")
    .in("curriculum_subject_id", curriculumSubjectIds)
    .order("sequence", { nullsFirst: false })
    .order("name");
  throwIfError(error, "Failed to load chapters");
  return (data ?? []).map((r) => r as CurriculumChapterRow);
}
