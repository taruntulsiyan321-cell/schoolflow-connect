/**
 * A student who did 10 questions yesterday is not asked those 10 again today
 * while unseen questions remain; a repeat comes only once the unseen pool runs
 * short, the longest-ago first.
 */
import { describe, expect, it } from "vitest";
import { drawFreshFirst, drawInMix, lastSeenFromAttempts } from "./practiceDraw";

const pool = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `q${i}` }));
/** A seeded generator, so each run is reproducible and runs differ. */
const seeded = (seed: number) => () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
const seenAt = (ids: string[], day: string) => new Map(ids.map((id) => [id, `2026-09-${day}T10:00:00Z`]));

describe("drawFreshFirst", () => {
  it("never repeats yesterday's questions while unseen ones remain", () => {
    for (let seed = 1; seed <= 200; seed++) {
      const yesterday = drawFreshFirst(pool(100), new Map(), 10, seeded(seed)).map((q) => q.id);
      const today = drawFreshFirst(pool(100), seenAt(yesterday, "24"), 10, seeded(seed + 1000)).map((q) => q.id);
      expect(today.filter((id) => yesterday.includes(id))).toEqual([]);
      expect(new Set(today).size).toBe(10);
    }
  });

  it("CONTROL: a plain random draw, the old behaviour, does repeat yesterday's questions", () => {
    const plain = (seed: number) => drawFreshFirst(pool(100), new Map(), 10, seeded(seed)).map((q) => q.id);
    let repeats = 0;
    for (let seed = 1; seed <= 200; seed++) {
      const yesterday = plain(seed);
      repeats += plain(seed + 1000).filter((id) => yesterday.includes(id)).length;
    }
    expect(repeats).toBeGreaterThan(0);
  });

  it("tops up from the longest-ago answers when the unseen pool is short", () => {
    const old = ["q0", "q1", "q2", "q3", "q4", "q5", "q6", "q7"];
    const recent = ["q8", "q9"];
    const lastSeen = new Map([...seenAt(old, "20"), ...seenAt(recent, "24")]);
    for (let seed = 1; seed <= 50; seed++) {
      const ids = drawFreshFirst(pool(12), lastSeen, 10, seeded(seed)).map((q) => q.id);
      expect(ids).toContain("q10");
      expect(ids).toContain("q11");
      expect(ids.filter((id) => recent.includes(id))).toEqual([]);
      expect(new Set(ids).size).toBe(10);
    }
  });

  it("is still random: two students with the same history get different sessions", () => {
    const a = drawFreshFirst(pool(100), new Map(), 10, seeded(7)).map((q) => q.id);
    const b = drawFreshFirst(pool(100), new Map(), 10, seeded(8)).map((q) => q.id);
    expect(a).not.toEqual(b);
  });

  it("serves the whole pool when the session is larger than it", () => {
    expect(drawFreshFirst(pool(4), seenAt(["q0"], "24"), 10, seeded(3))).toHaveLength(4);
  });
});

