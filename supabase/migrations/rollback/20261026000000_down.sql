-- Rollback for 20261026000000_recovery_does_not_grow_the_mistake_book.sql
--
-- Removes the §4.6 guard, so a wrong answer in a recovery session records a
-- mistake again in every mode.
--
-- What this re-introduces: the §4.2 ladder manufactures mistakes. Tiers 1-3
-- are generated variants the student has never seen, so getting one wrong
-- inserts a new row. Measured: 6 open mistakes before a session, 10 after —
-- past RECOVERY_WIDE_MAX_MISTAKES, which puts the chapter in `relearn` and
-- bans it from the recovery that was meant to fix it.
--
-- The 7 deleted rows are not restored: they are rows §4.6 says should never
-- have been written.

BEGIN;

DO $rewrite$
DECLARE _def text; _new text;
BEGIN
  SELECT replace(pg_get_functiondef(p.oid), E'\r\n', E'\n') INTO _def
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname='public' AND p.prokind='f'
     AND p.proname='rpc_record_question_attempt';

  _new := replace(_def,
    '    IF COALESCE(_practice_mode, '''') <> ''recovery''
       OR EXISTS (
         SELECT 1 FROM public.student_mistakes sm
          WHERE sm.user_id = _uid
            AND sm.source = ''practice''
            AND sm.question_id IS NOT DISTINCT FROM _bank_id
            AND _bank_id IS NOT NULL)
    THEN
    PERFORM public.rpc_record_concept_mistake(',
    '    PERFORM public.rpc_record_concept_mistake(');

  IF _new = _def THEN RAISE EXCEPTION 'guard anchor matched nothing'; END IF;

  _new := replace(_new,
    '      _resolved_correct_answer,
      _explanation
    );
    END IF;
  END IF;',
    '      _resolved_correct_answer,
      _explanation
    );
  END IF;');

  EXECUTE _new;
END $rewrite$;

COMMIT;
