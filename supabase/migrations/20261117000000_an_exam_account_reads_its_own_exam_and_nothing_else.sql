-- ===========================================================================
-- AN EXAM ACCOUNT'S DOOR OPENS ON ITS OWN EXAM, AND NOTHING ELSE.
--
-- `question_bank_student` is THE door a student reads the bank through. Its two
-- arms were an OR and they overlapped:
--
--     (exam_id IS NULL      AND board matches my school's board)   -- school arm
--  OR (exam_id = my exam)                                         -- exam arm
--
-- A CUET account is a tenant of one: its own `schools` row, `kind='individual'`,
-- and **board NULL**. So the school arm's `board IS NULL OR board = 'both'` case
-- matched for it too, and every board-less school question fell inside an exam
-- account's door.
--
-- Measured on production 2026-09-27, per CUET account:
--
--   their own exam's approved rows ....................... 4304
--   board-less school rows that came in as well .........   62
--   another exam's rows (correctly blocked) ............. 4304
--
-- The clearest evidence was the account on the fixture exam, which has no
-- questions of its own at all and still saw 62.
--
-- NOTHING SERVES THEM TODAY, and that is exactly the problem. Every caller
-- narrows the read itself — `studentBankQuery` filters `exam_id = scope.examId`
-- and `chapter_id IN syllabus`, `_student_bank_pool` (and so the practice
-- catalog and the mock paper builder) uses the same exam arm — so the 62 never
-- reach a screen. The door's correctness rests on every caller remembering,
-- which is the shape this repository keeps paying for: fix the thing, not the N
-- consumers. One caller that forgot would serve a CUET Commerce student a Class
-- 10 RBSE question.
--
-- THE FIX is to make the arms mutually exclusive: the school arm applies only
-- when the caller is NOT an exam account. Nothing else about the view changes —
-- same columns, same order, same types, same owner's rights (it is deliberately
-- not security_invoker, which is how a student reads it at all while
-- question_bank itself is staff-only).
--
-- This NARROWS a read. What it must not do is take away a row an exam account
-- should have, so the proof requires every exam account still to see all of its
-- own exam's approved rows, and every school student's count to be untouched.
--
-- ROLLBACK: rollback/20261117000000_an_exam_account_reads_its_own_exam_and_nothing_else.sql
-- ===========================================================================

BEGIN;

-- ── Before: what each real caller's door holds ──────────────────────────────
--
-- And, beside it, everything that is the STUDENT'S OWN: their mistakes, their
-- attempts, their sessions, their uploads, their captures, their revision and
-- recovery rows. This migration touches a view over the question bank and
-- nothing else, so not one of those numbers may move — and rather than say so,
-- the proof below refuses to let the migration commit if any of them does.
CREATE TEMP TABLE _view_before (
  who uuid PRIMARY KEY, is_exam boolean, rows_visible int, own_exam_rows int
) ON COMMIT DROP;

CREATE TEMP TABLE _mine_before (
  who uuid PRIMARY KEY,
  mistakes int, open_mistakes int, attempts int, sessions int,
  chapter_states int, recovery_queue int, revision_rows int, tallies int,
  uploads int, upload_questions int, capture_questions int, mocks int
) ON COMMIT DROP;

CREATE FUNCTION pg_temp.mine(_uid uuid) RETURNS _mine_before
LANGUAGE plpgsql AS $mine$
DECLARE _r _mine_before;
BEGIN
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', _uid, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  _r.who := _uid;
  SELECT count(*) INTO _r.mistakes        FROM public.student_mistakes;
  SELECT count(*) INTO _r.open_mistakes   FROM public.student_mistakes WHERE status = 'open';
  SELECT count(*) INTO _r.attempts        FROM public.question_attempts;
  SELECT count(*) INTO _r.sessions        FROM public.practice_sessions;
  SELECT jsonb_array_length(public.rpc_student_chapter_states())  INTO _r.chapter_states;
  SELECT jsonb_array_length(public.rpc_student_recovery_queue())  INTO _r.recovery_queue;
  SELECT count(*) INTO _r.revision_rows   FROM public.revision_queue WHERE NOT completed;
  SELECT count(*) INTO _r.tallies         FROM public.chapter_tally;
  SELECT count(*) INTO _r.uploads         FROM public.student_uploads;
  SELECT count(*) INTO _r.upload_questions  FROM public.student_upload_questions;
  SELECT count(*) INTO _r.capture_questions FROM public.student_capture_questions;
  SELECT jsonb_array_length(public.rpc_my_mock_history()) INTO _r.mocks;
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', NULL, true);
  RETURN _r;
END
$mine$;

DO $capture$
DECLARE
  _w record;
  _n int;
