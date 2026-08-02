-- Repair Devanagari UTF-8-as-Windows-1252/Latin-1 mojibake in academic text.
-- Proven root cause: UTF-8 Devanagari bytes were misdecoded as WIN1252/Latin-1
-- and stored as those Unicode codepoints (e.g. आलो → à¤†à¤²à¥‹).
-- Repo seeds are clean UTF-8; live question_bank still has ~40 Hindi rows with à¤/à¥.
-- Idempotent: only rows matching à¤|à¥ are rewritten. Prefer UPDATE in place (no deletes).

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

  -- Classic Devanagari UTF-8 bytes misread as Windows-1252 / Latin-1
  IF s !~ 'à¤|à¥' THEN
    RETURN s;
  END IF;

  BEGIN
    -- WIN1252 required: C1 range (0x80–0x9F) became † ‹ € etc., not ISO-8859-1 controls
    -- (e.g. anusvara byte 0x81 → U+0081 / CP1252 map). LATIN1 alone fails on those.
    out := convert_from(convert_to(s, 'WIN1252'), 'UTF8');
  EXCEPTION WHEN OTHERS THEN
    BEGIN
      out := convert_from(convert_to(s, 'LATIN1'), 'UTF8');
    EXCEPTION WHEN OTHERS THEN
      RETURN s;
    END;
  END;

  -- Reject obvious failed repairs (still look mojibaked, or empty)
  IF out IS NULL OR out = '' OR out ~ 'à¤|à¥' THEN
    RETURN s;
  END IF;

  RETURN out;
END;
$$;

COMMENT ON FUNCTION public._repair_cp1252_mojibake(text) IS
  'Repair UTF-8 Devanagari stored as Windows-1252/Latin-1 mojibake. Idempotent gate: requires à¤/à¥.';

-- question_bank text columns
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

-- options jsonb: string elements, or object.text / object.label
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

-- Normalize fancy dashes on repaired Devanagari chapter titles (optional / safe)
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

-- Downstream copies of chapter labels (best-effort)
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

-- Taxonomy should already be clean; repair only if somehow corrupted
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
