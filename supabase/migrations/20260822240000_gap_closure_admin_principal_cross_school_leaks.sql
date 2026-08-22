-- Gap closure, 2026-08-22: systematic sweep for the pattern
-- `has_role(admin) OR has_role(principal)` used as an authorization
-- bypass with NO same_school()/school_id check anywhere else in the same
-- function -- the RLS-policy version of this exact pattern was swept and
-- fixed earlier this session (21 tables), but that sweep only covered RLS
-- policies, not RPC function bodies, which turned out to have the same
-- anti-pattern independently. Found via grepping every remaining
-- untriaged function for has_role('admin'|'principal') without a
-- same_school( call anywhere in the same body. Ten real, confirmed gaps:
-- any admin or principal account, from ANY school, could read or write
-- another school's data by supplying that school's student/class/battle/
-- assignment/session id. Two are unconditional (no id parameter needed at
-- all): rpc_principal_concept_analytics and rpc_teacher_doubt_dashboard
-- returned a school-blind aggregate across every school in the database to
-- any admin/principal, full stop.

-- 1. admin_link_user_to_student / admin_link_user_to_teacher: an admin
-- could re-link ANY school's student/teacher row to an arbitrary auth
-- user by email, corrupting another school's roster identity mapping.
CREATE OR REPLACE FUNCTION public.admin_link_user_to_student(_student_id uuid, _email text, _as text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _uid UUID;
BEGIN
  IF NOT public.has_role(auth.uid(),'admin') THEN
    RAISE EXCEPTION 'Only admins can link users';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.students WHERE id = _student_id AND same_school(school_id)) THEN
    RAISE EXCEPTION 'Student not found in your school';
  END IF;
  SELECT id INTO _uid FROM auth.users WHERE lower(email) = lower(_email) LIMIT 1;
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'No user with email %. Ask them to sign up first.', _email;
  END IF;
  IF _as = 'student' THEN
    UPDATE public.students SET user_id = _uid WHERE id = _student_id;
  ELSIF _as = 'parent' THEN
    UPDATE public.students SET parent_user_id = _uid WHERE id = _student_id;
  ELSE
    RAISE EXCEPTION 'Invalid link type %', _as;
  END IF;
END; $function$;

CREATE OR REPLACE FUNCTION public.admin_link_user_to_teacher(_teacher_id uuid, _email text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _uid UUID;
BEGIN
  IF NOT public.has_role(auth.uid(),'admin') THEN
    RAISE EXCEPTION 'Only admins can link users';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.teachers WHERE id = _teacher_id AND same_school(school_id)) THEN
    RAISE EXCEPTION 'Teacher not found in your school';
  END IF;
  SELECT id INTO _uid FROM auth.users WHERE lower(email) = lower(_email) LIMIT 1;
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'No user with email %. Ask them to sign up first.', _email;
  END IF;
  UPDATE public.teachers SET user_id = _uid WHERE id = _teacher_id;
END; $function$;

-- 2. ai_session_memory_close: admin branch could close ANY school's AI
-- session record. ai_session_memory has its own school_id column.
CREATE OR REPLACE FUNCTION public.ai_session_memory_close(p_session_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL AND current_user <> 'service_role' THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  UPDATE public.ai_session_memory
     SET status = 'closed',
         closed_at = now(),
         updated_at = now()
   WHERE id = p_session_id
     AND (
       actor_user_id = v_uid
       OR (public.has_role(v_uid, 'admin'::public.app_role) AND public.same_school(school_id))
       OR current_user = 'service_role'
     );

  IF NOT FOUND THEN
    RAISE EXCEPTION 'session not found or not authorised';
  END IF;

  RETURN jsonb_build_object('session_id', p_session_id, 'status', 'closed');
END;
$function$;

-- 3. rpc_battle_monitor: admin/principal branch could monitor any other
-- school's live battle.
CREATE OR REPLACE FUNCTION public.rpc_battle_monitor(_battle_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _b record; _uid uuid := auth.uid(); _result jsonb; _allowed boolean;
BEGIN
  SELECT * INTO _b FROM public.battles WHERE id = _battle_id;
  IF _b IS NULL THEN RAISE EXCEPTION 'Battle not found'; END IF;

  _allowed := _b.creator_user_id = _uid
    OR (public.has_role(_uid, 'admin'::app_role) AND public.same_school(_b.school_id))
    OR (public.has_role(_uid, 'principal'::app_role) AND public.same_school(_b.school_id))
    OR (_b.class_id IS NOT NULL AND public.teacher_teaches_class(_uid, _b.class_id));
  IF NOT _allowed THEN RAISE EXCEPTION 'Not authorized to monitor this battle'; END IF;

  SELECT jsonb_build_object(
    'battle', jsonb_build_object(
      'id', _b.id, 'title', _b.title, 'subject', _b.subject, 'topic', _b.topic,
      'status', _b.status, 'question_count', _b.question_count,
      'per_question_sec', _b.per_question_sec, 'duration_sec', _b.duration_sec,
      'starts_at', _b.starts_at
    ),
    'participants', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'user_id', p.user_id,
        'display_name', p.display_name,
        'score', p.score,
        'correct_count', p.correct_count,
        'answered_count', p.answered_count,
        'total_time_ms', p.total_time_ms,
        'rank', p.rank,
        'finished', (p.finished_at IS NOT NULL),
        'joined_at', p.joined_at,
        'progress_pct', CASE WHEN _b.question_count > 0
                             THEN round(100.0 * p.answered_count / _b.question_count) ELSE 0 END,
        'accuracy', CASE WHEN p.answered_count > 0
                         THEN round(100.0 * p.correct_count / p.answered_count) ELSE NULL END,
        'avg_ms', CASE WHEN p.answered_count > 0
                       THEN round(p.total_time_ms::numeric / p.answered_count) ELSE NULL END,
        'struggling', (p.answered_count >= 2 AND p.correct_count::numeric / p.answered_count < 0.4)
      ) ORDER BY p.score DESC, p.total_time_ms ASC)
      FROM public.battle_participants p WHERE p.battle_id = _battle_id
    ), '[]'::jsonb),
    'questions', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'order_index', q.order_index,
        'question', q.question,
        'attempts', COALESCE(s.attempts, 0),
        'correct', COALESCE(s.correct, 0),
        'accuracy', CASE WHEN COALESCE(s.attempts, 0) > 0
                         THEN round(100.0 * s.correct / s.attempts) ELSE NULL END
      ) ORDER BY q.order_index)
      FROM public.battle_questions q
      LEFT JOIN (
        SELECT ba.question_id,
               count(*) AS attempts,
               count(*) FILTER (WHERE ba.is_correct) AS correct
        FROM public.battle_answers ba
        JOIN public.battle_questions bq2 ON bq2.id = ba.question_id
        WHERE bq2.battle_id = _battle_id
        GROUP BY ba.question_id
      ) s ON s.question_id = q.id
      WHERE q.battle_id = _battle_id
    ), '[]'::jsonb)
  ) INTO _result;

  RETURN _result;
