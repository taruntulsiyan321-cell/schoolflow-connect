-- ═══════════════════════════════════════════════════════════════════════════
-- Homework is counted in one place, and deleting it takes it out of every count
--
-- The product owner's homework specification, 2026-09-13
-- (docs/gurukul-spec-rules.md, "Homework — RULED 2026-09-13"): every student is
-- resolved to submitted or not submitted at the deadline, and a REJECTED
-- submission counts as NOT GIVEN. Builds on 20260925110000 (the model) and
-- 20260925120000 (the scheduler that drains class recounts).
--
-- ── WHAT COUNTED HOMEWORK, MEASURED ───────────────────────────────────────
--
-- Four routines counted homework, each its own way, and none agreed:
--   refresh_student_academic_profile   assigned = the class's published rows,
--       DELETED ones included; given = submissions IN ('submitted','graded')
--       from ANY homework, so late, reviewed and completed work was not given.
--   rpc_leaderboard ('homework')       denominator = every row of the class —
--       drafts, scheduled and deleted homework included.
--   rpc_student_academic_snapshot      the same unfiltered denominator, and
--       "pending" meant a missing row or status 'pending'.
--   _parent_weekly_digest              given = submitted_at IS NOT NULL, so a
--       returned (now: rejected) submission counted as done.
-- The client computed completion twice more, dividing by a roster that still
-- held deleted students. And nothing could delete published homework at all:
-- the API refused it, so teachers archived instead, and drafts were hard
-- deleted past the trash.
--
-- ── THE MODEL ─────────────────────────────────────────────────────────────
--
-- `homework_student_status` is THE one place a student's standing on a piece of
-- homework is decided. One row per student a homework is set to:
--   * only published, undeleted homework — what a student can read
--     (20260925100000) is exactly what they are counted on;
--   * the roster is the class's current students plus anyone who has a row,
--     until the homework is resolved; after resolution it is exactly the rows
--     resolve_closed_homework() froze, so a student who joins later is not
--     counted as having missed work set before they arrived;
--   * a deleted student is in nobody's count;
--   * `given` is submitted or accepted. Rejected is not given, and neither is
--     anything never handed in;
--   * `closed` is the deadline having passed. Completion is measured AT THE
--     DEADLINE (§10.12): a student is not behind on homework they still have
--     time to hand in, so every completion rate divides by closed homework.
-- `homework_completion` is its per-homework aggregate for staff screens.
-- Both are security_invoker: every caller sees exactly the rows RLS already
-- gives them, and neither calls a function, so no EXECUTE grant can hide them.
--
-- The four routines now read the view. They are SECURITY DEFINER, and a
-- definer reading a security_invoker view sees every school, so each one names
-- the student it is counting — none aggregates across the view unfenced.
--
-- `rpc_homework_delete(homework)` soft-deletes: a teacher of the class or an
-- admin of the school; drafts and published work alike go to the trash, which
-- already restores and purges them (`trash`, `rpc_restore_from_trash`,
-- `rpc_purge_expired`). What is computed on read — the leaderboard, the
-- snapshot, the digest, the completion view — drops the moment the row is
-- deleted, because all of it reads the one view. The stored profile drops when
-- the class recount queued by the homework.deleted fan-out is drained, which
-- the scheduler from 20260925120000 does within the minute, whoever is signed in.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. The one place ──────────────────────────────────────────────────────

CREATE VIEW public.homework_student_status WITH (security_invoker = true) AS
SELECT h.id AS homework_id,
       h.school_id,
       h.class_id,
       hs.student_id,
       hs.id AS submission_id,
       hs.status,
       hs.status IN ('submitted', 'accepted') AS given,
       h.closes_at,
       h.due_date,
       h.closes_at <= now() AS closed
  FROM public.homework_submissions hs
  JOIN public.homework h ON h.id = hs.homework_id
  JOIN public.students s ON s.id = hs.student_id
 WHERE h.status = 'published'
   AND h.deleted_at IS NULL
   AND s.deleted_at IS NULL
UNION ALL
SELECT h.id,
       h.school_id,
       h.class_id,
       s.id,
       NULL::uuid,
       'not_submitted'::text,
       false,
       h.closes_at,
       h.due_date,
       h.closes_at <= now()
  FROM public.homework h
  JOIN public.students s ON s.class_id = h.class_id AND s.school_id = h.school_id
 WHERE h.status = 'published'
   AND h.deleted_at IS NULL
   AND h.resolved_at IS NULL
   AND s.deleted_at IS NULL
   AND NOT EXISTS (SELECT 1 FROM public.homework_submissions hs
                    WHERE hs.homework_id = h.id AND hs.student_id = s.id);

COMMENT ON VIEW public.homework_student_status IS
  'THE one place a student''s standing on a homework is decided: one row per student a published, undeleted homework is set to. given = submitted or accepted (rejected is NOT given). closed = the deadline has passed; completion is measured at the deadline. security_invoker — callers see what RLS gives them; a SECURITY DEFINER reader must fence by student or school itself.';

CREATE VIEW public.homework_completion WITH (security_invoker = true) AS
SELECT homework_id,
       school_id,
       class_id,
       count(*)::int AS students,
       count(*) FILTER (WHERE given)::int AS given,
       count(*) FILTER (WHERE status = 'submitted')::int AS awaiting_review,
       count(*) FILTER (WHERE status = 'accepted')::int AS accepted,
       count(*) FILTER (WHERE status = 'rejected')::int AS rejected,
       count(*) FILTER (WHERE NOT given)::int AS not_given,
       round(100.0 * count(*) FILTER (WHERE given) / count(*), 1) AS completion_pct
  FROM public.homework_student_status
 GROUP BY homework_id, school_id, class_id;

COMMENT ON VIEW public.homework_completion IS
  'Per homework: how many students it is set to, and how many have given it (submitted or accepted). Rejected and never-handed-in are not_given. Read by the teacher and admin screens; derived entirely from homework_student_status.';

