import { supabase } from "@/integrations/supabase/client";

/** Queue recovery work when a student gets a concept wrong (idempotent per concept). */
export async function assignRecoveryOnMistake(opts: {
  subject: string;
  chapter?: string | null;
  concept?: string | null;
  sourceType: string;
  sourceId: string;
  accuracy?: number;
}) {
  const { error } = await (supabase as any).rpc("rpc_assign_concept_recovery", {
    _subject: opts.subject,
    _chapter: opts.chapter ?? null,
    _concept: opts.concept ?? opts.chapter ?? null,
    _subconcept: null,
    _accuracy: opts.accuracy ?? 35,
    _source_type: opts.sourceType,
    _source_id: opts.sourceId,
  });
  if (error) console.warn("recovery assign:", error.message);
}
