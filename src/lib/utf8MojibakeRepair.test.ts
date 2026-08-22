import { describe, expect, it } from "vitest";
import {
  looksLikeUtf8Mojibake,
  repairUtf8Mojibake,
} from "./utf8MojibakeRepair";
import { fixUtf8Content } from "./utf8Text";
import { fixMojibake, displayChapter } from "./academicPresentation";

/**
 * Build CP1252 mojibake for a UTF-8 string (bytes 0x80–0x9F map to CP1252 glyphs).
 * Matches how live DB corruption appears (not ISO-8859-1 C1 controls).
 */
function asCp1252Mojibake(utf8: string): string {
  const CP1252: Record<number, number> = {
    0x80: 0x20ac, 0x82: 0x201a, 0x83: 0x0192, 0x84: 0x201e,
    0x85: 0x2026, 0x86: 0x2020, 0x87: 0x2021, 0x88: 0x02c6,
    0x89: 0x2030, 0x8a: 0x0160, 0x8b: 0x2039, 0x8c: 0x0152,
    0x8e: 0x017d, 0x91: 0x2018, 0x92: 0x2019, 0x93: 0x201c,
    0x94: 0x201d, 0x95: 0x2022, 0x96: 0x2013, 0x97: 0x2014,
    0x98: 0x02dc, 0x99: 0x2122, 0x9a: 0x0161, 0x9b: 0x203a,
    0x9c: 0x0153, 0x9e: 0x017e, 0x9f: 0x0178,
  };
  const bytes = Buffer.from(utf8, "utf8");
  let out = "";
  for (const b of bytes) {
    out += String.fromCodePoint(CP1252[b] ?? b);
  }
  return out;
}

const HINDI_SHOT_MOJI = asCp1252Mojibake("आलो-आंधारी");
const HINDI_SEED_MOJI = asCp1252Mojibake("आलो आँधारि");
const ACC_DASH_MOJI = `Financial Statements ${asCp1252Mojibake("\u2013")} I`;

describe("repairUtf8Mojibake (structural CP1252→UTF-8)", () => {
  it("recovers Devanagari chapter from screenshot mojibake", () => {
    expect(looksLikeUtf8Mojibake(HINDI_SHOT_MOJI)).toBe(true);
    expect(repairUtf8Mojibake(HINDI_SHOT_MOJI)).toBe("आलो-आंधारी");
  });

  it("recovers seed-form Hindi mojibake (space + chandrabindu)", () => {
    expect(repairUtf8Mojibake(HINDI_SEED_MOJI)).toBe("आलो आँधारि");
  });

  it("does not re-decode clean Devanagari", () => {
    const clean = "आलो आँधारि";
    expect(looksLikeUtf8Mojibake(clean)).toBe(false);
    expect(repairUtf8Mojibake(clean)).toBe(clean);
  });

  it("recovers π / √ / ≤ and Acc en-dash mojibake", () => {
    expect(looksLikeUtf8Mojibake("Ï€")).toBe(true);
    expect(repairUtf8Mojibake("Ï€")).toBe("π");
    expect(repairUtf8Mojibake("âˆš")).toBe("√");
    expect(repairUtf8Mojibake("â‰¤")).toBe("≤");
    expect(repairUtf8Mojibake(ACC_DASH_MOJI)).toBe("Financial Statements – I");
  });

  it("cross-check Acc / BST / Hindi chapter labels", () => {
    expect(displayChapter(ACC_DASH_MOJI)).toBe("Financial Statements - I");
    expect(displayChapter("Nature and Significance of Management")).toBe(
      "Nature and Significance of Management",
    );
    expect(displayChapter(HINDI_SHOT_MOJI)).toBe("आलो-आंधारी");
    expect(displayChapter("आलो आँधारि")).toBe("आलो आँधारि");
  });
});

describe("end-Hindi chapter presentation hop", () => {
  it("Practice chip path: DB mojibake → displayChapter readable Hindi", () => {
    expect(fixMojibake(HINDI_SEED_MOJI)).toBe("आलो आँधारि");
    expect(displayChapter(HINDI_SEED_MOJI)).toBe("आलो आँधारि");
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

describe("mixed C1 + CP1252 Hindi (PG WIN1252/LATIN1 gap)", () => {
  it("recovers व्याकरण - काल (virama U+008D + bullet U+2022)", () => {
    const moji = asCp1252Mojibake("व्याकरण - काल");
    // Must contain both a C1 control (from 0x8D) and a CP1252 special (• from 0x95)
    expect([...moji].some((ch) => {
      const cp = ch.codePointAt(0)!;
      return cp >= 0x80 && cp <= 0x9f;
    })).toBe(true);
    expect(moji.includes("\u2022")).toBe(true);
    expect(repairUtf8Mojibake(moji)).toBe("व्याकरण - काल");
    expect(displayChapter(moji)).toBe("व्याकरण - काल");
  });

  it("recovers आलो आँधारि (chandrabindu U+0081 + dagger specials)", () => {
    const moji = asCp1252Mojibake("आलो आँधारि");
    expect(repairUtf8Mojibake(moji)).toBe("आलो आँधारि");
  });

  it("recovers कबीर के पद and latin1-form seeds", () => {
    expect(repairUtf8Mojibake(asCp1252Mojibake("कबीर के पद"))).toBe("कबीर के पद");
    const latin1 = Buffer.from("कबीर के पद", "utf8").toString("latin1");
    expect(repairUtf8Mojibake(latin1)).toBe("कबीर के पद");
  });
});