BEGIN
  FOR _w IN
    SELECT ea.account_id AS sub, true AS is_exam,
           (SELECT count(*) FROM public.question_bank qb
             WHERE qb.is_approved AND qb.exam_id = ea.exam_id)::int AS own
      FROM public.exam_accounts ea
    UNION ALL
    SELECT few.sub, false, 0 FROM (
      SELECT s.user_id AS sub
        FROM public.students s
        JOIN public.schools sc ON sc.id = s.school_id
       WHERE s.user_id IS NOT NULL AND sc.kind = 'school' AND s.deleted_at IS NULL
       ORDER BY s.created_at
       LIMIT 5
    ) few
  LOOP
    PERFORM set_config('request.jwt.claims',
      json_build_object('sub', _w.sub, 'role', 'authenticated')::text, true);
    SET LOCAL ROLE authenticated;
    SELECT count(*) INTO _n FROM public.question_bank_student;
    RESET ROLE;
    INSERT INTO _view_before VALUES (_w.sub, _w.is_exam, _n, _w.own)
    ON CONFLICT (who) DO NOTHING;
  END LOOP;
  PERFORM set_config('request.jwt.claims', NULL, true);

  -- Everything that belongs to each exam account, as that account.
  INSERT INTO _mine_before
  SELECT (pg_temp.mine(ea.account_id)).* FROM public.exam_accounts ea
  ON CONFLICT (who) DO NOTHING;

  IF NOT EXISTS (SELECT 1 FROM _view_before WHERE is_exam)
     OR NOT EXISTS (SELECT 1 FROM _view_before WHERE NOT is_exam) THEN
    RAISE EXCEPTION 'both an exam account and a school student are needed to prove this, and one was not found';
  END IF;
END
$capture$;

-- ── The door ────────────────────────────────────────────────────────────────
CREATE OR REPLACE VIEW public.question_bank_student AS
  SELECT
    q.id,
    q.class_level,
    q.subject,
    q.chapter,
    q.difficulty,
    q.question,
    q.options,
    q.source,
    q.is_approved,
    q.created_at,
    q.board,
    q.source_type,
    q.exam_year,
    q.stream,
    q.question_format,
    q.updated_at,
    q.is_active,
    q.chapter_id,
    q.variant_tier,
    q.topic_id,
    q.exam_id
  FROM public.question_bank q
  WHERE q.is_approved
    AND (
      (
        -- A SCHOOL student: their school's board. Not an exam account — a
        -- tenant of one has board NULL, which used to match `board IS NULL`
        -- here and let every board-less school question through.
        q.exam_id IS NULL
        AND NOT EXISTS (
          SELECT 1 FROM public.exam_accounts ea
           WHERE ea.school_id = (SELECT public.get_my_school_id())
        )
        AND (
          q.board IS NULL
          OR q.board = 'both'
          OR q.board = (
            SELECT s.board
              FROM public.schools s
             WHERE s.id = (SELECT public.get_my_school_id())
          )
        )
      )
      OR
      (
        -- An EXAM account: its own exam, whole and nothing besides.
        q.exam_id IS NOT NULL
        AND q.exam_id = (
          SELECT ea.exam_id
            FROM public.exam_accounts ea
           WHERE ea.school_id = (SELECT public.get_my_school_id())
        )
      )
    );

COMMENT ON VIEW public.question_bank_student IS
  'THE bank as a student may read it: approved rows only, their school''s board for a school student, their own exam for an exam account, and never both (20261117000000).';

-- ── Proof, as the same callers, and every check can fail ────────────────────
DO $proof$
DECLARE
  _b        record;
  _now      int;
  _exam_cut int := 0;
  _school   int := 0;
  _checked_exam int := 0;
BEGIN
  FOR _b IN SELECT * FROM _view_before LOOP
    PERFORM set_config('request.jwt.claims',
      json_build_object('sub', _b.who, 'role', 'authenticated')::text, true);
    SET LOCAL ROLE authenticated;
    SELECT count(*) INTO _now FROM public.question_bank_student;
    RESET ROLE;

    IF _b.is_exam THEN
      -- All of their own exam, and only that.
      IF _now <> _b.own_exam_rows THEN
        RAISE EXCEPTION 'exam account % now sees % rows, but its exam has % approved rows',
          _b.who, _now, _b.own_exam_rows;
      END IF;
      IF _now < _b.rows_visible THEN _exam_cut := _exam_cut + (_b.rows_visible - _now); END IF;
      _checked_exam := _checked_exam + 1;
    ELSE
      -- A school student loses nothing at all.
      IF _now <> _b.rows_visible THEN
        RAISE EXCEPTION 'school student % saw % rows and now sees % — this narrowing reached the wrong caller',
          _b.who, _b.rows_visible, _now;
      END IF;
      IF _now > 0 THEN _school := _school + 1; END IF;
    END IF;
  END LOOP;
  PERFORM set_config('request.jwt.claims', NULL, true);

  -- CONTROL 1: a school student whose door was EMPTY would satisfy "unchanged"
  -- without proving anything.
  IF _school = 0 THEN
    RAISE EXCEPTION 'CONTROL: not one school student had any rows, so "unchanged" proves nothing';
  END IF;

  -- CONTROL 2: something must actually have been cut, or this migration is a
  -- no-op dressed as a fix.
  IF _exam_cut = 0 THEN
    RAISE EXCEPTION 'CONTROL: no exam account lost a single row — nothing was leaking, or the new arm is not in force';
  END IF;

  RAISE NOTICE 'exam accounts checked: %, rows no longer in their door: %; school students unchanged: %',
    _checked_exam, _exam_cut, _school;
