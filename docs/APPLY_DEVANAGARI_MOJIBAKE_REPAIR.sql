-- APPLY: Devanagari / Hindi UTF-8 mojibake repair
-- Paste into Supabase Dashboard → SQL Editor → Run (UTF-8 client; do not re-import seeds via ANSI).
-- Safe / idempotent: only rows containing à¤ or à¥ are rewritten via WIN1252→UTF8 (LATIN1 fallback).
-- Prefer in-place UPDATE; does not delete questions.
--
-- Expected effect (project kdmjipeksjdyojjdokbi as of 2026-08-02):
--   ~40 Hindi question_bank rows / ~32 chapters: chapter/topic/concept/question/explanation/options
--   repaired to real Devanagari (e.g. à¤†à¤²à¥‹… → आलो आँधारि). Clean rows unchanged.
--
-- Verify after apply:
--   SELECT count(*) FROM question_bank WHERE subject = 'Hindi' AND (chapter ~ 'à¤|à¥' OR question ~ 'à¤|à¥');
--     -- expect 0
--   SELECT DISTINCT chapter FROM question_bank WHERE subject = 'Hindi' AND chapter ILIKE '%आलो%';
--     -- expect: आलो आँधारि (no à¤ variant)

CREATE OR REPLACE FUNCTION public._repair_cp1252_mojibake(t text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  s text := coalesce(t, '');
  out text;
BEGIN
  IF s = '' THEN
    RETURN s;
  END IF;

  IF s !~ 'à¤|à¥' THEN
    RETURN s;
  END IF;

  BEGIN
    -- WIN1252 first: recovers Devanagari when C1 bytes (0x80–0x9F) appear in mojibake
    out := convert_from(convert_to(s, 'WIN1252'), 'UTF8');
  EXCEPTION WHEN OTHERS THEN
    BEGIN
      out := convert_from(convert_to(s, 'LATIN1'), 'UTF8');
    EXCEPTION WHEN OTHERS THEN
      RETURN s;
    END;
  END;

  IF out IS NULL OR out = '' OR out ~ 'à¤|à¥' THEN
    RETURN s;
  END IF;

  RETURN out;
END;
$$;

COMMENT ON FUNCTION public._repair_cp1252_mojibake(text) IS
  'Repair UTF-8 Devanagari stored as Windows-1252/Latin-1 mojibake. Idempotent gate: requires à¤/à¥.';

UPDATE public.question_bank
SET
  chapter = CASE
    WHEN chapter IS NOT NULL AND chapter ~ 'à¤|à¥' THEN public._repair_cp1252_mojibake(chapter)
    ELSE chapter
  END,
  topic = CASE
    WHEN topic IS NOT NULL AND topic ~ 'à¤|à¥' THEN public._repair_cp1252_mojibake(topic)
    ELSE topic
  END,
  concept = CASE
    WHEN concept IS NOT NULL AND concept ~ 'à¤|à¥' THEN public._repair_cp1252_mojibake(concept)
    ELSE concept
  END,
  question = CASE
    WHEN question ~ 'à¤|à¥' THEN public._repair_cp1252_mojibake(question)
    ELSE question
  END,
  explanation = CASE
    WHEN explanation IS NOT NULL AND explanation ~ 'à¤|à¥' THEN public._repair_cp1252_mojibake(explanation)
    ELSE explanation
  END,
  updated_at = now()
WHERE
  (chapter IS NOT NULL AND chapter ~ 'à¤|à¥')
  OR (topic IS NOT NULL AND topic ~ 'à¤|à¥')
  OR (concept IS NOT NULL AND concept ~ 'à¤|à¥')
  OR (question ~ 'à¤|à¥')
  OR (coalesce(explanation, '') ~ 'à¤|à¥');

UPDATE public.question_bank qb
SET
  options = (
    SELECT coalesce(jsonb_agg(
      CASE
        WHEN jsonb_typeof(elem) = 'string' AND (elem #>> '{}') ~ 'à¤|à¥'
          THEN to_jsonb(public._repair_cp1252_mojibake(elem #>> '{}'))
        WHEN jsonb_typeof(elem) = 'object' THEN
          (
            SELECT jsonb_object_agg(
              key,
              CASE
                WHEN jsonb_typeof(value) = 'string' AND (value #>> '{}') ~ 'à¤|à¥'
                  THEN to_jsonb(public._repair_cp1252_mojibake(value #>> '{}'))
                ELSE value
              END
            )
            FROM jsonb_each(elem) AS e(key, value)
          )
        ELSE elem
      END
    ), '[]'::jsonb)
    FROM jsonb_array_elements(coalesce(qb.options, '[]'::jsonb)) AS elem
  ),
  updated_at = now()
WHERE qb.options IS NOT NULL
  AND qb.options::text ~ 'à¤|à¥';

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_proc WHERE proname = '_fix_academic_display_text'
  ) THEN
    UPDATE public.question_bank
    SET chapter = public._fix_academic_display_text(chapter)
    WHERE chapter IS NOT NULL
      AND chapter ~ '[‐‑‒–—―−]'
      AND chapter ~ '[\u0900-\u097F]';
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'practice_sessions' AND column_name = 'chapter'
  ) THEN
    UPDATE public.practice_sessions
    SET chapter = public._repair_cp1252_mojibake(chapter)
    WHERE chapter IS NOT NULL AND chapter ~ 'à¤|à¥';
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'concept_mastery' AND column_name = 'chapter'
  ) THEN
    UPDATE public.concept_mastery
    SET
      chapter = CASE WHEN chapter ~ 'à¤|à¥' THEN public._repair_cp1252_mojibake(chapter) ELSE chapter END,
      concept = CASE
        WHEN concept IS NOT NULL AND concept ~ 'à¤|à¥' THEN public._repair_cp1252_mojibake(concept)
        ELSE concept
      END
    WHERE
      (chapter IS NOT NULL AND chapter ~ 'à¤|à¥')
      OR (concept IS NOT NULL AND concept ~ 'à¤|à¥');
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'student_mistakes'
  ) THEN
    EXECUTE $u$
      UPDATE public.student_mistakes
      SET
        chapter = CASE WHEN chapter ~ 'à¤|à¥' THEN public._repair_cp1252_mojibake(chapter) ELSE chapter END,
        topic = CASE WHEN topic IS NOT NULL AND topic ~ 'à¤|à¥' THEN public._repair_cp1252_mojibake(topic) ELSE topic END,
        concept = CASE WHEN concept IS NOT NULL AND concept ~ 'à¤|à¥' THEN public._repair_cp1252_mojibake(concept) ELSE concept END,
        question_text = CASE
          WHEN question_text IS NOT NULL AND question_text ~ 'à¤|à¥'
            THEN public._repair_cp1252_mojibake(question_text)
          ELSE question_text
        END
      WHERE
        (chapter IS NOT NULL AND chapter ~ 'à¤|à¥')
        OR (topic IS NOT NULL AND topic ~ 'à¤|à¥')
        OR (concept IS NOT NULL AND concept ~ 'à¤|à¥')
        OR (question_text IS NOT NULL AND question_text ~ 'à¤|à¥')
    $u$;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'battles' AND column_name = 'chapter'
  ) THEN
    UPDATE public.battles
    SET chapter = public._repair_cp1252_mojibake(chapter)
    WHERE chapter IS NOT NULL AND chapter ~ 'à¤|à¥';
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'academic_taxonomy_terms'
  ) THEN
    UPDATE public.academic_taxonomy_terms
    SET
      display_name = public._repair_cp1252_mojibake(display_name),
      updated_at = now()
    WHERE display_name ~ 'à¤|à¥';
  END IF;
END $$;

-- Post-check (run separately if preferred)
-- SELECT count(*) AS still_mojibake FROM public.question_bank
--   WHERE subject = 'Hindi' AND (chapter ~ 'à¤|à¥' OR question ~ 'à¤|à¥' OR coalesce(options::text,'') ~ 'à¤|à¥');
-- SELECT DISTINCT chapter FROM public.question_bank WHERE subject = 'Hindi' AND chapter ILIKE '%आलो%';