-- A new view in public is granted ALL to anon and authenticated by default.
REVOKE ALL ON public.homework_student_status, public.homework_completion FROM anon, authenticated;
GRANT SELECT ON public.homework_student_status, public.homework_completion TO authenticated;

-- ── 2. Deleting homework ──────────────────────────────────────────────────

CREATE FUNCTION public.rpc_homework_delete(_homework_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
  _hw public.homework%ROWTYPE;
BEGIN
  SELECT * INTO _hw FROM public.homework WHERE id = _homework_id FOR UPDATE;
  IF NOT FOUND OR _uid IS NULL OR NOT (
       public.teacher_teaches_class(_uid, _hw.class_id)
    OR (public.has_role(_uid, 'admin'::public.app_role) AND public.same_school(_hw.school_id))
  ) THEN
    RAISE EXCEPTION 'Not homework you can delete' USING ERRCODE = '42501';
  END IF;
  IF _hw.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'This homework is already deleted' USING ERRCODE = '55000';
  END IF;

  UPDATE public.homework
     SET deleted_at = now(), deleted_by = _uid
   WHERE id = _homework_id
  RETURNING * INTO _hw;

  RETURN jsonb_build_object('id', _hw.id, 'deleted_at', _hw.deleted_at);
END;
$$;

COMMENT ON FUNCTION public.rpc_homework_delete(uuid) IS
  'A teacher of the class, or an admin of the school, deletes homework — draft or published — to the trash. It leaves every student''s count at once (homework_student_status excludes it; the class''s stored profiles recount through the homework.deleted fan-out). Restored or purged by the trash.';

GRANT EXECUTE ON FUNCTION public.rpc_homework_delete(uuid) TO authenticated;

-- ── 3. The four counters read the one place ───────────────────────────────

CREATE OR REPLACE FUNCTION public.refresh_student_academic_profile(_student_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _school uuid;
  _class uuid;
  _profile uuid;
  _att_present int := 0;
  _att_total int := 0;
  _hw_assigned int := 0;
  _hw_submitted int := 0;
  _tests_n int := 0;
  _tests_avg numeric := 0;
  _exams_n int := 0;
  _exams_avg numeric := 0;
  _practice_n int := 0;
  _practice_avg numeric := 0;
  _doubts_asked int := 0;
  _doubts_resolved int := 0;
  _remarks int := 0;
  _user uuid;
  _student_name text;
  _att_pct numeric;
  _hw_pct numeric;
  _new_att_band text;
  _new_hw_band text;
  _prev_att_band text;
  _prev_hw_band text;
BEGIN
  SELECT school_id, class_id, user_id, full_name
    INTO _school, _class, _user, _student_name
  FROM public.students
  WHERE id = _student_id;

  IF _school IS NULL THEN
    RAISE EXCEPTION 'student % not found', _student_id;
  END IF;

  PERFORM public.ensure_student_academic_profile(_student_id);

  SELECT attendance_risk_band, homework_consistency_band
    INTO _prev_att_band, _prev_hw_band
  FROM public.student_academic_profiles
  WHERE student_id = _student_id;

  SELECT
    count(*) FILTER (WHERE status = 'present'),
    count(*)
  INTO _att_present, _att_total
  FROM public.attendance_current
  WHERE student_id = _student_id;

  -- Homework whose deadline has passed, and how much of it was given.
  -- homework_student_status is the one place both are decided.
  SELECT count(*) FILTER (WHERE hss.closed),
         count(*) FILTER (WHERE hss.closed AND hss.given)
    INTO _hw_assigned, _hw_submitted
    FROM public.homework_student_status hss
   WHERE hss.student_id = _student_id;

  SELECT count(*), coalesce(avg(
    CASE WHEN max_score > 0 THEN (score::numeric / max_score) * 100 ELSE NULL END
  ), 0)
  INTO _tests_n, _tests_avg
  FROM public.test_attempts
  WHERE (student_id = _student_id OR (_user IS NOT NULL AND user_id = _user))
    AND status = 'submitted';

  SELECT count(*), coalesce(avg(
    CASE
      WHEN e.max_marks IS NOT NULL AND e.max_marks > 0
        THEN (m.marks_obtained / e.max_marks) * 100
      ELSE NULL
    END
  ), 0)
  INTO _exams_n, _exams_avg
  FROM public.marks m
  JOIN public.exams e ON e.id = m.exam_id
  WHERE m.student_id = _student_id;

  SELECT count(*), coalesce(avg(
    CASE WHEN question_count > 0 THEN (correct_count::numeric / question_count) * 100 ELSE NULL END
  ), 0)
  INTO _practice_n, _practice_avg
  FROM public.practice_sessions
  WHERE student_id = _student_id
     OR (_user IS NOT NULL AND user_id = _user);

  SELECT count(*),
         count(*) FILTER (WHERE status IN ('solved', 'teacher_answered', 'community_solved'))
  INTO _doubts_asked, _doubts_resolved
  FROM public.community_doubts
  WHERE student_id = _student_id
     OR (_user IS NOT NULL AND user_id = _user);

  SELECT count(*) INTO _remarks
  FROM public.teacher_remarks
  WHERE student_id = _student_id;

  _att_pct := CASE WHEN _att_total > 0 THEN round((_att_present::numeric / _att_total) * 100, 2) ELSE 0 END;
  _hw_pct := CASE WHEN _hw_assigned > 0 THEN round(_hw_submitted::numeric / _hw_assigned * 100, 2) ELSE 0 END;
  _new_att_band := public._eie_attendance_risk_band(CASE WHEN _att_total > 0 THEN _att_pct ELSE NULL END);
  _new_hw_band := public._eie_homework_consistency_band(CASE WHEN _hw_assigned > 0 THEN _hw_pct ELSE NULL END);

  UPDATE public.student_academic_profiles SET
    attendance_present = _att_present,
    attendance_total = _att_total,
    attendance_pct = _att_pct,
    attendance_risk_band = _new_att_band,
    homework_assigned = _hw_assigned,
    homework_submitted = _hw_submitted,
    homework_completion_pct = _hw_pct,
    homework_consistency_band = _new_hw_band,
    tests_attempted = _tests_n,
    tests_avg_pct = round(coalesce(_tests_avg, 0), 2),
    exams_recorded = _exams_n,
    exams_avg_pct = round(coalesce(_exams_avg, 0), 2),
    practice_sessions = _practice_n,
    practice_accuracy_pct = round(coalesce(_practice_avg, 0), 2),
    doubts_asked = coalesce(_doubts_asked, 0),
    doubts_resolved = coalesce(_doubts_resolved, 0),
    remarks_count = _remarks,
    last_event_type = 'student.profile.refreshed',
    last_event_at = now(),
    refreshed_at = now(),
    updated_at = now()
  WHERE student_id = _student_id
  RETURNING id INTO _profile;

  -- Alert only on a genuine worsening transition into elevated/high, with a
  -- minimum sample size so a single bad day never triggers a false alarm.
  IF _att_total >= 5
     AND public._eie_band_severity(_new_att_band) > public._eie_band_severity(coalesce(_prev_att_band, 'unknown'))
     AND public._eie_band_severity(_new_att_band) >= 2
  THEN
    PERFORM public._notify_student_circle(
      _student_id, 'attendance.risk_alert', 'Attendance needs attention',
      format('Attendance is at %s%% (%s of %s days) — this has moved into the "%s" range. Reach out to the class teacher if something is going on.',
             _att_pct, _att_present, _att_total, _new_att_band),
      'alert-triangle', '/parent'
    );
    IF _class IS NOT NULL THEN
      PERFORM public._notify_class_teacher(
        _class, 'attendance.risk_alert', 'Student attendance risk: ' || coalesce(_student_name, 'a student'),
        format('%s%% attendance (%s of %s days present) — %s risk band.', _att_pct, _att_present, _att_total, _new_att_band),
        'alert-triangle', '/teacher/attendance'
      );
    END IF;
  END IF;

  IF _hw_assigned >= 3
     AND public._eie_band_severity(_new_hw_band) > public._eie_band_severity(coalesce(_prev_hw_band, 'unknown'))
     AND public._eie_band_severity(_new_hw_band) >= 2
  THEN
    PERFORM public._notify_student_circle(
      _student_id, 'homework.risk_alert', 'Homework consistency needs attention',
      format('Only %s of %s homework handed in by the deadline (%s%%) — this has moved into the "%s" range.',
             _hw_submitted, _hw_assigned, _hw_pct, _new_hw_band),
      'alert-triangle', '/parent'
    );
    IF _class IS NOT NULL THEN
      PERFORM public._notify_class_teacher(
        _class, 'homework.risk_alert', 'Homework consistency risk: ' || coalesce(_student_name, 'a student'),
        format('%s of %s homework handed in by the deadline (%s%%) — %s risk band.', _hw_submitted, _hw_assigned, _hw_pct, _new_hw_band),
        'alert-triangle', '/teacher'
      );
    END IF;
  END IF;

  RETURN _profile;
END;
$function$;

CREATE OR REPLACE FUNCTION public.rpc_leaderboard(_scope text DEFAULT 'class'::text, _category text DEFAULT 'xp'::text, _subject text DEFAULT NULL::text, _limit integer DEFAULT 50)
 RETURNS TABLE(user_id uuid, full_name text, roll_number text, class_label text, score numeric, detail text, equipped_badge text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _cls uuid;
  _school uuid;
BEGIN
  SELECT s.class_id, s.school_id INTO _cls, _school
  FROM public.students_current s
  WHERE s.user_id = auth.uid()
  LIMIT 1;

  _school := coalesce(_school, public.get_my_school_id());

  IF _school IS NULL THEN
    RAISE EXCEPTION 'No school context';
  END IF;

  IF lower(coalesce(_scope, 'class')) <> 'school' AND _cls IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  WITH base AS (
    SELECT s.user_id AS uid, s.id AS sid, s.class_id AS cid, s.full_name, s.roll_number,
           COALESCE(c.name || '-' || c.section, 'Unassigned') AS class_label
    FROM public.students_current s
    LEFT JOIN public.classes c ON c.id = s.class_id
    WHERE s.user_id IS NOT NULL
      AND s.school_id = _school
      AND (
        lower(coalesce(_scope, 'class')) = 'school'
        OR s.class_id = _cls
      )
  ),
  scored AS (
    SELECT
      b.uid, b.full_name, b.roll_number, b.class_label,
      CASE _category
        WHEN 'xp'      THEN COALESCE(x.xp, 0)::numeric
        WHEN 'wins'    THEN COALESCE(x.wins, 0)::numeric
        -- Study streak SSOT (Progression Engine). Battle win streak remains on win_streak.
        WHEN 'streak'  THEN COALESCE(x.study_streak, 0)::numeric
        WHEN 'weekly'  THEN COALESCE((SELECT SUM(bp.score) FROM public.battle_participants bp
                                       WHERE bp.user_id = b.uid AND bp.joined_at >= date_trunc('week', now())), 0)::numeric
        WHEN 'monthly' THEN COALESCE((SELECT SUM(bp.score) FROM public.battle_participants bp
                                       WHERE bp.user_id = b.uid AND bp.joined_at >= date_trunc('month', now())), 0)::numeric
        WHEN 'subject' THEN COALESCE((SELECT SUM(bp.score) FROM public.battle_participants bp
                                       JOIN public.battles bt ON bt.id = bp.battle_id
                                       WHERE bp.user_id = b.uid AND _subject IS NOT NULL
                                         AND lower(bt.subject) = lower(_subject)), 0)::numeric
        WHEN 'marks' THEN COALESCE((
            SELECT CASE WHEN SUM(e.max_marks) > 0
                        THEN ROUND(SUM(m.marks_obtained)::numeric / SUM(e.max_marks) * 100, 1) ELSE 0 END
            FROM public.marks m JOIN public.exams e ON e.id = m.exam_id
            WHERE m.student_id = b.sid), 0)::numeric
        WHEN 'attendance' THEN COALESCE((
            SELECT CASE WHEN COUNT(*) > 0
                        THEN ROUND(COUNT(*) FILTER (WHERE a.status = 'present')::numeric / COUNT(*) * 100, 0) ELSE 0 END
            FROM public.attendance_current a WHERE a.student_id = b.sid), 0)::numeric
        -- Homework handed in by the deadline, of the homework whose deadline has
        -- passed. homework_student_status is the one place both are decided.
        WHEN 'homework' THEN COALESCE((
            SELECT CASE WHEN count(*) FILTER (WHERE hss.closed) > 0
                        THEN ROUND(count(*) FILTER (WHERE hss.closed AND hss.given)::numeric
                                   / count(*) FILTER (WHERE hss.closed) * 100, 0)
                        ELSE 0 END
            FROM public.homework_student_status hss WHERE hss.student_id = b.sid), 0)::numeric
        WHEN 'test' THEN COALESCE((
            SELECT ROUND(AVG(best), 0) FROM (
              SELECT MAX(CASE WHEN da.max_score > 0 THEN da.score::numeric / da.max_score * 100 ELSE 0 END) AS best
              FROM public.test_attempts da JOIN public.tests dp ON dp.id = da.test_id
              WHERE da.user_id = b.uid AND da.status = 'submitted' AND dp.status = 'published'
              GROUP BY da.test_id) t), 0)::numeric
        ELSE COALESCE(x.xp, 0)::numeric
      END AS score,
      CASE _category
        WHEN 'xp'     THEN 'Lvl ' || COALESCE(x.level,1) || ' · ' || COALESCE(x.wins,0) || ' wins'
        WHEN 'wins'   THEN COALESCE(x.total_battles,0) || ' battles'
        WHEN 'streak' THEN COALESCE(x.study_streak,0) || '-day study streak'
        ELSE NULL
      END AS detail,
      x.equipped_badge AS equipped_badge
    FROM base b
    LEFT JOIN public.student_xp x ON x.user_id = b.uid
  )
  SELECT s.uid, s.full_name, s.roll_number, s.class_label, s.score, s.detail, s.equipped_badge
  FROM scored s
  ORDER BY s.score DESC, s.full_name ASC
  LIMIT GREATEST(_limit, 1);
END;
$function$;

CREATE OR REPLACE FUNCTION public.rpc_student_academic_snapshot()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _uid uuid := auth.uid(); _s record; _xp record;
  _hw_pending int := 0; _hw_done int := 0; _test_open int := 0; _test_done int := 0;
  _weak jsonb; _rev jsonb; _mistakes int; _heat jsonb;
  _recovery_pending int := 0; _mastery_summary jsonb; _practice_sessions int := 0;
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

  SELECT count(*)::int INTO _practice_sessions
  FROM public.practice_sessions WHERE user_id = _uid AND finished_at IS NOT NULL;

  SELECT COALESCE(jsonb_agg(row_to_json(w) ORDER BY w.accuracy ASC), '[]'::jsonb)
    INTO _weak FROM public._weak_topics_for_user(_uid) w WHERE w.accuracy < 60 LIMIT 5;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'date', activity_date, 'test', test_count, 'homework', homework_count,
    'battles', battle_count, 'self_practice', self_practice_count, 'minutes', practice_minutes
  ) ORDER BY activity_date), '[]'::jsonb)
    INTO _heat FROM public.academic_daily_activity
    WHERE user_id = _uid AND activity_date >= CURRENT_DATE - 28;

  SELECT count(*) INTO _mistakes FROM public.student_mistakes
    WHERE user_id = _uid AND status = 'open';

  SELECT count(*)::int INTO _recovery_pending FROM public.recovery_assignments
    WHERE user_id = _uid AND status IN ('pending', 'in_progress');

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'subject', subject, 'concept', concept, 'mastery_score', mastery_score
  ) ORDER BY mastery_score ASC), '[]'::jsonb)
    INTO _mastery_summary
  FROM public.concept_mastery WHERE user_id = _uid AND mastery_score < 60 LIMIT 5;

  PERFORM public._rebuild_revision_queue(_uid, _s.id);

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', id, 'subject', subject, 'topic', topic, 'chapter', chapter,
    'priority', priority, 'due_date', due_date, 'reason', reason
  ) ORDER BY priority DESC, due_date ASC), '[]'::jsonb)
    INTO _rev FROM public.revision_queue
    WHERE user_id = _uid AND NOT completed LIMIT 10;

  RETURN jsonb_build_object(
    'student', CASE WHEN _s.id IS NULL THEN NULL ELSE jsonb_build_object(
      'id', _s.id, 'full_name', _s.full_name, 'class_id', _s.class_id,
      'roll_number', _s.roll_number, 'admission_number', _s.admission_number
    ) END,
    'xp', CASE WHEN _xp IS NULL THEN NULL ELSE to_jsonb(_xp) END,
    'homework', jsonb_build_object('pending', _hw_pending, 'completed', _hw_done),
    'test', jsonb_build_object('open', _test_open, 'completed', _test_done),
    'self_practice', jsonb_build_object('sessions_completed', _practice_sessions),
    'weak_topics', _weak,
    'revision_queue', _rev,
    'mistake_count', _mistakes,
    'recovery_pending', _recovery_pending,
    'weak_concepts', _mastery_summary,
    'activity_heatmap', _heat,
    'exam_readiness', public._exam_readiness(_uid, _s.id)
  );
