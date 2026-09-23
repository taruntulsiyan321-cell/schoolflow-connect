/**
 * Source locks for Practice swarm must-fixes (2026-09-23).
 *
 * Each assertion failed against the code as audited: all-correct Save threw,
 * by-ids skipped the class fence, cancel-after-start left orphans, Incorrect
 * never cleared the Mistake Book, and Skipped never left the pool after a
 * later answer.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { stripComments } from "@/test/stripComments";

const SERVICE = stripComments(readFileSync(join(__dirname, "practiceService.ts"), "utf8"));
const PRACTICE = stripComments(
  readFileSync(join(__dirname, "../../gurukul/pages/Practice.tsx"), "utf8"),
);
const AICOACH = stripComments(
  readFileSync(join(__dirname, "../../gurukul/pages/AICoach.tsx"), "utf8"),
);

describe("practice swarm fixes", () => {
  it("saveSession allows an all-correct session (empty durable attempts)", () => {
    const start = SERVICE.indexOf("async saveSession");
    expect(start).toBeGreaterThan(-1);
    const body = SERVICE.slice(start, SERVICE.indexOf("async resolveSchoolBoard", start));
    expect(body).toMatch(/correct_count/);
    expect(body).toMatch(/wrong_count/);
    expect(body).toMatch(/skipped_count/);
    expect(body, "must not refuse solely because §10.8 durable list is empty").not.toMatch(
      /if \(attempts\.length === 0\) throw/,
    );
  });

  it("listBankQuestions applies the class fence even for by-ids loads", () => {
    const start = SERVICE.indexOf("async listBankQuestions");
    const body = SERVICE.slice(start, start + 2500);
    expect(body).toContain("const byIds = opts.ids && opts.ids.length > 0");
    expect(body, "byIds must not exempt a null classLevel").not.toMatch(
      /if \(!byIds && \(classLevel == null/,
    );
    expect(body).toMatch(/if \(classLevel == null \|\| !Number\.isFinite\(classLevel\)\)/);
  });

  it("cancel-after-start discards the unstarted session row", () => {
    expect(SERVICE).toContain("async discardUnstartedSession");
    expect(PRACTICE).toContain("discardUnstartedSession");
  });

  it("incorrect finish clears open mistakes for correctly answered bank questions", () => {
    expect(SERVICE).toContain("clearMistakesAfterIncorrectSession");
    expect(SERVICE).toMatch(/practice_mode !== "incorrect"/);
    expect(SERVICE).toContain('source === "mistake_book"');
  });

  it("skipped pool keeps only questions whose latest attempt is still a skip", () => {
    const start = SERVICE.indexOf("async listQuestionIdsByStatus");
    const body = SERVICE.slice(start, SERVICE.indexOf("async listMistakeQuestions", start));
    expect(body).toMatch(/latestIsSkip|latest is skip/i);
    expect(body).toContain(".order(\"created_at\", { ascending: false })");
  });

  it("Ask Nova handoff mirrors the new conversation into convosRef before the first reply", () => {
    expect(AICOACH).toContain("convosRef.current = [newConvo, ...convosRef.current]");
  });
});

describe("practice result page keeps §10.8 on the supabase fallback", () => {
  it("filters the raw question_attempts read the same way listSessionAttempts does", () => {
    const RESULT = stripComments(
      readFileSync(join(__dirname, "../../pages/student/PracticeSessionResult.tsx"), "utf8"),
    );
    expect(RESULT).toContain('from("question_attempts")');
    expect(RESULT).toContain(
      '.or("is_correct.is.false,is_correct.is.null,skipped.is.true")',
    );
  });
});
