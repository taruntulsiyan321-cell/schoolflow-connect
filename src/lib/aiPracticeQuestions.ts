
import { mcqOptionsInvalid, normalizeMcqOptions } from "@/lib/mcqOptions";
import { invokeEdgeFunction } from "@/lib/edgeFunction";

type AiMcq = {
  question: string;
  options: string[];
  correct_index: number;
  explanation: string;
};


/** Generated MCQs — same engine as recovery (varied, concept-focused). */
export async function generateAiPracticeQuestions(opts: {
  subject: string;
  chapter?: string;
  topic: string;
  difficulty?: string;
  count: number;
  mistakeContext?: string;
  weakConcepts?: string[];
  recoveryMode?: boolean;
}): Promise<{ questions: AiMcq[]; error?: string }> {
  const focus = opts.weakConcepts?.length
    ? `Weak concepts to fix first: ${opts.weakConcepts.join("; ")}.`
    : "";

  const mistakes = opts.mistakeContext
    ? opts.recoveryMode
      ? `Mistakes from the student's practice sessions (use these to design remedial questions):\n${opts.mistakeContext}`
      : `Questions the student got wrong recently:\n${opts.mistakeContext}`
    : "";

  const recoveryInstructions = opts.recoveryMode && opts.mistakeContext
    ? [
        `Generate exactly ${opts.count} remedial MCQs — one per listed mistake concept where possible.`,
        "Each new question must test the SAME underlying skill as the corresponding mistake but with different numbers, wording, and scenario.",
        "Do NOT repeat or lightly reword the exact mistake questions listed above.",
        "Target what the student misunderstood (wrong pick vs correct answer and explanation).",
      ].join("\n")
    : "";

  const source_text = [
    focus,
    mistakes,
    recoveryInstructions,
    `Generate ${opts.count} DISTINCT CBSE Class 12 ${opts.subject} MCQs for chapter/topic "${opts.topic}".`,
    opts.recoveryMode
      ? "Remedial focus: rebuild confidence on weak spots with fresh practice."
      : "Each question must test a different sub-concept. Vary numbers, scenarios, and wording.",
    "NCERT-aligned. No duplicate question stems.",
  ]
    .filter(Boolean)
    .join("\n\n");

  // "test-generate-questions" was invoked here and 404s: it is deployed nowhere,
  // exists in no supabase/functions directory, and appears on no branch. The
  // deployed dpp-generate-questions accepts this exact body — every key here is
  // one it destructures, and source_url defaults to "" server-side — and returns
  // the { questions, error? } shape this function already reads.
  //
  // The gate WAS ["teacher","admin","principal"], so the student callers of this
  // helper (Class12AiSession, mistakeRecovery) were refused by design. Fixed in
  // deployed v15 (2026-09-07): "student" is on the role list, the school is
  // resolved from `students.school_id` when `profiles.school_id` is NULL — 40 of
  // 52 student accounts — and a student's run bills
  // `student.dpp.generate_questions` rather than the teacher line. Verified with
  // a real generation from the seeded student. KNOWN_ISSUES 2.
  const { data, error } = await invokeEdgeFunction<{ questions: AiMcq[]; error?: string }>(
    "dpp-generate-questions",
    {
      subject: opts.subject,
      chapter: opts.chapter ?? "",
      topic: opts.topic,
      difficulty: opts.difficulty ?? "medium",
      count: opts.count,
      source_text,
    },
  );

  if (error) return { questions: [], error };
  if (data?.error) return { questions: [], error: data.error };

  const valid = (data?.questions ?? [])
    .map((q) => {
      if (!q?.options?.length || q.correct_index == null) return null;
      if (mcqOptionsInvalid(q.options)) return null;
      const normalized = normalizeMcqOptions(q.options, q.correct_index);
      if (!normalized) return null;
      return {
        ...q,
        options: normalized.options,
        correct_index: normalized.correctIndex,
      };
    })
    .filter((q): q is AiMcq => q != null);

  return { questions: valid };
}
