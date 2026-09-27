-- ===========================================================================
-- TOPIC-WISE ANALYSIS IS IN THE PLAN.
--
-- The owner's ruling (2026-09-27): Free gets chapter-wise analysis; topic-wise
-- analysis from ₹199. Two reads carry topic-level analysis to the app:
--
--   rpc_student_academic_snapshot   weak_topics  (Analysis, the Practice hub)
--   rpc_student_practice_analytics  by_topic     (Analysis: time per topic)
--
-- For an account whose plan does not have analysis.topic, both come back as
-- empty lists with topic_analysis_locked: true, so a screen can say why
-- instead of showing an empty panel. Everything chapter- and subject-level is
-- untouched, and so is the student's own data: their attempts and mistakes
-- carry topics and stay readable — what the plan sells is the analysis.
-- A school's student, and everyone while enforcement is off, sees it all.
--
-- One helper holds the rule; each function wraps its RETURN in it. Both
-- bodies are taken from live (they had drifted from the repo's last full
-- definitions through in-place edits), with only the RETURN wrapped.
--
-- ROLLBACK: rollback/20261112000000_topic_analysis_is_in_the_plan.rollback.sql
-- ===========================================================================

BEGIN;

CREATE FUNCTION public._premium_topic_analysis(_uid uuid, _out jsonb, _keys text[])
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _k text;
BEGIN
  IF (public._premium_decide(_uid, 'analysis.topic', 1, false)->>'ok')::boolean THEN
    RETURN _out;
  END IF;
  FOREACH _k IN ARRAY _keys LOOP
    _out := jsonb_set(_out, ARRAY[_k], '[]'::jsonb, true);
  END LOOP;
  RETURN _out || jsonb_build_object('topic_analysis_locked', true);
END;
$function$;
REVOKE ALL ON FUNCTION public._premium_topic_analysis(uuid, jsonb, text[]) FROM PUBLIC, anon, authenticated;

-- rpc_student_academic_snapshot as live has it, RETURN wrapped.
CREATE OR REPLACE FUNCTION public.rpc_student_academic_snapshot()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _uid uuid := auth.uid(); _s record; _xp record;
  _hw_pending int := 0; _hw_done int := 0; _test_open int := 0; _test_done int := 0;
  _weak jsonb; _mistakes int; _heat jsonb;
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

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'date', activity_date, 'test', test_count, 'homework', homework_count,
    'battles', battle_count, 'self_practice', self_practice_count, 'minutes', practice_minutes
  ) ORDER BY activity_date), '[]'::jsonb)
    INTO _heat FROM public.academic_daily_activity
    WHERE user_id = _uid AND activity_date >= CURRENT_DATE - 28;

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
    'activity_heatmap', _heat,
    'exam_readiness', public._exam_readiness(_uid, _s.id)
  ), ARRAY['weak_topics']);
END; $function$;

