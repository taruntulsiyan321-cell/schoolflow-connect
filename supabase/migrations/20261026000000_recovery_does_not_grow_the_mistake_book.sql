-- ════════════════════════════════════════════════════════════════════════════
-- RECOVERY DOES NOT GROW THE MISTAKE BOOK
-- ════════════════════════════════════════════════════════════════════════════
--
-- §4.6, in the spec's own words:
--
--   "The mistake book never grows through recovery.
--    · Every question the student got wrong is ALREADY in the book.
--    · Getting one wrong again does not add a row — it bumps times_wrong.
--    · The count can only fall or stay level. A student who opens recovery
--      with 6 mistakes and has a bad session still has 6. If it doubled, they
--      would stop opening recovery."
--
-- MEASURED, SITTING A REAL RECOVERY SESSION, 2026-09-16
--
--   open mistakes before the session    6
--   open mistakes after                10
--   rows added                          4, every one on a GENERATED VARIANT
--
-- It doubled in the direction the spec names, and worse: 10 is above
-- RECOVERY_WIDE_MAX_MISTAKES, so the chapter went straight into `relearn`.
-- Failing one recovery round now bans the student from recovery on that
-- chapter — the opposite of §4.6, which has rounds 2, 3 and 4+ continuing
-- indefinitely.
--
-- WHY IT HAPPENS
--
-- rpc_record_question_attempt records a mistake for every wrong answer, in
-- every mode. In ordinary practice that is right. In a recovery session the
-- questions are the §4.2 ladder: tier 0 is the student's own originals, but
-- tiers 1-3 are VARIANTS the generator wrote, which the student has never seen
-- and which are not in their book. Getting one wrong inserts a brand-new row,
-- so the ladder built to fix six mistakes manufactures more of them.
--
-- THE FIX, AS NARROW AS THE RULE
--
-- In a recovery session a wrong answer may still BUMP a row that already
-- exists — that is the times_wrong sentence above, and it is how a repeated
-- tier-0 miss is recorded — but it may not CREATE one. So the call is made
-- only when the question is already in this student's book.
--
-- Revision is deliberately NOT included: §5.5 says a failed check's "newly
-- wrong questions enter the mistake book as NEW entries", which is the
-- opposite rule for the opposite reason, and it still applies.
--
-- THE ROWS ALREADY WRITTEN
--
-- 7 rows across 2 students were created by a recovery session (6 on generated
-- variants). They are rows the spec says should never have existed, and they
-- are what is holding one chapter above the relearn boundary, so they are
-- removed. Rows recovery only BUMPED are untouched: source_id records the
-- session that created a row, not one that updated it.
--
-- ROLLBACK: supabase/migrations/rollback/20261026000000_down.sql
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

DO $rewrite$
DECLARE _def text; _new text;
BEGIN
  SELECT replace(pg_get_functiondef(p.oid), E'\r\n', E'\n') INTO _def
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.prokind = 'f'
     AND p.proname = 'rpc_record_question_attempt';
  IF _def IS NULL THEN RAISE EXCEPTION 'rpc_record_question_attempt not found'; END IF;
  IF position(E'\r' IN _def) > 0 THEN
    RAISE EXCEPTION 'a carriage return survived normalisation';
  END IF;

  _new := replace(_def,
    '    PERFORM public.rpc_record_concept_mistake(
      ''practice'', _session_id, _bank_id,',
    '    -- §4.6: recovery may bump a row, never add one. Tiers 1-3 are
    -- generated variants the student has never seen, so recording them the
    -- ordinary way manufactured new mistakes out of the session built to fix
    -- the old ones — 6 open became 10, which is above the relearn boundary.
    -- Revision is not exempt: §5.5 gives it the opposite rule on purpose.
    IF COALESCE(_practice_mode, '''') <> ''recovery''
       OR EXISTS (
         SELECT 1 FROM public.student_mistakes sm
          WHERE sm.user_id = _uid
            AND sm.source = ''practice''
            AND sm.question_id IS NOT DISTINCT FROM _bank_id
            AND _bank_id IS NOT NULL)
    THEN
    PERFORM public.rpc_record_concept_mistake(
      ''practice'', _session_id, _bank_id,');

  IF _new = _def THEN
    RAISE EXCEPTION 'the mistake-call anchor matched nothing — the substitution would have failed open';
  END IF;

  -- Close the IF that was just opened, on the statement's own terminator.
  _new := replace(_new,
    '      _resolved_correct_answer,
      _explanation
    );
  END IF;',
    '      _resolved_correct_answer,
      _explanation
    );
    END IF;
  END IF;');

  EXECUTE _new;
END $rewrite$;

DO $check$
DECLARE _def text;
BEGIN
  SELECT replace(pg_get_functiondef(p.oid), E'\r\n', E'\n') INTO _def
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='public' AND p.proname='rpc_record_question_attempt';
  IF position('<> ''recovery''' IN _def) = 0 THEN
    RAISE EXCEPTION 'the recovery guard is not in the live body';
  END IF;
END $check$;

-- Rows a recovery session created. source_id is set on INSERT only, so this
-- cannot touch a row that recovery merely bumped.
DELETE FROM public.student_mistakes sm
 USING public.practice_sessions ps
 WHERE ps.id = sm.source_id
   AND sm.source = 'practice'
   AND ps.practice_mode = 'recovery';

COMMIT;
