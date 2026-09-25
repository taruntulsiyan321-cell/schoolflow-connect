-- ===========================================================================
-- THE REMINDERS KEEP THE SPEC'S CADENCE, AND NAME THE CHAPTER
--
-- send_learning_reminders (20261102000000) wrote one reminder a day for as
-- long as anything was waiting — a student with one ready recovery chapter
-- would hear about it every morning, for ever. Read against the spec that is
-- three rules broken:
--
--   §9    Revision: on the due date, and once more a week overdue, then silent
--         (it stays visible in Analysis). Never more than one a day, batched.
--   §4.1b Recovery: no ping when the session is built; if it goes unsolved,
--         escalating reminders — not a fixed 24-hour ping — and they stop when
--         the student acts. (§9's "once, when the trigger fires" contradicts
--         the no-ping rule; this reconciles the two: nothing at creation, then
--         after 1, 3 and 7 days unsolved, then silent.)
--   §5    "The notification must name what and when": "You worked on Cash Flow
--         Statement 7 days ago. Time to check it stuck." — not "1 chapter is
--         ready for its revision check".
--
-- And a timing defect: "one a day" was "nothing in the last 24 hours", and the
-- job runs once every 24 hours. A run a few seconds earlier than yesterday's
-- found yesterday's reminder inside the window and said nothing — every other
-- day at best. The window is 20 hours.
--
-- The windows are whole days since the moment that matters, read at a daily
-- run: a chapter due at any time falls into exactly one run's day 0, and one
-- run's day 7. _reminder_milestone is that one rule.
--
-- ROLLBACK: rollback/20261106000000_the_reminders_keep_the_spec_cadence.rollback.sql
-- ===========================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public._reminder_milestone(_since timestamptz, _days int[])
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $function$
  -- Whether a whole number of days since _since, counted now, is one of _days.
  SELECT _since IS NOT NULL
     AND _since <= now()
     AND floor(extract(epoch FROM (now() - _since)) / 86400)::int = ANY (_days);
$function$;

REVOKE ALL ON FUNCTION public._reminder_milestone(timestamptz, int[]) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.send_learning_reminders()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _u              uuid;
  _rev            record;
  _rev_names      text[];
  _rev_first      record;
  _rec_names      text[];
  _rec_first_days int;
  _sent           int := 0;
  _skipped_recent int := 0;
  _considered     int := 0;
  _title          text;
  _body           text;
  _link           text;
  _icon           text;
  _worked         text;
