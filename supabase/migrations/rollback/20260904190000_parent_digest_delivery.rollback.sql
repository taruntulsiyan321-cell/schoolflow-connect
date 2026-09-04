-- ═══════════════════════════════════════════════════════════════════════════
-- ROLLBACK — the digest loses its sender, its remark, and its fifth item
--
-- Restores rpc_parent_weekly_digest to the self-contained body 20260904120000
-- installed, and drops the two functions this migration added.
--
-- ORDER MATTERS. The sender is dropped BEFORE the shared computation it calls,
-- and the scheduled job must be gone before either — a cron job pointing at a
-- dropped function fails every Monday and reports nothing to anybody. Run
-- 20260904200000's rollback FIRST; the guard below refuses to proceed otherwise
-- rather than leaving a job calling a function that no longer exists.
--
-- WHAT THIS COSTS, PLAINLY:
--   · the teacher's remark leaves the digest — rule 17's fifth item, unmet again
--   · test marks leave it; exam marks are what remains
--   · the `alerts` key comes back, always empty, on a feature ruled not to exist
--   · nothing sends
--
-- No data is touched. Notifications already written stay.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron')
     AND EXISTS (SELECT 1 FROM cron.job WHERE command ~ 'rpc_send_parent_weekly_digests') THEN
    RAISE EXCEPTION
      'ABORT: a cron job still calls rpc_send_parent_weekly_digests. Run rollback/20260904200000_schedule_parent_digest.rollback.sql first, or the job will fail on a dropped function every week.';
  END IF;
END $$;

DROP FUNCTION IF EXISTS public.rpc_send_parent_weekly_digests();

CREATE OR REPLACE FUNCTION public.rpc_parent_weekly_digest()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _parent  uuid := auth.uid();
  _from    date := CURRENT_DATE - 7;
  _to      date := CURRENT_DATE;
  _result  jsonb := '[]'::jsonb;
  _child   record;
  _att     jsonb;
  _hw      jsonb;
  _marks   jsonb;
BEGIN
  IF _parent IS NULL THEN
    RAISE EXCEPTION 'auth required';
  END IF;
  IF NOT public.has_role(_parent, 'parent') AND NOT public.has_role(_parent, 'admin') THEN
    RAISE EXCEPTION 'Parent only';
  END IF;

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
             'due',       count(*),
             'submitted', count(*) FILTER (WHERE hs.submitted_at IS NOT NULL),
             'pct',       CASE WHEN count(*) = 0 THEN NULL
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
      INTO _marks
      FROM public.marks m
      JOIN public.exams e ON e.id = m.exam_id
     WHERE m.student_id = _child.id
       AND e.results_published_at IS NOT NULL
       AND e.results_published_at::date BETWEEN _from AND _to;

    _result := _result || jsonb_build_array(jsonb_build_object(
      'student_id', _child.id,
      'name',       _child.full_name,
      'class',      (SELECT COALESCE(display_name, name || '-' || section)
                       FROM public.classes WHERE id = _child.class_id),
      'attendance', COALESCE(_att,   jsonb_build_object('marked', 0, 'pct', NULL)),
      'homework',   COALESCE(_hw,    jsonb_build_object('due', 0, 'pct', NULL)),
      'marks',      COALESCE(_marks, jsonb_build_object('published', 0, 'subjects', '[]'::jsonb)),
      'alerts', (
        SELECT COALESCE(jsonb_agg(jsonb_build_object(
                 'id', a.id, 'kind', a.kind, 'title', a.title, 'body', a.body,
                 'read', a.read, 'created_at', a.created_at
               ) ORDER BY a.created_at DESC), '[]'::jsonb)
          FROM public.parent_academic_alerts a
         WHERE a.parent_user_id = _parent
           AND a.student_id = _child.id
           AND a.created_at >= now() - interval '7 days'
      )
    ));
  END LOOP;

  RETURN jsonb_build_object(
    'window',       jsonb_build_object('starts_on', _from, 'ends_on', _to),
    'children',     _result,
    'generated_at', now()
  );
END;
$function$;

DROP FUNCTION IF EXISTS public._parent_weekly_digest(uuid, date, date);

DO $$
DECLARE _d text;
BEGIN
  SELECT pg_get_functiondef(oid) INTO _d FROM pg_proc
   WHERE proname = 'rpc_parent_weekly_digest' AND pronamespace = 'public'::regnamespace;

  IF _d IS NULL THEN
    RAISE EXCEPTION 'rollback incomplete: rpc_parent_weekly_digest is missing';
  END IF;
  IF _d ~ '_parent_weekly_digest\(' THEN
    RAISE EXCEPTION 'rollback incomplete: the wrapper still delegates to a dropped function';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc
              WHERE proname IN ('_parent_weekly_digest','rpc_send_parent_weekly_digests')
                AND pronamespace = 'public'::regnamespace) THEN
    RAISE EXCEPTION 'rollback incomplete: an added function survives';
  END IF;
END $$;

DELETE FROM public.schema_migrations
 WHERE version = '20260904190000_parent_digest_delivery';

COMMIT;
