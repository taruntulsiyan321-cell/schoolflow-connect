-- ---------------------------------------------------------------------
-- REVERSE OF: SCALE_FIXTURE.sql
--
-- Removes Northfield Public School and everything hanging off it. Written
-- because the fixture had no way back: a fixture you cannot remove is a
-- one-way change to the database, and the rest of this build holds every
-- migration to being reversible. There is no reason a fixture should be
-- the exception, least of all one that adds a whole institution.
--
-- WHAT THIS COSTS: the timing gate goes blind again. With Northfield gone,
-- the heaviest table a demo-school reader faces is 26 marks — the volume
-- that hid a 50-second parent read through the whole of Chunk 6. Run this
-- to get back to one institution, not as a resting state for measurement.
--
-- WHY IT IS GENERIC RATHER THAN A LIST. The first version deleted the
-- tables the fixture writes, in FK order, and failed on the first run:
--
--   violates foreign key "school_activity_feed_school_id_fkey"
--
-- because triggers write rows the fixture never mentions —
-- school_activity_feed, academic_events, academic_audit. A hand-kept list
-- is wrong the moment anyone adds a trigger, and it fails LOUDLY here but
-- would fail SILENTLY as a half-removed institution if the delete order
-- happened to work. So it enumerates every school-scoped table instead and
-- repeats until a pass removes nothing, which resolves FK order by
-- convergence rather than by someone maintaining a topological sort.
-- ---------------------------------------------------------------------

DO $$
DECLARE
  _school   uuid := '00000000-0000-4000-8000-000000000002';
  _tbl      text;
  _removed  bigint;
  _pass     int := 0;
  _total    bigint := 0;
  _stuck    text := '';
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.schools WHERE id = _school) THEN
    RAISE NOTICE 'scale fixture not present — nothing to remove';
    RETURN;
  END IF;

  LOOP
    _pass := _pass + 1;
    _removed := 0;

    FOR _tbl IN
      SELECT c.relname
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public'
         AND c.relkind = 'r'
         AND c.relname <> 'schools'
         AND EXISTS (SELECT 1 FROM pg_attribute a
                      WHERE a.attrelid = c.oid AND a.attname = 'school_id'
                        AND a.attnum > 0 AND NOT a.attisdropped)
       ORDER BY c.relname
    LOOP
      BEGIN
        EXECUTE format('DELETE FROM public.%I WHERE school_id = $1', _tbl) USING _school;
        GET DIAGNOSTICS _total = ROW_COUNT;
        _removed := _removed + _total;
      EXCEPTION WHEN foreign_key_violation THEN
        -- Something still points at these rows. A later pass will get it
        -- once its own referents are gone.
        NULL;
      END;
    END LOOP;

    EXIT WHEN _removed = 0;
    IF _pass > 20 THEN
      RAISE EXCEPTION 'scale fixture removal did not converge after % passes', _pass;
    END IF;
  END LOOP;

  -- Only now can the institution itself go. If anything still references
  -- it, this raises rather than leaving a half-removed school behind.
  DELETE FROM public.schools WHERE id = _school;

  -- Refuse to report success on a partial removal.
  FOR _tbl IN
    SELECT c.relname
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relname <> 'schools'
       AND EXISTS (SELECT 1 FROM pg_attribute a
                    WHERE a.attrelid = c.oid AND a.attname = 'school_id'
                      AND a.attnum > 0 AND NOT a.attisdropped)
  LOOP
    EXECUTE format('SELECT count(*) FROM public.%I WHERE school_id = $1', _tbl)
      INTO _total USING _school;
    IF _total > 0 THEN
      _stuck := _stuck || format('%s(%s) ', _tbl, _total);
    END IF;
  END LOOP;

  IF _stuck <> '' THEN
    RAISE EXCEPTION 'scale fixture only partly removed; rows remain in: %', _stuck;
  END IF;

  RAISE NOTICE 'scale fixture removed cleanly in % pass(es)', _pass;
END $$;

SELECT (SELECT count(*) FROM public.schools)          AS schools,
       (SELECT count(*) FROM public.students)         AS students,
       (SELECT count(*) FROM public.marks)            AS marks,
       (SELECT count(*) FROM public.academic_events)  AS academic_events;