END $function$;

-- 4. rpc_mark_best_community_answer: admin/principal branch could accept
-- an answer on another school's doubt.
CREATE OR REPLACE FUNCTION public.rpc_mark_best_community_answer(_answer_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _uid uuid := auth.uid();
  _answer record;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'auth required'; END IF;

  SELECT a.id, a.doubt_id, a.user_id AS answer_user_id, d.user_id AS doubt_user_id, d.school_id
  INTO _answer
  FROM public.community_doubt_answers a
  JOIN public.community_doubts d ON d.id = a.doubt_id
  WHERE a.id = _answer_id;

  IF _answer.id IS NULL THEN RAISE EXCEPTION 'Answer not found'; END IF;
  IF _answer.doubt_user_id <> _uid
     AND NOT (public.has_role(_uid, 'admin') AND public.same_school(_answer.school_id))
     AND NOT (public.has_role(_uid, 'principal') AND public.same_school(_answer.school_id)) THEN
    RAISE EXCEPTION 'Only the doubt author can accept an answer';
  END IF;

  UPDATE public.community_doubt_answers SET is_accepted = false WHERE doubt_id = _answer.doubt_id;
  UPDATE public.community_doubt_answers SET is_accepted = true WHERE id = _answer_id;
  UPDATE public.community_doubts SET accepted_answer_id = _answer_id, status = 'solved', last_activity_at = now() WHERE id = _answer.doubt_id;
  PERFORM public._community_refresh_reputation(_answer.answer_user_id);
END $function$;

-- 5. rpc_principal_concept_analytics: CRITICAL -- had no school filter at
-- all on any of its four queries. Every principal/admin in the system saw
-- one global, cross-school-blended aggregate of every school's weak
-- concepts, subject performance, and recovery stats.
CREATE OR REPLACE FUNCTION public.rpc_principal_concept_analytics()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _uid uuid := auth.uid(); _school uuid;
BEGIN
  IF NOT public.has_role(_uid, 'admin') AND NOT public.has_role(_uid, 'principal') THEN
    RAISE EXCEPTION 'Principal or admin only';
  END IF;
  _school := public.get_my_school_id();
  IF _school IS NULL THEN RAISE EXCEPTION 'No school context for caller'; END IF;

  RETURN jsonb_build_object(
    'school_weak_concepts', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'subject', subject, 'concept', concept,
        'avg_mastery', round(avg(mastery_score), 1),
        'students_affected', count(DISTINCT user_id)
      ) ORDER BY avg(mastery_score) ASC), '[]'::jsonb)
      FROM public.concept_mastery
      WHERE mastery_score < 50 AND school_id = _school
      GROUP BY subject, concept
      LIMIT 12
    ),
    'subject_performance', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'subject', subject,
        'avg_mastery', round(avg(mastery_score), 1),
        'concepts_tracked', count(*)
      ) ORDER BY avg(mastery_score) ASC), '[]'::jsonb)
      FROM public.concept_mastery
      WHERE school_id = _school
      GROUP BY subject
    ),
    'recovery_rate', (
      SELECT CASE WHEN count(*) > 0
        THEN round(100.0 * count(*) FILTER (WHERE status = 'completed') / count(*), 1)
        ELSE 0 END
      FROM public.recovery_assignments
      WHERE school_id = _school
    ),
    'recovery_participation', (
      SELECT count(DISTINCT user_id)::int FROM public.recovery_assignments
      WHERE created_at >= now() - interval '30 days' AND school_id = _school
    )
  );
