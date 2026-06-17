import { supabase } from "@/integrations/supabase/client";
import type { GeneratedQuestion, QuestionTemplateRow } from "@/engines/class12Math/types";
import {
  diversifyTemplates,
  freshSessionSeed,
  generateUniqueFromTemplates,
} from "@/lib/practiceDiversity";

export type TemplateSessionItem = {
  template: QuestionTemplateRow;
  generated: GeneratedQuestion;
};

/** Pick Class 12 Math templates and generate unique questions client-side. */
export async function loadMath12TemplatePractice(opts: {
  chapter: string;
  count: number;
  sessionSeed?: number;
}): Promise<{ items: TemplateSessionItem[]; sessionSeed: number; error?: string }> {
  const seed = opts.sessionSeed ?? freshSessionSeed(opts.chapter);

  const { data: templates, error: tErr } = await supabase.rpc("rpc_pick_question_templates", {
    _class: 12,
    _subject: "Mathematics",
    _chapter: opts.chapter,
    _count: opts.count,
  });
  if (tErr) return { items: [], sessionSeed: seed, error: tErr.message };

  const rows = diversifyTemplates((templates ?? []) as QuestionTemplateRow[], opts.count);
  const seenIds = new Set<string>();
  const uniqueRows = rows.filter((r) => {
    if (!r.id || seenIds.has(r.id)) return !r.id;
    seenIds.add(r.id);
    return true;
  });
  if (uniqueRows.length === 0) return { items: [], sessionSeed: seed };

  return { items: generateUniqueFromTemplates(uniqueRows, seed), sessionSeed: seed };
}