BEGIN
  FOR _u IN
    SELECT DISTINCT x.user_id FROM (
      SELECT cs.user_id FROM public.chapter_state cs
       WHERE cs.next_revision_at <= now() AND cs.next_revision_at > now() - interval '8 days'
      UNION
      SELECT sm.user_id FROM public.student_mistakes sm
       WHERE sm.status = 'open' AND sm.chapter_id IS NOT NULL
    ) x
  LOOP
    -- REVISION: due today (day 0) or a week overdue (day 7), overdue first.
    _rev_names := ARRAY[]::text[];
    _rev_first := NULL;
    FOR _rev IN
      SELECT c.name,
             public._reminder_milestone(cs.next_revision_at, ARRAY[7]) AS overdue,
             (SELECT max(ct.created_at) FROM public.chapter_tally ct
               WHERE ct.user_id = _u AND ct.chapter_id = cs.chapter_id) AS last_worked
        FROM public.chapter_state cs
        JOIN public.chapters c ON c.id = cs.chapter_id
       WHERE cs.user_id = _u
         AND public._reminder_milestone(cs.next_revision_at, ARRAY[0, 7])
       ORDER BY 2 DESC, cs.next_revision_at
    LOOP
      _rev_names := _rev_names || _rev.name;
      IF _rev_first IS NULL THEN _rev_first := _rev; END IF;
    END LOOP;

    -- RECOVERY: what the Recovery card offers "Start recovery" on, 1, 3 or 7
    -- days after it became available — its last round finished, or its oldest
    -- open mistake, whichever is later — and not before.
    SELECT array_agg(q->>'chapter' ORDER BY r.since),
           (array_agg(floor(extract(epoch FROM (now() - r.since)) / 86400)::int ORDER BY r.since))[1]
      INTO _rec_names, _rec_first_days
      FROM jsonb_array_elements(public._recovery_queue_for(_u)) q
      CROSS JOIN LATERAL (
        SELECT GREATEST(
          (SELECT max(rs.completed_at) FROM public.recovery_sessions rs
            WHERE rs.user_id = _u AND rs.chapter_id = (q->>'chapter_id')::uuid),
          (SELECT min(sm.created_at) FROM public.student_mistakes sm
            WHERE sm.user_id = _u AND sm.chapter_id = (q->>'chapter_id')::uuid AND sm.status = 'open')
        ) AS since
      ) r
     WHERE (q->>'ready')::boolean AND (q->>'startable')::boolean
       AND public._reminder_milestone(r.since, ARRAY[1, 3, 7]);

    IF COALESCE(array_length(_rev_names, 1), 0) = 0 AND COALESCE(array_length(_rec_names, 1), 0) = 0 THEN
      CONTINUE;   -- nothing at a milestone today: say nothing
    END IF;
    _considered := _considered + 1;

    -- ONE A DAY. Twenty hours, not twenty-four: the job runs every twenty-four,
    -- and a window of exactly that length skips the next run.
    IF EXISTS (
      SELECT 1 FROM public.notifications n
       WHERE n.user_id = _u AND n.type = 'learning.reminder'
         AND n.created_at > now() - interval '20 hours'
    ) THEN
      _skipped_recent := _skipped_recent + 1;
      CONTINUE;
    END IF;

    IF COALESCE(array_length(_rev_names, 1), 0) > 0 THEN
      _worked := CASE WHEN _rev_first.last_worked IS NULL THEN NULL
                      ELSE GREATEST(1, floor(extract(epoch FROM (now() - _rev_first.last_worked)) / 86400)::int)::text END;
      IF array_length(_rev_names, 1) = 1 THEN
        _title := CASE WHEN _rev_first.overdue
                       THEN 'Your ' || _rev_first.name || ' check is a week overdue'
                       ELSE 'Time to check ' || _rev_first.name || ' stuck' END;
        _body  := CASE WHEN _worked IS NULL THEN 'A check takes a few minutes.'
                       ELSE 'You worked on ' || _rev_first.name || ' ' || _worked || ' days ago.' END;
      ELSE
        _title := array_length(_rev_names, 1) || ' chapters are due for a revision check';
        _body  := _rev_names[1]
                  || CASE WHEN _worked IS NULL THEN '' ELSE ' (worked on ' || _worked || ' days ago)' END
                  || CASE WHEN array_length(_rev_names, 1) = 2 THEN ' and ' || _rev_names[2]
                          ELSE ', ' || _rev_names[2] || ' and ' || (array_length(_rev_names, 1) - 2) || ' more' END
                  || '.';
      END IF;
      IF COALESCE(array_length(_rec_names, 1), 0) > 0 THEN
        _body := _body || ' ' || CASE WHEN array_length(_rec_names, 1) = 1
                                      THEN _rec_names[1] || ' is ready to review too.'
                                      ELSE array_length(_rec_names, 1) || ' chapters are ready to review too.' END;
      END IF;
      _link := '/student/revision';
      _icon := 'calendar-check';
    ELSE
      IF array_length(_rec_names, 1) = 1 THEN
        _title := _rec_names[1] || ' is ready to review';
        _body  := 'Your recovery session has been waiting '
                  || _rec_first_days || CASE WHEN _rec_first_days = 1 THEN ' day.' ELSE ' days.' END;
      ELSE
        _title := array_length(_rec_names, 1) || ' chapters are ready to review';
        _body  := _rec_names[1]
                  || CASE WHEN array_length(_rec_names, 1) = 2 THEN ' and ' || _rec_names[2]
                          ELSE ', ' || _rec_names[2] || ' and ' || (array_length(_rec_names, 1) - 2) || ' more' END
                  || ' — a recovery session is built and waiting for each.';
      END IF;
      _link := '/student/recovery';
      _icon := 'book-open';
    END IF;

    PERFORM public._notify(_u, 'learning.reminder', _title, _body, _icon, _link);
    _sent := _sent + 1;
  END LOOP;

  RETURN jsonb_build_object(
    'students_at_a_milestone', _considered,
    'reminders_sent', _sent,
    'skipped_already_reminded_today', _skipped_recent,
    'at', now());
END;
$function$;

COMMENT ON FUNCTION public.send_learning_reminders() IS
  'Revision reminders on the due date and a week overdue; recovery reminders 1, 3 and 7 days unsolved; at most one a day, batched, naming the chapter (§4.1b, §5, §9). Cron: learning-reminders.';
REVOKE ALL ON FUNCTION public.send_learning_reminders() FROM PUBLIC, anon, authenticated;

-- ── THE PROOF ────────────────────────────────────────────────────────────
-- On rows this block creates, rolled back with everything the job writes.
DO $guard$
DECLARE
  _uid uuid; _sid uuid; _school uuid; _chap uuid; _name text;
  _m0 boolean; _m3 boolean; _m7 boolean; _m8 boolean; _r1 boolean; _r2 boolean;
  _due_title text; _due_body text; _second int; _mid int; _week_title text; _none int;