-- rpc_student_practice_analytics as live has it, RETURN wrapped.
CREATE OR REPLACE FUNCTION public.rpc_student_practice_analytics()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _uid uuid := auth.uid();
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'auth required';
  END IF;

  -- PREMIUM (20261112000000): topic-level analysis only when the plan has it.
  RETURN public._premium_topic_analysis(_uid, jsonb_build_object(
    -- ── by subject ───────────────────────────────────────────────────────
    -- Every subject this student has attempted a question in, most attempts
    -- first. The generic buckets are excluded by the same list the chapter
    -- roll-up uses: "Subject" is not a subject.
    'by_subject', (
      SELECT COALESCE(jsonb_agg(row_to_json(s) ORDER BY s.attempts DESC), '[]'::jsonb)
      FROM (
        SELECT
          public._normalize_subject_label(qa.subject)                AS subject,
          count(*)::int                                              AS attempts,
          count(*) FILTER (WHERE NOT COALESCE(qa.skipped, false))::int AS answered,
          count(*) FILTER (WHERE COALESCE(qa.time_taken_ms, 0) > 0)::int AS timed,
          count(*) FILTER (WHERE qa.is_correct AND NOT COALESCE(qa.skipped, false))::int AS correct,
          count(*) FILTER (WHERE COALESCE(qa.skipped, false))::int    AS skipped,
          round(100.0 * count(*) FILTER (WHERE qa.is_correct AND NOT COALESCE(qa.skipped, false))
                / NULLIF(count(*) FILTER (WHERE NOT COALESCE(qa.skipped, false)), 0), 1) AS accuracy,
          round(avg(qa.time_taken_ms) FILTER (WHERE COALESCE(qa.time_taken_ms, 0) > 0) / 1000.0, 1) AS avg_sec,
          round(sum(qa.time_taken_ms) FILTER (WHERE COALESCE(qa.time_taken_ms, 0) > 0) / 60000.0, 1) AS total_min
        FROM public.question_attempts qa
        WHERE qa.user_id = _uid
          AND NOT COALESCE(qa.excluded_from_accuracy, false)
          AND public._normalize_subject_label(qa.subject) IS NOT NULL
        GROUP BY public._normalize_subject_label(qa.subject)
      ) s
    ),

    'by_topic', (
      SELECT COALESCE(jsonb_agg(row_to_json(t) ORDER BY t.avg_sec DESC NULLS LAST), '[]'::jsonb)
      FROM (
        SELECT
          qa.topic                                                   AS topic,
          max(qa.subject)                                            AS subject,
          qa.chapter                                                 AS chapter,
          count(*)::int                                              AS attempts,
          count(*) FILTER (WHERE NOT COALESCE(qa.skipped, false))::int AS answered,
          count(*) FILTER (WHERE COALESCE(qa.time_taken_ms, 0) > 0)::int AS timed,
          count(*) FILTER (WHERE qa.is_correct AND NOT COALESCE(qa.skipped, false))::int AS correct,
          count(*) FILTER (WHERE COALESCE(qa.skipped, false))::int    AS skipped,
          round(100.0 * count(*) FILTER (WHERE qa.is_correct AND NOT COALESCE(qa.skipped, false))
                / NULLIF(count(*) FILTER (WHERE NOT COALESCE(qa.skipped, false)), 0), 1) AS accuracy,
          round(avg(qa.time_taken_ms) FILTER (WHERE COALESCE(qa.time_taken_ms, 0) > 0) / 1000.0, 1) AS avg_sec,
          round(sum(qa.time_taken_ms) FILTER (WHERE COALESCE(qa.time_taken_ms, 0) > 0) / 60000.0, 1) AS total_min
        FROM public.question_attempts qa
        WHERE qa.user_id = _uid
          AND NOT COALESCE(qa.excluded_from_accuracy, false) AND COALESCE(btrim(qa.topic), '') <> ''
        -- Topics are per chapter (§10.22): two that share a name are two
        -- topics. Grouped by name alone they merged under max(chapter)
        -- (20261045000000).
        GROUP BY qa.topic, qa.chapter
      ) t
    ),

    'by_chapter', (
      SELECT COALESCE(jsonb_agg(row_to_json(c) ORDER BY c.accuracy ASC NULLS LAST), '[]'::jsonb)
      FROM (
        SELECT
          qa.chapter                                                 AS chapter,
          max(qa.subject)                                            AS subject,
          count(*)::int                                              AS attempts,
          count(*) FILTER (WHERE NOT COALESCE(qa.skipped, false))::int AS answered,
          count(*) FILTER (WHERE COALESCE(qa.time_taken_ms, 0) > 0)::int AS timed,
          count(*) FILTER (WHERE qa.is_correct AND NOT COALESCE(qa.skipped, false))::int AS correct,
          count(*) FILTER (WHERE COALESCE(qa.skipped, false))::int    AS skipped,
          round(100.0 * count(*) FILTER (WHERE qa.is_correct AND NOT COALESCE(qa.skipped, false))
                / NULLIF(count(*) FILTER (WHERE NOT COALESCE(qa.skipped, false)), 0), 1) AS accuracy,
          round(avg(qa.time_taken_ms) FILTER (WHERE COALESCE(qa.time_taken_ms, 0) > 0) / 1000.0, 1) AS avg_sec,
          round(sum(qa.time_taken_ms) FILTER (WHERE COALESCE(qa.time_taken_ms, 0) > 0) / 60000.0, 1) AS total_min
        FROM public.question_attempts qa
        WHERE qa.user_id = _uid
          AND NOT COALESCE(qa.excluded_from_accuracy, false)
          AND COALESCE(btrim(qa.chapter), '') <> ''
          AND lower(btrim(qa.chapter)) NOT IN
              ('subject', 'topic', 'daily', 'general', 'concept', 'chapter', 'mixed')
        GROUP BY qa.chapter
      ) c
    ),

    'by_difficulty', (
      SELECT COALESCE(jsonb_agg(row_to_json(d) ORDER BY d.rank), '[]'::jsonb)
      FROM (
        SELECT
          qa.difficulty                                              AS difficulty,
          CASE lower(qa.difficulty) WHEN 'easy' THEN 1 WHEN 'medium' THEN 2
                                    WHEN 'hard' THEN 3 ELSE 4 END    AS rank,
          count(*)::int                                              AS attempts,
          count(*) FILTER (WHERE NOT COALESCE(qa.skipped, false))::int AS answered,
          count(*) FILTER (WHERE COALESCE(qa.time_taken_ms, 0) > 0)::int AS timed,
          count(*) FILTER (WHERE COALESCE(qa.skipped, false))::int    AS skipped,
          count(*) FILTER (WHERE qa.is_correct AND NOT COALESCE(qa.skipped, false))::int AS correct,
          round(100.0 * count(*) FILTER (WHERE qa.is_correct AND NOT COALESCE(qa.skipped, false))
                / NULLIF(count(*) FILTER (WHERE NOT COALESCE(qa.skipped, false)), 0), 1) AS accuracy,
          round(avg(qa.time_taken_ms) FILTER (WHERE COALESCE(qa.time_taken_ms, 0) > 0) / 1000.0, 1) AS avg_sec
        FROM public.question_attempts qa
        WHERE qa.user_id = _uid
          AND NOT COALESCE(qa.excluded_from_accuracy, false) AND COALESCE(btrim(qa.difficulty), '') <> ''
        GROUP BY qa.difficulty
      ) d
    ),

    'effort', (
      SELECT jsonb_build_object(
        'attempts',          count(*)::int,
        'solution_viewed',   count(*) FILTER (WHERE COALESCE(qa.solution_viewed, false))::int,
        'repeat_attempts',   count(*) FILTER (WHERE COALESCE(qa.attempt_number, 1) > 1)::int,
        'first_try_attempts', count(*) FILTER (WHERE COALESCE(qa.attempt_number, 1) = 1
                                                 AND NOT COALESCE(qa.skipped, false))::int,
        'first_try_correct',  count(*) FILTER (WHERE COALESCE(qa.attempt_number, 1) = 1
                                                 AND qa.is_correct AND NOT COALESCE(qa.skipped, false))::int
      )
      FROM public.question_attempts qa
        WHERE qa.user_id = _uid
          AND NOT COALESCE(qa.excluded_from_accuracy, false)
    ),

    'recurring', (
      SELECT COALESCE(jsonb_agg(row_to_json(r) ORDER BY r.times_wrong DESC, r.last_wrong_at DESC), '[]'::jsonb)
      FROM (
        SELECT
          sm.topic                  AS topic,
          sm.chapter                AS chapter,
          sm.subject                AS subject,
          sm.times_wrong            AS times_wrong,
          sm.last_wrong_at          AS last_wrong_at,
          left(sm.question_text, 160) AS question_text
        FROM public.student_mistakes sm
        WHERE sm.user_id = _uid AND sm.status = 'open' AND COALESCE(sm.times_wrong, 0) > 1
        ORDER BY sm.times_wrong DESC, sm.last_wrong_at DESC
        LIMIT 8
      ) r
    )
  ), ARRAY['by_topic']);