END
$proof$;

-- ── The student's own work is untouched, and is still only theirs ────────────
DO $mine_proof$
DECLARE
  _b      _mine_before;
  _a      _mine_before;
  _other  uuid;
  _n      int;
  _busy   int := 0;
  _pairs  int := 0;
BEGIN
  FOR _b IN SELECT * FROM _mine_before LOOP
    _a := pg_temp.mine(_b.who);

    IF (_a.mistakes, _a.open_mistakes, _a.attempts, _a.sessions, _a.chapter_states,
        _a.recovery_queue, _a.revision_rows, _a.tallies, _a.uploads,
        _a.upload_questions, _a.capture_questions, _a.mocks)
       IS DISTINCT FROM
       (_b.mistakes, _b.open_mistakes, _b.attempts, _b.sessions, _b.chapter_states,
        _b.recovery_queue, _b.revision_rows, _b.tallies, _b.uploads,
        _b.upload_questions, _b.capture_questions, _b.mocks) THEN
      RAISE EXCEPTION
        'account % lost or gained its OWN work. mistakes %→%, open %→%, attempts %→%, sessions %→%, chapter_states %→%, recovery %→%, revision %→%, tallies %→%, uploads %→%, upload questions %→%, captures %→%, mocks %→%',
        _b.who, _b.mistakes, _a.mistakes, _b.open_mistakes, _a.open_mistakes,
        _b.attempts, _a.attempts, _b.sessions, _a.sessions,
        _b.chapter_states, _a.chapter_states, _b.recovery_queue, _a.recovery_queue,
        _b.revision_rows, _a.revision_rows, _b.tallies, _a.tallies,
        _b.uploads, _a.uploads, _b.upload_questions, _a.upload_questions,
        _b.capture_questions, _a.capture_questions, _b.mocks, _a.mocks;
    END IF;

    -- CONTROL: an account with nothing would satisfy "unchanged" while proving
    -- nothing, so at least one must actually have work to lose.
    IF _a.mistakes > 0 AND _a.attempts > 0 AND _a.sessions > 0 THEN _busy := _busy + 1; END IF;

    -- And it is still only theirs: as this account, another individual's rows
    -- are not readable.
    SELECT ea.account_id INTO _other FROM public.exam_accounts ea
     WHERE ea.account_id <> _b.who
       AND EXISTS (SELECT 1 FROM public.student_mistakes sm WHERE sm.user_id = ea.account_id)
     LIMIT 1;
    IF _other IS NOT NULL THEN
      _pairs := _pairs + 1;
      PERFORM set_config('request.jwt.claims',
        json_build_object('sub', _b.who, 'role', 'authenticated')::text, true);
      SET LOCAL ROLE authenticated;
      SELECT count(*) INTO _n FROM public.student_mistakes sm WHERE sm.user_id = _other;
      IF _n <> 0 THEN
        RESET ROLE;
        RAISE EXCEPTION 'account % can read % mistake(s) belonging to %', _b.who, _n, _other;
      END IF;
      SELECT count(*) INTO _n FROM public.question_attempts qa WHERE qa.user_id = _other;
      IF _n <> 0 THEN
        RESET ROLE;
        RAISE EXCEPTION 'account % can read % attempt(s) belonging to %', _b.who, _n, _other;
      END IF;
      SELECT count(*) INTO _n FROM public.practice_sessions ps WHERE ps.user_id = _other;
      IF _n <> 0 THEN
        RESET ROLE;
        RAISE EXCEPTION 'account % can read % session(s) belonging to %', _b.who, _n, _other;
      END IF;
      SELECT count(*) INTO _n FROM public.student_uploads u WHERE u.owner_id = _other;
      IF _n <> 0 THEN
        RESET ROLE;
        RAISE EXCEPTION 'account % can read % upload(s) belonging to %', _b.who, _n, _other;
      END IF;
      RESET ROLE;
      PERFORM set_config('request.jwt.claims', NULL, true);
    END IF;
  END LOOP;

  IF _busy = 0 THEN
    RAISE EXCEPTION 'CONTROL: no exam account had mistakes, attempts AND sessions, so "nothing moved" proves nothing';
  END IF;
  IF _pairs = 0 THEN
    RAISE WARNING 'ISOLATION UNPROVEN: there was no second individual with work of their own to read across at.';
  END IF;

  RAISE NOTICE 'own work unchanged for % account(s), % of them with a full history; cross-account reads refused on % pair(s)',
    (SELECT count(*) FROM _mine_before), _busy, _pairs;
END
$mine_proof$;

INSERT INTO public.schema_migrations (version)
VALUES ('20261117000000_an_exam_account_reads_its_own_exam_and_nothing_else')
ON CONFLICT (version) DO NOTHING;

COMMIT;
