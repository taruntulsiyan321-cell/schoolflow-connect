-- ═══════════════════════════════════════════════════════════════════════════
-- ROLLBACK — test_marks returns to ON DELETE CASCADE, tests returns to the purge
--
-- ⚠ THIS RESTORES A LIVE DATA-LOSS PATH. READ BEFORE RUNNING.
--
-- After this, deleting a test destroys its marks again — and that is not a
-- hypothetical purge job, it is the teacher's "Delete" button
-- (TestService.remove → LiveClassPanels.tsx:1752), which hard-deletes. All 72
-- live tests have marks; 2,520 test_marks rows go back to depending on nobody
-- pressing it.
--
-- It also puts `tests` back into rpc_purge_expired. That branch is unreachable
-- while nothing sets tests.deleted_at, so it does nothing today — which is
-- precisely why restoring it is worse than it looks: it reads as coverage and
-- would begin destroying marks the day a soft delete is added.
--
-- Run this ONLY to unblock something RESTRICT broke, and put it back in the
-- same session. The likely reason to reach for it — "teachers cannot delete
-- tests any more" — is the constraint working, not failing. Fix that in the
-- application layer instead: TestService.remove already catches 23503 and
-- explains it.
--
-- `npm run verify:caller-privileges` goes red immediately: the assertion
-- "180000 delete test WITH marks" expects a refusal and will observe a
-- successful delete. Run the harness after rolling back so the regression is
-- recorded rather than discovered.
--
-- No data is changed either way; this is a constraint and a function body.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

ALTER TABLE public.test_marks DROP CONSTRAINT IF EXISTS test_marks_test_fk;

ALTER TABLE public.test_marks
  ADD CONSTRAINT test_marks_test_fk
  FOREIGN KEY (test_id, school_id)
  REFERENCES public.tests (id, school_id)
  ON DELETE CASCADE;

CREATE OR REPLACE FUNCTION public.rpc_purge_expired()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _tests int; _homework int; _students int; _teachers int;
BEGIN
  IF auth.uid() IS NOT NULL THEN
    RAISE EXCEPTION
      'rpc_purge_expired is a platform maintenance job; it has no per-user caller and deletes across institutions by design';
  END IF;

  WITH gone AS (
    DELETE FROM public.tests
     WHERE deleted_at IS NOT NULL
       AND deleted_at < now() - (public.trash_retention_days('test') || ' days')::interval
    RETURNING 1) SELECT count(*) INTO _tests FROM gone;

  WITH gone AS (
    DELETE FROM public.homework
     WHERE deleted_at IS NOT NULL
       AND deleted_at < now() - (public.trash_retention_days('homework') || ' days')::interval
    RETURNING 1) SELECT count(*) INTO _homework FROM gone;

  WITH gone AS (
    DELETE FROM public.students
     WHERE deleted_at IS NOT NULL
       AND deleted_at < now() - (public.trash_retention_days('student') || ' days')::interval
    RETURNING 1) SELECT count(*) INTO _students FROM gone;

  WITH gone AS (
    DELETE FROM public.teachers
     WHERE deleted_at IS NOT NULL
       AND deleted_at < now() - (public.trash_retention_days('teacher') || ' days')::interval
    RETURNING 1) SELECT count(*) INTO _teachers FROM gone;

  RETURN jsonb_build_object(
    'tests', _tests, 'homework', _homework,
    'students', _students, 'teachers', _teachers,
    'purged_at', now()
  );
END;
$function$;

-- Assert the INVERSE of the forward check, so a half-applied reversal fails
-- loudly rather than leaving the constraint one way and the function the other.
DO $$
DECLARE _def text;
BEGIN
  SELECT pg_get_constraintdef(oid) INTO _def
    FROM pg_constraint
   WHERE conname = 'test_marks_test_fk' AND conrelid = 'public.test_marks'::regclass;

  IF _def IS NULL OR _def NOT LIKE '%ON DELETE CASCADE%' THEN
    RAISE EXCEPTION 'rollback incomplete: test_marks_test_fk is not CASCADE — it reads: %', coalesce(_def, '(missing)');
  END IF;

  IF (SELECT pg_get_functiondef(oid) FROM pg_proc
       WHERE proname = 'rpc_purge_expired' AND pronamespace = 'public'::regnamespace)
     !~ 'DELETE\s+FROM\s+public\.tests' THEN
    RAISE EXCEPTION 'rollback incomplete: rpc_purge_expired does not delete from public.tests';
  END IF;
END $$;

DELETE FROM public.schema_migrations
 WHERE version = '20260904180000_test_marks_restrict';

COMMIT;
