/**
 * The real paper's mix of forms, as practice reads it (rpc_exam_form_mix, C7):
 * only real counts, nothing to follow for a school account or a mixed
 * session, and a failed read drawn without the mix rather than failing the
 * session — as a failed read of what the student has answered already is.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const rpc = vi.fn();

vi.mock("../repository/base", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../repository/base")>();
  return { ...actual, getClient: () => ({ rpc: (...a: unknown[]) => rpc(...a) }) };
});

const { PracticeService } = await import("./practiceService");
const CTX = { schoolId: "s", userId: "u", role: "student", studentId: "st" } as never;

beforeEach(() => {
  rpc.mockReset();
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

describe("the exam's form mix for practice (C7)", () => {
  it("reads the subject's counts", async () => {
    rpc.mockResolvedValue({ data: { mcq: 24, statements: 5, case_based: 10 }, error: null });
    expect(await PracticeService.formMix(CTX, "Accountancy")).toEqual({ mcq: 24, statements: 5, case_based: 10 });
    expect(rpc).toHaveBeenCalledWith("rpc_exam_form_mix", { _subject: "Accountancy" });
  });

  it("keeps only real counts", async () => {
    rpc.mockResolvedValue({ data: { mcq: 24, match: "5", sequence: 0, case_based: -1 }, error: null });
    expect(await PracticeService.formMix(CTX, "Accountancy")).toEqual({ mcq: 24 });
  });

  it("has nothing to follow for a school account, which gets {}", async () => {
    rpc.mockResolvedValue({ data: {}, error: null });
    expect(await PracticeService.formMix(CTX, "Mathematics")).toBeNull();
  });

  it("does not ask for a session with no one subject", async () => {
    expect(await PracticeService.formMix(CTX, "Mixed")).toBeNull();
    expect(await PracticeService.formMix(CTX, "")).toBeNull();
    expect(rpc).not.toHaveBeenCalled();
  });

  it("draws without the mix when it cannot be read, and says so in the console", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "network" } });
    expect(await PracticeService.formMix(CTX, "Accountancy")).toBeNull();
    expect(console.warn).toHaveBeenCalled();
  });
});
