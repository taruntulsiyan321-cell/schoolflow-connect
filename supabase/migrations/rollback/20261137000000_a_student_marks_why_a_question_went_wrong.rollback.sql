-- Rollback for 20261137000000: no marks, no tags, no voice-note policies;
-- student_mistakes.error_type back (empty, with its check); and
-- rpc_refresh_academic_brain exactly as it was live on 2026-10-02 (it filed
-- every mistake under "unknown"). Grants on the function are unchanged by
-- CREATE OR REPLACE either way.
--
-- The question-voice-notes BUCKET stays: storage.protect_delete refuses a
-- bucket delete from SQL. With its three policies gone no student can read or
-- write it; empty and delete it from the Storage API if it should go too.
-- Rolling back deletes every student's marks.
BEGIN;

DROP POLICY IF EXISTS "question voice notes read own" ON storage.objects;
DROP POLICY IF EXISTS "question voice notes insert own" ON storage.objects;
DROP POLICY IF EXISTS "question voice notes delete own" ON storage.objects;

DROP TABLE public.question_marks;
DROP FUNCTION public._question_marks_normalise();
DROP TABLE public.mark_tags;

ALTER TABLE public.student_mistakes
  ADD COLUMN error_type text
  CONSTRAINT student_mistakes_error_type_check CHECK (
    (error_type IS NULL) OR (error_type = ANY (ARRAY['concept_error'::text, 'calculation_error'::text, 'careless_mistake'::text, 'time_pressure_error'::text, 'misinterpretation_error'::text]))
  );

