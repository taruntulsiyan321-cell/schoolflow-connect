import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * A student's marks on questions (20261137000000): the limits the screen
 * enforces are the database's, the question a row is about is found the same
 * way from every screen, and an empty mark is deleted rather than stored.
 */

const db = vi.hoisted(() => ({
  ops: [] as { table: string; op: string; args: unknown[] }[],
  reply: { data: null as unknown, error: null as { message: string } | null },
  storage: [] as { bucket: string; op: string; args: unknown[] }[],
}));

vi.mock("@/integrations/supabase/client", () => {
  const from = (table: string) => {
    const b: Record<string, unknown> = {};
    for (const op of ["select", "eq", "in", "not", "order", "delete", "upsert", "single"]) {
      b[op] = (...args: unknown[]) => {
        db.ops.push({ table, op, args });
        return b;
      };
    }
    b.then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve(db.reply).then(res, rej);
    return b;
  };
  const storage = {
    from: (bucket: string) => ({
      upload: (...args: unknown[]) => { db.storage.push({ bucket, op: "upload", args }); return Promise.resolve({ error: null }); },
      remove: (...args: unknown[]) => { db.storage.push({ bucket, op: "remove", args }); return Promise.resolve({ error: null }); },
    }),
  };
  return { supabase: { from, storage } };
});

import {
  NOTE_MAX_CHARS, VOICE_MAX_SECONDS, VOICE_NOTE_BUCKET, baseAudioType, clampNote, countChars, groupMarkTags,
  isEmptyDraft, markRefFromAttempt, markRefFromMistake, saveMark, uploadVoiceNote, type MarkTag,
} from "./questionMarks";

beforeEach(() => {
  db.ops = [];
  db.storage = [];
  db.reply = { data: null, error: null };
});

describe("the limits are the database's", () => {
  const migration = readFileSync(
    join(process.cwd(), "supabase/migrations/20261137000000_a_student_marks_why_a_question_went_wrong.sql"),
    "utf8",
  );
  const only = (re: RegExp) => {
    const found = [...migration.matchAll(re)].map((m) => Number(m[1]));
    expect(found, String(re)).toHaveLength(1);
    return found[0];
  };

  it("a note is as long as question_marks lets it be", () => {
    expect(only(/char_length\(note\) BETWEEN 1 AND (\d+)/g)).toBe(NOTE_MAX_CHARS);
  });

  it("a voice note is as long as question_marks lets it be", () => {
    expect(only(/voice_seconds BETWEEN 1 AND (\d+)/g)).toBe(VOICE_MAX_SECONDS);
  });

  it("the bucket the app writes to is the one the migration fences", () => {
    expect(migration).toContain(`bucket_id = '${VOICE_NOTE_BUCKET}' AND (storage.foldername(name))[1] = auth.uid()::text`);
  });
});

describe("a note is counted as Postgres counts it", () => {
  it("an emoji is one character, not two", () => {
    expect(countChars("😀😀")).toBe(2);
    expect("😀😀".length).toBe(4);
  });

  it("typing past the limit keeps the first NOTE_MAX_CHARS characters, whole", () => {
    const long = "😀".repeat(NOTE_MAX_CHARS + 3);
    const kept = clampNote(long);
    expect(countChars(kept)).toBe(NOTE_MAX_CHARS);
    expect(kept.endsWith("😀")).toBe(true);
    // Control: a note inside the limit is untouched.
    expect(clampNote("short")).toBe("short");
  });
});