END; $function$;

CREATE OR REPLACE FUNCTION public._parent_weekly_digest(_parent uuid, _from date, _to date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _result jsonb := '[]'::jsonb;
  _child  record;
  _att    jsonb;
  _hw     jsonb;
  _remark jsonb;
  _tm     jsonb;
BEGIN
  FOR _child IN
    SELECT s.*
      FROM public.students s
     WHERE s.deleted_at IS NULL
       AND (
         s.parent_user_id = _parent
         OR EXISTS (
           SELECT 1 FROM public.parents p
             JOIN public.parent_students ps ON ps.parent_id = p.id
            WHERE p.user_id = _parent AND ps.student_id = s.id
         )
       )
  LOOP
    -- ── 1. ATTENDANCE ─────────────────────────────────────────────────────
    -- attendance carries no date of its own; the day lives on the submission.
    SELECT jsonb_build_object(
             'present',  count(*) FILTER (WHERE att.status = 'present'),
             'absent',   count(*) FILTER (WHERE att.status = 'absent'),
             'late',     count(*) FILTER (WHERE att.status = 'late'),
             'leave',    count(*) FILTER (WHERE att.status = 'leave'),
             'half_day', count(*) FILTER (WHERE att.status = 'half_day'),
             'marked',   count(*),
             -- NULL, not 0, when nothing was marked. A child with no attendance
             -- record this week has an UNKNOWN rate, not a rate of zero.
             'pct',      CASE WHEN count(*) = 0 THEN NULL
                              ELSE round(100.0 * count(*) FILTER (WHERE att.status IN ('present','late','half_day'))
                                         / count(*), 1) END
           )
      INTO _att
      FROM public.attendance att
      JOIN public.attendance_submissions sub ON sub.id = att.submission_id
     WHERE att.student_id = _child.id
       AND sub.date BETWEEN _from AND _to;

    -- ── 2 & 3. HOMEWORK, completed and not completed ──────────────────────
    -- §10.12: completion is measured AT THE DUE DATE, so the window is on
    -- due_date and only homework whose deadline has passed is counted.
    -- `submitted` keeps its key for the screens that read it and means GIVEN
    -- (submitted or accepted): a rejected submission is not completed.
    -- `not_completed` is stated rather than left to subtraction — rule 17
    -- names both halves. homework_student_status is the one place both are
    -- decided.
    SELECT jsonb_build_object(
             'due',           count(*),
             'submitted',     count(*) FILTER (WHERE hss.given),
             'not_completed', count(*) FILTER (WHERE NOT hss.given),
             'pct',           CASE WHEN count(*) = 0 THEN NULL
                                   ELSE round(100.0 * count(*) FILTER (WHERE hss.given) / count(*), 1) END
           )
      INTO _hw
      FROM public.homework_student_status hss
     WHERE hss.student_id = _child.id
       AND hss.closed
       AND hss.due_date BETWEEN _from AND _to;

    -- ── 4. A TEACHER'S REMARK, IF ONE EXISTS ──────────────────────────────
    -- "If one exists" is the whole contract: no remark is `null`, not an empty
    -- string and not a cheerful placeholder.
    --
    -- VISIBILITY IS RESPECTED AND THE FILTER FAILS CLOSED. `visibility`
    -- defaults to 'parent_student' and has no CHECK constraint, so other values
    -- can exist. Matching on '%parent%' includes every parent-visible variant
    -- and excludes anything else — an unrecognised value keeps the remark out
    -- of the parent's digest rather than into it. §10.14 says the parent sees a
    -- remark immediately, but "the parent sees remarks" is not "the parent sees
    -- every row in this table".
    --
    -- `edited_at` is carried because §10.14 asks for an edited marker: a remark
    -- the parent already read, later changed, must not arrive looking original.
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
             'remark',     r.body,
             'kind',       r.remark_type,
             'created_at', r.created_at,
             'edited_at',  r.edited_at
           ) ORDER BY r.created_at DESC), '[]'::jsonb)
      INTO _remark
      FROM public.teacher_remarks r
     WHERE r.student_id = _child.id
       AND r.deleted_at IS NULL
       AND COALESCE(r.visibility, '') LIKE '%parent%'
       AND r.created_at::date BETWEEN _from AND _to;

    -- ── 5. TEST MARKS, where the test was conducted online ────────────────
    -- The online test is identified by having attempts: tests.test_kind is NULL
    -- on every row, so there is no explicit marker to read. This EXISTS is the
    -- only place that inference lives; change it here and nowhere else.
    SELECT jsonb_build_object(
             'count',  count(*),
             'tests',  COALESCE(jsonb_agg(jsonb_build_object(
                         'test',    t.title,
                         'scored',  tm.mark,
                         'out_of',  t.max_mark,
                         'pct',     CASE WHEN t.max_mark IS NULL OR t.max_mark = 0 THEN NULL
                                         ELSE round(100.0 * tm.mark / t.max_mark, 1) END
                       ) ORDER BY tm.uploaded_at DESC NULLS LAST), '[]'::jsonb)
           )
      INTO _tm
      FROM public.test_marks tm
      JOIN public.tests t ON t.id = tm.test_id
     WHERE tm.student_id = _child.id
       AND t.deleted_at IS NULL
       AND EXISTS (SELECT 1 FROM public.test_attempts a WHERE a.test_id = t.id)
       AND COALESCE(tm.uploaded_at, tm.created_at)::date BETWEEN _from AND _to;

    -- EXAM MARKS ARE DELIBERATELY ABSENT. They live in the exam report, which
    -- is available to parents all year; carrying them here duplicated that
    -- surface and left a key that is empty in every week without an exam.
    -- Restoring them means restoring the join too — see the rollback.

    _result := _result || jsonb_build_array(jsonb_build_object(
      'student_id',  _child.id,
      'name',        _child.full_name,
      'class',       (SELECT COALESCE(display_name, name || '-' || section)
                        FROM public.classes WHERE id = _child.class_id),
      'attendance',  COALESCE(_att,    jsonb_build_object('marked', 0, 'pct', NULL)),
      'homework',    COALESCE(_hw,     jsonb_build_object('due', 0, 'pct', NULL)),
      'remarks',     COALESCE(_remark, '[]'::jsonb),
      'test_marks',  COALESCE(_tm,     jsonb_build_object('count', 0, 'tests', '[]'::jsonb))
    ));
  END LOOP;

  RETURN jsonb_build_object(
    'window',       jsonb_build_object('starts_on', _from, 'ends_on', _to),
    'children',     _result,
    'generated_at', now()
  );
