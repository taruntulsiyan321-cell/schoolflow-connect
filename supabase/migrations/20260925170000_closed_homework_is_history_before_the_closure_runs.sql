-- ═══════════════════════════════════════════════════════════════════════════
-- Closed homework is history before the closure job reaches it, too
--
-- docs/gurukul-spec-rules.md, rules 35 and 37: the deadline closes homework for
-- everyone, and "a closed homework cannot go back to draft or scheduled".
--
-- ── THE GAP, READ FROM THE LIVE DEFINITION 2026-09-14 ────────────────────────
--
-- `tg_homework_lifecycle` (20260925110000) held homework closed only once
-- `resolved_at` was set — by the closure job, `resolve_closed_homework`, which
-- pg_cron runs once a minute, and which leaves a homework unresolved and
-- retries it when its missed-homework charge cannot be applied. Between the
-- deadline and resolution a teacher could:
--
--   * unpublish it. The job resolves only published homework, so it was never
--     resolved: nobody who missed it was charged, and its hand-ins were never
--     counted as given or not given at the deadline;
--   * move its deadline to a later moment, reopening work the deadline had
--     closed — rpc_homework_submit would take hand-ins again;
--   * archive it and then take it back to draft, which is the first case by
--     another door.
--
-- The teacher's list offered Unpublish and Edit in exactly that window. The
-- screen no longer does (it asks `homeworkHasClosed`); this is the same rule
-- where it belongs, so the API cannot do what the screen does not offer.
--
-- ── WHAT CHANGES ──────────────────────────────────────────────────────────
--
-- 1. For a person, released homework whose deadline has passed is closed,
--    resolved or not: its deadline, class and release cannot change. Released
--    is `status = 'published'`, or `published_at` set — the trigger clears
--    `published_at` when work goes back to draft or scheduled and keeps it
--    through archiving. Both halves are needed on live: 9 published homework
--    from before the trigger carry no `published_at` (measured 2026-09-14),
--    and 0 drafts or scheduled homework carry one. Titles, questions and
--    archiving are untouched. The server — the closure job, a seed, a proof —
--    is still held to resolution only, as before.
--    Measured before applying: 0 released, unresolved homework past its
--    deadline on live, so nothing that exists now is newly frozen.
--
-- 2. `homework_submissions` on live carried the same foreign key twice:
--    `homework_submissions_student_id_fkey` and `hw_sub_student_fkey`
--    (20260508010620), both student_id → students(id) ON DELETE CASCADE. The
--    duplicate is dropped. Nothing names it: no policy, function or client
--    embed (searched), and a second relationship between the same two tables
--    is what makes a PostgREST embed ambiguous. `IF EXISTS`, because a
--    database built from the migrations never gets it: 20260508010620 stops
--    on a bare cluster at its first constraint, which already exists there.
--
-- Rollback: supabase/migrations/rollback/
--           20260925170000_closed_homework_is_history_before_the_closure_runs.rollback.sql
-- ═══════════════════════════════════════════════════════════════════════════

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
    --
    -- Closed is resolved by the closure job — or, for a person, released and
    -- past its deadline before the job has reached it. The job runs a minute
    -- apart and retries a homework whose charge failed; in that wait,
    -- unpublishing took the homework out of its reach (it resolves published
    -- homework only, so nobody who missed it was charged) and moving the
    -- deadline reopened work the deadline had closed. Released is published,
    -- or carrying published_at, which this trigger clears on the way back to
    -- draft or scheduled and keeps through archiving.
    IF (OLD.resolved_at IS NOT NULL
        OR (auth.uid() IS NOT NULL
            AND (OLD.status = 'published' OR OLD.published_at IS NOT NULL)
            AND OLD.closes_at <= now()))
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

ALTER TABLE public.homework_submissions DROP CONSTRAINT IF EXISTS hw_sub_student_fkey;

