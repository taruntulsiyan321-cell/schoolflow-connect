import { assertCanConsume, assertCanOwn, toRepoContext, type ServiceContext } from "./context";
import {
  addChapterTopic,
  listChapterTopics,
  listCurriculumChapters,
  listCurriculumClassLevels,
  listCurriculumSubjects,
  type CurriculumChapterRow,
  type CurriculumTopicRow,
} from "../repository/curriculumRepository";
import { normalizeSubjectName, parseClassLevel } from "@/lib/curriculumScope";

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
export type CurriculumTopic = CurriculumTopicRow;

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

  /**
   * §10.22: the chapter list "filtered to the teacher's class and subject".
   * The level is read from the class's own name (`parseClassLevel`, the one
   * home for that parse) and the subject matched by canonical name. A class
   * name with no level in it, or a subject the curriculum does not carry,
   * gives an empty list — which is when a free-text label is allowed.
   */
  async listChaptersForClass(
    ctx: ServiceContext,
    classLabel: string,
    subject: string,
  ): Promise<CurriculumChapter[]> {
    assertCanConsume(ctx, "homework");
    const level = parseClassLevel(classLabel);
    if (level == null) return [];
    const repo = toRepoContext(ctx);
    const wanted = normalizeSubjectName(subject).toLowerCase();
    const ids = (await listCurriculumSubjects(repo, level))
      .filter((s) => normalizeSubjectName(String(s.name ?? "")).toLowerCase() === wanted)
      .map((s) => s.id);
    return listCurriculumChapters(repo, ids);
  },

  /** The topics teachers have named inside a chapter. */
  async listTopics(ctx: ServiceContext, chapterId: string): Promise<CurriculumTopic[]> {
    assertCanConsume(ctx, "homework");
    return listChapterTopics(toRepoContext(ctx), chapterId);
  },

  /** Add a topic to a chapter (or reuse the one already named so). */
  async addTopic(ctx: ServiceContext, chapterId: string, name: string): Promise<CurriculumTopic> {
    assertCanOwn(ctx, "homework");
    return addChapterTopic(toRepoContext(ctx), chapterId, name);
  },
};
