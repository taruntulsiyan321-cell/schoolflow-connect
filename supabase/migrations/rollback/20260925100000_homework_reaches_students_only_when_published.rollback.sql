-- Rollback for 20260925100000.
--
-- Restores the previous behaviour EXACTLY, including both defects it closed:
-- students and parents read unpublished and deleted homework again, and the
-- publisher is callable by any signed-in session. Grants are restored as the
-- live project held them on 2026-09-13 (authenticated and service_role). Roll
-- back only to undo a deployment; the app on this branch no longer calls the
-- publisher at all, so without the scheduler scheduled homework and tests stop
-- going out.

SELECT cron.unschedule('publish-due-scheduled-work')
 WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'publish-due-scheduled-work');

DROP FUNCTION public.publish_due_scheduled_work();

CREATE OR REPLACE FUNCTION public.publish_due_scheduled_homework(_school_id uuid DEFAULT NULL::uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _n_hw     int := 0;
  _n_test   int := 0;
  _is_svc   boolean := coalesce(current_setting('role', true) = 'service_role', false);
  _target   uuid := _school_id;
BEGIN
  -- Resolve from the caller when unspecified. NULL no longer means "every
  -- school"; for a real user it means "mine", and with no school context at all
  -- it is refused rather than widened.
  IF NOT _is_svc THEN
    IF _target IS NULL THEN
      _target := public.get_my_school_id();
    END IF;
    IF _target IS NULL THEN
      RAISE EXCEPTION 'publish_due_scheduled_homework: no school context for this caller';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM public.my_accessible_school_ids() AS s(id) WHERE s.id = _target
    ) THEN
      RAISE EXCEPTION 'publish_due_scheduled_homework: % is outside your school', _target;
    END IF;
  END IF;

  UPDATE public.homework
  SET status = 'published',
      published_at = coalesce(published_at, now()),
      updated_at = now()
  WHERE status = 'scheduled'
    AND scheduled_publish_at IS NOT NULL
    AND scheduled_publish_at <= now()
    AND (_target IS NULL OR school_id = _target);
  GET DIAGNOSTICS _n_hw = ROW_COUNT;

  UPDATE public.tests
  SET status = 'published',
      published_at = coalesce(published_at, now()),
      updated_at = now()
  WHERE status = 'scheduled'
    AND scheduled_publish_at IS NOT NULL
    AND scheduled_publish_at <= now()
    AND (_target IS NULL OR school_id = _target);
  GET DIAGNOSTICS _n_test = ROW_COUNT;

  RETURN _n_hw + _n_test;
END;
$function$;

COMMENT ON FUNCTION public.publish_due_scheduled_homework(uuid) IS
  'Publishes homework and tests whose scheduled_publish_at has passed, for ONE school. Fenced 20260908000000: the school is resolved from the caller and an argument naming another school is refused -- it previously accepted any school id from any authenticated user, and NULL meant every school at once. service_role keeps the unfenced path for a future sweep; no cron uses it yet.';

GRANT EXECUTE ON FUNCTION public.publish_due_scheduled_homework(uuid) TO authenticated;

DROP POLICY IF EXISTS "homework student read" ON public.homework;
CREATE POLICY "homework student read" ON public.homework
  FOR SELECT TO public
  USING (public.student_class_id(auth.uid()) = class_id);

DROP POLICY IF EXISTS "homework parent read" ON public.homework;
CREATE POLICY "homework parent read" ON public.homework
  FOR SELECT TO authenticated
  USING (public.is_class_of_my_child(class_id));