END;
$function$;

-- ── Proof: as a real CUET account and a school student (rolled back) ───────
DO $proof$
DECLARE
  _exam   uuid;
  _school constant uuid := 'd1000003-0001-4000-8000-000000000001';
  _snap   jsonb;
  _pa     jsonb;
  _msg    text;
BEGIN
  -- The CUET account with the most answered, topic-tagged attempts, so the
  -- unlocked read has something to strip.
  SELECT ea.account_id INTO _exam
    FROM public.exam_accounts ea
    JOIN public.question_attempts qa ON qa.user_id = ea.account_id
   WHERE COALESCE(btrim(qa.topic), '') <> '' AND NOT COALESCE(qa.skipped, false)
   GROUP BY ea.account_id
   ORDER BY count(*) DESC
   LIMIT 1;
  IF _exam IS NULL THEN
    RAISE EXCEPTION 'no exam account with topic attempts to prove the lock with';
  END IF;

  BEGIN
    -- 1. While off: nothing is locked.
    PERFORM set_config('request.jwt.claims', json_build_object('sub', _exam, 'role', 'authenticated')::text, true);
    SET LOCAL ROLE authenticated;
    _pa := public.rpc_student_practice_analytics();
    _snap := public.rpc_student_academic_snapshot();
    RESET ROLE;
    IF _pa ? 'topic_analysis_locked' OR _snap ? 'topic_analysis_locked' THEN
      RAISE EXCEPTION 'topic analysis locked while enforcement is off';
    END IF;
    -- CONTROL: there is something to lock.
    IF jsonb_array_length(_pa->'by_topic') = 0 THEN
      RAISE EXCEPTION 'CONTROL: the account has no by_topic rows, so the lock would prove nothing';
    END IF;

    -- 2. Enforced, Free: both reads lock, and nothing else changes.
    INSERT INTO public.premium_enforced_accounts (account_id, note) VALUES (_exam, 'migration 20261112000000 proof');
    SET LOCAL ROLE authenticated;
    DECLARE
      _pa2 jsonb := public.rpc_student_practice_analytics();
      _snap2 jsonb := public.rpc_student_academic_snapshot();
    BEGIN
      RESET ROLE;
      IF NOT COALESCE((_pa2->>'topic_analysis_locked')::boolean, false) OR jsonb_array_length(_pa2->'by_topic') <> 0 THEN
        RAISE EXCEPTION 'free: by_topic not locked: %', _pa2->'by_topic';
      END IF;
      IF NOT COALESCE((_snap2->>'topic_analysis_locked')::boolean, false) OR jsonb_array_length(_snap2->'weak_topics') <> 0 THEN
        RAISE EXCEPTION 'free: weak_topics not locked';
      END IF;
      IF (_pa2 - 'by_topic' - 'topic_analysis_locked') IS DISTINCT FROM (_pa - 'by_topic') THEN
        RAISE EXCEPTION 'free: the lock changed more than by_topic';
      END IF;
      IF (_pa2->'by_chapter') IS DISTINCT FROM (_pa->'by_chapter') THEN
        RAISE EXCEPTION 'free: chapter-wise analysis changed';
      END IF;
    END;

    -- 3. Starter: unlocked again, identical to before.
    PERFORM public.premium_grant(_exam, 'starter', 30, 'migration 20261112000000 proof');
    SET LOCAL ROLE authenticated;
    IF public.rpc_student_practice_analytics() IS DISTINCT FROM _pa THEN
      RESET ROLE;
      RAISE EXCEPTION 'starter: practice analytics differs from the unlocked read';
    END IF;
    RESET ROLE;

    -- 4. A school's student is never locked.
    PERFORM set_config('request.jwt.claims', json_build_object('sub', _school, 'role', 'authenticated')::text, true);
    SET LOCAL ROLE authenticated;
    IF public.rpc_student_practice_analytics() ? 'topic_analysis_locked' THEN
      RESET ROLE;
      RAISE EXCEPTION 'a school student was locked';
    END IF;
    RESET ROLE;
    PERFORM set_config('request.jwt.claims', NULL, true);

    IF has_function_privilege('authenticated', 'public._premium_topic_analysis(uuid,jsonb,text[])', 'EXECUTE') THEN
      RAISE EXCEPTION 'the lock helper is callable by a client';
    END IF;

    RAISE EXCEPTION 'topic_proof_ok';
  EXCEPTION WHEN raise_exception THEN
    GET STACKED DIAGNOSTICS _msg = MESSAGE_TEXT;
    IF _msg <> 'topic_proof_ok' THEN
      RAISE;
    END IF;
  END;
  IF EXISTS (SELECT 1 FROM public.premium_enforced_accounts) OR EXISTS (SELECT 1 FROM public.premium_entitlements) THEN
    RAISE EXCEPTION 'the proof left rows behind';
  END IF;
END
$proof$;

INSERT INTO public.schema_migrations (version)
VALUES ('20261112000000_topic_analysis_is_in_the_plan')
ON CONFLICT (version) DO NOTHING;

COMMIT;
