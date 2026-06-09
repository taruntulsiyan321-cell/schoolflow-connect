import { supabase } from "@/integrations/supabase/client";
import { generateFromTemplate } from "@/engines/class12Math/generate";
import { CLASS12_MATH_CHAPTERS, type QuestionTemplateRow } from "@/engines/class12Math/types";
import { diversifyTemplates, freshSessionSeed } from "@/lib/practiceDiversity";

const NO_BANK_MSG = "No questions available for this combination yet";

export function isEmptyQuestionBankError(message: string) {
  return message.toLowerCase().includes("no questions available");
}

export function canUseMath12TemplateSolo(subject: string, grade: number | null) {
  return grade === 12 && subject.toLowerCase() === "mathematics";
}

/** Mathematics solo can use templates even when class grade is unknown or bank is empty. */
export function shouldPreferMathTemplateSolo(
  subject: string,
  grade: number | null,
  bankEmpty: boolean,
) {
  if (subject.toLowerCase() !== "mathematics") return false;
  return canUseMath12TemplateSolo(subject, grade) || bankEmpty || grade === null;
}

export function resolveMath12Chapter(chapter: string | undefined) {
  if (chapter && chapter !== "__any__") return chapter;
  return CLASS12_MATH_CHAPTERS[Math.floor(Math.random() * CLASS12_MATH_CHAPTERS.length)];
}

/** Create a solo battle from Class 12 Math templates (client-side generation). */
export async function createMath12TemplateSoloBattle(opts: {
  chapter?: string;
  difficulty: string;
  count: number;
  perQ: number;
  classId?: string | null;
}): Promise<{ battleId: string } | { redirectTo: string }> {
  const chapter = resolveMath12Chapter(opts.chapter);
  const count = Math.min(20, Math.max(1, opts.count));

  const { data: templates, error: tErr } = await supabase.rpc("rpc_pick_question_templates", {
    _class: 12,
    _subject: "Mathematics",
    _chapter: chapter,
    _count: count,
  });
  if (tErr) throw tErr;

  const rows = diversifyTemplates((templates ?? []) as QuestionTemplateRow[], count);
  if (rows.length === 0) {
    return { redirectTo: `/student/practice/math12/session?chapter=${encodeURIComponent(chapter)}&count=${count}` };
  }

  const seed = freshSessionSeed(chapter);
  const generated = rows.map((t, i) => generateFromTemplate(t, seed + i * 7919));
  const payload = generated.map((g) => ({
    question: g.question,
    options: g.options,
    correct_index: g.correctIndex,
    points: 10,
  }));

  const { data: battleId, error: bErr } = await (supabase as any).rpc("rpc_create_template_solo_battle", {
    _subject: "Mathematics",
    _chapter: chapter,
    _difficulty: opts.difficulty,
    _count: payload.length,
    _per_q: opts.perQ,
    _class_id: opts.classId ?? null,
    _questions: payload,
  });

  if (bErr) {
    if (bErr.message?.includes("rpc_create_template_solo_battle") || bErr.code === "42883") {
      return { redirectTo: `/student/practice/math12/session?chapter=${encodeURIComponent(chapter)}&count=${count}` };
    }
    throw bErr;
  }

  return { battleId: battleId as string };
}

export { NO_BANK_MSG };
