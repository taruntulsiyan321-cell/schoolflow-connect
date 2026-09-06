-- ═══════════════════════════════════════════════════════════════════════════
-- ROLLBACK — the school fence comes off and the zero-arg overload returns
--
-- THIS RESTORES A CROSS-TENANT WRITE. After it, any authenticated user can
-- again call publish_due_scheduled_homework('<any school>') and force-publish
-- that school's scheduled homework and tests, and passing NULL publishes every
-- school's at once.
--
-- It ALSO restores the 42703 on `tests.updated_at`, which is the only reason
-- the hole above was not reachable in practice: the tests UPDATE aborts the
-- function and rolls the homework UPDATE back with it. The two defects masked
-- each other, so this file must remove both or it leaves the fence off with
-- the crash gone -- the one combination that is worse than either.
--
-- `tests.updated_at` is dropped last, and DROPPING IT DESTROYS DATA: every
-- row's modification timestamp. Seven call sites write that column; they go
-- back to writing one that does not exist.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

CREATE OR REPLACE FUNCTION public.publish_due_scheduled_homework(_school_id uuid DEFAULT NULL)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _n_hw int := 0;
  _n_test int := 0;
BEGIN
  UPDATE public.homework
  SET status = 'published',
      published_at = coalesce(published_at, now()),
      updated_at = now()
  WHERE status = 'scheduled'
    AND scheduled_publish_at IS NOT NULL
    AND scheduled_publish_at <= now()
    AND (_school_id IS NULL OR school_id = _school_id);
  GET DIAGNOSTICS _n_hw = ROW_COUNT;

  UPDATE public.tests
  SET status = 'published',
      published_at = coalesce(published_at, now()),
      updated_at = now()
  WHERE status = 'scheduled'
    AND scheduled_publish_at IS NOT NULL
    AND scheduled_publish_at <= now()
    AND (_school_id IS NULL OR school_id = _school_id);
  GET DIAGNOSTICS _n_test = ROW_COUNT;

  RETURN _n_hw + _n_test;
END;
$function$;

COMMENT ON FUNCTION public.publish_due_scheduled_homework(uuid) IS NULL;

CREATE OR REPLACE FUNCTION public.publish_due_scheduled_homework()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  RETURN public.publish_due_scheduled_homework(NULL);
END;
$function$;

DROP TRIGGER IF EXISTS tests_set_updated ON public.tests;
ALTER TABLE public.tests DROP COLUMN IF EXISTS updated_at;

COMMIT;