END; $function$;

-- 6. rpc_save_battle_ai_insights: admin/principal branch could overwrite
-- another school's battle report AI summary.
CREATE OR REPLACE FUNCTION public.rpc_save_battle_ai_insights(_participant_id uuid, _insights jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _uid uuid := auth.uid(); _owner uuid; _school uuid;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'auth required'; END IF;
  SELECT user_id, school_id INTO _owner, _school FROM public.battle_reports WHERE participant_id = _participant_id;
  IF _owner IS NULL THEN RAISE EXCEPTION 'Report not found'; END IF;
  IF _owner <> _uid
     AND NOT (public.has_role(_uid, 'admin') AND public.same_school(_school))
     AND NOT (public.has_role(_uid, 'principal') AND public.same_school(_school))
     AND NOT EXISTS (
       SELECT 1 FROM public.battle_reports br
       JOIN public.battles b ON b.id = br.battle_id
       WHERE br.participant_id = _participant_id
         AND (b.creator_user_id = _uid OR public.teacher_teaches_class(_uid, b.class_id))
     ) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  UPDATE public.battle_reports
    SET ai_insights = _insights
    WHERE participant_id = _participant_id;
END; $function$;

-- 7/8/9. rpc_teacher_class_insights / rpc_teacher_class_progression_insights /
-- rpc_teacher_concept_analytics: admin/principal branch had no school
-- check on _class_id at all -- any admin/principal could pull detailed
-- at-risk-student, XP, and concept-mastery data for any class in any
-- school. Fixed by resolving _class_id's own school_id once and requiring
-- same_school() for the admin/principal path (the teacher path already
-- implies same-school via teacher_teaches_class, unaffected).
CREATE OR REPLACE FUNCTION public.rpc_teacher_class_insights(_class_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _uid uuid := auth.uid(); _class_school uuid;
BEGIN
  SELECT school_id INTO _class_school FROM public.classes WHERE id = _class_id;
  IF _class_school IS NULL THEN RAISE EXCEPTION 'Class not found'; END IF;
  IF NOT (
    (public.has_role(_uid, 'admin') AND public.same_school(_class_school))
    OR (public.has_role(_uid, 'principal') AND public.same_school(_class_school))
    OR public.teacher_teaches_class(_uid, _class_id)
  ) THEN
    RAISE EXCEPTION 'Not authorized for this class';
  END IF;
  RETURN jsonb_build_object(
    'at_risk', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'student_id', s.id, 'name', s.full_name, 'roll', s.roll_number,
        'attendance_pct', sub.att_pct, 'avg_accuracy', sub.acc
      )), '[]'::jsonb)
      FROM public.students s
      JOIN LATERAL (
        SELECT
          CASE WHEN (SELECT count(*) FROM public.attendance att WHERE att.student_id = s.id) > 0
            THEN round(100.0 * (SELECT count(*) FROM public.attendance att WHERE att.student_id = s.id AND att.status = 'present')
                       / (SELECT count(*) FROM public.attendance att WHERE att.student_id = s.id), 1)
            ELSE 100 END AS att_pct,
          COALESCE((SELECT round(avg(CASE WHEN da.total_count > 0 THEN 100.0*da.correct_count/da.total_count END),1)
            FROM public.dpp_attempts da WHERE da.student_id = s.id AND da.status = 'submitted'), 0) AS acc
      ) sub ON true
      WHERE s.class_id = _class_id AND (sub.att_pct < 75 OR sub.acc < 55) LIMIT 15
    ),
    'improving', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object('student_id', s.id, 'name', s.full_name)), '[]'::jsonb)
      FROM public.students s JOIN public.student_xp x ON x.user_id = s.user_id
      WHERE s.class_id = _class_id AND x.win_streak >= 2 LIMIT 10
    ),
    'top_performers', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object('student_id', s.id, 'name', s.full_name, 'xp', x.xp)), '[]'::jsonb)
      FROM (
        SELECT s.id, s.full_name, x.xp
        FROM public.students s JOIN public.student_xp x ON x.user_id = s.user_id
        WHERE s.class_id = _class_id ORDER BY x.xp DESC LIMIT 5
      ) s JOIN public.student_xp x ON x.xp = s.xp
    ),
    'class_weak_topics', (
      SELECT COALESCE(jsonb_agg(row_to_json(t)), '[]'::jsonb)
      FROM (
        SELECT d.subject, d.chapter, round(100.0 * sum(CASE WHEN da.is_correct THEN 1 ELSE 0 END) / nullif(count(*),0), 1) AS accuracy
        FROM public.students s JOIN public.dpp_attempts att ON att.student_id = s.id AND att.status = 'submitted'
        JOIN public.dpps d ON d.id = att.dpp_id JOIN public.dpp_answers da ON da.attempt_id = att.id
        WHERE s.class_id = _class_id GROUP BY d.subject, d.chapter HAVING count(*) >= 5
        ORDER BY accuracy ASC LIMIT 5
      ) t
    )
  );
