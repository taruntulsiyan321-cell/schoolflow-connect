-- ═══════════════════════════════════════════════════════════════════════════
-- CHUNK 7.5g — the four DPP tables, last
--
-- 7.5's ordering exists for this moment: repoint, then functions, then tables.
-- By here nothing reads them — 0 function bodies, 0 columns, 0 constraints,
-- 0 badge rows and 0 client references name dpp, and the Tests feature has
-- been running on tests/test_* since 7.5b.
--
-- Preconditions are re-asserted below rather than trusted. A DROP is the one
-- step in this chunk that cannot be undone by re-running something.
--
-- Data being destroyed, counted before the fact: 2 dpps, 2 dpp_questions,
-- 4 dpp_attempts, 2 dpp_answers. Both dpp_answers rows are is_correct = true,
-- so nothing is owed to the mistake book — that was precondition 2, confirmed
-- at the start of 7.5 and re-confirmed here.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

DO $preconditions$
DECLARE _n int; _bad text;
BEGIN
  -- 1. Nothing in the database still references them.
  SELECT string_agg(p.proname, ', ') INTO _bad
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.prokind = 'f'
     AND pg_get_functiondef(p.oid) ~* 'dpp';
  IF _bad IS NOT NULL THEN
    RAISE EXCEPTION 'refusing to drop: these functions still reference dpp: %', _bad;
  END IF;

  -- 2. No foreign key points INTO a DPP table from outside it. This is the one
  --    that would cascade a row away silently.
  SELECT string_agg(c.conrelid::regclass::text || '.' || c.conname, ', ') INTO _bad
    FROM pg_constraint c
    JOIN pg_class t  ON t.oid  = c.confrelid
    JOIN pg_class ft ON ft.oid = c.conrelid
   WHERE c.contype = 'f' AND t.relname LIKE 'dpp%' AND ft.relname NOT LIKE 'dpp%';
  IF _bad IS NOT NULL THEN
    RAISE EXCEPTION 'refusing to drop: these foreign keys point into a DPP table: %', _bad;
  END IF;

  -- 3. Precondition 2 from the top of 7.5, re-confirmed at the moment it
  --    actually matters: no wrong answer is about to be destroyed unrecorded.
  SELECT count(*)::int INTO _n FROM public.dpp_answers WHERE is_correct IS DISTINCT FROM true;
  IF _n > 0 THEN
    RAISE EXCEPTION 'refusing to drop: % dpp_answers row(s) are wrong or ungraded and belong in student_mistakes first', _n;
  END IF;

  RAISE NOTICE 'dropping % dpps, % dpp_questions, % dpp_attempts, % dpp_answers',
    (SELECT count(*) FROM public.dpps),
    (SELECT count(*) FROM public.dpp_questions),
    (SELECT count(*) FROM public.dpp_attempts),
    (SELECT count(*) FROM public.dpp_answers);
END
$preconditions$;

-- Child-first, so a missing CASCADE surfaces as an error rather than silently
-- taking something with it.
DROP TABLE IF EXISTS public.dpp_answers;
DROP TABLE IF EXISTS public.dpp_attempts;
DROP TABLE IF EXISTS public.dpp_questions;
DROP TABLE IF EXISTS public.dpps;

DO $assert$
DECLARE _n int;
BEGIN
  SELECT count(*)::int INTO _n
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public' AND c.relname LIKE 'dpp%';
  IF _n > 0 THEN RAISE EXCEPTION '% dpp table(s) survived the drop', _n; END IF;
END
$assert$;

COMMIT;
