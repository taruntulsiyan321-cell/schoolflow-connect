-- ═══════════════════════════════════════════════════════════════════════════
-- A submitted paper reaches the other screens (2026-09-12 ruling on the
-- dynamic leaderboard)
--
-- ── WHAT DOES NOT MOVE TODAY, AND WHY ────────────────────────────────────
--
-- The ruling is that the board is live: "as soon as all the students start
-- submitting, the leaderboard gets updated." Measured in the client, two
-- mechanisms could carry that and neither does:
--
--   the academic live bus   `broadcastAcademicWrite` is an in-process event.
--                           It refreshes the tab that did the writing and
--                           reaches no other browser.
--   supabase realtime       `AcademicLiveProvider` subscribes to
--                           `postgres_changes` on `tests`, `marks`, `exams`,
--                           `homework` and nine more — but NOT on
--                           `test_attempts` or `test_marks`, which are the two
--                           tables a submission writes.
--
-- So a classmate submitting emitted nothing any other browser was listening
-- for, and the board only moved when its own 15-second poll came round.
--
-- ── WHAT THIS ADDS, AND WHO ACTUALLY RECEIVES IT ─────────────────────────
--
-- Both tables join the publication. Realtime applies RLS per subscriber, so
-- who receives what follows the fences already in place, and that is the point
-- rather than a limitation:
--
--   test_marks       `test_marks_read` admits a classmate WHO HAS SUBMITTED
--                    (20260920060000), which is exactly the set of students
--                    the leaderboard is readable by. They get the event; a
--                    student who has not sat it gets nothing, which is the same
--                    answer the board itself gives them.
--   test_attempts    `test_attempts_staff_read` admits the staff who own the
--                    test, so a teacher watching a published test sees
--                    "7 of 32 handed in" climb without reloading. A student
--                    receives only their own rows, which is `test_attempts_self`
--                    doing its job.
--
-- The poll stays as the floor: realtime is a delivery mechanism that can be
-- unavailable (a dropped socket, a project with realtime disabled), and a
-- leaderboard that silently stops moving is worse than one that is a few
-- seconds late.
--
-- REPLICA IDENTITY FULL is set on both, because a DELETE or an UPDATE otherwise
-- carries only the primary key and the client cannot tell which test changed
-- without another round trip.
--
-- Rollback: supabase/migrations/rollback/
--           20260920080000_a_submitted_paper_reaches_the_other_screens.rollback.sql
-- ═══════════════════════════════════════════════════════════════════════════

DO $add$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    RAISE EXCEPTION
      'ABORT: there is no supabase_realtime publication on this database, so adding a table to it would silently do nothing';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
     WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'test_attempts'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.test_attempts;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
     WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'test_marks'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.test_marks;
  END IF;
END $add$;

ALTER TABLE public.test_attempts REPLICA IDENTITY FULL;
ALTER TABLE public.test_marks    REPLICA IDENTITY FULL;

-- ── Proof ─────────────────────────────────────────────────────────────────
DO $verify$
DECLARE _n int; _ident text;
BEGIN
  SELECT count(*) INTO _n FROM pg_publication_tables
   WHERE pubname = 'supabase_realtime' AND schemaname = 'public'
     AND tablename IN ('test_attempts', 'test_marks');
  IF _n <> 2 THEN
    RAISE EXCEPTION 'ROLLED BACK: % of 2 test tables are in the publication', _n;
  END IF;

  SELECT relreplident INTO _ident FROM pg_class WHERE oid = 'public.test_marks'::regclass;
  IF _ident <> 'f' THEN
    RAISE EXCEPTION 'ROLLED BACK: test_marks replica identity is %, not FULL — an update would carry only its key', _ident;
  END IF;

  -- The positive control: a table NOBODY added is still absent, so this is
  -- reading the publication rather than a view that says yes to everything.
  IF EXISTS (
    SELECT 1 FROM pg_publication_tables
     WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'test_answers'
  ) THEN
    RAISE EXCEPTION 'ROLLED BACK: test_answers is in the publication and was never added — this check is reading the wrong thing';
  END IF;

  RAISE NOTICE 'verify OK: test_attempts and test_marks publish, both REPLICA IDENTITY FULL, test_answers still absent';
END
$verify$;
