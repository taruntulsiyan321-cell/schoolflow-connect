/**
 * MathText never hangs, and a price is not an equation.
 *
 * Measured 2026-09-22: a revision check crashed the browser tab on its fourth
 * question, "…the US dollar, which was convertible to gold at $35 per ounce".
 * The tokenizer met a `$` with no partner, fell through to a prose scanner that
 * stopped on that same `$`, and looped for ever without consuming input. Four
 * active bank questions carry a lone dollar sign; every page that renders one
 * froze.
 */
import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { MathText } from "./MathText";

const textOf = (t: string) => {
  const { container } = render(<MathText text={t} />);
  return { text: container.textContent ?? "", math: container.querySelectorAll(".katex").length };
};

describe("MathText — every input terminates", () => {
  it("renders a lone dollar sign as the dollar sign it is", () => {
    const r = textOf("Currencies were pegged to the US dollar, which was convertible to gold at $35 per ounce.");
    expect(r.text).toBe("Currencies were pegged to the US dollar, which was convertible to gold at $35 per ounce.");
    expect(r.math).toBe(0);
  });

  it("renders an unclosed \\( and \\[ as prose, not a hang", () => {
    expect(textOf("the ratio \\(a over b").text).toBe("the ratio \\(a over b");
    expect(textOf("see \\[ below").text).toBe("see \\[ below");
    expect(textOf("empty $$ block").text).toBe("empty $$ block");
  });

  it("does not read two prices as a formula", () => {
    const r = textOf("The price rose from $10 to $20 in a year.");
    expect(r.text).toBe("The price rose from $10 to $20 in a year.");
    expect(r.math).toBe(0);
  });

  it("treats \\$ as a literal dollar", () => {
    expect(textOf("costs \\$5 each").text).toBe("costs $5 each");
  });
});

describe("MathText — POSITIVE CONTROL: real math still typesets", () => {
  it("inline $…$", () => {
    expect(textOf("Solve $x^2 = 4$ for x.").math).toBe(1);
  });
  it("display $$…$$, \\(…\\) and \\[…\\]", () => {
    expect(textOf("$$\\frac{a}{b}$$").math).toBe(1);
    expect(textOf("area \\(\\pi r^2\\) here").math).toBe(1);
    expect(textOf("\\[E = mc^2\\]").math).toBe(1);
  });
  it("math and a price in one line", () => {
    const r = textOf("If $x = 3$ then it costs $30 in total.");
    expect(r.math).toBe(1);
    expect(r.text).toContain("costs $30 in total.");
  });
});
