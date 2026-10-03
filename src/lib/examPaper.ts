/** The CUET paper's shape for a screen with no session or catalog to read it from (rpc_exam_paper, 20261144000000). */
import { supabase } from "@/integrations/supabase/client";
import { type PaperShape, readPaperShape } from "@/academic/metrics/examPaper";

export async function fetchExamPaper(): Promise<PaperShape | null> {
  const { data, error } = await supabase.rpc("rpc_exam_paper");
  if (error) throw new Error(error.message);
  return readPaperShape(data);
}
