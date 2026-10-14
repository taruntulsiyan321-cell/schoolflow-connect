-- ═══════════════════════════════════════════════════════════════════════════
-- ROLLBACK: the rebuild and the sweep as they were before 20261163000000
--
-- Restores _rebuild_revision_queue (school left to the session trigger) and
-- refresh_revision_worklists (one statement, no isolation), exactly as they
-- were live, and drops _revision_sweep_students. Note what you are restoring:
-- a nightly sweep that fails whenever a student needs a new revision row,
-- because a cron job has no caller to take a school from.
--
-- Undoes: 20261163000000_revision_worklists_name_their_school.sql
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

SET LOCAL lock_timeout = '3s';

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
      INSERT INTO public.revision_queue (user_id, student_id, subject, chapter, topic, reason, priority, due_date)
      VALUES (_uid, _student_id, _row.subject, _row.chapter, _row.topic, 'weak_topic', _prio, _due);
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

CREATE OR REPLACE FUNCTION public.refresh_revision_worklists(_active_within interval)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _u record;
  _n int := 0;
BEGIN
  IF _active_within IS NULL OR _active_within <= interval '0' THEN
    RAISE EXCEPTION 'refresh_revision_worklists needs a positive window, not %', _active_within;
  END IF;

  -- Everyone whose weak topics can have moved: _weak_topics_for_user counts
  -- practice answers and battle answers, and lists chapters with mistakes.
  -- The student row is found as the snapshot found it.
  FOR _u IN
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
  LOOP
    PERFORM public._rebuild_revision_queue(_u.user_id, _u.student_id);
    _n := _n + 1;
  END LOOP;
  RETURN _n;
END
$function$;

DROP FUNCTION public._revision_sweep_students(interval);

DO $check$
BEGIN
  IF to_regprocedure('public._revision_sweep_students(interval)') IS NOT NULL THEN
    RAISE EXCEPTION 'the sweep helper is still there';
  END IF;
  IF pg_get_functiondef('public._rebuild_revision_queue(uuid,uuid)'::regprocedure) LIKE '%_school uuid%' THEN
    RAISE EXCEPTION 'the rebuild still names its school';
  END IF;
END
$check$;

DELETE FROM public.schema_migrations
 WHERE version = '20261163000000_revision_worklists_name_their_school';

COMMIT;