-- ── Proof ──────────────────────────────────────────────────────────────────
-- Behaviour, as a person, on a fixture homework inside a savepoint that always
-- rolls back (P0999, as in 20260925110000). Each refusal sits beside a write the
-- rule must still allow, so a trigger that refused everything fails here too.
DO $verify$
DECLARE
  _school  uuid;
  _class   uuid;
  _teacher uuid;
  _hw      uuid;
  _legacy  uuid;
  _draft   uuid;
  _code    text;
  _n       int;
  _as_teacher text;
BEGIN
  IF (SELECT count(*) FROM pg_constraint
       WHERE conrelid = 'public.homework_submissions'::regclass AND contype = 'f'
         AND confrelid = 'public.students'::regclass) <> 1 THEN
    RAISE EXCEPTION 'ROLLED BACK: homework_submissions does not hold exactly one foreign key to students';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conname = 'homework_submissions_student_id_fkey'
                    AND conrelid = 'public.homework_submissions'::regclass AND confdeltype = 'c') THEN
    RAISE EXCEPTION 'ROLLED BACK: the foreign key kept is not homework_submissions_student_id_fkey ON DELETE CASCADE';
  END IF;

  SELECT t.school_id, tc.class_id, t.user_id INTO _school, _class, _teacher
    FROM public.teacher_classes tc
    JOIN public.teachers t ON t.id = tc.teacher_id
    JOIN public.classes c ON c.id = tc.class_id AND c.school_id = t.school_id
   WHERE t.user_id IS NOT NULL
   ORDER BY tc.class_id, t.user_id
   LIMIT 1;
  IF _teacher IS NULL THEN
    RAISE EXCEPTION 'ROLLED BACK: no teacher with an account to act as';
  END IF;
  _as_teacher := json_build_object('sub', _teacher, 'role', 'authenticated')::text;

  BEGIN
    -- Released homework, as the server sets it, and its deadline passed: the
    -- closure job has not run.
    INSERT INTO public.homework (school_id, class_id, subject, title, description, closes_at, status)
    VALUES (_school, _class, 'Mathematics', '[verify 20260925170000] released', 'q', now() + interval '1 day', 'published')
    RETURNING id INTO _hw;
    UPDATE public.homework SET closes_at = now() - interval '1 second' WHERE id = _hw;
    IF (SELECT resolved_at FROM public.homework WHERE id = _hw) IS NOT NULL THEN
      RAISE EXCEPTION 'ROLLED BACK: the fixture was resolved before the proof could act on it';
    END IF;

    PERFORM set_config('request.jwt.claims', _as_teacher, true);

    BEGIN
      UPDATE public.homework SET status = 'draft' WHERE id = _hw;
      _code := 'none';
    EXCEPTION WHEN OTHERS THEN _code := SQLSTATE;
    END;
    IF _code <> '55000' THEN
      RAISE EXCEPTION 'ROLLED BACK: a person took released homework past its deadline back to draft (%)', _code;
    END IF;

    BEGIN
      UPDATE public.homework SET closes_at = now() + interval '3 days' WHERE id = _hw;
      _code := 'none';
    EXCEPTION WHEN OTHERS THEN _code := SQLSTATE;
    END;
    IF _code <> '55000' THEN
      RAISE EXCEPTION 'ROLLED BACK: a person reopened released homework by moving its passed deadline (%)', _code;
    END IF;

    -- Still allowed: its title, and archiving it. Each positive control names
    -- itself when refused, rather than surfacing as the trigger's own refusal.
    BEGIN
      UPDATE public.homework SET title = '[verify 20260925170000] released, retitled' WHERE id = _hw;
      GET DIAGNOSTICS _n = ROW_COUNT;
    EXCEPTION WHEN OTHERS THEN
      RAISE EXCEPTION 'ROLLED BACK: a person could not retitle closed homework (%)', SQLERRM;
    END;
    IF _n <> 1 THEN
      RAISE EXCEPTION 'ROLLED BACK: a person could not retitle closed homework';
    END IF;
    BEGIN
      UPDATE public.homework SET status = 'archived' WHERE id = _hw;
      GET DIAGNOSTICS _n = ROW_COUNT;
    EXCEPTION WHEN OTHERS THEN
      RAISE EXCEPTION 'ROLLED BACK: a person could not archive closed homework (%)', SQLERRM;
    END;
    IF _n <> 1 THEN
      RAISE EXCEPTION 'ROLLED BACK: a person could not archive closed homework';
    END IF;

    -- Archiving is not a door back to draft: published_at stays.
    BEGIN
      UPDATE public.homework SET status = 'draft' WHERE id = _hw;
      _code := 'none';
    EXCEPTION WHEN OTHERS THEN _code := SQLSTATE;
    END;
    IF _code <> '55000' THEN
      RAISE EXCEPTION 'ROLLED BACK: archiving and then unarchiving took closed homework back to draft (%)', _code;
    END IF;

    -- A published homework from before the trigger, with no published_at, is released too.
    PERFORM set_config('request.jwt.claims', '', true);
    INSERT INTO public.homework (school_id, class_id, subject, title, description, closes_at, status)
    VALUES (_school, _class, 'Mathematics', '[verify 20260925170000] legacy', 'q', now() - interval '1 day', 'published')
    RETURNING id INTO _legacy;
    UPDATE public.homework SET published_at = NULL WHERE id = _legacy;
    -- The server is held to resolution only: it may still move this deadline.
    BEGIN
      UPDATE public.homework SET closes_at = now() - interval '2 days' WHERE id = _legacy;
      GET DIAGNOSTICS _n = ROW_COUNT;
    EXCEPTION WHEN OTHERS THEN
      RAISE EXCEPTION 'ROLLED BACK: the server could not move an unresolved deadline (%)', SQLERRM;
    END;
    IF _n <> 1 THEN
      RAISE EXCEPTION 'ROLLED BACK: the server could not move an unresolved deadline';
    END IF;
    PERFORM set_config('request.jwt.claims', _as_teacher, true);
    BEGIN
      UPDATE public.homework SET status = 'draft' WHERE id = _legacy;
      _code := 'none';
    EXCEPTION WHEN OTHERS THEN _code := SQLSTATE;
    END;
    IF _code <> '55000' THEN
      RAISE EXCEPTION 'ROLLED BACK: published homework with no published_at went back to draft past its deadline (%)', _code;
    END IF;

    -- Work never released is not closed by a deadline: a draft's may move.
    PERFORM set_config('request.jwt.claims', '', true);
    INSERT INTO public.homework (school_id, class_id, subject, title, description, closes_at, status)
    VALUES (_school, _class, 'Mathematics', '[verify 20260925170000] draft', '', now() - interval '1 day', 'draft')
    RETURNING id INTO _draft;
    PERFORM set_config('request.jwt.claims', _as_teacher, true);
    BEGIN
      UPDATE public.homework SET closes_at = now() + interval '3 days' WHERE id = _draft;
      GET DIAGNOSTICS _n = ROW_COUNT;
    EXCEPTION WHEN OTHERS THEN
      RAISE EXCEPTION 'ROLLED BACK: a person could not move the deadline of a draft that was never released (%)', SQLERRM;
    END;
    IF _n <> 1 THEN
      RAISE EXCEPTION 'ROLLED BACK: a person could not move the deadline of a draft that was never released';
    END IF;

    PERFORM set_config('request.jwt.claims', '', true);
    RAISE EXCEPTION USING ERRCODE = 'P0999', MESSAGE = 'verify fixtures rolled back';
  EXCEPTION WHEN SQLSTATE 'P0999' THEN
    NULL;
  END;

  IF EXISTS (SELECT 1 FROM public.homework WHERE title LIKE '[verify 20260925170000]%') THEN
    RAISE EXCEPTION 'ROLLED BACK: verify fixtures survived the savepoint';
  END IF;

  RAISE NOTICE 'verify OK: released homework past its deadline is closed to people before the closure job runs — no draft, no reopened deadline, no archive-and-unarchive, legacy rows included — while its title and archiving stay open, the server still moves an unresolved deadline, and a draft never released keeps a movable deadline; homework_submissions holds one foreign key to students';
END
$verify$;
