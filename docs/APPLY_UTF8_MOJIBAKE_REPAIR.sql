-- =============================================================================
-- APPLY_UTF8_MOJIBAKE_REPAIR.sql  (Meta3 SSOT — paste into Supabase SQL editor)
-- Client encoding must be UTF-8. Idempotent.
--
-- Root cause (proven Inv2 + RCA synthesizer):
--   Repo seeds are valid UTF-8 (आलो आँधारि, π).
--   Live source=seed_rbse_commerce_v1 was applied with UTF-8 misread as WIN1252,
--   storing à¤†à¤²à¥‹… / Ï€ / âˆš. React/presentation do not invent this.
--   full_v1 rows are already clean — delete corrupt v1, repair leftovers.
--
-- Verify after apply:
--   SELECT count(*) FROM question_bank WHERE chapter ~ 'à¤|à¥' OR question ~ 'à¤|à¥';  -- 0
--   SELECT count(*) FROM question_bank WHERE source = 'seed_rbse_commerce_v1';         -- 0
--   SELECT DISTINCT chapter FROM question_bank WHERE subject ILIKE 'hindi' AND chapter ILIKE '%आलो%';
-- =============================================================================

CREATE OR REPLACE FUNCTION public._repair_utf8_mojibake(t text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  s text := coalesce(t, '');
  repaired text;
  pass int := 0;
BEGIN
  IF s = '' THEN
    RETURN s;
  END IF;

  WHILE pass < 3 AND s ~ 'à¤|à¥|â€.|Ã.|Î.|Ï.|Â[°·¹²³½¼¾]|âˆ.' LOOP
    BEGIN
      repaired := convert_from(convert_to(s, 'WIN1252'), 'UTF8');
    EXCEPTION
      WHEN others THEN
        EXIT;
    END;
    IF repaired IS NULL OR repaired = '' OR repaired = s THEN
      EXIT;
    END IF;
    s := repaired;
    pass := pass + 1;
  END LOOP;

  RETURN s;
END;
$$;

COMMENT ON FUNCTION public._repair_utf8_mojibake(text) IS
  'Reverse UTF-8-as-WIN1252 mojibake (Devanagari, punctuation, Greek, âˆš). Safe no-op on clean UTF-8.';

UPDATE public.question_bank
SET
  chapter = public._repair_utf8_mojibake(chapter),
  topic = public._repair_utf8_mojibake(topic),
  concept = public._repair_utf8_mojibake(concept),
  question = public._repair_utf8_mojibake(question),
  explanation = public._repair_utf8_mojibake(explanation),
  updated_at = now()
WHERE
  (chapter IS NOT NULL AND chapter ~ 'à¤|à¥|â€.|Ã.|Î.|Ï.|Â[°·¹²³½¼¾]|âˆ.')
  OR (topic IS NOT NULL AND topic ~ 'à¤|à¥|â€.|Ã.|Î.|Ï.|Â[°·¹²³½¼¾]|âˆ.')
  OR (concept IS NOT NULL AND concept ~ 'à¤|à¥|â€.|Ã.|Î.|Ï.|Â[°·¹²³½¼¾]|âˆ.')
  OR (question IS NOT NULL AND question ~ 'à¤|à¥|â€.|Ã.|Î.|Ï.|Â[°·¹²³½¼¾]|âˆ.')
  OR (coalesce(explanation, '') ~ 'à¤|à¥|â€.|Ã.|Î.|Ï.|Â[°·¹²³½¼¾]|âˆ.');

UPDATE public.question_bank qb
SET
  options = (
    SELECT coalesce(jsonb_agg(
      CASE
        WHEN jsonb_typeof(elem) = 'string'
          THEN to_jsonb(public._repair_utf8_mojibake(elem #>> '{}'))
        ELSE elem
      END
    ), '[]'::jsonb)
    FROM jsonb_array_elements(coalesce(qb.options, '[]'::jsonb)) AS elem
  ),
  updated_at = now()
WHERE qb.options IS NOT NULL
  AND qb.options::text ~ 'à¤|à¥|â€.|Ã.|Î.|Ï.|Â[°·¹²³½¼¾]|âˆ.';

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'academic_taxonomy_terms'
  ) THEN
    EXECUTE $u$
      UPDATE public.academic_taxonomy_terms
      SET display_name = public._repair_utf8_mojibake(display_name)
      WHERE display_name ~ 'à¤|à¥|â€.|Ã.|Î.|Ï.|Â[°·¹²³½¼¾]|âˆ.'
    $u$;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'concept_mastery'
  ) THEN
    EXECUTE $u$
      UPDATE public.concept_mastery
      SET
        chapter = public._repair_utf8_mojibake(chapter),
        concept = public._repair_utf8_mojibake(concept),
        subject = public._repair_utf8_mojibake(subject)
      WHERE
        (chapter IS NOT NULL AND chapter ~ 'à¤|à¥|â€.|Ã.|Î.|Ï.|Â[°·¹²³½¼¾]|âˆ.')
        OR (concept IS NOT NULL AND concept ~ 'à¤|à¥|â€.|Ã.|Î.|Ï.|Â[°·¹²³½¼¾]|âˆ.')
        OR (subject IS NOT NULL AND subject ~ 'à¤|à¥|â€.|Ã.|Î.|Ï.|Â[°·¹²³½¼¾]|âˆ.')
    $u$;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'practice_sessions' AND column_name = 'chapter'
  ) THEN
    UPDATE public.practice_sessions
    SET chapter = public._repair_utf8_mojibake(chapter)
    WHERE chapter IS NOT NULL AND chapter ~ 'à¤|à¥|â€.|Ã.|Î.|Ï.|Â[°·¹²³½¼¾]|âˆ.';
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'student_mistakes'
  ) THEN
    EXECUTE $u$
      UPDATE public.student_mistakes
      SET
        chapter = CASE WHEN chapter IS NOT NULL THEN public._repair_utf8_mojibake(chapter) ELSE chapter END,
        topic = CASE WHEN topic IS NOT NULL THEN public._repair_utf8_mojibake(topic) ELSE topic END,
        concept = CASE WHEN concept IS NOT NULL THEN public._repair_utf8_mojibake(concept) ELSE concept END,
        question_text = CASE
          WHEN question_text IS NOT NULL THEN public._repair_utf8_mojibake(question_text)
          ELSE question_text
        END
      WHERE
        (chapter IS NOT NULL AND chapter ~ 'à¤|à¥|â€.|Ã.|Î.|Ï.|Â[°·¹²³½¼¾]|âˆ.')
        OR (topic IS NOT NULL AND topic ~ 'à¤|à¥|â€.|Ã.|Î.|Ï.|Â[°·¹²³½¼¾]|âˆ.')
        OR (concept IS NOT NULL AND concept ~ 'à¤|à¥|â€.|Ã.|Î.|Ï.|Â[°·¹²³½¼¾]|âˆ.')
        OR (question_text IS NOT NULL AND question_text ~ 'à¤|à¥|â€.|Ã.|Î.|Ï.|Â[°·¹²³½¼¾]|âˆ.')
    $u$;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'battles' AND column_name = 'chapter'
  ) THEN
    UPDATE public.battles
    SET chapter = public._repair_utf8_mojibake(chapter)
    WHERE chapter IS NOT NULL AND chapter ~ 'à¤|à¥|â€.|Ã.|Î.|Ï.|Â[°·¹²³½¼¾]|âˆ.';
  END IF;
END $$;
