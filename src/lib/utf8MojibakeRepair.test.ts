import { describe, expect, it } from "vitest";
import {
  looksLikeUtf8Mojibake,
  repairUtf8Mojibake,
} from "./utf8MojibakeRepair";
import { fixUtf8Content } from "./utf8Text";
import { fixMojibake, displayChapter } from "./academicPresentation";

describe("repairUtf8Mojibake (structural CP1252→UTF-8)", () => {
  it("recovers Devanagari chapter from screenshot mojibake", () => {
    const bad = "à¤†à¤²à¥‹-à¤†à¤‚à¤§à¤¾à¤°à¥€";
    expect(looksLikeUtf8Mojibake(bad)).toBe(true);
    expect(repairUtf8Mojibake(bad)).toBe("आलो-आंधारी");
  });

  it("recovers seed-form Hindi mojibake (space + chandrabindu)", () => {
    const bad = "à¤†à¤²à¥‹ à¤†à¤à¤§à¤¾à¤°à¤¿";
    expect(repairUtf8Mojibake(bad)).toBe("आलो आँधारि");
  });

  it("does not re-decode clean Devanagari", () => {
    const clean = "आलो आँधारि";
    expect(looksLikeUtf8Mojibake(clean)).toBe(false);
    expect(repairUtf8Mojibake(clean)).toBe(clean);
  });

  it("recovers π / √ / ≤ mojibake", () => {
    expect(looksLikeUtf8Mojibake("Ï€")).toBe(true);
    expect(repairUtf8Mojibake("Ï€")).toBe("π");
    expect(repairUtf8Mojibake("âˆš")).toBe("√");
    expect(repairUtf8Mojibake("â‰¤")).toBe("≤");
    expect(repairUtf8Mojibake("Financial Statements â€“ I")).toBe(
      "Financial Statements – I",
    );
  });

  it("cross-check Acc / BST / Hindi chapter labels", () => {
    expect(repairUtf8Mojibake("Financial Statements â€“ I")).toBe(
      "Financial Statements – I",
    );
    expect(displayChapter("Financial Statements â€“ I")).toBe(
      "Financial Statements - I",
    );
    expect(displayChapter("Nature and Significance of Management")).toBe(
      "Nature and Significance of Management",
    );
    expect(displayChapter("à¤†à¤²à¥‹-à¤†à¤‚à¤§à¤¾à¤°à¥€")).toBe("आलो-आंधारी");
    expect(displayChapter("आलो आँधारि")).toBe("आलो आँधारि");
  });
});

describe("end-to-end Hindi chapter presentation hop", () => {
  it("Practice chip path: DB mojibake → displayChapter readable Hindi", () => {
    const dbValue = "à¤†à¤²à¥‹ à¤†à¤à¤§à¤¾à¤°à¤¿";
    expect(fixMojibake(dbValue)).toBe("आलो आँधारि");
    expect(displayChapter(dbValue)).toBe("आलो आँधारि");
  });

  it("fixUtf8Content recovers π without damaging clean math", () => {
    expect(fixUtf8Content("Ï€ rÂ²")).toMatch(/π/);
    expect(fixUtf8Content("π r²")).toContain("π");
    expect(fixUtf8Content("cos(π/3) equals:")).toBe("cos(π/3) equals:");
  });

  it("MathText path recovers âˆš option mojibake", () => {
    expect(fixUtf8Content("âˆš3/2")).toBe("√3/2");
    expect(fixUtf8Content("The value of sin 30Â° is:")).toBe(
      "The value of sin 30° is:",
    );
  });
});
