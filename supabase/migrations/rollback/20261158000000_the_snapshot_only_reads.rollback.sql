-- ROLLBACK 20261158000000 — the snapshot rebuilds the worklist again.
--
-- Unschedules both refresh jobs, drops refresh_revision_worklists, and puts
-- rpc_student_academic_snapshot back exactly as it was live before
-- 20261158000000 (pg_get_functiondef): it calls _rebuild_revision_queue on
-- every read again. CREATE OR REPLACE keeps its grants.

BEGIN;

DO $cron$
BEGIN
  PERFORM cron.unschedule(j.jobname)
     FROM cron.job j
    WHERE j.jobname IN ('refresh-revision-worklists-recent', 'refresh-revision-worklists-daily');
END
$cron$;

DROP FUNCTION public.refresh_revision_worklists(interval);

CREATE OR REPLACE FUNCTION public.rpc_student_academic_snapshot()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _uid uuid := auth.uid(); _s record; _xp record;
  _hw_pending int := 0; _hw_done int := 0; _test_open int := 0; _test_done int := 0;
  _weak jsonb; _mistakes int;
  _recovery_pending int := 0; _mastery_summary jsonb; _practice_sessions int := 0;
  _revision_due int := 0;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'auth required'; END IF;

  SELECT * INTO _s FROM public.students_current WHERE user_id = _uid LIMIT 1;
  SELECT * INTO _xp FROM public.student_xp WHERE user_id = _uid;

  IF _s.id IS NOT NULL THEN
    -- completed: given (submitted or accepted). pending: not given and the
    -- deadline has not passed, so there is still something to do — rejected
    -- work included. homework_student_status is the one place both are decided.
    SELECT count(*) FILTER (WHERE hss.given),
           count(*) FILTER (WHERE NOT hss.given AND NOT hss.closed)
      INTO _hw_done, _hw_pending
    FROM public.homework_student_status hss
    WHERE hss.student_id = _s.id;

    SELECT count(*) FILTER (WHERE att.status = 'submitted'),
           count(*) FILTER (WHERE att.status IS DISTINCT FROM 'submitted')
      INTO _test_done, _test_open
    FROM public.tests d
    LEFT JOIN public.test_attempts att ON att.test_id = d.id AND att.user_id = _uid
    WHERE d.status = 'published' AND d.section_subject_id IN (SELECT ss.id FROM public.section_subjects ss WHERE ss.section_id = _s.class_id);
  END IF;

  -- "Finished" is not "answered": a session the loader could not fill is
  -- auto-finished with zero attempts (20260925000000).
  SELECT count(*)::int INTO _practice_sessions
  FROM public.practice_sessions WHERE user_id = _uid AND finished_at IS NOT NULL
    AND public._practice_session_attempted(correct_count, wrong_count, skipped_count);

  SELECT COALESCE(jsonb_agg(row_to_json(w) ORDER BY w.accuracy ASC), '[]'::jsonb)
    INTO _weak FROM public._weak_topics_for_user(_uid) w WHERE w.is_weak LIMIT 5;

  SELECT count(*) INTO _mistakes FROM public.student_mistakes
    WHERE user_id = _uid AND status = 'open';

  -- §4.1. The chapters Recovery offers a session for, read from the queue
  -- itself. This used to restate the queue's rule, and the restatement
  -- drifted (no relearn boundary, no question_id filter), so Home said 19
  -- chapters were ready to recover while Recovery offered 15. One rule, one
  -- home: rpc_student_recovery_queue decides `ready` (20261045000000).
  SELECT count(*)::int INTO _recovery_pending
    FROM jsonb_array_elements(public.rpc_student_recovery_queue()) q
   WHERE (q->>'startable')::boolean;

  -- §5.3. A chapter is due when its scheduled date has arrived. A chapter that
  -- reached REVISION_STAGES_TO_SOLID has next_revision_at NULL and is counted
  -- by neither branch, which is what removes it from the student's list.
  SELECT count(*)::int INTO _revision_due
  FROM public.chapter_state cs
  WHERE cs.user_id = _uid
    AND cs.next_revision_at IS NOT NULL
    AND cs.next_revision_at <= now();

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'subject', subject, 'concept', concept, 'mastery_score', mastery_score
  ) ORDER BY mastery_score ASC), '[]'::jsonb)
    INTO _mastery_summary
  FROM public.concept_mastery WHERE user_id = _uid AND mastery_score < 60 LIMIT 5;

  -- Maintains the AI/EIE weak-topic worklist. No student screen reads it.
  PERFORM public._rebuild_revision_queue(_uid, _s.id);

  -- PREMIUM (20261112000000): topic-level analysis only when the plan has it.
  RETURN public._premium_topic_analysis(_uid, jsonb_build_object(
    'student', CASE WHEN _s.id IS NULL THEN NULL ELSE jsonb_build_object(
      'id', _s.id, 'full_name', _s.full_name, 'class_id', _s.class_id,
      'roll_number', _s.roll_number, 'admission_number', _s.admission_number
    ) END,
    'xp', CASE WHEN _xp IS NULL THEN NULL ELSE to_jsonb(_xp) END,
    'homework', jsonb_build_object('pending', _hw_pending, 'completed', _hw_done),
    'test', jsonb_build_object('open', _test_open, 'completed', _test_done),
    'self_practice', jsonb_build_object('sessions_completed', _practice_sessions),
    'weak_topics', _weak,
    'revision_due', _revision_due,
    'mistake_count', _mistakes,
    'recovery_pending', _recovery_pending,
    'weak_concepts', _mastery_summary,
    'exam_readiness', public._exam_readiness(_uid, _s.id)
  ), ARRAY['weak_topics']);
END; $function$;

DO $proof$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname LIKE 'refresh-revision-worklists%') THEN
    RAISE EXCEPTION 'ROLLBACK FAILED: a refresh job is still scheduled';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE oid = 'public.rpc_student_academic_snapshot()'::regprocedure
                    AND prosrc LIKE '%PERFORM public._rebuild_revision_queue(_uid, _s.id);%') THEN
    RAISE EXCEPTION 'ROLLBACK FAILED: the snapshot does not rebuild the worklist';
  END IF;
END
$proof$;

COMMIT;
