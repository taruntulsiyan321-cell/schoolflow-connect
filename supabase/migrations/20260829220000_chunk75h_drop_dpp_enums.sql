-- ═══════════════════════════════════════════════════════════════════════════
-- CHUNK 7.5h — the two enum TYPES the table drop left behind
--
--   dpp_attempt_status  (in_progress, submitted)
--   dpp_question_kind   (mcq, multi, numerical, short)
--
-- Dropping a table does not drop the enum types its columns used, so these
-- survived 7.5g and were the last four `dpp` strings in the generated
-- TypeScript. Found by verification item 4 — "zero references to dpp anywhere"
-- includes generated types, and the count went to 0/0/0/0/0 on every DB
-- surface while the client types still said dpp four times.
--
-- Confirmed unused by any column first: the new test_attempts.status and
-- test_questions are plain text with CHECK constraints, so nothing depends on
-- these types. DROP TYPE fails loudly if that stops being true, which is why
-- it is not IF EXISTS-and-hope.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

DO $guard$
DECLARE _bad text;
BEGIN
  SELECT string_agg(c.relname || '.' || a.attname, ', ') INTO _bad
    FROM pg_attribute a
    JOIN pg_class c ON c.oid = a.attrelid
    JOIN pg_type  t ON t.oid = a.atttypid
   WHERE t.typname IN ('dpp_attempt_status', 'dpp_question_kind')
     AND a.attnum > 0 AND NOT a.attisdropped;
  IF _bad IS NOT NULL THEN
    RAISE EXCEPTION 'refusing to drop: these columns still use a DPP enum type: %', _bad;
  END IF;
END
$guard$;

DROP TYPE IF EXISTS public.dpp_attempt_status;
DROP TYPE IF EXISTS public.dpp_question_kind;

DO $assert$
DECLARE _n int;
BEGIN
  SELECT count(*)::int INTO _n
    FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
   WHERE n.nspname = 'public' AND t.typname ILIKE '%dpp%';
  IF _n > 0 THEN RAISE EXCEPTION '% dpp type(s) survived', _n; END IF;
END
$assert$;

COMMIT;