END; $function$;

CREATE OR REPLACE FUNCTION public.rpc_teacher_class_progression_insights(_class_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _caller uuid := auth.uid();
  _ok boolean := false;
  _class_school uuid;
BEGIN
  IF _caller IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  SELECT school_id INTO _class_school FROM public.classes WHERE id = _class_id;
  IF _class_school IS NULL THEN RAISE EXCEPTION 'Class not found'; END IF;
  IF (public.has_role(_caller, 'admin') OR public.has_role(_caller, 'principal'))
     AND public.same_school(_class_school) THEN
    _ok := true;
  ELSIF public.has_role(_caller, 'teacher') THEN
    _ok := EXISTS (
      SELECT 1 FROM public.teacher_classes tc
      JOIN public.teachers t ON t.id = tc.teacher_id
      WHERE t.user_id = _caller AND tc.class_id = _class_id
    );
  END IF;
  IF NOT _ok THEN RAISE EXCEPTION 'Not authorized for class insights'; END IF;

  RETURN jsonb_build_object(
    'top_xp', COALESCE((
      SELECT jsonb_agg(row_to_json(t))
      FROM (
        SELECT s.id AS student_id, s.full_name, COALESCE(x.xp, 0) AS xp,
               COALESCE(x.level, 1) AS level, COALESCE(x.league_code, 'bronze') AS league
        FROM public.students s
        LEFT JOIN public.student_xp x ON x.user_id = s.user_id
        WHERE s.class_id = _class_id AND s.user_id IS NOT NULL
        ORDER BY COALESCE(x.xp, 0) DESC
        LIMIT 10
      ) t
    ), '[]'::jsonb),
    'improvers', COALESCE((
      SELECT jsonb_agg(row_to_json(t))
      FROM (
        SELECT s.id AS student_id, s.full_name,
               COALESCE(SUM(CASE WHEN h.xp_delta > 0 THEN h.xp_delta ELSE 0 END), 0) AS xp_gained_7d
        FROM public.students s
        LEFT JOIN public.progression_history h
          ON h.user_id = s.user_id AND h.created_at >= now() - interval '7 days'
        WHERE s.class_id = _class_id AND s.user_id IS NOT NULL
        GROUP BY s.id, s.full_name
        HAVING COALESCE(SUM(CASE WHEN h.xp_delta > 0 THEN h.xp_delta ELSE 0 END), 0) > 0
        ORDER BY xp_gained_7d DESC
        LIMIT 10
      ) t
    ), '[]'::jsonb),
    'inactive', COALESCE((
      SELECT jsonb_agg(row_to_json(t))
      FROM (
        SELECT s.id AS student_id, s.full_name, x.last_activity_at
        FROM public.students s
        LEFT JOIN public.student_xp x ON x.user_id = s.user_id
        WHERE s.class_id = _class_id AND s.user_id IS NOT NULL
          AND (x.last_activity_at IS NULL OR x.last_activity_at < now() - interval '7 days')
        ORDER BY x.last_activity_at NULLS FIRST
        LIMIT 15
      ) t
    ), '[]'::jsonb),
    'consistent_practicers', COALESCE((
      SELECT jsonb_agg(row_to_json(t))
      FROM (
        SELECT s.id AS student_id, s.full_name,
               COALESCE(x.study_streak, 0) AS study_streak,
               COALESCE(x.practice_sessions_count, 0) AS practice_sessions
        FROM public.students s
        JOIN public.student_xp x ON x.user_id = s.user_id
        WHERE s.class_id = _class_id
          AND (COALESCE(x.study_streak, 0) >= 3 OR COALESCE(x.practice_sessions_count, 0) >= 5)
        ORDER BY x.study_streak DESC, x.practice_sessions_count DESC
        LIMIT 10
      ) t
    ), '[]'::jsonb),
    'class_engagement', (
      SELECT jsonb_build_object(
        'students', COUNT(*),
        'with_xp', COUNT(x.user_id),
        'avg_xp', COALESCE(ROUND(AVG(COALESCE(x.xp, 0))), 0),
        'avg_streak', COALESCE(ROUND(AVG(COALESCE(x.study_streak, 0))), 0),
        'avg_reputation', COALESCE(ROUND(AVG(COALESCE(x.reputation, 0))), 0),
        'practice_rate', CASE WHEN COUNT(*) = 0 THEN 0
          ELSE ROUND(100.0 * COUNT(*) FILTER (WHERE COALESCE(x.practice_sessions_count, 0) > 0) / COUNT(*)) END,
        'homework_rate', CASE WHEN COUNT(*) = 0 THEN 0
          ELSE ROUND(100.0 * COUNT(*) FILTER (WHERE COALESCE(x.homework_submitted_count, 0) > 0) / COUNT(*)) END
      )
      FROM public.students s
      LEFT JOIN public.student_xp x ON x.user_id = s.user_id
      WHERE s.class_id = _class_id AND s.user_id IS NOT NULL
    )
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.rpc_teacher_concept_analytics(_class_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _uid uuid := auth.uid(); _base jsonb; _class_school uuid;
BEGIN
  SELECT school_id INTO _class_school FROM public.classes WHERE id = _class_id;
  IF _class_school IS NULL THEN RAISE EXCEPTION 'Class not found'; END IF;
  IF NOT (
    (public.has_role(_uid, 'admin') AND public.same_school(_class_school))
    OR (public.has_role(_uid, 'principal') AND public.same_school(_class_school))
    OR public.teacher_teaches_class(_uid, _class_id)
  ) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  _base := public.rpc_teacher_class_insights(_class_id);

  RETURN _base || jsonb_build_object(
    'class_weak_concepts', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'subject', cm.subject, 'chapter', cm.chapter, 'concept', cm.concept,
        'avg_mastery', round(avg(cm.mastery_score), 1),
        'students', count(DISTINCT cm.user_id)
      ) ORDER BY avg(cm.mastery_score) ASC), '[]'::jsonb)
      FROM public.concept_mastery cm
      JOIN public.students s ON s.user_id = cm.user_id
      WHERE s.class_id = _class_id AND cm.mastery_score < 55
      GROUP BY cm.subject, cm.chapter, cm.concept
      LIMIT 10
    ),
    'student_weak_concepts', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'student_id', s.id, 'name', s.full_name,
        'concept', cm.concept, 'subject', cm.subject,
        'mastery_score', cm.mastery_score
      ) ORDER BY cm.mastery_score ASC), '[]'::jsonb)
      FROM public.concept_mastery cm
      JOIN public.students s ON s.user_id = cm.user_id
      WHERE s.class_id = _class_id AND cm.mastery_score < 45
      LIMIT 20
    ),
    'recovery_completion_rate', (
      SELECT CASE WHEN count(*) > 0
        THEN round(100.0 * count(*) FILTER (WHERE ra.status = 'completed') / count(*), 1)
        ELSE 0 END
      FROM public.recovery_assignments ra
      JOIN public.students s ON s.user_id = ra.user_id
      WHERE s.class_id = _class_id
    ),
    'mastery_distribution', (
      SELECT jsonb_build_object(
        'below_40', count(*) FILTER (WHERE cm.mastery_score < 40),
        '40_60', count(*) FILTER (WHERE cm.mastery_score >= 40 AND cm.mastery_score < 60),
        '60_80', count(*) FILTER (WHERE cm.mastery_score >= 60 AND cm.mastery_score < 80),
        'above_80', count(*) FILTER (WHERE cm.mastery_score >= 80)
      )
      FROM public.concept_mastery cm
      JOIN public.students s ON s.user_id = cm.user_id
      WHERE s.class_id = _class_id
    )
  );
