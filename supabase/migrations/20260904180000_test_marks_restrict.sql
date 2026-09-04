-- ═══════════════════════════════════════════════════════════════════════════
-- tests → test_marks becomes ON DELETE RESTRICT
--
-- ── THIS IS NOT A FUTURE RISK. IT IS THE DELETE BUTTON. ───────────────────
--
-- The cascade was found while checking whether `rpc_purge_expired` was safe to
-- schedule. Checking it properly turned up something worse: the purge is not
-- the path that destroys marks, and never has been.
--
--   TestService.remove()  →  .from("tests").delete().eq("id", testId)
--   called from LiveClassPanels.tsx:1752, the teacher's "Delete" button
--
-- That is a HARD delete. Nothing in this repo ever sets `tests.deleted_at` —
-- 0 rows carry it, no client code writes it, and the only database function
-- that UPDATEs `public.tests` is rpc_restore_from_trash, which clears it. So:
--
--   · the 7-day trash window for tests has never once applied
--   · rpc_purge_expired's `tests` branch is unreachable by construction
--   · and a teacher pressing Delete today cascade-destroys that test's marks,
--     attempts and questions IMMEDIATELY
--
-- All 72 tests have marks. 2,520 test_marks rows sit behind one button with no
-- confirmation that mentions them.
--
-- ── WHY RESTRICT AND NOT THE ALTERNATIVES ─────────────────────────────────
--
-- Ruled, and the reasoning is worth keeping because each alternative is the
-- kind that looks reasonable in review:
--
--   SET NULL + denormalise — orphans marks with no test context and copies
--     test name and subject onto test_marks. A second home for data, which is
--     the defect class G13 exists to prevent.
--
--   "write marks to the profile before deleting" — makes the durable record
--     depend on a job running correctly every single time. If the write fails
--     and the delete succeeds, the marks are gone. The answer to an ordering
--     hazard is to REMOVE the ordering dependency, not to get the order right.
--
--   exclude tests from the purge only — fixes today's job and not tomorrow's.
--     Six months from now someone writes another cleanup path and the hole
--     reopens with nobody noticing.
--
-- RESTRICT is structural. A delete that would destroy marks fails loudly
-- instead of succeeding quietly, whoever writes it and whenever.
--
-- ── WHAT THIS BREAKS, DELIBERATELY ────────────────────────────────────────
--
-- Every one of the 72 live tests has marks, so after this migration the
-- teacher's Delete button fails on ALL of them with a foreign-key violation.
-- That is the point — those deletions were destroying the durable record — but
-- it is a visible behaviour change, not a silent one. TestService.remove is
-- updated in the same commit to catch 23503 and say what happened instead of
-- surfacing a raw Postgres error.
--
-- ── test_attempts AND test_questions ARE NOT TOUCHED HERE ─────────────────
--
-- Both still cascade (458 and 576 rows). Reported rather than changed, because
-- the retention question for them is genuinely different: the current model
-- keeps raw test data for the ACADEMIC YEAR, and neither the 7-day trash window
-- nor a cascade-on-parent-delete expresses that. Deciding it needs a ruling
-- about what "current academic year" means for a test whose parent row is being
-- removed at all. With RESTRICT in place a test that HAS marks can no longer be
-- deleted, so in practice their rows are now protected by consequence — but
-- that is a side effect, not a policy, and it should not be mistaken for one.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conname = 'test_marks_test_fk'
                    AND conrelid = 'public.test_marks'::regclass) THEN
    RAISE EXCEPTION 'ABORT: test_marks_test_fk does not exist; the schema is not what this migration was written against';
  END IF;
END $$;

ALTER TABLE public.test_marks DROP CONSTRAINT test_marks_test_fk;

-- RESTRICT, not NO ACTION: RESTRICT is checked immediately and cannot be
-- deferred to commit, so a transaction cannot delete the parent, write
-- something on the strength of it, and only discover the problem at COMMIT.
ALTER TABLE public.test_marks
  ADD CONSTRAINT test_marks_test_fk
  FOREIGN KEY (test_id, school_id)
  REFERENCES public.tests (id, school_id)
  ON DELETE RESTRICT;

-- ── Belt and braces: tests leave the purge ────────────────────────────────
-- Marks persistence must not depend on the constraint being the only thing in
-- the way. The branch was unreachable anyway (nothing sets tests.deleted_at),
-- which is exactly why leaving it in would be worse than useless: it reads as
-- coverage while doing nothing, and it would start working the day somebody
-- adds a soft delete.
CREATE OR REPLACE FUNCTION public.rpc_purge_expired()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _homework int; _students int; _teachers int;
BEGIN
  -- Same rule as the homework purge it replaces: no per-user caller. A
  -- logged-in user reaching this would be deleting other institutions' rows,
  -- and there is no correct institution to scope to.
  IF auth.uid() IS NOT NULL THEN
    RAISE EXCEPTION
      'rpc_purge_expired is a platform maintenance job; it has no per-user caller and deletes across institutions by design';
  END IF;

  -- `tests` IS DELIBERATELY ABSENT. Deleting a test cascades to test_attempts
  -- and test_questions, and until this migration cascaded to test_marks too.
  -- Raw test data is retained for the current academic year, which a 7-day
  -- trash window does not express. Purging tests needs its own ruling.

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
    'homework', _homework,
    'students', _students, 'teachers', _teachers,
    'tests_excluded', 'retention ruling pending; see 20260904180000',
    'purged_at', now()
  );
END;
$function$;

-- ── Verification ──────────────────────────────────────────────────────────
DO $$
DECLARE _def text;
BEGIN
  SELECT pg_get_constraintdef(oid) INTO _def
    FROM pg_constraint
   WHERE conname = 'test_marks_test_fk' AND conrelid = 'public.test_marks'::regclass;

  IF _def IS NULL THEN
    RAISE EXCEPTION 'ABORT: test_marks_test_fk was not recreated';
  END IF;
  IF _def NOT LIKE '%ON DELETE RESTRICT%' THEN
    RAISE EXCEPTION 'ABORT: test_marks_test_fk is not RESTRICT — it reads: %', _def;
  END IF;
  -- The composite pair must survive the swap, or the tenant half of the
  -- reference is lost and a mark could point at another school's test.
  IF _def NOT LIKE '%(test_id, school_id)%' THEN
    RAISE EXCEPTION 'ABORT: the composite (test_id, school_id) reference was lost: %', _def;
  END IF;

  IF (SELECT pg_get_functiondef(oid) FROM pg_proc
       WHERE proname = 'rpc_purge_expired' AND pronamespace = 'public'::regnamespace)
     ~ 'DELETE\s+FROM\s+public\.tests' THEN
    RAISE EXCEPTION 'ABORT: rpc_purge_expired still deletes from public.tests';
  END IF;
END $$;

COMMIT;