describe("drawInMix — the real paper's mix of forms (C7)", () => {
  // 60 direct questions and 6 of each other form, as the bank is shaped: few of them.
  type Q = { id: string; form: string };
  const FORMS = ["statements", "match", "sequence", "case_based"];
  const bank: Q[] = [
    ...Array.from({ length: 60 }, (_, i) => ({ id: `m${i}`, form: "mcq" })),
    ...FORMS.flatMap((f) => Array.from({ length: 6 }, (_, i) => ({ id: `${f}${i}`, form: f }))),
  ];
  // Accountancy's blueprint: 24 direct, 5 statements, 5 match, 6 sequence, 10 case-based, of 50.
  const MIX = { mcq: 24, statements: 5, match: 5, sequence: 6, case_based: 10 };
  const formOf = (q: Q) => q.form;
  const count = (qs: Q[], form: string) => qs.filter((q) => q.form === form).length;

  it("gives each form its share of a 20-question session", () => {
    for (let seed = 1; seed <= 50; seed++) {
      const qs = drawInMix(bank, new Map(), 20, MIX, formOf, seeded(seed));
      expect(qs).toHaveLength(20);
      expect(new Set(qs.map((q) => q.id)).size).toBe(20);
      // 20 × 5/50 = 2, 20 × 6/50 = 2.4 → 2, 20 × 10/50 = 4; the other 10 are direct.
      expect([count(qs, "statements"), count(qs, "match"), count(qs, "sequence"), count(qs, "case_based")]).toEqual([2, 2, 2, 4]);
    }
  });

  it("CONTROL: the plain draw, from the same pool, gives the forms far less often", () => {
    let forms = 0;
    for (let seed = 1; seed <= 50; seed++) {
      const qs = drawFreshFirst(bank, new Map(), 20, seeded(seed));
      forms += qs.filter((q) => q.form !== "mcq").length;
    }
    // 24 of 84 in the pool: about 5.7 a session against the mix's 10.
    expect(forms / 50).toBeLessThan(8);
  });

  it("takes a form's share only from questions never answered, and fills the rest without shrinking", () => {
    // Every match question already answered: none of them is taken for the share.
    const lastSeen = new Map(Array.from({ length: 6 }, (_, i) => [`match${i}`, "2026-10-01T10:00:00Z"] as const));
    for (let seed = 1; seed <= 50; seed++) {
      const qs = drawInMix(bank, lastSeen, 20, MIX, formOf, seeded(seed));
      expect(qs).toHaveLength(20);
      expect(count(qs, "match")).toBe(0);
    }
  });

  it("rounds each share to the nearest question", () => {
    // 30 × 6/50 = 3.6 → 4 sequence; 30 × 5/50 = 3 statements and match; 30 × 10/50 = 6 case-based.
    const qs = drawInMix(bank, new Map(), 30, MIX, formOf, seeded(3));
    expect([count(qs, "statements"), count(qs, "match"), count(qs, "sequence"), count(qs, "case_based")]).toEqual([3, 3, 4, 6]);
  });

  it("fills with other forms only once direct questions run out, never met ones before repeats", () => {
    const fewDirect: Q[] = [...bank.filter((q) => q.form !== "mcq"), { id: "m0", form: "mcq" }, { id: "m1", form: "mcq" }];
    // A form question already answered is a repeat: it comes last.
    const lastSeen = new Map([["case_based0", "2026-10-01T10:00:00Z"]]);
    for (let seed = 1; seed <= 30; seed++) {
      const qs = drawInMix(fewDirect, lastSeen, 20, MIX, formOf, seeded(seed));
      expect(qs).toHaveLength(20);
      expect(count(qs, "mcq")).toBe(2);
      expect(qs.some((q) => q.id === "case_based0")).toBe(false);
    }
  });

  it("reads a question with no form as a direct one", () => {
    type Loose = { id: string; form: string | null };
    const unformed: Loose[] = [
      ...bank.filter((q) => q.form !== "mcq"),
      ...Array.from({ length: 30 }, (_, i) => ({ id: "u" + i, form: null })),
    ];
    const qs = drawInMix(unformed, new Map(), 20, MIX, (q) => q.form, seeded(5));
    expect(qs.filter((q) => q.form === null)).toHaveLength(10);
  });

  it("serves the whole pool when it is smaller than the session, and draws plainly with no mix", () => {
    expect(drawInMix(bank.slice(0, 8), new Map(), 20, MIX, formOf, seeded(1))).toHaveLength(8);
    const plain = drawInMix(bank, new Map(), 10, null, formOf, seeded(7)).map((q) => q.id);
    expect(plain).toEqual(drawFreshFirst(bank, new Map(), 10, seeded(7)).map((q) => q.id));
    expect(drawInMix(bank, new Map(), 10, {}, formOf, seeded(7)).map((q) => q.id)).toEqual(plain);
  });
});

describe("lastSeenFromAttempts", () => {
  it("keeps the latest answer per question and skips non-bank attempts", () => {
    const m = lastSeenFromAttempts([
      { bank_question_id: "q1", created_at: "2026-09-20T00:00:00Z" },
      { bank_question_id: "q1", created_at: "2026-09-24T00:00:00Z" },
      { bank_question_id: null, created_at: "2026-09-25T00:00:00Z" },
    ]);
    expect([...m]).toEqual([["q1", "2026-09-24T00:00:00Z"]]);
  });
});
