-- ═══════════════════════════════════════════════════════════════════════════
-- ROLLBACK: rpc_weak_areas_v2 without the plan fence
--
-- Restores it from the definition 20261122000000 saved before editing it.
--
-- Undoes: 20261122000000_topic_weakness_is_in_the_plan_wherever_it_is_read.sql
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

DO $restore$
DECLARE _r record; _n int := 0;
BEGIN
  FOR _r IN SELECT object, definition FROM public.routines_pre_20261122000000 LOOP
    EXECUTE _r.definition;
    IF md5(pg_get_functiondef(_r.object::regprocedure)) <> md5(_r.definition) THEN
      RAISE EXCEPTION '% did not come back as it was saved', _r.object;
    END IF;
    _n := _n + 1;
  END LOOP;
  IF _n <> 1 THEN
    RAISE EXCEPTION 'expected 1 saved definition to restore, found %', _n;
  END IF;
  IF pg_get_functiondef('public.rpc_weak_areas_v2()'::regprocedure) LIKE '%analysis.topic%' THEN
    RAISE EXCEPTION 'the fence is still in the body after restoring';
  END IF;
END
$restore$;

DROP TABLE public.routines_pre_20261122000000;

DELETE FROM public.schema_migrations
 WHERE version = '20261122000000_topic_weakness_is_in_the_plan_wherever_it_is_read';

COMMIT;
