-- Rollback for 20260925130000.
--
-- Restores the four homework counters exactly as they were — each counting its
-- own way: deleted homework in the profile's denominator, drafts and scheduled
-- rows in the leaderboard's and the snapshot's, 'submitted'/'graded' as the only
-- given statuses (so accepted work counts as not given under 20260925110000),
-- and the digest counting rejected work as submitted — then removes the one
-- view they now share and the soft delete. Their grants are untouched by the
-- migration and so by this rollback. Roll back 20260925110000 only after this.

DROP FUNCTION public.rpc_homework_delete(uuid);
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

  IF _class IS NOT NULL THEN
    SELECT count(*) INTO _hw_assigned
    FROM public.homework
    WHERE class_id = _class
      AND coalesce(status, 'active') IN ('active', 'published');
  END IF;

  SELECT count(*) INTO _hw_submitted
  FROM public.homework_submissions
  WHERE student_id = _student_id
    AND status IN ('submitted', 'graded');

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
  _hw_pct := CASE WHEN _hw_assigned > 0 THEN round(least(_hw_submitted, _hw_assigned)::numeric / _hw_assigned * 100, 2) ELSE 0 END;
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
      format('Only %s of %s recent homework assignments completed (%s%%) — this has moved into the "%s" range.',
             _hw_submitted, _hw_assigned, _hw_pct, _new_hw_band),
      'alert-triangle', '/parent'
    );
    IF _class IS NOT NULL THEN
      PERFORM public._notify_class_teacher(
        _class, 'homework.risk_alert', 'Homework consistency risk: ' || coalesce(_student_name, 'a student'),
        format('%s of %s homework assignments completed (%s%%) — %s risk band.', _hw_submitted, _hw_assigned, _hw_pct, _new_hw_band),
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
        WHEN 'homework' THEN COALESCE((
            SELECT CASE WHEN (SELECT COUNT(*) FROM public.homework h WHERE h.class_id = b.cid) > 0
                        THEN ROUND(
                          (SELECT COUNT(*) FROM public.homework_submissions hs
                             JOIN public.homework h2 ON h2.id = hs.homework_id
                             WHERE hs.student_id = b.sid AND hs.status IN ('submitted','graded') AND h2.class_id = b.cid)::numeric
                          / (SELECT COUNT(*) FROM public.homework h WHERE h.class_id = b.cid) * 100, 0)
                        ELSE 0 END), 0)::numeric
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
    SELECT count(*) FILTER (WHERE hs.status IN ('submitted','graded')),
           count(*) FILTER (WHERE hs.status IS NULL OR hs.status = 'pending')
      INTO _hw_done, _hw_pending
    FROM public.homework h
    LEFT JOIN public.homework_submissions hs ON hs.homework_id = h.id AND hs.student_id = _s.id
    WHERE h.class_id = _s.class_id;

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
    -- due_date. `not_completed` is stated rather than left to subtraction —
    -- rule 17 names both halves, and a reader should not have to derive one.
    SELECT jsonb_build_object(
             'due',           count(*),
             'submitted',     count(*) FILTER (WHERE hs.submitted_at IS NOT NULL),
             'not_completed', count(*) FILTER (WHERE hs.submitted_at IS NULL),
             'pct',           CASE WHEN count(*) = 0 THEN NULL
                                   ELSE round(100.0 * count(*) FILTER (WHERE hs.submitted_at IS NOT NULL)
                                              / count(*), 1) END
           )
      INTO _hw
      FROM public.homework h
      LEFT JOIN public.homework_submissions hs
             ON hs.homework_id = h.id AND hs.student_id = _child.id
     WHERE h.class_id = _child.class_id
       AND h.deleted_at IS NULL
       AND h.published_at IS NOT NULL
       AND h.due_date BETWEEN _from AND _to;

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

DROP VIEW public.homework_completion;
DROP VIEW public.homework_student_status;