-- =============================================================================
-- APPLY_HINDI_CHAPTER_MOJIBAKE_REPAIR.sql
-- Paste into Supabase SQL Editor as UTF-8. Idempotent.
--
-- ROOT CAUSE (Practice → Hindi → CHAPTER chips, 2026-08-03):
--   seed_rbse_commerce_v1 stored UTF-8 Devanagari as CP1252/Latin-1 mojibake (à¤… / à¥…).
--   Screenshot OCR of those chips looks like `äèµ` / `äèµ¾¥` (same class, NOT new encoding).
--   Clean full_v1 rows (कबीर के पद, व्याकरण - काल) coexist → duplicate chips.
--
-- PG GAP vs APPLY_UTF8_MOJIBAKE_REPAIR:
--   Chapters with virama/chandrabindu (व्याकरण, आलो आँधारि) produce MIXED mojibake:
--     CP1252 specials (U+2022 •, U+2020 †, …) AND C1 controls (U+008D / U+0081).
--   convert_to(WIN1252) fails on C1; convert_to(LATIN1) fails on •/† → repair no-oped.
--
-- FIX:
--   1) Normalize CP1252 glyphs → U+00xx, then LATIN1→UTF8 (mirrors JS repairUtf8Mojibake).
--   2) UPDATE question_bank (+ related) in place.
--   3) Align Hindi chapter labels to academic_taxonomy_terms.display_name when matched.
--   4) Normalize em/en dashes so clean + corrupt siblings collapse.
--
-- Verify:
--   SELECT count(*) FROM question_bank WHERE chapter ~ 'à¤|à¥';  -- expect 0
--   SELECT DISTINCT chapter FROM question_bank
--     WHERE subject ILIKE 'Hindi' ORDER BY 1;
-- =============================================================================

CREATE OR REPLACE FUNCTION public._normalize_cp1252_mojibake_to_latin1(t text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  s text := coalesce(t, '');
BEGIN
  IF s = '' THEN RETURN s; END IF;
  -- Map CP1252 Unicode glyphs back to the byte value as a Latin-1 codepoint.
  -- Enables LATIN1→UTF8 even when C1 controls (U+0081/U+008D/…) are also present.
  s := replace(s, U&'\20AC', CHR(128)); -- €
  s := replace(s, U&'\201A', CHR(130)); -- ‚
  s := replace(s, U&'\0192', CHR(131)); -- ƒ
  s := replace(s, U&'\201E', CHR(132)); -- „
  s := replace(s, U&'\2026', CHR(133)); -- …
  s := replace(s, U&'\2020', CHR(134)); -- †
  s := replace(s, U&'\2021', CHR(135)); -- ‡
  s := replace(s, U&'\02C6', CHR(136)); -- ˆ
  s := replace(s, U&'\2030', CHR(137)); -- ‰
  s := replace(s, U&'\0160', CHR(138)); -- Š
  s := replace(s, U&'\2039', CHR(139)); -- ‹
  s := replace(s, U&'\0152', CHR(140)); -- Œ
  s := replace(s, U&'\017D', CHR(142)); -- Ž
  s := replace(s, U&'\2018', CHR(145)); -- ‘
  s := replace(s, U&'\2019', CHR(146)); -- ’
  s := replace(s, U&'\201C', CHR(147)); -- “
  s := replace(s, U&'\201D', CHR(148)); -- ”
  s := replace(s, U&'\2022', CHR(149)); -- •
  s := replace(s, U&'\2013', CHR(150)); -- –
  s := replace(s, U&'\2014', CHR(151)); -- —
  s := replace(s, U&'\02DC', CHR(152)); -- ˜
  s := replace(s, U&'\2122', CHR(153)); -- ™
  s := replace(s, U&'\0161', CHR(154)); -- š
  s := replace(s, U&'\203A', CHR(155)); -- ›
  s := replace(s, U&'\0153', CHR(156)); -- œ
  s := replace(s, U&'\017E', CHR(158)); -- ž
  s := replace(s, U&'\0178', CHR(159)); -- Ÿ
  RETURN s;
END;
$$;

CREATE OR REPLACE FUNCTION public._repair_utf8_mojibake(t text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  s text := coalesce(t, '');
  normalized text;
  repaired text;
  candidate text;
BEGIN
  IF s = '' THEN RETURN s; END IF;
  IF s !~ 'à¤|à¥|â€|Ã.|Î.|Ï.|Â[°·¹²³½¼¾]|âˆ.' THEN RETURN s; END IF;

  repaired := NULL;

  -- Path A (preferred): normalize mixed CP1252+C1 → LATIN1 → UTF8
  BEGIN
    normalized := public._normalize_cp1252_mojibake_to_latin1(s);
    candidate := convert_from(convert_to(normalized, 'LATIN1'), 'UTF8');
    IF candidate IS NOT NULL AND candidate <> '' AND candidate <> s AND candidate !~ 'à¤|à¥' THEN
      repaired := candidate;
    END IF;
  EXCEPTION WHEN others THEN
    repaired := NULL;
  END;

  -- Path B: classic WIN1252
  IF repaired IS NULL THEN
    BEGIN
      candidate := convert_from(convert_to(s, 'WIN1252'), 'UTF8');
      IF candidate IS NOT NULL AND candidate <> '' AND candidate <> s AND candidate !~ 'à¤|à¥' THEN
        repaired := candidate;
      END IF;
    EXCEPTION WHEN others THEN
      repaired := NULL;
    END;
  END IF;

  -- Path C: raw LATIN1 (pure C1-control mojibake, no CP1252 specials)
  IF repaired IS NULL THEN
    BEGIN
      candidate := convert_from(convert_to(s, 'LATIN1'), 'UTF8');
      IF candidate IS NOT NULL AND candidate <> '' AND candidate <> s AND candidate !~ 'à¤|à¥' THEN
        repaired := candidate;
      END IF;
    EXCEPTION WHEN others THEN
      repaired := NULL;
    END;
  END IF;

  IF repaired IS NULL THEN
    RETURN s;
  END IF;
  RETURN repaired;
END;
$$;

COMMENT ON FUNCTION public._repair_utf8_mojibake(text) IS
  'UTF-8-as-CP1252/Latin-1 reverse incl. mixed C1+CP1252 Hindi (व्याकरण). Idempotent.';

COMMENT ON FUNCTION public._normalize_cp1252_mojibake_to_latin1(text) IS
  'Map CP1252 glyphs to U+00xx so LATIN1→UTF8 works alongside C1 controls.';

-- Match key for chapter dedupe (normalize dashes / whitespace; keep Devanagari)
CREATE OR REPLACE FUNCTION public._academic_label_match_key(t text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT lower(trim(regexp_replace(
    regexp_replace(
      coalesce(public._repair_utf8_mojibake(t), ''),
      '[—–−‐‑‒―\-]+',
      ' ',
      'g'
    ),
    '\s+',
    ' ',
    'g'
  )));
$$;

-- ---------------------------------------------------------------------------
-- 1) In-place structural repair on question_bank
-- ---------------------------------------------------------------------------
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

-- ---------------------------------------------------------------------------
-- 2) Align Hindi chapters to taxonomy canonical display_name (prefer clean twin)
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'academic_taxonomy_terms'
  ) THEN
    UPDATE public.question_bank qb
    SET
      chapter = t.display_name,
      updated_at = now()
    FROM public.academic_taxonomy_terms t
    WHERE t.kind = 'chapter'
      AND t.subject ILIKE 'Hindi'
      AND qb.subject ILIKE 'Hindi'
      AND qb.chapter IS NOT NULL
      AND t.class_level IS NOT NULL
      AND qb.class_level = t.class_level
      AND public._academic_label_match_key(qb.chapter)
          = public._academic_label_match_key(t.display_name)
      AND qb.chapter IS DISTINCT FROM t.display_name;

    -- Also repair taxonomy display_name if any still corrupt
    UPDATE public.academic_taxonomy_terms
    SET display_name = public._repair_utf8_mojibake(display_name),
        updated_at = now()
    WHERE display_name ~ 'à¤|à¥|â€|Ã.|Î.|Ï.|Â[°·¹²³½¼¾]|âˆ.';
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 3) Collapse em/en dash variants among Hindi chapters to ASCII " - "
--     (taxonomy uses "व्याकरण - काल"; seed_v1 used "व्याकरण — संधि")
-- ---------------------------------------------------------------------------
UPDATE public.question_bank
SET
  chapter = trim(both FROM regexp_replace(
    regexp_replace(chapter, '[\u2010-\u2015\u2212\uFE58\uFE63\uFF0D]', '-', 'g'),
    '\s*-\s*',
    ' - ',
    'g'
  )),
  updated_at = now()
