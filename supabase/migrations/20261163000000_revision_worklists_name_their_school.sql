-- ═══════════════════════════════════════════════════════════════════════════
-- A REVISION WORKLIST NAMES ITS SCHOOL; ONE STUDENT CANNOT STOP THE SWEEP
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Found 2026-10-14 in the production health pass: refresh-revision-worklists-
-- daily failed its first run (2026-10-13 20:40 UTC) with
--
--     null value in column "school_id" of relation "revision_queue"
--
-- 20261158000000 moved _rebuild_revision_queue out of the student's snapshot
-- read and into two cron jobs. Its INSERT never named a school. The BEFORE
-- INSERT trigger tg_set_school_id_from_session filled it from
-- get_my_school_id(), which is the SIGNED-IN caller's school, and a cron job
-- has no caller. So every new weak-topic row a sweep wrote was refused, and
-- because the sweep was one statement, one refused row stopped every student's
-- refresh. The 15-minute job passed only because its few students needed no
-- new row.
--
--   1. _rebuild_revision_queue names the school: the student row's, else the
--      profile's. Every one of the 201 rows live today carries exactly its
--      student row's school (measured), so this is the rule the data already
--      follows. A student with neither is refused by name, when it needs a new
--      row, not by a NOT NULL error.
--   2. refresh_revision_worklists rebuilds each student in a subtransaction.
--      One refused or broken student is logged (a WARNING naming the account
--      and the reason) and the sweep carries on.
--   3. Who the sweep visits has one home, _revision_sweep_students, which the
--      proof below counts as well.
--
-- The other functions that insert into session-filled tables without naming
-- the school are _upsert_concept_mastery, rpc_record_concept_mistake,
-- _capture_battle_mistakes, rpc_mirror_battle_answer, and _mock_grade through
-- them. Measured: each is reached only from a signed-in student's own request
-- (rpc_record_question_attempt, rpc_finish_battle, rpc_submit_battle_answer,
-- rpc_mock_submit, and the student's own mock reads), where the trigger has its
-- caller.
--
-- ROLLBACK: rollback/20261163000000_revision_worklists_name_their_school.rollback.sql
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

SET LOCAL lock_timeout = '3s';

-- ── 1. Who a sweep visits ──────────────────────────────────────────────────
-- Everyone whose weak topics can have moved: _weak_topics_for_user counts
-- practice answers and battle answers, and lists chapters with mistakes. The
-- student row is found as the snapshot found it.
CREATE FUNCTION public._revision_sweep_students(_active_within interval)
RETURNS TABLE (user_id uuid, student_id uuid)
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $$
  SELECT a.user_id,
         (SELECT s.id FROM public.students_current s WHERE s.user_id = a.user_id LIMIT 1) AS student_id
    FROM (
      SELECT qa.user_id FROM public.question_attempts qa
       WHERE qa.created_at >= now() - _active_within
      UNION
      SELECT bp.user_id FROM public.battle_participants bp
        JOIN public.battle_answers ba ON ba.participant_id = bp.id
       WHERE ba.created_at >= now() - _active_within
      UNION
      SELECT sm.user_id FROM public.student_mistakes sm
       WHERE sm.last_wrong_at >= now() - _active_within
    ) a
   WHERE a.user_id IS NOT NULL
   ORDER BY a.user_id
$$;
REVOKE ALL ON FUNCTION public._revision_sweep_students(interval) FROM PUBLIC, anon, authenticated;

-- ── 2. The rebuild names the student's school ──────────────────────────────
CREATE OR REPLACE FUNCTION public._rebuild_revision_queue(_uid uuid, _student_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _row record;
  _prio int;
  _existing uuid;
  _due date;
  -- The student's school, from the student's own rows, never the caller's:
  -- a sweep has no caller (20261163000000).
  _school uuid := COALESCE(
    (SELECT s.school_id FROM public.students s WHERE s.id = _student_id),
    (SELECT pr.school_id FROM public.profiles pr WHERE pr.id = _uid));
BEGIN
  FOR _row IN
    SELECT * FROM public._weak_topics_for_user(_uid) WHERE is_weak ORDER BY accuracy ASC LIMIT 8
  LOOP
    IF public._revision_recently_completed(_uid, _row.subject, _row.chapter, _row.topic, 7) THEN
      CONTINUE;
    END IF;

    SELECT p.priority INTO _prio
    FROM public._revision_topic_priority(_uid, _row.subject, _row.chapter, _row.topic, _row.accuracy) p;

    SELECT id INTO _existing FROM public.revision_queue
    WHERE user_id = _uid AND NOT completed
      AND subject = _row.subject
      AND COALESCE(chapter, '') = COALESCE(_row.chapter, '')
      AND COALESCE(topic, '') = COALESCE(_row.topic, '')
    LIMIT 1;

    _due := CURRENT_DATE + CASE WHEN _row.accuracy < 40 THEN 0 WHEN _row.accuracy < 50 THEN 1 ELSE 2 END;

    IF _existing IS NOT NULL THEN
      UPDATE public.revision_queue SET
        priority = _prio, reason = 'weak_topic', due_date = LEAST(due_date, _due), student_id = _student_id
      WHERE id = _existing;
    ELSE
      IF _school IS NULL THEN
        RAISE EXCEPTION 'account % has no school on its student row or its profile, so its revision worklist has nowhere to live', _uid;
      END IF;
      INSERT INTO public.revision_queue (user_id, student_id, school_id, subject, chapter, topic, reason, priority, due_date)
      VALUES (_uid, _student_id, _school, _row.subject, _row.chapter, _row.topic, 'weak_topic', _prio, _due);
    END IF;
  END LOOP;

  FOR _row IN
    SELECT rq.*, w.accuracy
    FROM public.revision_queue rq
    LEFT JOIN public._weak_topics_for_user(_uid) w
      ON w.subject = rq.subject
     AND COALESCE(w.chapter, '') = COALESCE(rq.chapter, '')
     AND COALESCE(w.topic, '') = COALESCE(rq.topic, '')
    WHERE rq.user_id = _uid AND NOT rq.completed AND rq.reason = 'test_wrong'
  LOOP
    SELECT p.priority INTO _prio
    FROM public._revision_topic_priority(_uid, _row.subject, _row.chapter, _row.topic, _row.accuracy) p;
    UPDATE public.revision_queue SET priority = _prio WHERE id = _row.id;
  END LOOP;

  -- Auto-clear: a topic whose accuracy has recovered to >= 60 no longer
  -- belongs in an open revision queue. Only acts on rows where we have
  -- current accuracy data confirming recovery (w.accuracy IS NOT NULL) --
  -- a row with no matching attempt data is left untouched rather than
  -- guessed at.
  UPDATE public.revision_queue rq
  SET completed = true, completed_at = now()
  FROM public._weak_topics_for_user(_uid) w
  WHERE rq.user_id = _uid AND NOT rq.completed
    AND w.subject = rq.subject
    AND COALESCE(w.chapter, '') = COALESCE(rq.chapter, '')
    AND COALESCE(w.topic, '') = COALESCE(rq.topic, '')
    AND w.accuracy >= 60;
END; $function$;

-- ── 3. The sweep carries on past a student it cannot rebuild ───────────────
CREATE OR REPLACE FUNCTION public.refresh_revision_worklists(_active_within interval)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _u record;
  _n int := 0;
  _refused int := 0;
BEGIN
  IF _active_within IS NULL OR _active_within <= interval '0' THEN
    RAISE EXCEPTION 'refresh_revision_worklists needs a positive window, not %', _active_within;
  END IF;

  FOR _u IN SELECT * FROM public._revision_sweep_students(_active_within) LOOP
    -- Each student in a subtransaction: a refusal undoes that student's
    -- rebuild alone, and is said in the log with who and why.
    BEGIN
      PERFORM public._rebuild_revision_queue(_u.user_id, _u.student_id);
      _n := _n + 1;
    EXCEPTION WHEN OTHERS THEN
      _refused := _refused + 1;
      RAISE WARNING 'revision worklist of % not rebuilt: %', _u.user_id, SQLERRM;
    END;
  END LOOP;

  IF _refused > 0 THEN
    RAISE WARNING 'refresh_revision_worklists: % rebuilt, % not (each named above)', _n, _refused;
  END IF;
  RETURN _n;
END
$$;

-- ── THE PROOF ─────────────────────────────────────────────────────────────
DO $proof$
DECLARE
  _window interval := make_interval(days => public._recovery_const('WEAK_WINDOW_DAYS')::int + 1);
  _active int;
  _n int;
  _bad bigint;
  _c record;
  _written int := 0;
  _wrong int := 0;
BEGIN
  -- A sweep's context: no signed-in caller, as pg_cron runs it.
  PERFORM set_config('request.jwt.claims', '', true);
  IF public.get_my_school_id() IS NOT NULL THEN
    RAISE EXCEPTION 'CONTROL FAILED: the proof is not running without a caller';
  END IF;

  -- CONTROL, the cause: without a caller, a revision row that leaves its
  -- school to the trigger is refused.
  BEGIN
    INSERT INTO public.revision_queue (user_id, student_id, subject, chapter, topic, reason, priority, due_date)
    SELECT s.user_id, s.id, 'probe', 'probe', 'probe', 'weak_topic', 1, CURRENT_DATE
      FROM public.students s WHERE s.user_id IS NOT NULL LIMIT 1;
    RAISE EXCEPTION 'CONTROL FAILED: a revision row with no school was accepted without a caller';
  EXCEPTION WHEN not_null_violation THEN
    NULL;
  END;

  -- The path that failed: a rebuild that must WRITE a new row, with no caller.
  -- A student with weak topics loses their open rows inside a subtransaction
  -- and is rebuilt; the rows must come back carrying their school. Then the
  -- subtransaction is undone, so nothing here changes anyone's worklist.
  FOR _c IN
    SELECT s.user_id, s.student_id FROM public._revision_sweep_students(_window) s
     WHERE EXISTS (SELECT 1 FROM public._weak_topics_for_user(s.user_id) t WHERE t.is_weak)
     LIMIT 10
  LOOP
    BEGIN
      DELETE FROM public.revision_queue WHERE user_id = _c.user_id AND NOT completed;
      PERFORM public._rebuild_revision_queue(_c.user_id, _c.student_id);
      SELECT count(*),
             count(*) FILTER (WHERE rq.school_id IS DISTINCT FROM COALESCE(
               (SELECT s.school_id FROM public.students s WHERE s.id = _c.student_id),
               (SELECT p.school_id FROM public.profiles p WHERE p.id = _c.user_id)))
        INTO _written, _wrong
        FROM public.revision_queue rq WHERE rq.user_id = _c.user_id AND NOT rq.completed;
      RAISE EXCEPTION USING ERRCODE = 'P0099', MESSAGE = 'undo the probe';
    EXCEPTION WHEN SQLSTATE 'P0099' THEN
      NULL;
    END;
    EXIT WHEN _written > 0;
  END LOOP;
  IF _written = 0 THEN
    RAISE EXCEPTION 'CONTROL FAILED: no rebuild wrote a new row, so the school was never tested';
  END IF;
  IF _wrong <> 0 THEN
    RAISE EXCEPTION '% new row(s) written with no caller carry another school', _wrong;
  END IF;

  -- The nightly sweep in full: every student it visits is rebuilt.
  SELECT count(*) INTO _active FROM public._revision_sweep_students(_window);
  IF _active = 0 THEN
    RAISE EXCEPTION 'CONTROL FAILED: nobody is in the nightly window, so the sweep proves nothing';
  END IF;
  _n := public.refresh_revision_worklists(_window);
  IF _n <> _active THEN
    RAISE EXCEPTION 'the nightly sweep rebuilt % of % students', _n, _active;
  END IF;

  -- Every row carries its own student's school.
  SELECT count(*) INTO _bad
    FROM public.revision_queue rq
    LEFT JOIN public.students s ON s.id = rq.student_id
    LEFT JOIN public.profiles p ON p.id = rq.user_id
   WHERE rq.school_id IS DISTINCT FROM COALESCE(s.school_id, p.school_id);
  IF _bad <> 0 THEN
    RAISE EXCEPTION '% revision row(s) carry a school that is not their student''s', _bad;
  END IF;

  -- No client can call any of the three.
  IF has_function_privilege('authenticated', 'public._revision_sweep_students(interval)', 'execute')
     OR has_function_privilege('authenticated', 'public._rebuild_revision_queue(uuid,uuid)', 'execute')
     OR has_function_privilege('authenticated', 'public.refresh_revision_worklists(interval)', 'execute')
     OR has_function_privilege('anon', 'public._revision_sweep_students(interval)', 'execute') THEN
    RAISE EXCEPTION 'a client role can execute the sweep or the rebuild';
  END IF;

  RAISE NOTICE 'nightly sweep: % of % students rebuilt; % new row(s) written with no caller', _n, _active, _written;
END
$proof$;

INSERT INTO public.schema_migrations (version)
VALUES ('20261163000000_revision_worklists_name_their_school')
ON CONFLICT (version) DO NOTHING;

COMMIT;
