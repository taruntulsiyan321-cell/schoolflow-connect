-- ═══════════════════════════════════════════════════════════════════════════
-- tests → test_attempts becomes ON DELETE RESTRICT. test_questions stays CASCADE.
--
-- ── THE SPLIT, AND WHY THESE TWO ARE NOT THE SAME KIND OF THING ──────────
--
-- 20260904180000 reported both as cascading and changed neither, on the
-- grounds that the retention question needed a ruling. It has been ruled, and
-- the two go opposite ways:
--
--   test_questions  KEEPS CASCADE. Questions are the test's own body. They are
--     not student data and are meaningless without the parent row. A test
--     being deleted should take its questions with it. No change — and the
--     verification below ASSERTS it is still CASCADE, so a later "make all the
--     test children RESTRICT" sweep trips instead of quietly landing.
--
--   test_attempts  BECOMES RESTRICT. Attempts are student data. The rule that
--     made test_marks RESTRICT applies unchanged: a parent row disappearing
--     must never silently destroy child data, and that guarantee should be
--     STRUCTURAL rather than dependent on some other constraint happening to
--     fire first.
--
-- ── THE GAP THIS CLOSES, STATED PRECISELY ────────────────────────────────
--
-- With RESTRICT on test_marks alone, a MARKED test is safe. A test with
-- attempts and NO marks still deletes, and takes its attempt history with it.
-- That is the case the retention model covers — raw test data lives for the
-- academic year — and it was unprotected.
--
-- HOW EXPOSED IS IT TODAY: the honest answer is that the gap currently has
-- ZERO instances. Measured just now:
--
--   tests                                        72
--   tests with attempts                          24
--   tests with marks                             72
--   tests with attempts and NO marks              0   ← the unprotected set
--   tests with neither marks nor attempts         0
--
-- So every test that has attempts also has marks, and test_marks' RESTRICT
-- already refuses all 72 deletions. This migration changes no outcome for any
-- row that exists today. It is preventive: the moment a teacher creates a test,
-- students attempt it, and marks are not yet uploaded — the normal state of
-- every online test between the bell and the marking — 458-row-scale attempt
-- history sits behind a hard-delete button with nothing structural in the way.
-- Protection by consequence is not protection by policy, and the previous
-- migration said so in as many words.
--
-- ── WHAT "ATTEMPTS WITH NO MARKS" ACTUALLY MEANS ─────────────────────────
--
-- Under the current spec it is a student who opened the test and never
-- submitted, or who was force-closed mid-attempt and recorded as "Not given".
-- That is real evidence about a real test session — who sat down, when, and
-- what happened — not junk awaiting cleanup. It is exactly the record a
-- disputed result would be settled from.
--
-- ── THE COST, ACCEPTED ───────────────────────────────────────────────────
--
-- A test with an abandoned attempt becomes undeletable. That is acceptable
-- because hard deletion is not a path that should be exercised at all: the
-- product rule is deactivate / soft-delete, never hard delete, history
-- immutable. RESTRICT is a guardrail on a path nobody should be walking.
--
-- ── SHAPE: SINGLE-COLUMN, DELIBERATELY ───────────────────────────────────
--
-- test_marks_test_fk references tests (id, school_id) because it already did,
-- and 180000 was careful not to lose the tenant half. test_attempts_test_id_fkey
-- has always been single-column — (test_id) → tests(id) — so nothing is lost
-- by leaving it that way, and widening it would be a TENANCY change riding
-- along inside a RETENTION ruling.
--
-- Widening is available and currently clean if it is ever wanted:
--   attempts whose school_id disagrees with their test's       0
--   orphan attempts                                            0
--   attempts with a NULL school_id                             0
--   unique index on tests (id, school_id)                      present
-- Flagged, not done. It needs its own ruling.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- Fail rather than assume: if the constraint has been renamed or reshaped since
-- this was authored, stop and re-read instead of dropping something else.
DO $$
DECLARE _def text;
BEGIN
  SELECT pg_get_constraintdef(oid) INTO _def
    FROM pg_constraint
   WHERE conname = 'test_attempts_test_id_fkey'
     AND conrelid = 'public.test_attempts'::regclass;

  IF _def IS NULL THEN
    RAISE EXCEPTION
      'ABORT: test_attempts_test_id_fkey does not exist; the schema is not what this migration was written against';
  END IF;
  IF _def NOT LIKE '%REFERENCES tests(id)%' THEN
    RAISE EXCEPTION
      'ABORT: test_attempts_test_id_fkey is not the single-column reference this migration expects — it reads: %', _def;
  END IF;
END $$;

ALTER TABLE public.test_attempts DROP CONSTRAINT test_attempts_test_id_fkey;

-- RESTRICT, not NO ACTION: RESTRICT is checked immediately and cannot be
-- deferred to commit, so a transaction cannot delete the parent, write
-- something on the strength of it, and only discover the problem at COMMIT.
ALTER TABLE public.test_attempts
  ADD CONSTRAINT test_attempts_test_id_fkey
  FOREIGN KEY (test_id)
  REFERENCES public.tests (id)
  ON DELETE RESTRICT;

-- ── Verification ──────────────────────────────────────────────────────────
DO $$
DECLARE _att text; _qs text; _mk text;
BEGIN
  SELECT pg_get_constraintdef(oid) INTO _att FROM pg_constraint
   WHERE conname = 'test_attempts_test_id_fkey' AND conrelid = 'public.test_attempts'::regclass;
  SELECT pg_get_constraintdef(oid) INTO _qs FROM pg_constraint
   WHERE conname = 'test_questions_test_id_fkey' AND conrelid = 'public.test_questions'::regclass;
  SELECT pg_get_constraintdef(oid) INTO _mk FROM pg_constraint
   WHERE conname = 'test_marks_test_fk' AND conrelid = 'public.test_marks'::regclass;

  -- The half that changed.
  IF _att IS NULL THEN
    RAISE EXCEPTION 'ABORT: test_attempts_test_id_fkey was not recreated';
  END IF;
  IF _att NOT LIKE '%ON DELETE RESTRICT%' THEN
    RAISE EXCEPTION 'ABORT: test_attempts_test_id_fkey is not RESTRICT — it reads: %', _att;
  END IF;
  IF _att NOT LIKE '%REFERENCES tests(id)%' THEN
    RAISE EXCEPTION 'ABORT: the reference target changed — it reads: %', _att;
  END IF;

  -- The half that deliberately did NOT change. This is the assertion that
  -- makes the split a policy instead of an accident: a future sweep that
  -- RESTRICTs every child of `tests` fails here and has to justify itself.
  IF _qs IS NULL THEN
    RAISE EXCEPTION 'ABORT: test_questions_test_id_fkey has gone missing';
  END IF;
  IF _qs NOT LIKE '%ON DELETE CASCADE%' THEN
    RAISE EXCEPTION
      'ABORT: test_questions is no longer CASCADE — it reads: %. Questions are the test''s own body and were ruled to travel with it; changing this needs its own ruling.', _qs;
  END IF;

  -- And the constraint this one is modelled on must still be in place, or the
  -- reasoning above ("the rule that made test_marks RESTRICT") is stale.
  IF _mk IS NULL OR _mk NOT LIKE '%ON DELETE RESTRICT%' THEN
    RAISE EXCEPTION 'ABORT: test_marks_test_fk is no longer RESTRICT — it reads: %', coalesce(_mk, '(missing)');
  END IF;
END $$;

COMMIT;
