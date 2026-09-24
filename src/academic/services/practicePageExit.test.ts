/**
 * A practice session the student leaves by closing the tab, or by pressing
 * Back out of the app, still finishes — with the answer they had just given.
 *
 * Measured 2026-09-22: answer twice, press Back out of the app, and the session
 * was left open holding ONE answer, with no finish sent. The finish was an
 * ordinary request, cancelled with the page, and so was the live write of the
 * second answer. Nothing closed it until the settle on a later visit.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { stripComments } from "@/test/stripComments";

vi.mock("./context", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./context")>();
  return { ...actual, assertCanOwn: () => {}, assertCanConsume: () => {} };
});
vi.mock("../repository/base", () => ({ getClient: () => ({}), throwIfError: () => {} }));
vi.mock("../live", () => ({ broadcastAcademicWrite: () => {} }));
vi.mock("../repository/eventsRepository", () => ({ emitEvent: async () => "e", emitEventBestEffort: async () => null }));
vi.mock("@/lib/studentXpNotify", () => ({ notifyStudentXpUpdated: () => {} }));

const { PracticeService } = await import("./practiceService");
const { attemptsToFinishPayload } = await import("@/lib/practiceSessionSnapshot");

const attempt = (i: number, explanation = "") => ({
  question: `Question ${i}`, options: ["a", "b", "c", "d"], correctIndex: 1, selectedIndex: 1,
  isCorrect: true, bankQuestionId: `q-${i}`, explanation,
});

afterEach(() => vi.unstubAllGlobals());

describe("a page that is going away still finishes its session", () => {
  it("sends the finish as a request that outlives the page, with the unconfirmed answers", () => {
    const fetchSpy = vi.fn(() => Promise.resolve(new Response("{}")));
    vi.stubGlobal("fetch", fetchSpy);
    PracticeService.finishOnPageExit({
      sessionId: "session-1",
      attempts: attemptsToFinishPayload([attempt(2)]),
      accessToken: "token-1",
    });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toMatch(/\/rest\/v1\/rpc\/rpc_finish_practice_session$/);
    expect(init.keepalive, "an ordinary request is cancelled with the page").toBe(true);
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer token-1");
    const body = JSON.parse(String(init.body));
    expect(body).toMatchObject({ _session_id: "session-1", _ended_by_user: true, _ended_normally: false });
    expect(body._attempts.map((a: { bank_question_id: string }) => a.bank_question_id)).toEqual(["q-2"]);
  });

  it("stays inside the browser's keepalive limit by letting the server count what it has", () => {
    const fetchSpy = vi.fn(() => Promise.resolve(new Response("{}")));
    vi.stubGlobal("fetch", fetchSpy);
    const long = "x".repeat(4000);
    PracticeService.finishOnPageExit({
      sessionId: "session-2",
      attempts: attemptsToFinishPayload(Array.from({ length: 20 }, (_, i) => attempt(i, long))),
      accessToken: "token-2",
    });
    const [, init] = fetchSpy.mock.calls[0] as unknown as [string, RequestInit];
    expect(String(init.body).length).toBeLessThan(64 * 1024);
    // rpc_finish_practice_session counts the session from question_attempts,
    // so a finish without the list still closes it with what was recorded.
    expect(JSON.parse(String(init.body))._attempts).toBeNull();
  });
});

describe("the runner sends it on pagehide, and only what the server has not confirmed", () => {
  const SOURCE = stripComments(readFileSync(join(__dirname, "../../gurukul/pages/Practice.tsx"), "utf8"));

  it("wires pagehide to the page-exit finish, and unmount to the ordinary one", () => {
    expect(SOURCE).toContain('window.addEventListener("pagehide", exit)');
    expect(SOURCE).toContain("PracticeService.finishOnPageExit(");
    expect(SOURCE, "a pagehide that ran the ordinary finish was cancelled with the page")
      .not.toContain('window.addEventListener("pagehide", leave)');
  });

  it("resends only the answers whose live write was never confirmed", () => {
    expect(SOURCE).toContain("attemptLog.current.filter((a) => !confirmedRef.current.has(a))");
    // Confirmed means the server answered with its verdict; a failed write stays unconfirmed.
    expect(SOURCE).toMatch(/if \(!v\) return;\s*confirmedRef\.current\.add\(snap\);/);
    expect(SOURCE).toContain("async function persistAttemptLive(snap: PracticeAttemptSnapshot): Promise<AttemptVerdict | null>");
  });
});
