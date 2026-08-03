import { supabase } from "@/integrations/supabase/client";
import { generateAiPracticeQuestions } from "@/lib/aiPracticeQuestions";

export type MistakeRecord = {
  id: string;
  question_text: string;
  options: string[];
  student_answer: { selected_index?: number; text?: string } | null;
  correct_answer: { correct_index?: number; text?: string } | null;
  explanation: string | null;
  subject: string;
  chapter: string | null;
  concept: string | null;
  topic: string | null;
  times_wrong: number;
  last_wrong_at?: string | null;
};

export type RecoveryQuestionFromMistakes = {
  id: string;
  order_index: number;
  question_text: string;
  options: string[];
  correct_index: number;
  explanation: string;
  answered: boolean;
  ai_generated: boolean;
  mistake_id?: string;
};

function parseOptions(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.map(String);
  return [];
}

function parseAnswer(raw: unknown): { selected_index?: number; text?: string } | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  return {
    selected_index: typeof o.selected_index === "number" ? o.selected_index : undefined,
    text: typeof o.text === "string" ? o.text : undefined,
  };
}

function conceptLabel(m: MistakeRecord): string {
  return m.concept || m.topic || m.chapter || "concept";
}

function matchesConcept(
  mistakeConcept: string | null,
  mistakeTopic: string | null,
  filter?: string | null,
): boolean {
  if (!filter) return true;
  const f = filter.toLowerCase();
  const c = (mistakeConcept ?? "").toLowerCase();
  const t = (mistakeTopic ?? "").toLowerCase();
  return c.includes(f) || f.includes(c) || t.includes(f) || f.includes(t);
}

function mapRow(m: {
  id: string;
  question_text: string;
  options: unknown;
  student_answer: unknown;
  correct_answer: unknown;
  explanation: string | null;
  subject: string;
  chapter: string | null;
  concept: string | null;
  topic: string | null;
  times_wrong: number;
  last_wrong_at?: string | null;
}): MistakeRecord {
  return {
    id: m.id,
    question_text: m.question_text,
    options: parseOptions(m.options),
    student_answer: parseAnswer(m.student_answer),
    correct_answer: parseAnswer(m.correct_answer),
    explanation: m.explanation,
    subject: m.subject,
    chapter: m.chapter,
    concept: m.concept,
    topic: m.topic,
    times_wrong: m.times_wrong,
    last_wrong_at: m.last_wrong_at ?? null,
  };
}

const MISTAKE_SELECT =
  "id, question_text, options, student_answer, correct_answer, explanation, subject, chapter, concept, topic, times_wrong, last_wrong_at";

/** Unmastered practice mistakes for a recovery assignment's subject/chapter/concept. */
export async function fetchMistakesForRecovery(opts: {
  subject: string;
  chapter?: string | null;
  concept?: string | null;
  limit?: number;
}): Promise<MistakeRecord[]> {
  const { data: auth } = await supabase.auth.getUser();
  const user = auth.user;
  if (!user) return [];

  let query = supabase
    .from("student_mistakes")
    .select(MISTAKE_SELECT)
    .eq("user_id", user.id)
    .eq("mastered", false)
    .eq("subject", opts.subject)
    .or("source.eq.practice,assessment_type.eq.practice")
    .order("last_wrong_at", { ascending: false })
    .limit(opts.limit ?? 8);

  if (opts.chapter) query = query.ilike("chapter", `%${opts.chapter}%`);

  const { data } = await query;
  if (!data?.length) return [];

  let filtered = data;
  if (opts.concept) {
    filtered = data.filter((m) => matchesConcept(m.concept, m.topic, opts.concept));
    if (filtered.length === 0) filtered = data;
  }

  return filtered.map(mapRow);
}

/** Unmastered mistakes for analytics (practice, DPP, battles, exams). */
export async function fetchMistakesForAnalytics(limit = 50): Promise<MistakeRecord[]> {
  const { data: auth } = await supabase.auth.getUser();
  const user = auth.user;
  if (!user) return [];

  const { data } = await supabase
    .from("student_mistakes")
    .select(MISTAKE_SELECT)
    .eq("user_id", user.id)
    .eq("mastered", false)
    .order("last_wrong_at", { ascending: false })
    .limit(limit);

  return (data ?? []).map(mapRow);
}

/** @deprecated Use fetchMistakesForAnalytics */
export const fetchPracticeMistakesForAnalytics = fetchMistakesForAnalytics;

/** Most recent unmastered practice mistake (any subject). */
export async function fetchMostRecentPracticeMistake(): Promise<MistakeRecord | null> {
  const { data: auth } = await supabase.auth.getUser();
  const user = auth.user;
  if (!user) return null;

  const { data } = await supabase
    .from("student_mistakes")
    .select(MISTAKE_SELECT)
    .eq("user_id", user.id)
    .eq("mastered", false)
    .or("source.eq.practice,assessment_type.eq.practice")
    .order("last_wrong_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  return data ? mapRow(data) : null;
}

export function formatMistakesForPrompt(mistakes: MistakeRecord[]): string {
  return mistakes
    .map((m, i) => {
      const label = conceptLabel(m);
      const studentIdx = m.student_answer?.selected_index;
      const correctIdx = m.correct_answer?.correct_index;
      const studentPick =
        studentIdx != null && m.options[studentIdx] ? m.options[studentIdx] : "(unknown)";
      const correctPick =
        correctIdx != null && m.options[correctIdx] ? m.options[correctIdx] : "(unknown)";
      const opts = m.options.map((o, j) => `${String.fromCharCode(65 + j)}. ${o}`).join("; ");
      const expl = m.explanation ? `\n   Explanation: ${m.explanation.slice(0, 400)}` : "";
      return `${i + 1}. [${label}] (wrong ${m.times_wrong}x)
   Question: ${m.question_text.slice(0, 500)}
   Options: ${opts}
   Student picked: ${studentPick}
   Correct answer: ${correctPick}${expl}`;
    })
    .join("\n\n");
}

export async function generateRecoveryQuestionsFromMistakes(
  assign: {
    subject?: string;
    chapter?: string;
    concept?: string;
    severity?: string;
    question_count?: number;
  },
  mistakes: MistakeRecord[],
): Promise<{ questions: RecoveryQuestionFromMistakes[]; error?: string }> {
  const mistakeContext = formatMistakesForPrompt(mistakes);
  const concepts = [...new Set(mistakes.map(conceptLabel))];
  const concept = assign.concept ?? assign.chapter ?? concepts[0] ?? "";
  const maxBySeverity =
    assign.severity === "severe" ? 8 : assign.severity === "moderate" ? 6 : 5;
  const count = Math.min(assign.question_count ?? maxBySeverity, mistakes.length, maxBySeverity);

  const { questions, error } = await generateAiPracticeQuestions({
    subject: assign.subject ?? "",
    chapter: assign.chapter ?? "",
    topic: concept,
    difficulty: assign.severity === "severe" ? "easy" : "medium",
    count: Math.max(1, count),
    mistakeContext,
    weakConcepts: concepts,
    recoveryMode: true,
  });

  if (questions.length === 0) return { questions: [], error };

  return {
    questions: questions.map((q, i) => ({
      id: `recovery-${mistakes[i % mistakes.length]?.id ?? Date.now()}-${i}`,
      order_index: i,
      question_text: q.question,
      options: q.options,
      correct_index: q.correct_index,
      explanation: q.explanation,
      answered: false,
      ai_generated: true,
      mistake_id: mistakes[i % mistakes.length]?.id,
    })),
    error,
  };
}
