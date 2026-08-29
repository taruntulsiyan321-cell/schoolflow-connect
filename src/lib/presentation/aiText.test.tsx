import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { toAssistantMarkdown, toAiLine } from "./aiText";
import { NovaMarkdown } from "@/components/NovaMarkdown";
import { MathText } from "@/components/MathText";

const UUID = "3f2a9c11-4b8e-4c1a-9f0d-2b7e5a1c8d33";

describe("toAssistantMarkdown — model output is screened before it is prose", () => {
  it("passes a normal answer through untouched", () => {
    const answer = "To solve $x^2 = 9$, take the square root of **both sides**.";
    const out = toAssistantMarkdown(answer);
    expect(out.unusable).toBe(false);
    expect(out.markdown).toBe(answer);
  });

  it("rejects a reply that is really a JSON envelope", () => {
    const out = toAssistantMarkdown('{"answer": "42", "confidence": 0.9}');
    expect(out.unusable).toBe(true);
    expect(out.reason).toBe("json-payload");
    expect(out.markdown).toBe("");
  });

  it("rejects a non-string payload instead of stringifying it", () => {
    const out = toAssistantMarkdown({ answer: "42" });
    expect(out.unusable).toBe(true);
    expect(out.reason).toBe("not-a-string");
  });

  it("strips tool-call blocks", () => {
    const out = toAssistantMarkdown(
      "Here is the plan.\n<tool_call>{\"name\":\"lookup\"}</tool_call>\nStart with chapter 3.",
    );
    expect(out.unusable).toBe(false);
    expect(out.markdown).not.toContain("tool_call");
    expect(out.markdown).not.toContain("lookup");
    expect(out.markdown).toContain("Here is the plan.");
    expect(out.markdown).toContain("Start with chapter 3.");
  });

  it("strips orphan tags left by a truncated stream", () => {
    const out = toAssistantMarkdown("<thinking>Let me consider</thinking>Answer: 4");
    expect(out.markdown).not.toContain("<thinking>");
    expect(out.markdown).toContain("Answer: 4");
  });

  it("redacts identifiers the model echoed back", () => {
    const out = toAssistantMarkdown(`Your record ${UUID} shows steady progress.`);
    expect(out.markdown).not.toContain(UUID);
    expect(out.markdown).toContain("steady progress");
  });

  it("removes a stringified object that leaked into the model's own text", () => {
    const out = toAssistantMarkdown("Your score is [object Object] this week, keep going.");
    expect(out.markdown).not.toContain("[object Object]");
  });

  it("closes an unbalanced code fence so the renderer cannot break", () => {
    const out = toAssistantMarkdown("Try this:\n```js\nconst x = 1;");
    expect((out.markdown.match(/```/g) ?? []).length % 2).toBe(0);
  });

  it("reports machinery-only output as unusable", () => {
    const out = toAssistantMarkdown("<tool_call>{}</tool_call>");
    expect(out.unusable).toBe(true);
    expect(out.reason).toBe("only-machinery");
  });

  it("repairs mojibake in model output", () => {
    expect(toAssistantMarkdown("Area is Ï€r^2").markdown).toContain("π");
  });
});

describe("toAiLine — single-line AI copy", () => {
  it("flattens inline markdown markers but keeps the model's words", () => {
    expect(toAiLine("**Great work** on ~~algebra~~ geometry")).toBe(
      "Great work on algebra geometry",
    );
  });

  it("collapses multi-line output onto one line", () => {
    expect(toAiLine("Focus on\nquadratics next")).toBe("Focus on quadratics next");
  });

  it("returns the fallback for unusable output", () => {
    expect(toAiLine('{"a":1}', "No summary yet")).toBe("No summary yet");
    expect(toAiLine(null, "No summary yet")).toBe("No summary yet");
    expect(toAiLine({ a: 1 }, "No summary yet")).toBe("No summary yet");
  });
});

describe("NovaMarkdown — the student-facing AI surface", () => {
  it("renders a normal answer as typeset markdown, not raw syntax", () => {
    render(<NovaMarkdown text="Use the **quadratic formula** here." />);
    expect(screen.getByText("quadratic formula").tagName).toBe("STRONG");
    expect(document.body.textContent).not.toContain("**");
  });

  it("shows an intentional message instead of dumping a JSON reply", () => {
    render(<NovaMarkdown text='{"answer":"42","tool":"calc"}' />);
    const shown = document.body.textContent ?? "";
    // None of the payload — keys, values or braces — reaches the student.
    expect(shown).not.toContain("calc");
    expect(shown).not.toContain("42");
    expect(shown).not.toContain("{");
    expect(screen.getByText(/couldn't be displayed/i)).toBeTruthy();
  });

  it("never renders a tool-call block to the student", () => {
    render(<NovaMarkdown text={"Sure.\n<tool_call>{\"name\":\"x\"}</tool_call>"} />);
    expect(document.body.textContent).not.toContain("tool_call");
    expect(document.body.textContent).toContain("Sure.");
  });

  it("does not render an object as [object Object]", () => {
    // Passing the wrong shape on purpose: the prop is `unknown` by design.
    render(<NovaMarkdown text={{ answer: 42 }} />);
    expect(document.body.textContent).not.toContain("[object Object]");
  });
});

describe("MathText — the question-content surface", () => {
  it("renders plain question text", () => {
    render(<MathText text="What is the area of a circle?" />);
    expect(document.body.textContent).toContain("What is the area of a circle?");
  });

  it("repairs mojibake rather than showing it", () => {
    render(<MathText text="Ï€ r^2" />);
    expect(document.body.textContent).toContain("π");
    expect(document.body.textContent).not.toContain("Ï€");
  });

  it("does not render an object option as [object Object]", () => {
    // TestQuestion.options is untyped jsonb, so an object option really can
    // reach here. Passing the wrong shape on purpose: the prop is `unknown`.
    render(<MathText text={{ label: "A" }} />);
    expect(document.body.textContent).not.toContain("[object Object]");
  });

  it("renders nothing rather than the literal string 'undefined'", () => {
    render(<MathText text={undefined} />);
    expect(document.body.textContent).not.toContain("undefined");
  });
});
