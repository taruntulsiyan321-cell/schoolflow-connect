/**
 * A student's identity and curriculum scope are loaded once and shared, not
 * re-read by every component that mounts.
 *
 * Measured 2026-09-22 as the Class 12 student, pressing Start Practice:
 *
 *     GET  /auth/v1/user                       395 ms
 *     POST rpc_get_my_student_identity         401 ms   (13,385 calls in all)
 *     GET  /schools                            307 ms
 *     ...and only then the first question page
 *
 * — an identity and a scope the page had resolved a moment earlier. The
 * student waited over a second for nothing on every session.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const auth = { session: { user: { id: "student-1" } } as { user: { id: string } } | null };
const calls = { identityRpc: 0, schools: 0 };
let identityRow: Record<string, unknown> | null = {
  user_id: "student-1", role: "student", has_student_role: true, student_id: "s-1",
  school_id: "school-1", class_id: "class-1", class_name: "12", class_section: "A",
  class_display_name: "12-A", class_category: "commerce",
};

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: {
      getSession: async () => ({ data: { session: auth.session }, error: null }),
      getUser: async () => { throw new Error("identity must not wait on a round trip to the auth server"); },
    },
    rpc: async (name: string) => {
      if (name === "rpc_get_my_student_identity") {
        calls.identityRpc += 1;
        await new Promise((r) => setTimeout(r, 5));
        return { data: identityRow ? [identityRow] : [], error: null };
      }
      return { data: null, error: null };
    },
    from: () => {
      const chain: Record<string, unknown> = {};
      for (const m of ["select", "eq"]) chain[m] = () => chain;
      chain.maybeSingle = async () => ({ data: null, error: null });
      return chain;
    },
  },
}));

vi.mock("../repository/base", () => ({
  getClient: () => ({
    from: (table: string) => {
      if (table === "schools") calls.schools += 1;
      const chain: Record<string, unknown> = {};
      for (const m of ["select", "eq"]) chain[m] = () => chain;
      chain.maybeSingle = async () => (table === "schools"
        ? { data: { board: "rbse", stream: "commerce" }, error: null }
        : { data: null, error: null });
      return chain;
    },
  }),
  throwIfError: (error: unknown, message: string) => { if (error) throw new Error(message); },
}));
vi.mock("../live", () => ({ broadcastAcademicWrite: () => {} }));
vi.mock("../repository/eventsRepository", () => ({ emitEvent: async () => "e", emitEventBestEffort: async () => null }));
vi.mock("@/lib/studentXpNotify", () => ({ notifyStudentXpUpdated: () => {} }));

const { loadStudentAcademicIdentity } = await import("./resolveStudentContext");
const { PracticeService } = await import("./practiceService");

beforeEach(() => {
  calls.identityRpc = 0;
  calls.schools = 0;
});

describe("the student's identity is loaded once and shared", () => {
  it("serves concurrent and repeated callers from one load", async () => {
    auth.session = { user: { id: "student-share" } };
    identityRow = { ...identityRow!, user_id: "student-share" };
    const [a, b] = await Promise.all([loadStudentAcademicIdentity(), loadStudentAcademicIdentity()]);
    const c = await loadStudentAcademicIdentity("student-share");
    expect(a?.studentId).toBe("s-1");
    expect(b).toEqual(a);
    expect(c).toEqual(a);
    expect(calls.identityRpc, "each mount re-read the identity").toBe(1);
  });

  it("re-reads an account that is not a linked student yet", async () => {
    // A portal link made a moment ago must not hide behind a cached "no student".
    auth.session = { user: { id: "unlinked" } };
    identityRow = null;
    await loadStudentAcademicIdentity();
    await loadStudentAcademicIdentity();
    expect(calls.identityRpc).toBe(2);
    identityRow = { user_id: "student-1", student_id: "s-1", school_id: "school-1", class_id: "class-1" };
  });

  it("never serves one user's identity to another", async () => {
    auth.session = { user: { id: "student-x" } };
    identityRow = { ...identityRow!, user_id: "student-x", student_id: "s-x" };
    const x = await loadStudentAcademicIdentity();
    auth.session = { user: { id: "student-y" } };
    identityRow = { ...identityRow!, user_id: "student-y", student_id: "s-y" };
    const y = await loadStudentAcademicIdentity();
    expect(x?.studentId).toBe("s-x");
    expect(y?.studentId).toBe("s-y");
  });
});

describe("the curriculum scope is resolved once per student and class", () => {
  const ctx = {
    schoolId: "school-1", userId: "student-1", studentId: "s-1", classId: "class-1",
    classLabel: "12-A", classCategory: "commerce", role: "student" as const,
  };

  it("asks for the school once, however many loads need the scope", async () => {
    const [a, b] = await Promise.all([PracticeService.resolveCurriculumScope(ctx), PracticeService.resolveCurriculumScope(ctx)]);
    const c = await PracticeService.resolveCurriculumScope(ctx);
    expect(a).toEqual({
      classLevel: 12, board: "rbse", stream: "commerce", classLabel: "12-A",
      examId: null, examCode: null, examName: null, syllabusChapterIds: null,
    });
    expect(b).toEqual(a);
    expect(c).toEqual(a);
    expect(calls.schools, "each question load re-read the school").toBe(1);
  });

  it("POSITIVE CONTROL: a different class is resolved on its own", async () => {
    await PracticeService.resolveCurriculumScope(ctx);
    await PracticeService.resolveCurriculumScope({ ...ctx, classId: "class-2", classLabel: "11-B" });
    expect(calls.schools).toBe(1);
  });
});