WHERE subject ILIKE 'Hindi'
  AND chapter IS NOT NULL
  AND chapter ~ '[\u2010-\u2015\u2212\uFE58\uFE63\uFF0D]';

-- Prefer an already-clean sibling chapter string within the same class when keys match
UPDATE public.question_bank qb
SET
  chapter = clean.chapter,
  updated_at = now()
FROM (
  SELECT DISTINCT ON (class_level, public._academic_label_match_key(chapter))
    class_level,
    public._academic_label_match_key(chapter) AS k,
    chapter
  FROM public.question_bank
  WHERE subject ILIKE 'Hindi'
    AND chapter IS NOT NULL
    AND chapter !~ 'à¤|à¥'
    AND chapter ~ '[\u0900-\u097F]'
  ORDER BY class_level, public._academic_label_match_key(chapter), length(chapter) DESC, chapter
) clean
WHERE qb.subject ILIKE 'Hindi'
  AND qb.chapter IS NOT NULL
  AND qb.class_level = clean.class_level
  AND public._academic_label_match_key(qb.chapter) = clean.k
  AND qb.chapter IS DISTINCT FROM clean.chapter;

-- ---------------------------------------------------------------------------
-- 4) Related tables
-- ---------------------------------------------------------------------------
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

-- ---------------------------------------------------------------------------
-- 5) Sanity notices
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  leftover int;
  hindi_chapters int;
BEGIN
  SELECT count(*) INTO leftover FROM public.question_bank WHERE coalesce(chapter, '') ~ 'à¤|à¥';
  SELECT count(DISTINCT chapter) INTO hindi_chapters
  FROM public.question_bank WHERE subject ILIKE 'Hindi' AND chapter IS NOT NULL;
  RAISE NOTICE 'Hindi chapter mojibake leftover (chapter ~ à¤|à¥): %', leftover;
  RAISE NOTICE 'Distinct Hindi chapters after repair: %', hindi_chapters;
END $$;
