-- Practice Engine SSOT hardening (encoding + history search + finish guard notes)
-- Apply after APPLY_ACADEMIC_PROGRESSION_ENGINE.sql and APPLY_SAVED_PRACTICE_SESSIONS.sql
-- (saved-sessions APPLY must NOT redefine rpc_finish_practice_session).

-- ---------------------------------------------------------------------------
-- 1) Root UTF-8 content repair for question stems / options / explanations
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._fix_utf8_content(t text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  s text := coalesce(t, '');
BEGIN
  IF s = '' THEN RETURN s; END IF;

  -- Common UTF-8-as-Latin1 punctuation
  s := replace(s, 'â€”', E'\u2014');
  s := replace(s, 'â€“', E'\u2013');
  s := replace(s, 'â€˜', E'\u2018');
  s := replace(s, 'â€™', E'\u2019');
  s := replace(s, 'â€œ', E'\u201C');
  s := replace(s, 'â€', E'\u201D');
  s := replace(s, 'â€¦', E'\u2026');
  s := replace(s, 'â€¢', E'\u2022');
  s := replace(s, 'Â·', E'\u00B7');
  s := replace(s, 'Â°', E'\u00B0');

  -- Math operators / relations / Greek (preserve Unicode — do not ASCII-strip)
  s := replace(s, 'Ã—', E'\u00D7');
  s := replace(s, 'Ã·', E'\u00F7');
  s := replace(s, 'Â±', E'\u00B1');
  s := replace(s, 'â‰¤', E'\u2264');
  s := replace(s, 'â‰¥', E'\u2265');
  s := replace(s, 'â‰ ', E'\u2260');
  s := replace(s, 'âˆž', E'\u221E');
  s := replace(s, 'âˆš', E'\u221A');
  s := replace(s, 'âˆ’', E'\u2212');
  s := replace(s, 'Ï€', E'\u03C0');
  s := replace(s, 'Î¸', E'\u03B8');
  s := replace(s, 'Î±', E'\u03B1');
  s := replace(s, 'Î²', E'\u03B2');
  s := replace(s, 'Î£', E'\u03A3');
  s := replace(s, 'Â½', E'\u00BD');
  s := replace(s, 'Â¼', E'\u00BC');
  s := replace(s, 'Â¾', E'\u00BE');
  s := replace(s, 'Â²', E'\u00B2');
  s := replace(s, 'Â³', E'\u00B3');

  -- Orphan soft hyphen / nbsp collapse
  s := replace(s, E'\u00AD', '');
  s := regexp_replace(s, '[ \t' || E'\u00A0' || ']+', ' ', 'g');
  RETURN btrim(s);
END;
$$;

COMMENT ON FUNCTION public._fix_utf8_content(text) IS
  'Root encoding repair for QB / attempt text. Preserves math Unicode (π θ √ …).';

-- Live DBs may predate updated_at on question_bank (types/schema historically omit it).
ALTER TABLE public.question_bank
  ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();

-- Best-effort repair on question_bank (idempotent; only rows that still look mojibaked)
UPDATE public.question_bank
SET
  question = public._fix_utf8_content(question),
  explanation = public._fix_utf8_content(explanation),
  updated_at = now()
WHERE question ~ 'â€|Ã—|Ï€|Î¸|Î±|Â½|âˆš|â‰¤|â‰¥'
   OR coalesce(explanation, '') ~ 'â€|Ã—|Ï€|Î¸|Î±|Â½|âˆš|â‰¤|â‰¥';

-- Options jsonb: repair string elements when present
UPDATE public.question_bank qb
SET
  options = (
    SELECT coalesce(jsonb_agg(
      CASE
        WHEN jsonb_typeof(elem) = 'string'
          THEN to_jsonb(public._fix_utf8_content(elem #>> '{}'))
        ELSE elem
      END
    ), '[]'::jsonb)
    FROM jsonb_array_elements(coalesce(qb.options, '[]'::jsonb)) AS elem
  ),
  updated_at = now()
WHERE qb.options IS NOT NULL
  AND qb.options::text ~ 'â€|Ã—|Ï€|Î¸|Î±|Â½|âˆš|â‰¤|â‰¥';

-- ---------------------------------------------------------------------------
-- 2) Practice history search RPC (server-side, beyond client 50-row window)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.rpc_list_practice_history(
  _limit int DEFAULT 100,
  _subject text DEFAULT NULL,
  _practice_mode text DEFAULT NULL,
  _date_from timestamptz DEFAULT NULL,
  _date_to timestamptz DEFAULT NULL,
  _search text DEFAULT NULL,
  _sort text DEFAULT 'finished_at_desc'
)
RETURNS SETOF public.practice_sessions
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
  _q text := lower(nullif(btrim(coalesce(_search, '')), ''));
  _lim int := least(greatest(coalesce(_limit, 100), 1), 200);
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'auth required';
  END IF;

  RETURN QUERY
  SELECT ps.*
  FROM public.practice_sessions ps
  WHERE ps.user_id = _uid
    AND ps.finished_at IS NOT NULL
    AND (_subject IS NULL OR btrim(_subject) = '' OR ps.subject ILIKE btrim(_subject))
    AND (_practice_mode IS NULL OR btrim(_practice_mode) = '' OR ps.practice_mode = btrim(_practice_mode))
    AND (_date_from IS NULL OR ps.finished_at >= _date_from)
    AND (_date_to IS NULL OR ps.finished_at <= _date_to)
    AND (
      _q IS NULL
      OR lower(coalesce(ps.subject, '')) LIKE '%' || _q || '%'
      OR lower(coalesce(ps.chapter, '')) LIKE '%' || _q || '%'
      OR lower(coalesce(ps.practice_mode, '')) LIKE '%' || _q || '%'
      OR lower(coalesce(ps.difficulty, '')) LIKE '%' || _q || '%'
    )
  ORDER BY
    CASE WHEN _sort = 'accuracy_desc' THEN ps.accuracy END DESC NULLS LAST,
    CASE WHEN _sort = 'accuracy_asc' THEN ps.accuracy END ASC NULLS LAST,
    CASE WHEN _sort = 'xp_desc' THEN ps.xp_earned END DESC NULLS LAST,
    CASE WHEN _sort = 'xp_asc' THEN ps.xp_earned END ASC NULLS LAST,
    ps.finished_at DESC NULLS LAST
  LIMIT _lim;
END;
$$;

GRANT EXECUTE ON FUNCTION public.rpc_list_practice_history(int, text, text, timestamptz, timestamptz, text, text)
  TO authenticated;

COMMENT ON FUNCTION public.rpc_list_practice_history IS
  'SSOT practice history with server-side filter/search/sort. UI must display accuracy/xp_earned columns as-is.';

-- ---------------------------------------------------------------------------
-- 3) Guard note: finish must stay Progression-wired
-- ---------------------------------------------------------------------------
-- If rpc_finish_practice_session was overwritten by an older APPLY (correct×10,
-- no rpc_apply_progression), re-run docs/APPLY_ACADEMIC_PROGRESSION_ENGINE.sql.
-- Do not redefine finish in APPLY_SAVED_PRACTICE_SESSIONS.sql.