describe("the question a row is about", () => {
  it("from this device's log: the ids on generated_question", () => {
    expect(markRefFromAttempt({ generated_question: { bank_question_id: "b1" } })).toEqual({ kind: "bank", id: "b1" });
    expect(markRefFromAttempt({ generated_question: { upload_question_id: "u1", bank_question_id: null } })).toEqual({ kind: "upload", id: "u1" });
    expect(markRefFromAttempt({ generated_question: { capture_question_id: "c1" } })).toEqual({ kind: "capture", id: "c1" });
  });

  // Rows as the screen holds them, with the question text the ids sit beside.
  // question_attempts.generated_question carries the brought-question keys,
  // null for a bank question (measured 2026-10-02); the bank id is a column.
  const dbRow = { bank_question_id: "b2", generated_question: { question: "?", upload_question_id: null, capture_question_id: null } };
  // A saved snapshot froze the text and nothing else; a row that names no
  // question in any of the three places is the same case.
  const snapshotRow = { generated_question: { question: "?", bank_question_id: null, upload_question_id: null, capture_question_id: null } };

  it("from a question_attempts row: the bank_question_id column", () => {
    expect(markRefFromAttempt(dbRow)).toEqual({ kind: "bank", id: "b2" });
  });

  it("from a saved snapshot, which froze no ids: nothing to mark", () => {
    expect(markRefFromAttempt(snapshotRow)).toBeNull();
  });

  it("from a Mistake Book row; a school test's question_id is not a bank question", () => {
    const m = { source: "practice", questionId: "b3", uploadQuestionId: null, captureQuestionId: null };
    expect(markRefFromMistake(m)).toEqual({ kind: "bank", id: "b3" });
    expect(markRefFromMistake({ ...m, source: "upload", questionId: null, uploadQuestionId: "u3" })).toEqual({ kind: "upload", id: "u3" });
    expect(markRefFromMistake({ ...m, source: "screen_capture", questionId: null, captureQuestionId: "c3" })).toEqual({ kind: "capture", id: "c3" });
    expect(markRefFromMistake({ ...m, source: "test" })).toBeNull();
  });
});

describe("the tags offered", () => {
  const tags: MarkTag[] = [
    { key: "recall", label: "Recall", group: "Memory", position: 3, active: true },
    { key: "conceptual_gap", label: "Conceptual gap", group: "Understanding", position: 1, active: true },
    { key: "formula_error", label: "Formula error", group: "Memory", position: 4, active: false },
    { key: "guessed", label: "Guessed", group: "Exam conditions", position: 9, active: true },
  ];

  it("come in groups, a group where its first tag is, and a retired tag is not offered", () => {
    expect(groupMarkTags(tags).map((g) => [g.label, g.tags.map((t) => t.key)])).toEqual([
      ["Understanding", ["conceptual_gap"]],
      ["Memory", ["recall"]],
      ["Exam conditions", ["guessed"]],
    ]);
  });

  it("…unless the mark already carries it, so it can be taken off", () => {
    const memory = groupMarkTags(tags, ["formula_error"]).find((g) => g.label === "Memory");
    expect(memory?.tags.map((t) => t.key)).toEqual(["recall", "formula_error"]);
  });
});

describe("saving a mark", () => {
  const ref = { kind: "bank" as const, id: "q1" };
  const question = { text: "What is GDP?", subject: "economics", chapter: "National Income" };

  it("an empty mark is deleted, never stored", async () => {
    const draft = { tags: [], note: "   ", voice: null };
    expect(isEmptyDraft(draft)).toBe(true);
    const out = await saveMark("u1", ref, question, draft);
    expect(out).toBeNull();
    expect(db.ops.map((o) => o.op)).toEqual(["delete", "eq", "eq"]);
    expect(db.ops.filter((o) => o.op === "eq").map((o) => o.args)).toEqual([["user_id", "u1"], ["question_ref", "q1"]]);
  });

  it("anything in it is one upsert on the student's mark for that question", async () => {
    db.reply = {
      data: {
        bank_question_id: "q1", upload_question_id: null, capture_question_id: null, question_ref: "q1",
        question_text: "What is GDP?", subject: "economics", chapter: "National Income",
        tags: ["conceptual_gap", "silly_mistake"], note: "Mixed up GDP and GNP", voice_path: "u1/a.webm", voice_seconds: 12,
        updated_at: "2026-10-02T10:00:00Z",
      },
      error: null,
    };
    const out = await saveMark("u1", ref, question, {
      tags: ["silly_mistake", "conceptual_gap"],
      note: "  Mixed up GDP and GNP  ",
      voice: { path: "u1/a.webm", seconds: 12 },
    });
    const upsert = db.ops.find((o) => o.op === "upsert");
    expect(upsert?.table).toBe("question_marks");
    expect(upsert?.args[0]).toEqual({
      bank_question_id: "q1", upload_question_id: null, capture_question_id: null,
      question_text: "What is GDP?", subject: "economics", chapter: "National Income",
      tags: ["silly_mistake", "conceptual_gap"], note: "Mixed up GDP and GNP",
      voice_path: "u1/a.webm", voice_seconds: 12,
    });
    expect(upsert?.args[1]).toEqual({ onConflict: "user_id,question_ref" });
    expect(db.ops.some((o) => o.op === "delete")).toBe(false);
    // What comes back is what the database stored: its tag order, not ours.
    expect(out).toMatchObject({ ref, tags: ["conceptual_gap", "silly_mistake"], voiceSeconds: 12 });
  });

  it("an uploaded question is saved under its own column, and a blank note as none", async () => {
    db.reply = {
      data: {
        bank_question_id: null, upload_question_id: "uq", capture_question_id: null, question_ref: "uq",
        question_text: "x", subject: null, chapter: null, tags: ["recall"], note: null, voice_path: null, voice_seconds: null,
        updated_at: "2026-10-02T10:00:00Z",
      },
      error: null,
    };
    await saveMark("u1", { kind: "upload", id: "uq" }, { text: "x", subject: null, chapter: null }, { tags: ["recall"], note: " ", voice: null });
    expect(db.ops.find((o) => o.op === "upsert")?.args[0]).toMatchObject({
      bank_question_id: null, upload_question_id: "uq", capture_question_id: null, note: null, voice_path: null, voice_seconds: null,
    });
  });

  it("a refusal from the database is the student's error, not a silent success", async () => {
    db.reply = { data: null, error: { message: "new row violates check constraint" } };
    await expect(saveMark("u1", ref, question, { tags: ["recall"], note: "", voice: null })).rejects.toThrow("check constraint");
  });
});

