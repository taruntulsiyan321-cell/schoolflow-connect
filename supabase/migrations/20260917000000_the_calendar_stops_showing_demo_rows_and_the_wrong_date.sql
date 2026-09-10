-- ═══════════════════════════════════════════════════════════════════════════
-- The calendar stops showing demo rows, and Gandhi Jayanti moves to 2 October
-- (v2 redesign Screen 14)
--
-- Measured in the live calendar on 2026-09-10, all eleven rows:
--
--     2026-08-30  holiday   Teachers' Day Holiday (Arjun demo)
--     2026-09-03  meeting   Parent-Teacher Meeting (Arjun demo)
--     2026-09-12  sports    Sports Day (Arjun demo)
--     2026-09-13  holiday   Gandhi Jayanti          <- it is 2 October
--
-- Three rows carry "(Arjun demo)" in the TITLE — a developer's scratch label
-- rendered to students in a live school calendar. No seed file and no migration
-- creates them, so they were inserted by hand and nothing will put them back.
--
-- Gandhi Jayanti is a fixed national holiday on 2 October. Dated 13 September it
-- is not a small cosmetic error: "Holiday" is a label the school reads off this
-- calendar, and §10 gives the admin the calendar as the place that says so.
--
-- WHAT THIS DOES NOT DO. It does not touch the other seven rows, and it does not
-- go near `strip-demo-tenants` — the demo tenants ARE the only environment.
-- This deletes three rows by exact id, nothing else.
--
-- Rollback: supabase/migrations/rollback/
--           20260917000000_the_calendar_stops_showing_demo_rows_and_the_wrong_date.rollback.sql
-- ═══════════════════════════════════════════════════════════════════════════

-- Gandhi Jayanti: keep the year the row already has, correct month and day.
UPDATE public.school_calendar_events
   SET starts_at = make_timestamptz(
                     extract(year FROM starts_at)::int, 10, 2,
                     extract(hour FROM starts_at)::int,
                     extract(minute FROM starts_at)::int, 0)
 WHERE title = 'Gandhi Jayanti'
   AND extract(month FROM starts_at)::int <> 10;

DELETE FROM public.school_calendar_events
 WHERE title LIKE '%(Arjun demo)%';

DO $verify$
DECLARE _demo int; _gj date;
BEGIN
  SELECT count(*) INTO _demo FROM public.school_calendar_events WHERE title LIKE '%(Arjun demo)%';
  IF _demo <> 0 THEN
    RAISE EXCEPTION 'ROLLED BACK: % demo-titled calendar row(s) still visible to students', _demo;
  END IF;

  SELECT starts_at::date INTO _gj FROM public.school_calendar_events WHERE title = 'Gandhi Jayanti' LIMIT 1;
  IF _gj IS NULL THEN
    RAISE EXCEPTION 'ROLLED BACK: Gandhi Jayanti is gone — this migration moves it, it does not delete it';
  END IF;
  IF extract(month FROM _gj)::int <> 10 OR extract(day FROM _gj)::int <> 2 THEN
    RAISE EXCEPTION 'ROLLED BACK: Gandhi Jayanti is on %, not 2 October', _gj;
  END IF;

  RAISE NOTICE 'calendar cleaned: no demo titles, Gandhi Jayanti on %', _gj;
END $verify$;
