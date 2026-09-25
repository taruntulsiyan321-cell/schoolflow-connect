-- ROLLBACK of 20261106000000_the_reminders_keep_the_spec_cadence:
-- send_learning_reminders as 20261103000000 left it; the milestone helper dropped.

BEGIN;

CREATE OR REPLACE FUNCTION public.send_learning_reminders()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _overdue_days int := 7;          -- when "due" becomes "overdue" in the copy
  _r            record;
  _sent         int := 0;
  _skipped_recent int := 0;
  _considered   int := 0;
  _title        text;
  _body         text;
  _link         text;
  _icon         text;
BEGIN
  FOR _r IN
    WITH due AS (
      SELECT cs.user_id,
             count(*)::int AS due_count,
             count(*) FILTER (
               WHERE cs.next_revision_at <= now() - (_overdue_days || ' days')::interval
             )::int AS overdue_count,
             min(cs.next_revision_at) AS oldest_due
        FROM public.chapter_state cs
       WHERE cs.next_revision_at IS NOT NULL
         AND cs.next_revision_at <= now()
       GROUP BY cs.user_id
    ),
    students AS (
      SELECT DISTINCT sm.user_id
        FROM public.student_mistakes sm
       WHERE sm.status = 'open' AND sm.chapter_id IS NOT NULL
    ),
    ready AS (
      -- Exactly the chapters the Recovery card offers "Start recovery" on.
      SELECT st.user_id, count(*)::int AS ready_count
        FROM students st
        CROSS JOIN LATERAL jsonb_array_elements(public._recovery_queue_for(st.user_id)) q
       WHERE (q->>'ready')::boolean AND (q->>'startable')::boolean
       GROUP BY st.user_id
    )
    SELECT COALESCE(d.user_id, r.user_id) AS user_id,
           COALESCE(d.due_count, 0)       AS due_count,
           COALESCE(d.overdue_count, 0)   AS overdue_count,
           d.oldest_due,
           COALESCE(r.ready_count, 0)     AS ready_count
      FROM due d
      FULL JOIN ready r ON r.user_id = d.user_id
  LOOP
    _considered := _considered + 1;

    -- ONE A DAY. The last reminder of this kind is the whole test; nothing
    -- else in the table counts, so a homework notice never silences this.
    IF EXISTS (
      SELECT 1 FROM public.notifications n
       WHERE n.user_id = _r.user_id
         AND n.type = 'learning.reminder'
         AND n.created_at > now() - interval '1 day'
    ) THEN
      _skipped_recent := _skipped_recent + 1;
      CONTINUE;
    END IF;

    -- The overdue line comes first when there is one: it is the fact the
    -- student needs, and §4.1b calls for the reminder to escalate rather than
    -- repeat itself.
    IF _r.overdue_count > 0 THEN
      _title := CASE WHEN _r.overdue_count = 1
                     THEN '1 chapter is overdue for revision'
                     ELSE _r.overdue_count || ' chapters are overdue for revision' END;
      _body  := 'The oldest has been waiting '
                || GREATEST(1, (EXTRACT(EPOCH FROM (now() - _r.oldest_due)) / 86400)::int)
                || ' days.'
                || CASE WHEN _r.due_count > _r.overdue_count
                        THEN ' ' || (_r.due_count - _r.overdue_count) || ' more are due now.'
                        ELSE '' END
                || CASE WHEN _r.ready_count > 0
                        THEN ' ' || _r.ready_count || ' recovery session(s) are ready too.'
                        ELSE '' END;
      _link  := '/student/revision';
      _icon  := 'calendar-check';
    ELSIF _r.due_count > 0 THEN
      _title := CASE WHEN _r.due_count = 1
                     THEN '1 chapter is ready for its revision check'
                     ELSE _r.due_count || ' chapters are ready for their revision checks' END;
      _body  := 'A check takes a few minutes and says whether it stayed learned.'
                || CASE WHEN _r.ready_count > 0
                        THEN ' ' || _r.ready_count || ' recovery session(s) are ready too.'
                        ELSE '' END;
      _link  := '/student/revision';
      _icon  := 'calendar-check';
    ELSIF _r.ready_count > 0 THEN
      _title := CASE WHEN _r.ready_count = 1
                     THEN '1 chapter is ready to review'
                     ELSE _r.ready_count || ' chapters are ready to review' END;
      _body  := CASE WHEN _r.ready_count = 1
                     THEN 'Your recovery session is built and waiting.'
                     ELSE 'A recovery session is built and waiting for each of them.' END;
      _link  := '/student/recovery';
      _icon  := 'book-open';
    ELSE
      CONTINUE;   -- nothing waiting: say nothing
    END IF;

    PERFORM public._notify(_r.user_id, 'learning.reminder', _title, _body, _icon, _link);
    _sent := _sent + 1;
  END LOOP;

  RETURN jsonb_build_object(
    'students_with_something_waiting', _considered,
    'reminders_sent', _sent,
    'skipped_already_reminded_today', _skipped_recent,
    'at', now());
END;
$function$;

DROP FUNCTION public._reminder_milestone(timestamptz, int[]);

DELETE FROM public.schema_migrations WHERE version = '20261106000000_the_reminders_keep_the_spec_cadence';

COMMIT;
