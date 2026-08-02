-- Meta3 unify: in-place WIN1252 UTF-8 repair (no delete-v1). See docs/APPLY_UTF8_MOJIBAKE_REPAIR.sql

-- =============================================================================
-- APPLY_UTF8_MOJIBAKE_REPAIR.sql  (CANONICAL — Meta-Supervisor 3)
-- Paste into Supabase SQL Editor with UTF-8. Idempotent.
--
-- ROOT CAUSE (proven live DB 2026-08-02):
--   Repo seeds store valid UTF-8 (chapter आलो आँधारि, symbol π).
--   seed_rbse_commerce_v1 was applied with UTF-8 misread as WIN1252 →
--   stored as à¤… / Ï€. full_v1 + taxonomy already clean.
--   Presentation Western char-maps passed Devanagari mojibake through.
--
-- ONE STRATEGY (do NOT delete seed batches; do NOT use APPLY_DEVANAGARI_*):
--   convert_from(convert_to(s, 'WIN1252'), 'UTF8') on signature-matched text.
--
-- Verify:
--   SELECT count(*) FROM question_bank WHERE chapter ~ 'à¤|à¥';  -- expect 0
--   SELECT DISTINCT chapter FROM question_bank
--     WHERE subject ILIKE 'Hindi' AND chapter LIKE '%आलो%';  -- आलो आँधारि
-- =============================================================================

