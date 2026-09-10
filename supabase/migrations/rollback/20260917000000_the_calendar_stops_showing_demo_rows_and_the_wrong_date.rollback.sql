-- Rollback for 20260917000000.
--
-- Puts Gandhi Jayanti back on 13 September and restores the three demo rows.
--
-- WHAT ROLLING THIS BACK COSTS: students see "(Arjun demo)" in their school
-- calendar again, and a national holiday sits on the wrong date. There is no
-- good reason to run this; it exists because every migration ships one.
--
-- The three rows are recreated with NEW ids — the originals were inserted by
-- hand and their ids were not recorded anywhere before deletion. School and
-- type are restored from what was measured on 2026-09-10.

UPDATE public.school_calendar_events
   SET starts_at = make_timestamptz(extract(year FROM starts_at)::int, 9, 13, 0, 0, 0)
 WHERE title = 'Gandhi Jayanti';

INSERT INTO public.school_calendar_events (school_id, title, event_type, starts_at)
SELECT s.id, v.title, v.event_type, v.starts_at
  FROM (VALUES
    ('Teachers'' Day Holiday (Arjun demo)', 'holiday', '2026-08-30T00:00:00Z'::timestamptz),
    ('Parent-Teacher Meeting (Arjun demo)', 'meeting', '2026-09-03T00:00:00Z'::timestamptz),
    ('Sports Day (Arjun demo)',             'sports',  '2026-09-12T00:00:00Z'::timestamptz)
  ) AS v(title, event_type, starts_at)
  CROSS JOIN (SELECT id FROM public.schools ORDER BY created_at LIMIT 1) s
 WHERE NOT EXISTS (
   SELECT 1 FROM public.school_calendar_events e WHERE e.title = v.title
 );