END; $function$;

-- 10. rpc_teacher_doubt_dashboard: CRITICAL -- the "visible" CTE's admin/
-- principal branch had no school filter, so every school's community
-- doubts were visible to any admin/principal in the system.
CREATE OR REPLACE FUNCTION public.rpc_teacher_doubt_dashboard()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _uid uuid := auth.uid();
  _school uuid;
  _result jsonb;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'auth required'; END IF;
  IF NOT public.has_role(_uid, 'teacher') AND NOT public.has_role(_uid, 'admin') AND NOT public.has_role(_uid, 'principal') THEN
    RAISE EXCEPTION 'Teacher access required';
  END IF;
  _school := public.get_my_school_id();
  IF _school IS NULL THEN RAISE EXCEPTION 'No school context for caller'; END IF;

  WITH visible AS (
    SELECT *
    FROM public.community_doubts d
    WHERE d.school_id = _school
      AND (
        public.has_role(_uid, 'admin')
        OR public.has_role(_uid, 'principal')
        OR public.teacher_teaches_class_subject(_uid, d.class_id, d.subject, d.subject_id)
      )
  ),
  concepts AS (
    SELECT COALESCE(NULLIF(concept, ''), NULLIF(chapter, ''), subject, 'General') AS label,
           COUNT(*) AS total,
           COUNT(*) FILTER (WHERE status IN ('open', 'unsolved')) AS unresolved
    FROM visible
    GROUP BY 1
    ORDER BY total DESC
    LIMIT 8
  )
  SELECT jsonb_build_object(
    'unanswered', COALESCE((SELECT jsonb_agg(to_jsonb(v) ORDER BY v.created_at DESC) FROM (SELECT * FROM visible WHERE status IN ('open','unsolved') ORDER BY created_at DESC LIMIT 20) v), '[]'::jsonb),
    'attention', COALESCE((SELECT jsonb_agg(to_jsonb(v) ORDER BY v.view_count DESC, v.created_at ASC) FROM (SELECT * FROM visible WHERE status IN ('open','unsolved') ORDER BY view_count DESC, created_at ASC LIMIT 12) v), '[]'::jsonb),
    'concepts', COALESCE((SELECT jsonb_agg(to_jsonb(c)) FROM concepts c), '[]'::jsonb),
    'totals', jsonb_build_object(
      'open', (SELECT COUNT(*) FROM visible WHERE status IN ('open','unsolved')),
      'teacher_answered', (SELECT COUNT(*) FROM visible WHERE teacher_answered),
      'solved', (SELECT COUNT(*) FROM visible WHERE status = 'solved')
    )
  ) INTO _result;

  RETURN _result;
