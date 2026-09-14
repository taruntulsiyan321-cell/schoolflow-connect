-- Rollback for 20260925170000_closed_homework_is_history_before_the_closure_runs.
--
-- Puts `tg_homework_lifecycle` back exactly as 20260925110000 defined it:
-- homework closed to people only once the closure job has resolved it.
--
-- WHAT REVERTING COSTS: between a released homework's deadline and the closure
-- job reaching it, a teacher can again unpublish it (so nobody who missed it is
-- charged) or move its deadline and reopen it. Roll back only to undo a
-- deployment.
--
-- WHAT IT DOES NOT PUT BACK: the duplicate foreign key `hw_sub_student_fkey`.
-- It was identical to `homework_submissions_student_id_fkey`, which stays;
-- nothing read it, so restoring it would restore a defect — the ambiguous
-- second relationship — and no behaviour. A database built from the
-- migrations never had it either.

DO $pre$
BEGIN
  -- Something applied since may have redefined the trigger function; putting
  -- the old body back would silently undo that too.
  IF (SELECT prosrc FROM pg_proc WHERE oid = 'public.tg_homework_lifecycle()'::regprocedure)
     !~ 'OLD\.status = ''published'' OR OLD\.published_at IS NOT NULL' THEN
    RAISE EXCEPTION 'ABORT: tg_homework_lifecycle is not the version 20260925170000 left. Roll back what changed it first.';
  END IF;
END
$pre$;

CREATE OR REPLACE FUNCTION public.tg_homework_lifecycle()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF auth.uid() IS NOT NULL THEN
      NEW.created_by := auth.uid();
    END IF;
    NEW.resolved_at := NULL;
    NEW.deleted_at := NULL;
    NEW.deleted_by := NULL;
  ELSE
    -- Closed homework is history. Its deadline and class cannot move, and it
    -- cannot go back to draft or scheduled — republishing would tell the class
    -- "New homework" about work nobody can hand in. Archiving it is allowed.
    IF OLD.resolved_at IS NOT NULL
       AND (NEW.closes_at IS DISTINCT FROM OLD.closes_at
            OR NEW.class_id IS DISTINCT FROM OLD.class_id
            OR NEW.status IN ('draft', 'scheduled')) THEN
      RAISE EXCEPTION 'This homework has closed. Its deadline, class and release are history and cannot change.'
        USING ERRCODE = '55000';
    END IF;
  END IF;

  -- Nothing is released to a class after its deadline, and a released
  -- homework's deadline is not moved to a moment that has already passed. A
  -- person doing either is refused: releasing it would announce work nobody can
  -- hand in, and pulling the deadline into the past would close it at once and
  -- charge the class the missed-homework XP for work it still had time to do.
  -- Extending a deadline, or shortening it to a later moment, is allowed. The
  -- rule is for people: the scheduler keeps it by releasing only homework whose
  -- deadline is still ahead (publish_due_scheduled_work, below), and the server
  -- writing a row directly — a seed, this migration's proof — is not refused.
  IF auth.uid() IS NOT NULL
     AND NEW.status IN ('published', 'scheduled')
     AND (TG_OP = 'INSERT'
          OR OLD.status IS DISTINCT FROM NEW.status
          OR NEW.closes_at IS DISTINCT FROM OLD.closes_at)
     AND NEW.closes_at <= now() THEN
    RAISE EXCEPTION 'That deadline has already passed. Set a later deadline for work the class is given.'
      USING ERRCODE = '55000';
  END IF;

  IF NEW.status = 'published' AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'published') THEN
    NEW.published_at := coalesce(NEW.published_at, now());
  ELSIF NEW.status <> 'published' AND NEW.status <> 'archived' THEN
    NEW.published_at := NULL;
  END IF;

  IF NEW.status = 'archived' AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'archived') THEN
    NEW.archived_at := now();
  ELSIF NEW.status <> 'archived' THEN
    NEW.archived_at := NULL;
  END IF;

  RETURN NEW;
END;
$$;

DO $verify$
BEGIN
  IF (SELECT prosrc FROM pg_proc WHERE oid = 'public.tg_homework_lifecycle()'::regprocedure) ~ 'OLD\.published_at IS NOT NULL' THEN
    RAISE EXCEPTION 'ROLLED BACK: tg_homework_lifecycle still closes unresolved homework';
  END IF;
  IF (SELECT prosrc FROM pg_proc WHERE oid = 'public.tg_homework_lifecycle()'::regprocedure) !~ 'IF OLD\.resolved_at IS NOT NULL\s+AND \(NEW\.closes_at' THEN
    RAISE EXCEPTION 'ROLLED BACK: tg_homework_lifecycle is not the resolved-only version again';
  END IF;
  RAISE NOTICE 'rollback OK: homework is closed to people only once resolved again';
END
$verify$;
