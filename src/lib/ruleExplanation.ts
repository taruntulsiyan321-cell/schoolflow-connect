import type { Explanation } from "@/components/learn/ExplainPanel";

export function buildRuleExplanation(opts: {
  question: string;
  options?: string[];
  correctIndex?: number | null;
  selectedIndex?: number | null;
  correctText?: string;
  selectedText?: string;
  wasCorrect?: boolean | null;
  subject?: string;
  chapter?: string;
}): Explanation {
  const {
    options = [],
    correctIndex = null,
    selectedIndex = null,
    correctText = "",
    selectedText = "",
    wasCorrect = null,
    subject = "",
    chapter = "",
  } = opts;

  const correct =
    correctText ||
    (correctIndex != null && options[correctIndex] ? options[correctIndex] : "the correct option");
  const chosen =
    selectedText ||
    (selectedIndex != null && selectedIndex >= 0 && options[selectedIndex]
      ? options[selectedIndex]
      : "no answer");

  if (wasCorrect) {
    return {
      summary: `Well done — your answer matches the correct option.`,
      why_wrong: `You selected "${chosen}", which is correct for this ${subject || "subject"} question.`,
      concept: chapter
        ? `This question is from NCERT chapter "${chapter}". Revise key definitions and worked examples from your textbook.`
        : `Review the core concept behind this question in your class notes or NCERT.`,
      how_to_improve: `Try a similar question without hints, then check the mistake book if you get it wrong.`,
    };
  }

  return {
    summary: `You chose "${chosen}" but the correct answer is "${correct}".`,
    why_wrong:
      selectedIndex == null || selectedIndex < 0
        ? `You did not submit an answer in time. Read the question carefully and eliminate obviously wrong options first.`
        : `"${chosen}" does not satisfy the conditions in the question. Compare each option against what the question is asking.`,
    concept: chapter
      ? `Focus on NCERT chapter "${chapter}"${subject ? ` (${subject})` : ""}. Re-read the section summary and redo 2–3 textbook examples.`
      : `Identify the formula or rule this question tests, then practise 5 similar MCQs.`,
    how_to_improve: `Add this to your revision queue, attempt a solo battle on the same chapter, and use DPP for timed practice.`,
  };
}