CREATE OR REPLACE FUNCTION public.rpc_refresh_academic_brain()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _uid uuid := auth.uid(); _sid uuid;
  _weak_concepts jsonb;
  _weak_chapters jsonb;
  _weak_subjects jsonb;
  _mistake_hist jsonb; _recovery_hist jsonb; _practice_hist jsonb;
  _mastery_snap jsonb; _class_trends jsonb;
  _recovery_pct numeric; _improve_trend text;
  _total_act int; _prev_score numeric; _curr_score numeric;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'auth required'; END IF;
  SELECT id INTO _sid FROM public.students WHERE user_id = _uid LIMIT 1;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'concept', concept, 'subject', subject, 'chapter', chapter,
    'mastery_score', mastery_score, 'mistake_count', mistake_count
  ) ORDER BY mastery_score ASC), '[]'::jsonb)
  INTO _weak_concepts
  FROM public.concept_mastery
  WHERE user_id = _uid AND mastery_score < 60
  LIMIT 15;

  

  SELECT COALESCE(jsonb_agg(row_data ORDER BY avg_mastery ASC), '[]'::jsonb)
  INTO _weak_chapters
  FROM (
    SELECT jsonb_build_object(
      'chapter', chapter, 'subject', subject,
      'avg_mastery', round(avg(mastery_score)::numeric, 1)
    ) AS row_data, round(avg(mastery_score)::numeric, 1) AS avg_mastery
    FROM public.concept_mastery
    WHERE user_id = _uid AND chapter IS NOT NULL
    GROUP BY chapter, subject
    HAVING avg(mastery_score) < 55
    ORDER BY avg(mastery_score) ASC
    LIMIT 8
  ) wc;

  

  SELECT COALESCE(jsonb_agg(row_data ORDER BY avg_mastery ASC), '[]'::jsonb)
  INTO _weak_subjects
  FROM (
    SELECT jsonb_build_object(
      'subject', subject, 'avg_mastery', round(avg(mastery_score)::numeric, 1)
    ) AS row_data, round(avg(mastery_score)::numeric, 1) AS avg_mastery
    FROM public.concept_mastery WHERE user_id = _uid
    GROUP BY subject
    HAVING avg(mastery_score) < 55
    ORDER BY avg(mastery_score) ASC
    LIMIT 5
  ) ws;

  

  SELECT jsonb_build_object(
    'total_mistakes', count(*),
    'unmastered', count(*) FILTER (WHERE status = 'open'),
    'by_subject', COALESCE((
      SELECT jsonb_object_agg(subject, cnt)
      FROM (SELECT subject, count(*) cnt FROM public.student_mistakes
            WHERE user_id = _uid GROUP BY subject) s
    ), '{}'::jsonb),
    'by_error_type', COALESCE((
      SELECT jsonb_object_agg(COALESCE(error_type, 'unknown'), cnt)
      FROM (SELECT error_type, count(*) cnt FROM public.student_mistakes
            WHERE user_id = _uid GROUP BY error_type) e
    ), '{}'::jsonb),
    'recent_7d', count(*) FILTER (WHERE last_wrong_at >= now() - interval '7 days')
  )
  INTO _mistake_hist FROM public.student_mistakes WHERE user_id = _uid;

  SELECT jsonb_build_object(
    'total_rounds', count(*),
    'cleared', count(*) FILTER (WHERE outcome = 'ready'),
    'open', count(*) FILTER (WHERE completed_at IS NULL),
    'avg_readiness', round(COALESCE(avg(readiness) * 100, 0), 1)
  )
  INTO _recovery_hist FROM public.recovery_sessions WHERE user_id = _uid;

  SELECT jsonb_build_object(
    'total_sessions', count(*),
    'avg_score', round(COALESCE(avg(score), 0), 1),
    'avg_accuracy', round(COALESCE(
      avg(CASE WHEN question_count > 0 THEN correct_count::numeric / question_count * 100 END), 0
    ), 1),
    'last_7d_sessions', count(*) FILTER (WHERE finished_at >= now() - interval '7 days')
  )
  INTO _practice_hist FROM public.practice_sessions
  WHERE user_id = _uid AND finished_at IS NOT NULL;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'concept', concept, 'subject', subject, 'chapter', chapter,
    'mastery_score', mastery_score, 'total_attempts', total_attempts,
    'correct_attempts', correct_attempts, 'mistake_count', mistake_count
  ) ORDER BY mastery_score ASC), '[]'::jsonb)
  INTO _mastery_snap FROM public.concept_mastery WHERE user_id = _uid;

  SELECT COALESCE(jsonb_object_agg(error_type, cnt), '{}'::jsonb)
  INTO _class_trends
  FROM (
    SELECT COALESCE(error_type, 'unknown') AS error_type, count(*) cnt
    FROM public.student_mistakes WHERE user_id = _uid GROUP BY error_type
  ) t;

  _recovery_pct := COALESCE((_recovery_hist->>'avg_readiness')::numeric, 0);

  SELECT avg(mastery_score) INTO _curr_score
  FROM public.concept_mastery WHERE user_id = _uid
    AND last_attempt_at >= now() - interval '7 days';
  SELECT avg(mastery_score) INTO _prev_score
  FROM public.concept_mastery WHERE user_id = _uid
    AND last_attempt_at >= now() - interval '14 days'
    AND last_attempt_at < now() - interval '7 days';

  _improve_trend := CASE
    WHEN _curr_score IS NULL OR _prev_score IS NULL THEN 'steady'
    WHEN _curr_score > _prev_score + 3 THEN 'improving'
    WHEN _curr_score < _prev_score - 3 THEN 'slipping'
    ELSE 'steady'
  END;

  SELECT (
    COALESCE((SELECT count(*) FROM public.practice_sessions WHERE user_id = _uid AND finished_at IS NOT NULL), 0) +
    COALESCE((SELECT count(*) FROM public.student_mistakes WHERE user_id = _uid), 0)
  ) INTO _total_act;

  INSERT INTO public.student_academic_brain (
    user_id, student_id,
    weak_subjects, weak_chapters,
    weak_concepts,
    mistake_history, recovery_history, practice_history,
    speed_trend, accuracy_trend, consistency_trend,
    mastery_snapshot, mistake_classification_trends,
    recovery_completion_pct, improvement_trend, total_activities, updated_at
  ) VALUES (
    _uid, _sid,
    COALESCE(_weak_subjects, '[]'::jsonb),
    COALESCE(_weak_chapters, '[]'::jsonb),
    COALESCE(_weak_concepts, '[]'::jsonb),
    COALESCE(_mistake_hist, '{}'::jsonb),
    COALESCE(_recovery_hist, '{}'::jsonb),
    COALESCE(_practice_hist, '{}'::jsonb),
    jsonb_build_object('avg_ms_per_question', (
      SELECT round(avg(time_taken_ms)::numeric, 0)
      FROM public.question_attempts
      WHERE user_id = _uid AND time_taken_ms IS NOT NULL AND NOT skipped
    )),
    jsonb_build_object(
      'last_session', (_practice_hist->>'avg_accuracy')::numeric,
      'rolling_7d', (_practice_hist->>'avg_accuracy')::numeric
    ),
    jsonb_build_object(
      'sessions_7d', (_practice_hist->>'last_7d_sessions')::int,
      'mistakes_7d', (_mistake_hist->>'recent_7d')::int
    ),
    COALESCE(_mastery_snap, '[]'::jsonb),
    COALESCE(_class_trends, '{}'::jsonb),
    _recovery_pct, _improve_trend, _total_act, now()
  )
  ON CONFLICT (user_id) DO UPDATE SET
    student_id = EXCLUDED.student_id,
    weak_subjects = EXCLUDED.weak_subjects,
    weak_chapters = EXCLUDED.weak_chapters,
    weak_concepts = EXCLUDED.weak_concepts,
    mistake_history = EXCLUDED.mistake_history,
    recovery_history = EXCLUDED.recovery_history,
    practice_history = EXCLUDED.practice_history,
    speed_trend = EXCLUDED.speed_trend,
    accuracy_trend = EXCLUDED.accuracy_trend,
    consistency_trend = EXCLUDED.consistency_trend,
    mastery_snapshot = EXCLUDED.mastery_snapshot,
    mistake_classification_trends = EXCLUDED.mistake_classification_trends,
    recovery_completion_pct = EXCLUDED.recovery_completion_pct,
    improvement_trend = EXCLUDED.improvement_trend,
    total_activities = EXCLUDED.total_activities,
    updated_at = now();

  RETURN (SELECT to_jsonb(b) FROM public.student_academic_brain b WHERE b.user_id = _uid);
END; $function$;

DO $verify$
BEGIN
  IF to_regclass('public.question_marks') IS NOT NULL OR to_regclass('public.mark_tags') IS NOT NULL THEN
    RAISE EXCEPTION 'ROLLBACK VERIFY FAILED: a marks table is still there';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema = 'public' AND table_name = 'student_mistakes' AND column_name = 'error_type') THEN
    RAISE EXCEPTION 'ROLLBACK VERIFY FAILED: error_type was not restored';
  END IF;
  IF (SELECT prosrc FROM pg_proc WHERE oid = 'public.rpc_refresh_academic_brain()'::regprocedure) !~ 'by_error_type' THEN
    RAISE EXCEPTION 'ROLLBACK VERIFY FAILED: the brain function was not restored';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'storage' AND policyname LIKE 'question voice notes %') THEN
    RAISE EXCEPTION 'ROLLBACK VERIFY FAILED: a voice-note policy is still there';
  END IF;
END $verify$;

COMMIT;
