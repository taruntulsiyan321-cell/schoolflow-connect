-- Fix corrupted UTF-8 mojibake and normalize fancy dashes in academic display fields.
-- Concepts may remain as internal slugs; UI humanizes via academicDisplay helpers.
-- Chapters/topics should be display-friendly UTF-8 (ASCII hyphen preferred).

CREATE OR REPLACE FUNCTION public._fix_academic_display_text(t text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  s text := t;
BEGIN
  IF s IS NULL OR btrim(s) = '' THEN
    RETURN s;
  END IF;

  -- Common UTF-8-as-Windows-1252 mojibake sequences
  s := replace(s, 'â€”', '—');
  s := replace(s, 'â€“', '–');
  s := replace(s, 'â€˜', '''');
  s := replace(s, 'â€™', '''');
  s := replace(s, 'â€œ', '"');
  s := replace(s, 'â€', '"');
  s := replace(s, 'â€¦', '...');
  s := replace(s, 'Â·', '·');
  s := replace(s, 'Â', '');

  -- Unicode dashes → spaced ASCII hyphen
  s := regexp_replace(s, '\s*[‐‑‒–—―−]\s*', ' - ', 'g');
  s := regexp_replace(s, '[ \t\u00A0]+', ' ', 'g');
  s := btrim(s);

  RETURN s;
END;
$$;

-- question_bank
UPDATE public.question_bank
SET
  chapter = public._fix_academic_display_text(chapter),
  topic = public._fix_academic_display_text(topic)
WHERE
  (chapter IS NOT NULL AND (
    chapter LIKE '%â€%' OR chapter LIKE '%Â%' OR chapter ~ '[‐‑‒–—―−]'
  ))
  OR (topic IS NOT NULL AND (
    topic LIKE '%â€%' OR topic LIKE '%Â%' OR topic ~ '[‐‑‒–—―−]'
  ));

-- Prefer clean known chapter titles (idempotent)
UPDATE public.question_bank
SET chapter = 'Financial Statements - I'
WHERE chapter IS NOT NULL
  AND public._fix_academic_display_text(chapter) ILIKE 'Financial Statements - I';

UPDATE public.question_bank
SET chapter = 'Financial Statements - II'
WHERE chapter IS NOT NULL
  AND public._fix_academic_display_text(chapter) ILIKE 'Financial Statements - II';

-- concept_mastery
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'concept_mastery' AND column_name = 'chapter'
  ) THEN
    UPDATE public.concept_mastery
    SET chapter = public._fix_academic_display_text(chapter)
    WHERE chapter IS NOT NULL AND (
      chapter LIKE '%â€%' OR chapter LIKE '%Â%' OR chapter ~ '[‐‑‒–—―−]'
    );
  END IF;
END $$;

-- student_mistakes (if present)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'student_mistakes'
  ) THEN
    UPDATE public.student_mistakes
    SET
      chapter = CASE WHEN chapter IS NOT NULL THEN public._fix_academic_display_text(chapter) ELSE chapter END,
      topic = CASE WHEN topic IS NOT NULL THEN public._fix_academic_display_text(topic) ELSE topic END,
      concept = CASE
        WHEN concept IS NOT NULL AND (concept LIKE '%â€%' OR concept LIKE '%Â%' OR concept ~ '[‐‑‒–—―−]')
          THEN public._fix_academic_display_text(concept)
        ELSE concept
      END
    WHERE
      (chapter IS NOT NULL AND (chapter LIKE '%â€%' OR chapter LIKE '%Â%' OR chapter ~ '[‐‑‒–—―−]'))
      OR (topic IS NOT NULL AND (topic LIKE '%â€%' OR topic LIKE '%Â%' OR topic ~ '[‐‑‒–—―−]'))
      OR (concept IS NOT NULL AND (concept LIKE '%â€%' OR concept LIKE '%Â%' OR concept ~ '[‐‑‒–—―−]'));
  END IF;
END $$;

-- battles.chapter
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'battles' AND column_name = 'chapter'
  ) THEN
    UPDATE public.battles
    SET chapter = public._fix_academic_display_text(chapter)
    WHERE chapter IS NOT NULL AND (
      chapter LIKE '%â€%' OR chapter LIKE '%Â%' OR chapter ~ '[‐‑‒–—―−]'
    );
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'battles' AND column_name = 'topic'
  ) THEN
    UPDATE public.battles
    SET topic = public._fix_academic_display_text(topic)
    WHERE topic IS NOT NULL AND (
      topic LIKE '%â€%' OR topic LIKE '%Â%' OR topic ~ '[‐‑‒–—―−]'
    );
  END IF;
END $$;

-- recovery_assignments
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'recovery_assignments'
  ) THEN
    EXECUTE $u$
      UPDATE public.recovery_assignments
      SET
        chapter = CASE WHEN chapter IS NOT NULL THEN public._fix_academic_display_text(chapter) ELSE chapter END,
        concept = CASE
          WHEN concept IS NOT NULL AND (concept LIKE '%â€%' OR concept LIKE '%Â%' OR concept ~ '[‐‑‒–—―−]')
            THEN public._fix_academic_display_text(concept)
          ELSE concept
        END
      WHERE
        (chapter IS NOT NULL AND (chapter LIKE '%â€%' OR chapter LIKE '%Â%' OR chapter ~ '[‐‑‒–—―−]'))
        OR (concept IS NOT NULL AND (concept LIKE '%â€%' OR concept LIKE '%Â%' OR concept ~ '[‐‑‒–—―−]'))
    $u$;
  END IF;
END $$;

-- practice_sessions chapter labels
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'practice_sessions' AND column_name = 'chapter'
  ) THEN
    UPDATE public.practice_sessions
    SET chapter = public._fix_academic_display_text(chapter)
    WHERE chapter IS NOT NULL AND (
      chapter LIKE '%â€%' OR chapter LIKE '%Â%' OR chapter ~ '[‐‑‒–—―−]'
    );
  END IF;
END $$;