describe("a voice note", () => {
  it("goes into the student's own folder, typed without its codec", async () => {
    const path = await uploadVoiceNote("u1", new Blob(["x"], { type: "audio/webm;codecs=opus" }));
    expect(path).toMatch(/^u1\/[0-9a-f-]{36}\.webm$/);
    expect(db.storage[0]).toMatchObject({ bucket: VOICE_NOTE_BUCKET, op: "upload" });
    expect(db.storage[0].args[2]).toEqual({ contentType: "audio/webm", upsert: false });
  });

  it("a format the bucket would refuse is refused here, before uploading", async () => {
    await expect(uploadVoiceNote("u1", new Blob(["x"], { type: "audio/wav" }))).rejects.toThrow();
    expect(db.storage).toHaveLength(0);
    expect(baseAudioType("audio/mp4; codecs=mp4a.40.2")).toBe("audio/mp4");
  });
});

describe("mistake types, lately against before", () => {
  const NOW = new Date("2026-10-03T12:00:00Z");
  const daysAgo = (d: number) => new Date(NOW.getTime() - d * 86_400_000).toISOString();
  const TAG_LIST = [
    { key: "calc", label: "Calculation error", group: "Working it out", position: 1, active: true },
    { key: "recall", label: "Recall", group: "Memory", position: 2, active: true },
  ];
  const m = (id: string, tags: string[], createdAt: string) => ({
    ref: { kind: "bank" as const, id }, questionText: id, subject: null, chapter: null, tags,
    note: null, voicePath: null, voiceSeconds: null, createdAt, updatedAt: createdAt,
  });

  it("counts each type in the last 14 days and the 14 before — equal windows — the type grown most first", async () => {
    const { tagTrend, risingTag } = await import("./questionMarks");
    const trend = tagTrend([
      m("1", ["calc"], daysAgo(1)), m("2", ["calc"], daysAgo(3)), m("3", ["calc", "recall"], daysAgo(13.9)),
      m("4", ["calc"], daysAgo(20)),
      m("5", ["recall"], daysAgo(15)), m("6", ["recall"], daysAgo(27.9)),
      m("7", ["calc", "recall"], daysAgo(40)), // before both windows: not counted
    ], TAG_LIST, NOW, 14);
    expect(trend).toEqual([
      { key: "calc", label: "Calculation error", recent: 3, before: 1 },
      { key: "recall", label: "Recall", recent: 1, before: 2 },
    ]);
    expect(risingTag(trend)?.key).toBe("calc");
    // CONTROL: nothing grown, nothing named.
    expect(risingTag(tagTrend([m("5", ["recall"], daysAgo(15))], TAG_LIST, NOW, 14))).toBeNull();
  });
});
