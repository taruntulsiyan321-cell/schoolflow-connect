import { describe, expect, it, vi, beforeEach } from "vitest";

/**
 * The two homework summaries added for the principal's class list and the
 * teacher's profile (2026-09-15), held to what they claim:
 *
 *  - a class's completion is measured over homework that has CLOSED, so a
 *    class is not behind on work its students still have time to hand in, and
 *    a class with nothing closed has no rate rather than 0%;
 *  - what waits on a teacher is counted across EVERYTHING they released, read
 *    page by page to the end, not across the first page.
 */
const repo = {
  listPublishedHomeworkDeadlines: vi.fn(),
  listCompletion: vi.fn(),
  countHomeworkByStatus: vi.fn(),
  listHomeworkCreatedBy: vi.fn(),
};

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
vi.mock("../live", () => ({ broadcastAcademicWrite: vi.fn() }));
vi.mock("../repository/homeworkRepository", () => ({
  listPublishedHomeworkDeadlines: (...a: unknown[]) => repo.listPublishedHomeworkDeadlines(...a),
  listCompletion: (...a: unknown[]) => repo.listCompletion(...a),
  countHomeworkByStatus: (...a: unknown[]) => repo.countHomeworkByStatus(...a),
  listHomeworkCreatedBy: (...a: unknown[]) => repo.listHomeworkCreatedBy(...a),
}));

import { HomeworkService } from "./homeworkService";

const SCHOOL = "00000000-0000-4000-8000-000000000001";
const principal = { schoolId: SCHOOL, userId: "principal-1", role: "principal" as const };
const teacher = { schoolId: SCHOOL, userId: "teacher-1", role: "teacher" as const };
const NOW = Date.parse("2026-09-15T12:00:00.000Z");

const completion = (homeworkId: string, classId: string, students: number, given: number, awaitingReview: number) => ({
  homeworkId,
  classId,
  students,
  given,
  awaitingReview,
  accepted: 0,
  rejected: 0,
  notGiven: students - given,
  completionPct: 0,
});

describe("each class's homework completion", () => {
  beforeEach(() => {
    repo.listPublishedHomeworkDeadlines.mockReset();
    repo.listCompletion.mockReset();
  });

  it("measures completion over closed homework only, counts open homework apart, and review across both", async () => {
    repo.listPublishedHomeworkDeadlines.mockResolvedValue([
      { id: "closed-1", classId: "10a", closesAt: "2026-09-14T11:30:00.000Z" },
      // At the deadline is closed.
      { id: "closed-2", classId: "10a", closesAt: "2026-09-15T12:00:00.000Z" },
      { id: "open-10a", classId: "10a", closesAt: "2026-09-16T11:30:00.000Z" },
      { id: "open-9b", classId: "9b", closesAt: "2026-09-16T11:30:00.000Z" },
    ]);
    repo.listCompletion.mockResolvedValue([
      completion("closed-1", "10a", 40, 30, 5),
      completion("closed-2", "10a", 40, 10, 0),
      completion("open-10a", "10a", 40, 2, 2),
      completion("open-9b", "9b", 30, 25, 25),
    ]);

    const byClass = await HomeworkService.completionByClass(principal, NOW);

    expect(byClass.get("10a")).toEqual({
      classId: "10a",
      closedHomework: 2,
      openHomework: 1,
      given: 40,
      expected: 80,
      completionPct: 50,
      awaitingReview: 7,
    });
    expect(byClass.get("9b")).toMatchObject({ closedHomework: 0, openHomework: 1, completionPct: null, awaitingReview: 25 });
    // The whole school's completion in one read, not one per class.
    expect(repo.listCompletion).toHaveBeenCalledTimes(1);
  });

  it("gives no rate for closed homework nobody was set, rather than 0%", async () => {
    repo.listPublishedHomeworkDeadlines.mockResolvedValue([{ id: "empty", classId: "12c", closesAt: "2026-09-01T00:00:00.000Z" }]);
    repo.listCompletion.mockResolvedValue([]);
    const byClass = await HomeworkService.completionByClass(principal, NOW);
    expect(byClass.get("12c")).toMatchObject({ closedHomework: 1, expected: 0, completionPct: null });
  });

  it("is the principal's and admin's to read, not a teacher's", async () => {
    await expect(HomeworkService.completionByClass(teacher, NOW)).rejects.toThrow(/admin\/principal-only/);
    expect(repo.listPublishedHomeworkDeadlines).not.toHaveBeenCalled();
  });
});

describe("the homework a teacher has set", () => {
  beforeEach(() => {
    repo.listHomeworkCreatedBy.mockReset();
    repo.countHomeworkByStatus.mockReset();
    repo.listCompletion.mockReset();
  });

  it("counts what waits on them across every homework they released, past the first page", async () => {
    const released = (from: number, n: number) =>
      Array.from({ length: n }, (_, i) => ({ id: `hw-${from + i}`, status: "published" }));
    repo.listHomeworkCreatedBy.mockImplementation(
      async (_ctx: unknown, _userId: string, page: { limit: number; offset?: number }, status?: string) => {
        if (status === "published") return (page.offset ?? 0) === 0 ? released(0, 200) : released(200, 3);
        return [
          { id: "hw-0", status: "published" },
          { id: "draft-1", status: "draft" },
        ];
      },
    );
    repo.countHomeworkByStatus.mockResolvedValue({ draft: 1, scheduled: 2, published: 203, archived: 4 });
    // One hand-in waiting on each released homework — two on the last one,
    // which only a read past the first page of 200 can see.
    repo.listCompletion.mockImplementation(async (_ctx: unknown, ids: string[]) =>
      ids.map((id) => completion(id, "10a", 3, 1, id === "hw-202" ? 2 : 1)),
    );

    const summary = await HomeworkService.summaryForTeacher(teacher, { limit: 5 });

    expect(repo.countHomeworkByStatus).toHaveBeenCalledWith(expect.anything(), { createdBy: "teacher-1" });
    expect(summary).toMatchObject({ total: 210, published: 203, scheduled: 2, drafts: 1, archived: 4 });
    expect(summary.awaitingReview).toBe(204);
    // The recent few, with completion only where it exists: released work.
    expect(summary.recent.map((h) => [h.id, h.completion?.given ?? null])).toEqual([
      ["hw-0", 1],
      ["draft-1", null],
    ]);
    expect(repo.listHomeworkCreatedBy).toHaveBeenCalledWith(expect.anything(), "teacher-1", { limit: 5 });
  });

  it("refuses without a signed-in user", async () => {
    await expect(HomeworkService.summaryForTeacher({ ...teacher, userId: "" })).rejects.toThrow(/No signed-in user/);
  });
});
