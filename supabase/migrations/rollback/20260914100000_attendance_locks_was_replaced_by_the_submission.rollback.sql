-- Rollback for 20260914100000_attendance_locks_was_replaced_by_the_submission.sql
--
-- Recreates `attendance_locks` exactly as it was measured immediately before
-- the drop: four columns, the composite primary key, RLS enabled (not forced),
-- three policies, and the same grants — including the `anon` DML grant, which
-- was part of the state and is restored rather than quietly improved. A
-- rollback that returns a DIFFERENT table under the same name is not a
-- rollback.
--
-- No data is restored because there was none: the table held 0 rows for its
-- whole life. That is also why the drop was safe.
--
-- Restoring this re-opens what the forward migration closed: a second home for
-- "is this day closed?" alongside `attendance_submissions`, and a SELECT policy
-- of `USING (true)` with no tenancy predicate. Do it only to unblock something
-- else, and re-apply.

BEGIN;

CREATE TABLE public.attendance_locks (
  class_id  uuid NOT NULL,
  date      date NOT NULL,
  locked_by uuid,
  locked_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT attendance_locks_pkey PRIMARY KEY (class_id, date)
);

ALTER TABLE public.attendance_locks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "locks read auth" ON public.attendance_locks
  FOR SELECT TO authenticated
  USING (true);

CREATE POLICY "locks teacher insert" ON public.attendance_locks
  FOR INSERT TO authenticated
  WITH CHECK (public.teacher_teaches_class(auth.uid(), class_id)
              OR public.is_principal_or_admin(auth.uid()));

CREATE POLICY "locks admin delete" ON public.attendance_locks
  FOR DELETE TO authenticated
  USING (public.is_principal_or_admin(auth.uid()));

GRANT ALL ON TABLE public.attendance_locks TO anon, authenticated, service_role;

DO $verify$
DECLARE _n int;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
                  WHERE n.nspname = 'public' AND c.relname = 'attendance_locks') THEN
    RAISE EXCEPTION 'ABORT: attendance_locks was not recreated';
  END IF;

  SELECT count(*) INTO _n FROM pg_policy pol JOIN pg_class c ON c.oid = pol.polrelid
   WHERE c.relname = 'attendance_locks';
  IF _n <> 3 THEN
    RAISE EXCEPTION 'ABORT: attendance_locks came back with % policies, not the 3 it had', _n;
  END IF;

  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.attendance_locks'::regclass) THEN
    RAISE EXCEPTION 'ABORT: RLS is off on the restored table -- it was on';
  END IF;

  -- Positive control: the replacement must survive the rollback too, or
  -- attendance now has neither home for a closed day.
  IF NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
                  WHERE n.nspname = 'public' AND c.relname = 'attendance_submissions') THEN
    RAISE EXCEPTION 'ABORT: attendance_submissions is missing after the rollback';
  END IF;

  RAISE NOTICE 'attendance_locks is back, empty, with its 3 policies. CHUNK2_VERIFY section 7 will report 1 again.';
END $verify$;

COMMIT;
