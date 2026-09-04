-- ═══════════════════════════════════════════════════════════════════════════
-- ROLLBACK — `exam_marks` returns to the weekly digest
--
-- This restores the six-key payload as 20260904190000 left it: the exam-marks
-- join, the `_em` variable, and the `exam_marks` key.
--
-- ⚠ WHAT YOU ARE PUTTING BACK IS A DUPLICATE SURFACE, NOT A FEATURE.
--
-- Exam marks reach parents through the exam report, all year. The digest key
-- was a second copy of that, empty in every week without an exam. Restoring it
-- also re-contradicts §10.17 in spirit — rank is "sent to parents in the exam
-- report, never in the weekly summary", and this puts the marks rank is
-- computed from back into the weekly summary.
--
-- The legitimate reason to run this is that a parent-facing screen was found to
-- depend on `exam_marks` and breaking it is worse than the duplication. If that
-- is the reason, the screen should move to the exam report and this should come
-- straight back out.
--
-- WHAT GOES RED AFTER RUNNING THIS, and should be allowed to:
--   · probe6 assertion "210000 exam_marks absent from the payload"
--   · src/hooks/useParentWeeklyDigest.test.ts — the payload-key contract test
-- Run `npm run verify:caller-privileges` and `npm run test` afterwards so the
-- regression is recorded rather than discovered.
--
-- No data is changed either way; this is one function body.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

CREATE OR REPLACE FUNCTION public._parent_weekly_digest(_parent uuid, _from date, _to date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _result jsonb := '[]'::jsonb;
  _child  record;
  _att    jsonb;
  _hw     jsonb;
  _remark jsonb;
  _tm     jsonb;
  _em     jsonb;
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
    SELECT jsonb_build_object(
             'present',  count(*) FILTER (WHERE att.status = 'present'),
             'absent',   count(*) FILTER (WHERE att.status = 'absent'),
             'late',     count(*) FILTER (WHERE att.status = 'late'),
             'leave',    count(*) FILTER (WHERE att.status = 'leave'),
             'half_day', count(*) FILTER (WHERE att.status = 'half_day'),
             'marked',   count(*),
             'pct',      CASE WHEN count(*) = 0 THEN NULL
                              ELSE round(100.0 * count(*) FILTER (WHERE att.status IN ('present','late','half_day'))
                                         / count(*), 1) END
           )
      INTO _att
      FROM public.attendance att
      JOIN public.attendance_submissions sub ON sub.id = att.submission_id
     WHERE att.student_id = _child.id
       AND sub.date BETWEEN _from AND _to;

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

    -- Only PUBLISHED results — an unpublished mark is not the parent's to see
    -- yet (§10.13).
    SELECT jsonb_build_object(
             'published', count(*),
             'subjects',  COALESCE(jsonb_agg(jsonb_build_object(
                            'exam',    e.name,
                            'subject', e.subject,
                            'scored',  m.marks_obtained,
                            'out_of',  e.max_marks,
                            'pct',     CASE WHEN e.max_marks IS NULL OR e.max_marks = 0 THEN NULL
                                            ELSE round(100.0 * m.marks_obtained / e.max_marks, 1) END
                          ) ORDER BY e.results_published_at DESC), '[]'::jsonb)
           )
      INTO _em
      FROM public.marks m
      JOIN public.exams e ON e.id = m.exam_id
     WHERE m.student_id = _child.id
       AND e.results_published_at IS NOT NULL
       AND e.results_published_at::date BETWEEN _from AND _to;

    _result := _result || jsonb_build_array(jsonb_build_object(
      'student_id',  _child.id,
      'name',        _child.full_name,
      'class',       (SELECT COALESCE(display_name, name || '-' || section)
                        FROM public.classes WHERE id = _child.class_id),
      'attendance',  COALESCE(_att,    jsonb_build_object('marked', 0, 'pct', NULL)),
      'homework',    COALESCE(_hw,     jsonb_build_object('due', 0, 'pct', NULL)),
      'remarks',     COALESCE(_remark, '[]'::jsonb),
      'test_marks',  COALESCE(_tm,     jsonb_build_object('count', 0, 'tests', '[]'::jsonb)),
      'exam_marks',  COALESCE(_em,     jsonb_build_object('published', 0, 'subjects', '[]'::jsonb))
    ));
  END LOOP;

  RETURN jsonb_build_object(
    'window',       jsonb_build_object('starts_on', _from, 'ends_on', _to),
    'children',     _result,
    'generated_at', now()
  );
END;
$function$;

REVOKE ALL ON FUNCTION public._parent_weekly_digest(uuid, date, date) FROM PUBLIC, anon, authenticated;

-- Assert the INVERSE of the forward check, so a half-applied reversal fails
-- loudly rather than leaving the key back and the join missing.
DO $$
DECLARE _d text;
BEGIN
  SELECT pg_get_functiondef(oid) INTO _d FROM pg_proc
   WHERE proname = '_parent_weekly_digest' AND pronamespace = 'public'::regnamespace;

  IF _d !~* '''exam_marks''' THEN
    RAISE EXCEPTION 'rollback incomplete: the exam_marks key is not back in the payload';
  END IF;
  IF _d !~* 'public\.exams' THEN
    RAISE EXCEPTION 'rollback incomplete: the exam join was not restored — the key would always be empty';
  END IF;
  -- The five items must survive the reversal too.
  IF _d !~* 'public\.test_marks'      THEN RAISE EXCEPTION 'rollback broke item 5: test marks'; END IF;
  IF _d !~* 'public\.teacher_remarks' THEN RAISE EXCEPTION 'rollback broke item 4: the teacher remark'; END IF;
  IF _d !~* 'not_completed'           THEN RAISE EXCEPTION 'rollback broke item 3: homework not-completed'; END IF;
END $$;

DELETE FROM public.schema_migrations
 WHERE version = '20260904210000_digest_exam_marks_removed';

COMMIT;
