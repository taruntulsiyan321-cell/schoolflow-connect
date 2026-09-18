/**
 * The explanation cache lives in ai-explain, not in the browser.
 *
 * Measured 2026-09-18: ai_explanations held 0 rows platform-wide. The panel
 * inserted without created_by, its RLS policy refused every write (42501), and
 * `.then(() => {}, () => {})` swallowed the refusal — so every "Explain my
 * mistake" paid for a model call, for every student, for the same question.
 * And cache_key is a global primary key read per school, so even a fixed client
 * insert could never have served a second school.
 *
 * After the move, driven live: the model answered in 6.0s, a classmate asking
 * the same thing was answered from the cache in 1.2s with the same text, and a
 * student writing the table directly is still refused.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { stripComments } from "@/test/stripComments";

const ROOT = join(__dirname, "..", "..", "..");
const panel = stripComments(readFileSync(join(__dirname, "ExplainPanel.tsx"), "utf8"));
const fn = stripComments(readFileSync(join(ROOT, "supabase", "functions", "ai-explain", "index.ts"), "utf8"));

describe("the explanation cache", () => {
  it("is not read or written from the browser", () => {
    expect(panel, "a client write is refused by RLS and a client read can only see its own school")
      .not.toContain('from("ai_explanations")');
    expect(panel).not.toContain("hashKey(");
    // The panel still asks the function.
    expect(panel).toContain('invokeEdgeFunction<Explanation & { source?: string }>("ai-explain"');
  });

  it("is read by the function before it calls the model", () => {
    const read = fn.indexOf('.from("ai_explanations")');
    const model = fn.indexOf("generateStructured<");
    expect(read, "the function must look the key up").toBeGreaterThan(-1);
    expect(model).toBeGreaterThan(read);
    expect(fn).toContain('source: "cache"');
  });

  it("is written by the function, idempotently, with no student in the row", () => {
    const write = fn.indexOf(".upsert(");
    expect(write, "the function must store what the model returned").toBeGreaterThan(fn.indexOf("generateStructured<"));
    const call = fn.slice(write, fn.indexOf(");", write));
    expect(call).toContain('onConflict: "cache_key"');
    expect(call).toContain("ignoreDuplicates: true");
    // A cache of a global bank question holds nothing about who asked first.
    expect(call).not.toContain("created_by");
    expect(call).not.toContain("student_id");
  });

  it("keys on the question AND the answer given, so one mistake is not explained as another", () => {
    expect(fn).toMatch(/cacheKeyFor\(\[question, correct_index, selected_index, correct_text, selected_text\]\)/);
  });
});