END $function$;

-- 11. rpc_parent_child_snapshot: the admin branch (used when a specific
-- _student_id is named) had no same_school check either -- an admin from
-- any school could read any student's full academic snapshot. Preserved
-- byte-for-byte from the version fixed earlier this session for the
-- parent_students join gap, except this one added check.
CREATE OR REPLACE FUNCTION public.rpc_parent_child_snapshot(_student_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _uid uuid := auth.uid(); _s record; _child_uid uuid;
BEGIN
  IF NOT public.has_role(_uid, 'parent') AND NOT public.has_role(_uid, 'admin') THEN
    RAISE EXCEPTION 'Parent only';
  END IF;
  SELECT s.* INTO _s FROM public.students s
    WHERE (_student_id IS NULL AND (
             s.parent_user_id = _uid
             OR EXISTS (SELECT 1 FROM public.parents p JOIN public.parent_students ps ON ps.parent_id = p.id WHERE p.user_id = _uid AND ps.student_id = s.id)
           ))
       OR (s.id = _student_id AND (
             s.parent_user_id = _uid
             OR EXISTS (SELECT 1 FROM public.parents p JOIN public.parent_students ps ON ps.parent_id = p.id WHERE p.user_id = _uid AND ps.student_id = s.id)
             OR (public.has_role(_uid, 'admin') AND public.same_school(s.school_id))
           ))
    LIMIT 1;
  IF _s IS NULL THEN RETURN '{}'::jsonb; END IF;
  _child_uid := _s.user_id;
  IF _child_uid IS NULL THEN
    RETURN jsonb_build_object('student', to_jsonb(_s), 'linked', false);
  END IF;
  RETURN jsonb_build_object('student', to_jsonb(_s), 'linked', true,
    'snapshot', (SELECT public.rpc_student_academic_snapshot_internal(_child_uid, _s.id)));
END; $function$;
