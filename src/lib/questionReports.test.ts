import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * A student's report on a question (20261139000000): the reasons, statuses and
 * note limit the screen offers are the database's own, a report sends only
 * what the student said, and the plan's refusal is a notice, not an error.
 */

const db = vi.hoisted(() => ({
  ops: [] as { op: string; args: unknown[] }[],
  rpc: [] as { fn: string; args: Record<string, unknown> }[],
  reply: { data: null as unknown, error: null as Record<string, unknown> | null },
}));

vi.mock("@/integrations/supabase/client", () => {
  const from = (table: string) => {
    const b: Record<string, unknown> = {};
    for (const op of ["select", "eq", "in", "order"]) {
      b[op] = (...args: unknown[]) => {
        db.ops.push({ op: `${table}.${op}`, args });
        return b;
      };
    }
    b.then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve(db.reply).then(res, rej);
    return b;
  };
  const rpc = (fn: string, args: Record<string, unknown>) => {
    db.rpc.push({ fn, args });
    return Promise.resolve(db.reply);
  };
  return { supabase: { from, rpc } };
});

import { PlanLimitError } from "@/lib/premium";
import {
  REPORT_NOTE_MAX_CHARS, REPORT_REASONS, REPORT_STATUS, clampReportNote, listMyReports, loadMyReports,
  reasonsFor, reportQuestion,
} from "./questionReports";

const MIGRATION = readFileSync("supabase/migrations/20261139000000_a_student_reports_a_question.sql", "utf8");
const checkList = (name: string) => {
  const m = MIGRATION.match(new RegExp(`CONSTRAINT ${name}\\s+CHECK \\(\\w+ IN \\(([\\s\\S]*?)\\)\\)`));
  if (!m) throw new Error(`no ${name} in the migration`);
  return [...m[1].matchAll(/'([a-z_]+)'/g)].map((x) => x[1]).sort();
};

const row = {
  id: "r1", question_id: "q1", reason: "wrong_answer", claimed_index: 2, note: "It is C", question_text: "Q?",
  options: ["a", "b", "c", "d"], subject: "Accountancy", chapter: "Partnership", status: "open", outcome: null,
  outcome_explanation: null, replacement_question_id: null, created_at: "2026-10-03T10:00:00Z", resolved_at: null,
};

beforeEach(() => {
  db.ops = [];
  db.rpc = [];
  db.reply = { data: null, error: null };
});

describe("the screen offers what the database accepts", () => {
  it("the same reasons and statuses as question_reports' CHECKs", () => {
    expect(REPORT_REASONS.map((r) => r.key).sort()).toEqual(checkList("question_reports_reason_check"));
    expect(Object.keys(REPORT_STATUS).sort()).toEqual(checkList("question_reports_status_check"));
  });

  it(`a note of at most ${REPORT_NOTE_MAX_CHARS} characters, counted as Postgres counts them`, () => {
    expect(MIGRATION).toContain(`CHECK (note IS NULL OR char_length(note) BETWEEN 1 AND ${REPORT_NOTE_MAX_CHARS})`);
    const emoji = "😀".repeat(REPORT_NOTE_MAX_CHARS + 5);
    expect(Array.from(clampReportNote(emoji))).toHaveLength(REPORT_NOTE_MAX_CHARS);
  });

  it("before the answer is shown, there is no answer or explanation to report", () => {
    expect(reasonsFor(false).map((r) => r.key)).toEqual(["question_error", "other"]);
    expect(reasonsFor(true).map((r) => r.key)).toEqual(["wrong_answer", "question_error", "explanation_error", "other"]);
  });
});

describe("filing a report", () => {
  it("sends the claimed option only with a wrong answer, and leaves out what was not said", async () => {
    db.reply = { data: { created: true, report: row }, error: null };
    const r = await reportQuestion({ questionId: "q1", reason: "wrong_answer", claimedIndex: 2, note: "  It is C ", sessionId: "s1" });
    expect(db.rpc[0]).toEqual({ fn: "rpc_report_question", args: { _question_id: "q1", _reason: "wrong_answer", _claimed_index: 2, _note: "It is C", _session_id: "s1" } });
    expect(r).toMatchObject({ created: true, report: { id: "r1", claimedIndex: 2, status: "open", options: ["a", "b", "c", "d"] } });

    await reportQuestion({ questionId: "q1", reason: "question_error", claimedIndex: 2, note: "   ", sessionId: null });
    expect(db.rpc[1].args).toEqual({ _question_id: "q1", _reason: "question_error" });
  });

  it("a plan refusal is a PlanLimitError the dialog shows as a notice", async () => {
    db.reply = { data: null, error: { message: "plan_limit:question.report", details: JSON.stringify({ ok: false, feature: "question.report", reason: "limit_reached", limit: 10, period: "day" }) } };
    await expect(reportQuestion({ questionId: "q1", reason: "other", claimedIndex: null, note: "x", sessionId: null }))
      .rejects.toBeInstanceOf(PlanLimitError);
  });

  it("any other refusal is the database's own sentence", async () => {
    db.reply = { data: null, error: { message: "This question has been withdrawn." } };
    await expect(reportQuestion({ questionId: "q1", reason: "other", claimedIndex: null, note: "x", sessionId: null }))
      .rejects.toThrow("This question has been withdrawn.");
  });
});

describe("reading reports", () => {
  it("reads only the student's own, even where the fence would show more", async () => {
    db.reply = { data: [row], error: null };
    const m = await loadMyReports("u1", ["q1", "q1", ""]);
    expect(m.get("q1")?.note).toBe("It is C");
    expect(db.ops).toContainEqual({ op: "question_reports.eq", args: ["user_id", "u1"] });
    expect(db.ops).toContainEqual({ op: "question_reports.in", args: ["question_id", ["q1"]] });
    await listMyReports("u1");
    expect(db.ops.filter((o) => o.op === "question_reports.eq")).toHaveLength(2);
  });

  it("asks nothing for no questions", async () => {
    expect((await loadMyReports("u1", [])).size).toBe(0);
    expect(db.ops).toHaveLength(0);
  });
});
