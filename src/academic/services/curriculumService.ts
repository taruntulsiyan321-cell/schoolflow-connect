import { assertCanConsume, toRepoContext, type ServiceContext } from "./context";
import {
  listCurriculumChapters,
  listCurriculumClassLevels,
  listCurriculumSubjects,
  type CurriculumChapterRow,
} from "../repository/curriculumRepository";

/**
 * The picker behind §10.22 — "Chapter is picked, never typed."
 *
 * One subject NAME can map to several `curriculum_subjects` rows once a second
 * board is seeded, so a subject is carried as `{ name, ids }` and the chapter
 * query takes the whole id list. That is why `listSubjects` returns names with
 * ids attached rather than the raw rows.
 */

export type CurriculumSubject = { name: string; ids: string[] };
export type CurriculumChapter = CurriculumChapterRow;

export const CurriculumService = {
  /** Class levels the seeded curriculum covers, ascending. */
  async listClassLevels(ctx: ServiceContext): Promise<number[]> {
    assertCanConsume(ctx, "question");
    return listCurriculumClassLevels(toRepoContext(ctx));
  },

  /** Subjects at one class level, one entry per distinct name. */
  async listSubjects(ctx: ServiceContext, classLevel: number): Promise<CurriculumSubject[]> {
    assertCanConsume(ctx, "question");
    const rows = await listCurriculumSubjects(toRepoContext(ctx), classLevel);
    const byName = new Map<string, string[]>();
    for (const r of rows) {
      const name = String(r.name ?? "").trim();
      if (!name) continue;
      const ids = byName.get(name) ?? [];
      ids.push(r.id);
      byName.set(name, ids);
    }
    return [...byName.entries()]
      .map(([name, ids]) => ({ name, ids }))
      .sort((a, b) => a.name.localeCompare(b.name));
  },

  /** Chapters under a subject, in teaching order. */
  async listChapters(ctx: ServiceContext, subjectIds: string[]): Promise<CurriculumChapter[]> {
    assertCanConsume(ctx, "question");
    return listCurriculumChapters(toRepoContext(ctx), subjectIds);
  },
};