END;
$function$;

-- ── 4. Proof ──────────────────────────────────────────────────────────────

-- One savepoint that always ends by raising P0999, as in 20260925110000:
-- nothing the proof publishes, closes, awards or deletes survives it.
DO $verify$
DECLARE
  _school uuid; _class uuid; _teacher uuid; _other_teacher uuid; _other_tid uuid; _parent_user uuid;
  _a uuid; _ua uuid; _b uuid; _ub uuid; _c uuid; _d uuid;
  _open uuid; _closing uuid; _n int; _m int; _refused boolean; _j jsonb; _row record;
BEGIN
BEGIN
  -- A signed-in student with a signed-in parent, in a section with a
  -- signed-in teacher; chosen through memberships, not has_role/2 (no caller).
  SELECT s.school_id, s.class_id, t.user_id, s.id, s.user_id, p.user_id
    INTO _school, _class, _teacher, _a, _ua, _parent_user
    FROM public.students s
    JOIN public.teacher_classes tc ON tc.class_id = s.class_id
    JOIN public.teachers t ON t.id = tc.teacher_id AND t.user_id IS NOT NULL AND t.deleted_at IS NULL
    JOIN public.memberships m ON m.local_person_id = t.id AND m.role = 'teacher'
                             AND m.status = 'active' AND m.school_id = s.school_id
    JOIN public.parent_students ps ON ps.student_id = s.id
    JOIN public.parents p ON p.id = ps.parent_id AND p.user_id IS NOT NULL
   WHERE s.user_id IS NOT NULL AND s.deleted_at IS NULL
     AND (SELECT count(*) FROM public.students x WHERE x.class_id = s.class_id AND x.deleted_at IS NULL) >= 4
     AND EXISTS (SELECT 1 FROM public.students x WHERE x.class_id = s.class_id AND x.deleted_at IS NULL
                  AND x.user_id IS NOT NULL AND x.id <> s.id)
   LIMIT 1;
  IF _parent_user IS NULL THEN
    RAISE EXCEPTION 'ROLLED BACK: need a section of four students with a signed-in teacher, a signed-in student with a signed-in parent, and a second signed-in student';
  END IF;
  SELECT id, user_id INTO _b, _ub FROM public.students
   WHERE class_id = _class AND deleted_at IS NULL AND user_id IS NOT NULL AND id <> _a ORDER BY id LIMIT 1;
  SELECT id INTO _c FROM public.students
   WHERE class_id = _class AND deleted_at IS NULL AND id NOT IN (_a, _b) ORDER BY id LIMIT 1;
  SELECT id INTO _d FROM public.students
   WHERE class_id = _class AND deleted_at IS NULL AND id NOT IN (_a, _b, _c) ORDER BY id LIMIT 1;

  SELECT t.id, t.user_id INTO _other_tid, _other_teacher
    FROM public.teachers t
    JOIN public.memberships m ON m.local_person_id = t.id AND m.role = 'teacher'
                             AND m.status = 'active' AND m.school_id = _school
   WHERE t.user_id IS NOT NULL AND t.user_id <> _teacher AND t.deleted_at IS NULL
   LIMIT 1;
  IF _other_teacher IS NULL THEN
    RAISE EXCEPTION 'ROLLED BACK: need a second signed-in teacher in the school to prove the delete fence';
  END IF;
  DELETE FROM public.teacher_classes WHERE teacher_id = _other_tid AND class_id = _class;
  UPDATE public.teachers SET class_teacher_of = NULL WHERE id = _other_tid AND class_teacher_of = _class;

  -- Exact counts need a class with no other homework: its existing homework
  -- goes to the trash inside this savepoint, and the recount it queues is
  -- drained the way the scheduler drains it.
  UPDATE public.homework SET deleted_at = now() WHERE class_id = _class AND deleted_at IS NULL;
  LOOP EXIT WHEN public.process_pending_academic_events(500) = 0; END LOOP;

  -- The teacher publishes two homework, both open.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', _teacher, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  INSERT INTO public.homework (school_id, class_id, subject, title, description, closes_at, status)
  VALUES (_school, _class, 'Mathematics', '[verify 20260925130000] open', 'q', now() + interval '2 days', 'published')
  RETURNING id INTO _open;
  INSERT INTO public.homework (school_id, class_id, subject, title, description, closes_at, status)
  VALUES (_school, _class, 'Mathematics', '[verify 20260925130000] closing', 'q', now() + interval '2 days', 'published')
  RETURNING id INTO _closing;
  RESET ROLE;

  -- Three hand-ins on the second: A rejected, B accepted, C awaiting review.
  -- Written directly (the hand-in path is proven in 20260925110000); each one
  -- refreshes that student's profile through its event.
  INSERT INTO public.homework_submissions (homework_id, student_id, school_id, status, file, submitted_at, decided_at, decided_by)
  VALUES (_closing, _a, _school, 'rejected', '{"path":"x/a.pdf","name":"a.pdf","mime":"application/pdf"}', now(), now(), _teacher),
         (_closing, _b, _school, 'accepted', '{"path":"x/b.pdf","name":"b.pdf","mime":"application/pdf"}', now(), now(), _teacher),
         (_closing, _c, _school, 'submitted', '{"path":"x/c.pdf","name":"c.pdf","mime":"application/pdf"}', now(), NULL, NULL);

  -- Its deadline passes. Nothing has recounted yet: completion is measured at
  -- the deadline, and until the closure runs the stored profile still says 0.
  UPDATE public.homework SET closes_at = now() - interval '1 minute' WHERE id = _closing;
  SELECT homework_assigned INTO _n FROM public.student_academic_profiles WHERE student_id = _a;
  IF _n IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION 'ROLLED BACK: the profile counted % homework before any deadline was measured, expected 0', _n;
  END IF;

  -- 1. The closure resolves it and queues the class recount; the scheduler's
  --    drain applies it. Before the drain the stored profile has not moved —
  --    the recount really does travel through the queue.
  PERFORM set_config('request.jwt.claims', '', true);
  PERFORM public.resolve_closed_homework();
  SELECT homework_assigned INTO _n FROM public.student_academic_profiles WHERE student_id = _a;
  IF _n IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION 'ROLLED BACK: the closure recounted the profile inside its own write (% assigned), so the queue is not what is being proven', _n;
  END IF;
  LOOP EXIT WHEN public.process_pending_academic_events(500) = 0; END LOOP;
  SELECT homework_assigned, homework_submitted INTO _n, _m FROM public.student_academic_profiles WHERE student_id = _a;
  IF (_n, _m) IS DISTINCT FROM (1, 0) THEN
    RAISE EXCEPTION 'ROLLED BACK: a rejected submission counted as given in the profile (% assigned, % given)', _n, _m;
  END IF;
  SELECT homework_assigned, homework_submitted INTO _n, _m FROM public.student_academic_profiles WHERE student_id = _b;
  IF (_n, _m) IS DISTINCT FROM (1, 1) THEN
    RAISE EXCEPTION 'ROLLED BACK: after the closure student B''s profile reads % assigned, % given; expected 1, 1', _n, _m;
  END IF;

  -- 2. The teacher's completion for it: every current student, rejected not given.
  SELECT count(*) INTO _m FROM public.students WHERE class_id = _class AND school_id = _school AND deleted_at IS NULL;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', _teacher, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  SELECT * INTO _row FROM public.homework_completion WHERE homework_id = _closing;
  RESET ROLE;
  IF (_row.students, _row.given, _row.accepted, _row.awaiting_review, _row.rejected, _row.not_given)
     IS DISTINCT FROM (_m, 2, 1, 1, 1, _m - 2) THEN
    RAISE EXCEPTION 'ROLLED BACK: the teacher''s completion read % students, % given, % accepted, % awaiting, % rejected, % not given; the class has %',
      _row.students, _row.given, _row.accepted, _row.awaiting_review, _row.rejected, _row.not_given, _m;
  END IF;

  -- 3. A deleted student leaves the denominator — for the teacher, and for the
  --    SECURITY DEFINER counters, which read the view as its owner. RLS on
  --    students already hides a deleted student from the teacher, so only the
  --    owner's read shows whether the view itself excludes them, on resolved
  --    homework and on open homework alike.
  UPDATE public.students SET deleted_at = now() WHERE id = _d;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', _teacher, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  SELECT students INTO _n FROM public.homework_completion WHERE homework_id = _closing;
  RESET ROLE;
  IF _n IS DISTINCT FROM _m - 1 THEN
    RAISE EXCEPTION 'ROLLED BACK: deleting a student left the teacher''s completion denominator at %, expected %', _n, _m - 1;
  END IF;
  PERFORM set_config('request.jwt.claims', '', true);
  SELECT students INTO _n FROM public.homework_completion WHERE homework_id = _closing;
  IF _n IS DISTINCT FROM _m - 1 THEN
    RAISE EXCEPTION 'ROLLED BACK: a deleted student is still counted on resolved homework when the view is read as its owner (% students, expected %)', _n, _m - 1;
  END IF;
  SELECT students INTO _n FROM public.homework_completion WHERE homework_id = _open;
  IF _n IS DISTINCT FROM _m - 1 THEN
    RAISE EXCEPTION 'ROLLED BACK: a deleted student is still counted on open homework when the view is read as its owner (% students, expected %)', _n, _m - 1;
  END IF;

  -- 4. A student reads their own standing and nobody else's; anon reads nothing.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', _ua, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) FILTER (WHERE student_id = _a AND homework_id IN (_open, _closing)),
         count(*) FILTER (WHERE student_id <> _a)
    INTO _n, _m FROM public.homework_student_status;
  RESET ROLE;
  IF _n <> 2 OR _m <> 0 THEN
    RAISE EXCEPTION 'ROLLED BACK: a student read % of their own homework rows (expected 2) and % of other students''', _n, _m;
  END IF;
  _refused := false;
  PERFORM set_config('request.jwt.claims', '', true);
  SET LOCAL ROLE anon;
  BEGIN
    PERFORM 1 FROM public.homework_student_status LIMIT 1;
  EXCEPTION WHEN insufficient_privilege THEN _refused := true;
  END;
  RESET ROLE;
  IF NOT _refused THEN RAISE EXCEPTION 'ROLLED BACK: anon read homework standing'; END IF;

  -- 5. The snapshot, the leaderboard and the digest agree with the profile.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', _ub, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  _j := public.rpc_student_academic_snapshot();
  SELECT score INTO _n FROM public.rpc_leaderboard('class', 'homework', NULL, 1000) WHERE user_id = _ua;
  SELECT score INTO _m FROM public.rpc_leaderboard('class', 'homework', NULL, 1000) WHERE user_id = _ub;
  RESET ROLE;
  IF _j->'homework' IS DISTINCT FROM '{"pending": 1, "completed": 1}'::jsonb THEN
    RAISE EXCEPTION 'ROLLED BACK: the snapshot read % — expected one open, one given', _j->'homework';
  END IF;
  -- A's closed homework was rejected: not given, and nothing left to do.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', _ua, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  _j := public.rpc_student_academic_snapshot();
  RESET ROLE;
  IF _j->'homework' IS DISTINCT FROM '{"pending": 1, "completed": 0}'::jsonb THEN
    RAISE EXCEPTION 'ROLLED BACK: the rejected student''s snapshot read % — expected the one open homework pending and nothing given', _j->'homework';
  END IF;
  IF _n IS DISTINCT FROM 0 OR _m IS DISTINCT FROM 100 THEN
    RAISE EXCEPTION 'ROLLED BACK: the homework leaderboard scored A % and B % — expected 0 (rejected is not given) and 100', _n, _m;
  END IF;
  SELECT c->'homework' INTO _j
    FROM jsonb_array_elements(public._parent_weekly_digest(_parent_user, current_date - 7, current_date + 7)->'children') c
   WHERE (c->>'student_id')::uuid = _a;
  IF (_j->>'due')::int IS DISTINCT FROM 1 OR (_j->>'submitted')::int IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION 'ROLLED BACK: the digest read % — expected the one closed homework, not given (it was rejected)', _j;
  END IF;

  -- 6. Only the class's teacher (or an admin) deletes, and only once.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', _other_teacher, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  _refused := false;
  BEGIN
    PERFORM public.rpc_homework_delete(_closing);
  EXCEPTION WHEN insufficient_privilege THEN _refused := true;
  END;
  RESET ROLE;
  IF NOT _refused THEN RAISE EXCEPTION 'ROLLED BACK: a teacher of another class deleted the homework'; END IF;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', _ua, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  _refused := false;
  BEGIN
    PERFORM public.rpc_homework_delete(_closing);
  EXCEPTION WHEN insufficient_privilege THEN _refused := true;
  END;
  RESET ROLE;
  IF NOT _refused THEN RAISE EXCEPTION 'ROLLED BACK: a student deleted homework'; END IF;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', _teacher, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  _j := public.rpc_homework_delete(_closing);
  _refused := false;
  BEGIN
    PERFORM public.rpc_homework_delete(_closing);
  EXCEPTION WHEN object_not_in_prerequisite_state THEN _refused := true;
  END;
  RESET ROLE;
  IF _j->>'deleted_at' IS NULL OR (SELECT deleted_by FROM public.homework WHERE id = _closing) IS DISTINCT FROM _teacher THEN
    RAISE EXCEPTION 'ROLLED BACK: deleting came back as % and did not record who deleted it', _j;
  END IF;
  IF NOT _refused THEN RAISE EXCEPTION 'ROLLED BACK: deleted homework was deleted a second time'; END IF;

  -- 7. Every count drops together once the scheduler's drain has run, with
  --    nothing recomputed by hand.
  LOOP EXIT WHEN public.process_pending_academic_events(500) = 0; END LOOP;
  SELECT homework_assigned, homework_submitted INTO _n, _m FROM public.student_academic_profiles WHERE student_id = _a;
  IF (_n, _m) IS DISTINCT FROM (0, 0) THEN
    RAISE EXCEPTION 'ROLLED BACK: after the delete student A''s profile still reads % assigned, % given', _n, _m;
  END IF;
  SELECT homework_assigned, homework_submitted INTO _n, _m FROM public.student_academic_profiles WHERE student_id = _b;
  IF (_n, _m) IS DISTINCT FROM (0, 0) THEN
    RAISE EXCEPTION 'ROLLED BACK: after the delete student B''s profile still reads % assigned, % given', _n, _m;
  END IF;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', _ub, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  _j := public.rpc_student_academic_snapshot();
  SELECT score INTO _n FROM public.rpc_leaderboard('class', 'homework', NULL, 1000) WHERE user_id = _ub;
  SELECT count(*) INTO _m FROM public.homework_completion WHERE homework_id = _closing;
  RESET ROLE;
  IF _j->'homework' IS DISTINCT FROM '{"pending": 1, "completed": 0}'::jsonb THEN
    RAISE EXCEPTION 'ROLLED BACK: after the delete the snapshot still reads %', _j->'homework';
  END IF;
  IF _n IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION 'ROLLED BACK: after the delete the leaderboard still scores B %', _n;
  END IF;
  IF _m <> 0 THEN
    RAISE EXCEPTION 'ROLLED BACK: deleted homework still has a completion row';
  END IF;
  SELECT c->'homework' INTO _j
    FROM jsonb_array_elements(public._parent_weekly_digest(_parent_user, current_date - 7, current_date + 7)->'children') c
   WHERE (c->>'student_id')::uuid = _a;
  IF (_j->>'due')::int IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION 'ROLLED BACK: after the delete the digest still reads %', _j;
  END IF;

  PERFORM set_config('request.jwt.claims', '', true);
  RAISE EXCEPTION USING ERRCODE = 'P0999', MESSAGE = 'verify fixtures rolled back';
EXCEPTION WHEN SQLSTATE 'P0999' THEN
  NULL;
END;

  IF EXISTS (SELECT 1 FROM public.homework WHERE title LIKE '[verify 20260925130000]%') THEN
    RAISE EXCEPTION 'ROLLED BACK: verify fixtures survived the savepoint';
  END IF;

  RAISE NOTICE 'verify OK: completion is measured at the deadline and recounts through the scheduled queue when the closure runs; rejected is not given in the profile, the completion view and the leaderboard; a deleted student leaves the denominator; a student reads only their own standing and anon none; snapshot, leaderboard and digest agree; only the class teacher deletes, once; and every count drops together once the queue is drained — nothing the proof did survived';
END
$verify$;
