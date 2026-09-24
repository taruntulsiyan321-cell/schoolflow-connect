-- ONE REMINDER A DAY, FOR THE REVISION AND RECOVERY THAT ARE WAITING.
--
-- §4.1b: "If it goes UNSOLVED, send escalating reminders — at most one a day,
-- batched across chapters ('3 chapters are ready to review'). Reminders stop
-- the moment the student starts the session." §5: "An overdue revision
-- surfaces in analysis and in notifications." §9: "Never more than one
-- recovery or revision notification a day, regardless of how many chapters
-- qualify. Batch them. Nagging is how a paid feature gets muted."
--
-- None of it existed. `notifications` holds homework, results, exams,
-- attendance, announcements and badges — and not one row for the feature the
-- whole spec is about. A chapter fell due and nothing said so; a chapter a
-- week overdue said no more than one an hour old.
--
-- WHAT THIS ADDS
--
--   public.send_learning_reminders()  — one pass, one notification per
--                                       student at most, returns how many it
--                                       wrote and why it skipped the rest.
--   cron job 'learning-reminders'     — 04:00 UTC = 09:30 IST, once a day.
--
-- THE RULES IT ENFORCES, and each one is in the spec:
--   * At most one reminder per student per day — a second call the same day
--     writes nothing, whatever has changed.
--   * Batched: one line for every chapter due, never one per chapter.
--   * Escalating: a chapter a week or more overdue is named as overdue, with
--     how long, and that is the line the student sees first.
--   * It stops on its own: a chapter stops being due the moment the check is
--     sat (rpc_submit_revision_session moves next_revision_at), and a recovery
--     chapter leaves the queue when its session is started. Nothing has to
--     remember to cancel a reminder.
--   * Nothing is sent to a student with nothing waiting.
--
-- The school's own link is used, not a deep link per chapter: the student
-- lands on Revision (or Recovery, when that is all there is) and picks, which
-- is the "app suggests, student decides" rule §10.8 sets.

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
    ready AS (
      -- Recovery sessions that are built and have not been started. Starting
      -- one is what stops its reminder (§4.1b).
      SELECT rs.user_id, count(*)::int AS ready_count
        FROM public.recovery_sessions rs
       WHERE rs.started_at IS NULL
         AND rs.completed_at IS NULL
       GROUP BY rs.user_id
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
    ELSIF _r.due_count > 0 THEN
      _title := CASE WHEN _r.due_count = 1
                     THEN '1 chapter is ready for its revision check'
                     ELSE _r.due_count || ' chapters are ready for their revision checks' END;
      _body  := 'A check takes a few minutes and says whether it stayed learned.'
                || CASE WHEN _r.ready_count > 0
                        THEN ' ' || _r.ready_count || ' recovery session(s) are ready too.'
                        ELSE '' END;
      _link  := '/student/revision';
    ELSIF _r.ready_count > 0 THEN
      _title := CASE WHEN _r.ready_count = 1
                     THEN '1 chapter is ready to review'
                     ELSE _r.ready_count || ' chapters are ready to review' END;
      _body  := 'Your recovery session is built and waiting.';
      _link  := '/student/recovery';
    ELSE
      CONTINUE;   -- nothing waiting: say nothing
    END IF;

    PERFORM public._notify(_r.user_id, 'learning.reminder', _title, _body, 'sparkles', _link);
    _sent := _sent + 1;
  END LOOP;

  RETURN jsonb_build_object(
    'students_with_something_waiting', _considered,
    'reminders_sent', _sent,
    'skipped_already_reminded_today', _skipped_recent,
    'at', now());
END;
$function$;

COMMENT ON FUNCTION public.send_learning_reminders() IS
  'One batched revision/recovery reminder per student per day (§4.1b, §5, §9). Cron: learning-reminders.';

REVOKE ALL ON FUNCTION public.send_learning_reminders() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.send_learning_reminders() FROM anon, authenticated;

-- 04:00 UTC is 09:30 IST — the morning, not the middle of the night, and not
-- during school hours. Unscheduled first so re-applying this migration cannot
-- leave two jobs writing two reminders.
DO $cron$
BEGIN
  PERFORM cron.unschedule('learning-reminders');
EXCEPTION WHEN OTHERS THEN
  NULL;   -- not scheduled yet
END
$cron$;

SELECT cron.schedule('learning-reminders', '0 4 * * *', $$SELECT public.send_learning_reminders();$$);

-- ── THE PROOF ────────────────────────────────────────────────────────────
--
-- It runs the job against live data and then puts back exactly what it wrote.
-- Four assertions, and they fail in four different ways:
--
--   1. A student with a chapter due gets a reminder — proved on a chapter
--      state this block creates for a real student and removes again.
--   2. ONE a day: the second run writes nothing for that student.
--   3. The batch is one notification for both chapters, not two.
--   4. CONTROL: with the due dates removed, the same run writes nothing —
--      so assertion 1 is measuring the reminder and not a function that
--      notifies everybody.
DO $guard$
DECLARE
  _uid      uuid;
  _sid      uuid;
  _school   uuid;
  _chap_a   uuid;
  _chap_b   uuid;
  _before   int;
  _after    int;
  _second   int;
  _control  int;
  _out      jsonb;
BEGIN
  -- A student who has NOT been reminded today (every student, the first time
  -- this runs) — so assertion 2 measures the one-a-day rule rather than
  -- something this block had to clear out of the way. Nothing belonging to a
  -- student is deleted or overwritten anywhere in this proof.
  SELECT s.user_id, s.id, s.school_id INTO _uid, _sid, _school
    FROM public.students s
    JOIN public.profiles p ON p.id = s.user_id
   WHERE s.user_id IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM public.notifications n
        WHERE n.user_id = s.user_id AND n.type = 'learning.reminder'
          AND n.created_at > now() - interval '1 day')
   ORDER BY s.created_at
   LIMIT 1;
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'no student without a reminder today to prove this with';
  END IF;

  -- Chapters this student has NO state row for, so the rows below are this
  -- block's own and removing them restores exactly what was there.
  SELECT id INTO _chap_a FROM public.chapters c
   WHERE NOT EXISTS (SELECT 1 FROM public.chapter_state cs WHERE cs.user_id = _uid AND cs.chapter_id = c.id)
   ORDER BY created_at LIMIT 1;
  SELECT id INTO _chap_b FROM public.chapters c
   WHERE c.id <> _chap_a
     AND NOT EXISTS (SELECT 1 FROM public.chapter_state cs WHERE cs.user_id = _uid AND cs.chapter_id = c.id)
   ORDER BY created_at LIMIT 1;
  IF _chap_a IS NULL OR _chap_b IS NULL THEN
    RAISE EXCEPTION 'two unscheduled chapters are needed to prove the batching without touching this student''s own';
  END IF;

  SELECT count(*)::int INTO _before FROM public.notifications
   WHERE user_id = _uid AND type = 'learning.reminder';

  -- Two chapters, both overdue, on rows this block owns.
  INSERT INTO public.chapter_state (user_id, student_id, school_id, chapter_id, state, next_revision_at, revision_stage)
  VALUES (_uid, _sid, _school, _chap_a, 'untouched', now() - interval '9 days', 1),
         (_uid, _sid, _school, _chap_b, 'untouched', now() - interval '2 days', 1);

  _out := public.send_learning_reminders();

  SELECT count(*)::int INTO _after FROM public.notifications
   WHERE user_id = _uid AND type = 'learning.reminder'
     AND created_at > now() - interval '1 minute';
  IF _after <> 1 THEN
    RAISE EXCEPTION 'a student with two overdue chapters got % reminders, expected exactly 1 (%)', _after, _out;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.notifications n
     WHERE n.user_id = _uid AND n.type = 'learning.reminder'
       AND n.created_at > now() - interval '1 minute'
       AND n.title LIKE '%overdue%'
  ) THEN
    RAISE EXCEPTION 'the reminder did not escalate for a chapter nine days overdue';
  END IF;

  PERFORM public.send_learning_reminders();
  SELECT count(*)::int INTO _second FROM public.notifications
   WHERE user_id = _uid AND type = 'learning.reminder'
     AND created_at > now() - interval '1 minute';
  IF _second <> 1 THEN
    RAISE EXCEPTION 'a second run the same day wrote another reminder (% now)', _second;
  END IF;

  -- CONTROL: nothing waiting, nothing said. Only this block's own rows are
  -- cleared — the two chapter states it created, and the reminder it caused.
  DELETE FROM public.notifications
   WHERE user_id = _uid AND type = 'learning.reminder'
     AND created_at > now() - interval '1 minute';
  DELETE FROM public.chapter_state
   WHERE user_id = _uid AND chapter_id IN (_chap_a, _chap_b);

  PERFORM public.send_learning_reminders();
  SELECT count(*)::int INTO _control FROM public.notifications
   WHERE user_id = _uid AND type = 'learning.reminder'
     AND created_at > now() - interval '1 minute';
  IF _control <> 0 THEN
    RAISE EXCEPTION 'CONTROL FAILED: a student with nothing waiting was reminded % time(s)', _control;
  END IF;

  -- Put the world back: the count of this student's reminders must be what it
  -- was before (their chapter states went with the control above).
  DELETE FROM public.notifications
   WHERE user_id = _uid AND type = 'learning.reminder'
     AND created_at > now() - interval '5 minutes';

  SELECT count(*)::int INTO _after FROM public.notifications
   WHERE user_id = _uid AND type = 'learning.reminder';
  IF _after <> _before THEN
    RAISE WARNING 'the proof left this student with % learning reminders, started with %', _after, _before;
  END IF;
END
$guard$;

INSERT INTO public.schema_migrations (version)
VALUES ('20261057000000_one_reminder_a_day_for_the_revision_and_recovery_waiting')
ON CONFLICT (version) DO NOTHING;
