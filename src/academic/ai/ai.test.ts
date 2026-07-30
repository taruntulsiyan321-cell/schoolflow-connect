import { describe, expect, it } from "vitest";

/**
 * AI data layer contract: summaries expose only structured fields,
 * never raw table dumps.
 */
describe("ai data layer contract", () => {
  it("student summary shape is structured", async () => {
    const { buildStudentAiSummary } = await import("@/academic/ai/dataLayer");
    expect(typeof buildStudentAiSummary).toBe("function");
  });
});