CREATE OR REPLACE FUNCTION public._repair_utf8_mojibake(t text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  s text := coalesce(t, '');
  repaired text;
BEGIN
  IF s = '' THEN RETURN s; END IF;
  IF s !~ 'à¤|à¥|â€|Ã.|Î.|Ï.|Â[°·¹²³½¼¾]|âˆ.' THEN RETURN s; END IF;
  BEGIN
    repaired := convert_from(convert_to(s, 'WIN1252'), 'UTF8');
  EXCEPTION WHEN others THEN
    BEGIN
      repaired := convert_from(convert_to(s, 'LATIN1'), 'UTF8');
    EXCEPTION WHEN others THEN
      RETURN s;
    END;
  END;
  IF repaired IS NULL OR repaired = '' OR repaired = s OR repaired ~ 'à¤|à¥' THEN
    RETURN s;
  END IF;
  RETURN repaired;
END;
$$;

COMMENT ON FUNCTION public._repair_utf8_mojibake(text) IS
  'Canonical UTF-8-as-WIN1252 reverse (Hindi + π). Idempotent. Meta3 SSOT.';

DROP FUNCTION IF EXISTS public._repair_cp1252_mojibake(text);

UPDATE public.question_bank
SET
  chapter = public._repair_utf8_mojibake(chapter),
  topic = public._repair_utf8_mojibake(topic),
  concept = public._repair_utf8_mojibake(concept),
  question = public._repair_utf8_mojibake(question),
  explanation = public._repair_utf8_mojibake(explanation),
  updated_at = now()
WHERE
  (chapter IS NOT NULL AND chapter ~ 'à¤|à¥|â€|Ã.|Î.|Ï.|Â[°·¹²³½¼¾]|âˆ.')
  OR (topic IS NOT NULL AND topic ~ 'à¤|à¥|â€|Ã.|Î.|Ï.|Â[°·¹²³½¼¾]|âˆ.')
  OR (concept IS NOT NULL AND concept ~ 'à¤|à¥|â€|Ã.|Î.|Ï.|Â[°·¹²³½¼¾]|âˆ.')
  OR (question IS NOT NULL AND question ~ 'à¤|à¥|â€|Ã.|Î.|Ï.|Â[°·¹²³½¼¾]|âˆ.')
  OR (coalesce(explanation, '') ~ 'à¤|à¥|â€|Ã.|Î.|Ï.|Â[°·¹²³½¼¾]|âˆ.');

UPDATE public.question_bank qb
SET
  options = (
    SELECT coalesce(jsonb_agg(
      CASE WHEN jsonb_typeof(elem) = 'string'
        THEN to_jsonb(public._repair_utf8_mojibake(elem #>> '{}'))
        ELSE elem END
    ), '[]'::jsonb)
    FROM jsonb_array_elements(coalesce(qb.options, '[]'::jsonb)) AS elem
  ),
  updated_at = now()
WHERE qb.options IS NOT NULL
  AND qb.options::text ~ 'à¤|à¥|â€|Ã.|Î.|Ï.|Â[°·¹²³½¼¾]|âˆ.';

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = '_fix_utf8_content') THEN
    UPDATE public.question_bank
    SET question = public._fix_utf8_content(question),
        explanation = public._fix_utf8_content(explanation),
        updated_at = now()
    WHERE question ~ 'â€|Ã—|Ï€|Î¸|Â½|âˆš|â‰¤|â‰¥'
       OR coalesce(explanation, '') ~ 'â€|Ã—|Ï€|Î¸|Â½|âˆš|â‰¤|â‰¥';
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='academic_taxonomy_terms') THEN
    UPDATE public.academic_taxonomy_terms
    SET display_name = public._repair_utf8_mojibake(display_name)
    WHERE display_name ~ 'à¤|à¥|â€|Ã.|Î.|Ï.|Â[°·¹²³½¼¾]|âˆ.';
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='practice_sessions' AND column_name='chapter') THEN
    UPDATE public.practice_sessions SET chapter = public._repair_utf8_mojibake(chapter)
    WHERE chapter IS NOT NULL AND chapter ~ 'à¤|à¥|â€|Ã.|Î.|Ï.|Â[°·¹²³½¼¾]|âˆ.';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='concept_mastery') THEN
    EXECUTE $u$UPDATE public.concept_mastery SET
      chapter = public._repair_utf8_mojibake(chapter),
      concept = public._repair_utf8_mojibake(concept),
      subject = public._repair_utf8_mojibake(subject)
      WHERE (chapter IS NOT NULL AND chapter ~ 'à¤|à¥|â€|Ã.|Î.|Ï.|Â[°·¹²³½¼¾]|âˆ.')
         OR (concept IS NOT NULL AND concept ~ 'à¤|à¥|â€|Ã.|Î.|Ï.|Â[°·¹²³½¼¾]|âˆ.')
         OR (subject IS NOT NULL AND subject ~ 'à¤|à¥|â€|Ã.|Î.|Ï.|Â[°·¹²³½¼¾]|âˆ.')$u$;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='student_mistakes') THEN
    EXECUTE $u$UPDATE public.student_mistakes SET
      chapter = CASE WHEN chapter IS NOT NULL THEN public._repair_utf8_mojibake(chapter) ELSE chapter END,
      topic = CASE WHEN topic IS NOT NULL THEN public._repair_utf8_mojibake(topic) ELSE topic END,
      concept = CASE WHEN concept IS NOT NULL THEN public._repair_utf8_mojibake(concept) ELSE concept END
      WHERE (chapter IS NOT NULL AND chapter ~ 'à¤|à¥|â€|Ã.|Î.|Ï.|Â[°·¹²³½¼¾]|âˆ.')
         OR (topic IS NOT NULL AND topic ~ 'à¤|à¥|â€|Ã.|Î.|Ï.|Â[°·¹²³½¼¾]|âˆ.')
         OR (concept IS NOT NULL AND concept ~ 'à¤|à¥|â€|Ã.|Î.|Ï.|Â[°·¹²³½¼¾]|âˆ.')$u$;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='battles' AND column_name='chapter') THEN
    UPDATE public.battles SET chapter = public._repair_utf8_mojibake(chapter)
    WHERE chapter IS NOT NULL AND chapter ~ 'à¤|à¥|â€|Ã.|Î.|Ï.|Â[°·¹²³½¼¾]|âˆ.';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='recovery_assignments') THEN
    EXECUTE $u$UPDATE public.recovery_assignments SET
      chapter = CASE WHEN chapter IS NOT NULL THEN public._repair_utf8_mojibake(chapter) ELSE chapter END,
      concept = CASE WHEN concept IS NOT NULL THEN public._repair_utf8_mojibake(concept) ELSE concept END
      WHERE (chapter IS NOT NULL AND chapter ~ 'à¤|à¥|â€|Ã.|Î.|Ï.|Â[°·¹²³½¼¾]|âˆ.')
         OR (concept IS NOT NULL AND concept ~ 'à¤|à¥|â€|Ã.|Î.|Ï.|Â[°·¹²³½¼¾]|âˆ.')$u$;
  END IF;
END $$;
