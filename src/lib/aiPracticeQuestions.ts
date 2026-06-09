import { supabase } from "@/integrations/supabase/client";
import { invokeEdgeFunction } from "@/lib/edgeFunction";

export type AiMcq = {
  question: string;
  options: string[];
  correct_index: number;
  explanation: string;
};

/** Recent wrong answers to steer AI recovery / practice. */
export async function fetchRecentMistakeContext(opts: {
  subject: string;
  chapter?: string | null;
  concept?: string | null;
  limit?: number;
}): Promise<{ text: string; concepts: string[] }> {
  const { data: auth } = await supabase.auth.getUser();
  const user = auth.user;
  if (!user) return { text: "", concepts: [] };

  let query = supabase
    .from("student_mistakes")
    .select("question_text, concept, chapter, topic")
    .eq("user_id", user.id)
    .eq("subject", opts.subject)
    .order("last_wrong_at", { ascending: false })
    .limit(opts.limit ?? 6);

  if (opts.chapter) query = query.ilike("chapter", `%${opts.chapter}%`);

  const { data } = await query;
  if (!data?.length) return { text: "", concepts: [] };

  const concepts = [
    ...new Set(
      data
        .map((m) => m.concept || m.topic || m.chapter)
        .filter(Boolean) as string[],
    ),
  ];

  const text = data
    .map((m, i) => {
      const label = m.concept || m.topic || m.chapter || "concept";
      const q = (m.question_text ?? "").slice(0, 280);
      return `${i + 1}. [${label}] ${q}`;
    })
    .join("\n");

  return { text, concepts };
}

/** Gemini-powered MCQs — same engine as recovery (varied, concept-focused). */
export async function generateAiPracticeQuestions(opts: {
  subject: string;
  chapter?: string;
  topic: string;
  difficulty?: string;
  count: number;
  mistakeContext?: string;
  weakConcepts?: string[];
}): Promise<{ questions: AiMcq[]; error?: string }> {
  const focus = opts.weakConcepts?.length
    ? `Weak concepts to fix first: ${opts.weakConcepts.join("; ")}.`
    : "";
  const mistakes = opts.mistakeContext
    ? `Questions the student got wrong recently:\n${opts.mistakeContext}`
    : "";

  const source_text = [
    focus,
    mistakes,
    `Generate ${opts.count} DISTINCT CBSE Class 12 ${opts.subject} MCQs for chapter/topic "${opts.topic}".`,
    "Each question must test a different sub-concept. Vary numbers, scenarios, and wording.",
    "NCERT-aligned. No duplicate question stems.",
  ]
    .filter(Boolean)
    .join("\n\n");

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
  return { questions: data?.questions ?? [] };
}