BEGIN
  _m0 := public._reminder_milestone(now() - interval '2 hours', ARRAY[0, 7]);
  _m3 := public._reminder_milestone(now() - interval '3 days 2 hours', ARRAY[0, 7]);
  _m7 := public._reminder_milestone(now() - interval '7 days 5 hours', ARRAY[0, 7]);
  _m8 := public._reminder_milestone(now() - interval '8 days 1 hour', ARRAY[0, 7]);
  _r1 := public._reminder_milestone(now() - interval '1 day 3 hours', ARRAY[1, 3, 7]);
  _r2 := public._reminder_milestone(now() - interval '2 days 3 hours', ARRAY[1, 3, 7]);
  IF NOT _m0 OR _m3 OR NOT _m7 OR _m8 OR NOT _r1 OR _r2 THEN
    RAISE EXCEPTION 'the day windows are wrong: day0 % day3 % day7 % day8 % rec1 % rec2 %', _m0, _m3, _m7, _m8, _r1, _r2;
  END IF;

  SELECT s.user_id, s.id, s.school_id INTO _uid, _sid, _school
    FROM public.students s JOIN public.profiles p ON p.id = s.user_id
   WHERE NOT EXISTS (SELECT 1 FROM public.student_mistakes sm WHERE sm.user_id = s.user_id AND sm.status = 'open')
     AND NOT EXISTS (SELECT 1 FROM public.chapter_state cs WHERE cs.user_id = s.user_id AND cs.next_revision_at <= now())
   ORDER BY s.created_at LIMIT 1;
  SELECT c.id, c.name INTO _chap, _name FROM public.chapters c
   WHERE NOT EXISTS (SELECT 1 FROM public.chapter_state cs WHERE cs.user_id = _uid AND cs.chapter_id = c.id)
   ORDER BY c.created_at LIMIT 1;
  IF _uid IS NULL OR _chap IS NULL THEN RAISE EXCEPTION 'no probe student or chapter'; END IF;

  BEGIN
    DELETE FROM public.notifications WHERE user_id = _uid AND type = 'learning.reminder';
    -- Due two hours ago: day 0.
    INSERT INTO public.chapter_state (user_id, student_id, school_id, chapter_id, state, next_revision_at, revision_stage)
    VALUES (_uid, _sid, _school, _chap, 'untouched', now() - interval '2 hours', 1);
    PERFORM public.send_learning_reminders();
    SELECT title, body INTO _due_title, _due_body FROM public.notifications
     WHERE user_id = _uid AND type = 'learning.reminder';
    PERFORM public.send_learning_reminders();
    SELECT count(*) INTO _second FROM public.notifications WHERE user_id = _uid AND type = 'learning.reminder';

    -- Three days overdue: silent (§9), even with no reminder today.
    DELETE FROM public.notifications WHERE user_id = _uid AND type = 'learning.reminder';
    UPDATE public.chapter_state SET next_revision_at = now() - interval '3 days 2 hours' WHERE user_id = _uid AND chapter_id = _chap;
    PERFORM public.send_learning_reminders();
    SELECT count(*) INTO _mid FROM public.notifications WHERE user_id = _uid AND type = 'learning.reminder';

    -- A week overdue: once more.
    UPDATE public.chapter_state SET next_revision_at = now() - interval '7 days 2 hours' WHERE user_id = _uid AND chapter_id = _chap;
    PERFORM public.send_learning_reminders();
    SELECT title INTO _week_title FROM public.notifications WHERE user_id = _uid AND type = 'learning.reminder';

    -- CONTROL: nothing waiting, nothing said.
    DELETE FROM public.notifications WHERE user_id = _uid AND type = 'learning.reminder';
    DELETE FROM public.chapter_state WHERE user_id = _uid AND chapter_id = _chap;
    PERFORM public.send_learning_reminders();
    SELECT count(*) INTO _none FROM public.notifications WHERE user_id = _uid AND type = 'learning.reminder';

    RAISE EXCEPTION 'proof_rollback';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'proof_rollback' THEN RAISE; END IF;
  END;

  IF _due_title IS DISTINCT FROM 'Time to check ' || _name || ' stuck' THEN
    RAISE EXCEPTION 'the due-date reminder does not name the chapter: %', _due_title;
  END IF;
  IF _second <> 1 THEN RAISE EXCEPTION 'a second run the same day left % reminders', _second; END IF;
  IF _mid <> 0 THEN RAISE EXCEPTION 'a check three days overdue was reminded about — §9 says silent'; END IF;
  IF _week_title IS DISTINCT FROM 'Your ' || _name || ' check is a week overdue' THEN
    RAISE EXCEPTION 'the week-overdue reminder is wrong: %', _week_title;
  END IF;
  IF _none <> 0 THEN RAISE EXCEPTION 'CONTROL FAILED: nothing waiting and % reminder(s)', _none; END IF;
END
$guard$;

COMMIT;
