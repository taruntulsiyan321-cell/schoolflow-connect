-- ═══════════════════════════════════════════════════════════════════════════
-- Homework reaches a student only once it is published — and it gets published
-- by a scheduler, not by whoever happens to open a page
--
-- The product owner's homework specification, 2026-09-13: the teacher sets a
-- deadline "and may also SCHEDULE when it goes out". This is the half of that
-- which decides WHO SEES IT WHEN. docs/gurukul-spec-rules.md, "Homework — RULED
-- 2026-09-13".
--
-- ── TWO LEAKS, BOTH MEASURED AS A REAL SIGNED-IN STUDENT ──────────────────
--
-- 1. `homework student read` was `student_class_id(auth.uid()) = class_id`
--    with no status filter, granted TO public. The screen hid drafts; the API
--    handed them over. `homework parent read` had the same shape. A draft is
--    the teacher's unfinished work and a scheduled row is one the teacher chose
--    NOT to release yet — neither is the student's to read, and a deleted row
--    is nobody's.
--
-- 2. `publish_due_scheduled_homework` is SECURITY DEFINER with no role check,
--    EXECUTE was held by every signed-in session (`authenticated`, measured on
--    the live project 2026-09-13; anon had lost it), and five screens
--    called it on page load — including the student's Assignments, Homework
--    and Tests pages. A student's session published the teacher's scheduled
--    homework.
--
-- ── AND THE SCHEDULER THAT DID NOT EXIST ──────────────────────────────────
--
-- Those page-load calls WERE the scheduler. Nothing else ran it: no cron job,
-- no edge function. Nobody opens the app, nothing publishes. Worse, the
-- function could not have been scheduled as written — with no JWT it resolves
-- "my school" to NULL and raises "no school context", so a cron job calling it
-- would have failed every minute. It also publishes scheduled TESTS, which is
-- why the rewrite keeps that half: removing the page loads without a real
-- scheduler would have stopped scheduled tests going out too.
--
-- ── WHAT THIS DOES ────────────────────────────────────────────────────────
--
-- * Students and parents read homework that is published and not deleted.
--   Nothing else changes for staff: teachers, the principal and admins read
--   what they read before.
-- * `publish_due_scheduled_work()` replaces `publish_due_scheduled_homework`.
--   Renamed because it publishes homework AND tests, and the old name said
--   otherwise. Called by the scheduler it covers every school; called by a
--   signed-in member of staff it covers their own school; called by anyone
--   else it refuses. Neither PUBLIC nor `anon` holds EXECUTE. It no longer publishes a DELETED
--   scheduled row, which the old one did for both tables.
-- * pg_cron job `publish-due-scheduled-work`, every minute. The migration
--   refuses to apply where `cron.schedule` does not exist, rather than claiming
--   scheduled work goes out when nothing would send it.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. Read fences ────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "homework student read" ON public.homework;
CREATE POLICY "homework student read" ON public.homework
  FOR SELECT TO authenticated
  USING (
    public.student_class_id(auth.uid()) = class_id
    AND status = 'published'
    AND deleted_at IS NULL
  );

DROP POLICY IF EXISTS "homework parent read" ON public.homework;
CREATE POLICY "homework parent read" ON public.homework
  FOR SELECT TO authenticated
  USING (
    public.is_class_of_my_child(class_id)
    AND status = 'published'
    AND deleted_at IS NULL
  );

-- ── 2. The one publisher ──────────────────────────────────────────────────

DROP FUNCTION public.publish_due_scheduled_homework(uuid);

CREATE OR REPLACE FUNCTION public.publish_due_scheduled_work()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  -- Inside SECURITY DEFINER, `current_user` is the owner for every caller.
  -- The session role is what tells a PostgREST request (`anon`,
  -- `authenticated`) from the scheduler (`postgres` under pg_cron, reporting
  -- 'none') or a service-role worker.
  _session_role text := coalesce(nullif(current_setting('role', true), ''), 'none');
  _uid uuid := auth.uid();
  _school uuid := NULL;
  _n_hw int := 0;
  _n_test int := 0;
BEGIN
  IF _session_role IN ('anon', 'authenticated') THEN
    IF _uid IS NULL OR NOT (
         public.has_role(_uid, 'teacher'::public.app_role)
      OR public.has_role(_uid, 'admin'::public.app_role)
      OR public.has_role(_uid, 'principal'::public.app_role)
    ) THEN
      RAISE EXCEPTION 'Only school staff may publish scheduled work'
        USING ERRCODE = '42501';
    END IF;
    _school := public.get_my_school_id();
    IF _school IS NULL THEN
      RAISE EXCEPTION 'publish_due_scheduled_work: no school context for this caller'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  UPDATE public.homework
     SET status = 'published',
         published_at = coalesce(published_at, now()),
         updated_at = now()
   WHERE status = 'scheduled'
     AND scheduled_publish_at IS NOT NULL
     AND scheduled_publish_at <= now()
     AND deleted_at IS NULL
     AND (_school IS NULL OR school_id = _school);
  GET DIAGNOSTICS _n_hw = ROW_COUNT;

  UPDATE public.tests
     SET status = 'published',
         published_at = coalesce(published_at, now()),
         updated_at = now()
   WHERE status = 'scheduled'
     AND scheduled_publish_at IS NOT NULL
     AND scheduled_publish_at <= now()
     AND deleted_at IS NULL
     AND (_school IS NULL OR school_id = _school);
  GET DIAGNOSTICS _n_test = ROW_COUNT;

  RETURN _n_hw + _n_test;
END;
$$;

COMMENT ON FUNCTION public.publish_due_scheduled_work() IS
  'Publishes homework and tests whose scheduled_publish_at has passed. Run every minute by pg_cron job publish-due-scheduled-work across all schools; a signed-in teacher, admin or principal may run it for their own school; any other caller is refused (42501). Never publishes a deleted row. Replaces publish_due_scheduled_homework, which any signed-in session — a student''s included — could run, and which page loads called in place of a scheduler.';

-- A function created in public executes for service_role alone by default
-- (pg_default_acl, measured on the live project); a signed-in member of staff
-- needs it too, and anon gets nothing.
GRANT EXECUTE ON FUNCTION public.publish_due_scheduled_work() TO authenticated;

-- ── 3. The scheduler ──────────────────────────────────────────────────────

DO $cron$
BEGIN
  IF to_regprocedure('cron.schedule(text,text,text)') IS NULL THEN
    RAISE EXCEPTION 'ABORT: cron.schedule(text,text,text) does not exist, so scheduled homework and tests would never publish. Install pg_cron, then apply this migration.';
  END IF;
  PERFORM cron.schedule(
    'publish-due-scheduled-work',
    '* * * * *',
    'SELECT public.publish_due_scheduled_work()'
  );
END
$cron$;

-- ── 4. Proof ──────────────────────────────────────────────────────────────
--
-- Runs as the real callers, inside ONE savepoint that always ends by raising
-- P0999: publishing a fixture notifies a real class and writes audit and feed
-- rows, and none of that may survive the proof. Every assertion raises a
-- different error, which escapes the handler and rolls the migration back.
-- Every refusal has its positive control beside it: a student who reads
-- nothing proves nothing unless the same student reads the same row once it is
-- published, and a scheduler that skips a row proves nothing unless it
-- publishes the row beside it.

DO $verify$
DECLARE
  _school uuid; _class uuid; _teacher uuid; _student_user uuid; _parent_user uuid;
  _section_subject uuid; _other_school uuid; _other_class uuid;
  _draft uuid; _sched uuid; _gone uuid; _gone_sched uuid; _test uuid; _later uuid; _elsewhere uuid;
  _n int; _refused boolean; _job text;
BEGIN
BEGIN
  -- A section with a signed-in teacher, a signed-in student and a signed-in
  -- parent of that student. The teacher is chosen through an active teacher
  -- MEMBERSHIP, not `has_role/2`: that form asks whether the CALLER is acting
  -- in a role, and here there is no caller yet, so it is false for everyone
  -- (rule 28).
  SELECT s.school_id, s.class_id, t.user_id, s.user_id, p.user_id
    INTO _school, _class, _teacher, _student_user, _parent_user
    FROM public.students s
    JOIN public.teacher_classes tc ON tc.class_id = s.class_id
    JOIN public.teachers t ON t.id = tc.teacher_id AND t.user_id IS NOT NULL AND t.deleted_at IS NULL
    JOIN public.memberships m ON m.local_person_id = t.id AND m.role = 'teacher'
                             AND m.status = 'active' AND m.school_id = s.school_id
    JOIN public.parent_students ps ON ps.student_id = s.id
    JOIN public.parents p ON p.id = ps.parent_id AND p.user_id IS NOT NULL
   WHERE s.user_id IS NOT NULL AND s.deleted_at IS NULL
   LIMIT 1;
  IF _parent_user IS NULL THEN
    RAISE EXCEPTION 'ROLLED BACK: need a section with a signed-in teacher, student and parent';
  END IF;
  SELECT id INTO _section_subject FROM public.section_subjects WHERE school_id = _school LIMIT 1;
  IF _section_subject IS NULL THEN
    RAISE EXCEPTION 'ROLLED BACK: need a section subject in the school to schedule a test on';
  END IF;

  -- A second school, made here rather than looked for: the teacher's run must
  -- leave another school's due row alone, and a proof that is skipped when
  -- the database happens to hold one school reads exactly like one that passed.
  INSERT INTO public.schools (name) VALUES ('[verify 20260925100000] elsewhere') RETURNING id INTO _other_school;
  INSERT INTO public.classes (school_id, name, section) VALUES (_other_school, 'V', 'A') RETURNING id INTO _other_class;

  INSERT INTO public.homework (school_id, class_id, subject, title, description, due_date, status, created_by)
  VALUES (_school, _class, 'Mathematics', '[verify 20260925100000] draft', 'q', current_date + 7, 'draft', _teacher)
  RETURNING id INTO _draft;
  INSERT INTO public.homework (school_id, class_id, subject, title, description, due_date, status, scheduled_publish_at, created_by)
  VALUES (_school, _class, 'Mathematics', '[verify 20260925100000] scheduled', 'q', current_date + 7, 'scheduled', now() - interval '1 minute', _teacher)
  RETURNING id INTO _sched;
  INSERT INTO public.homework (school_id, class_id, subject, title, description, due_date, status, published_at, deleted_at, created_by)
  VALUES (_school, _class, 'Mathematics', '[verify 20260925100000] deleted', 'q', current_date + 7, 'published', now(), now(), _teacher)
  RETURNING id INTO _gone;
  INSERT INTO public.homework (school_id, class_id, subject, title, description, due_date, status, scheduled_publish_at, deleted_at, created_by)
  VALUES (_school, _class, 'Mathematics', '[verify 20260925100000] deleted scheduled', 'q', current_date + 7, 'scheduled', now() - interval '1 minute', now(), _teacher)
  RETURNING id INTO _gone_sched;
  INSERT INTO public.tests (school_id, section_subject_id, max_mark, title, status, scheduled_publish_at)
  VALUES (_school, _section_subject, 10, '[verify 20260925100000] scheduled test', 'scheduled', now() - interval '1 minute')
  RETURNING id INTO _test;

  -- 1. The student reads none of the three.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', _student_user, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO _n FROM public.homework WHERE id IN (_draft, _sched, _gone);
  RESET ROLE;
  IF _n <> 0 THEN
    RAISE EXCEPTION 'ROLLED BACK: a student read % unpublished or deleted homework row(s)', _n;
  END IF;

  -- 2. Nor does the parent.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', _parent_user, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO _n FROM public.homework WHERE id IN (_draft, _sched, _gone);
  RESET ROLE;
  IF _n <> 0 THEN
    RAISE EXCEPTION 'ROLLED BACK: a parent read % unpublished or deleted homework row(s)', _n;
  END IF;

  -- 3. The teacher still reads the draft and the scheduled row (the fence is
  --    for students and parents, not staff).
  PERFORM set_config('request.jwt.claims', json_build_object('sub', _teacher, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO _n FROM public.homework WHERE id IN (_draft, _sched);
  RESET ROLE;
  IF _n <> 2 THEN
    RAISE EXCEPTION 'ROLLED BACK: the teacher read % of their own draft and scheduled rows, expected 2', _n;
  END IF;

  -- 4. A student cannot publish; anon cannot even call it.
  _refused := false;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', _student_user, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    PERFORM public.publish_due_scheduled_work();
  EXCEPTION WHEN insufficient_privilege THEN _refused := true;
  END;
  RESET ROLE;
  IF NOT _refused THEN
    RAISE EXCEPTION 'ROLLED BACK: a student ran the scheduled publisher';
  END IF;
  IF (SELECT status FROM public.homework WHERE id = _sched) <> 'scheduled' THEN
    RAISE EXCEPTION 'ROLLED BACK: the refused student call still published the row';
  END IF;

  _refused := false;
  PERFORM set_config('request.jwt.claims', '', true);
  SET LOCAL ROLE anon;
  BEGIN
    PERFORM public.publish_due_scheduled_work();
  EXCEPTION WHEN insufficient_privilege THEN _refused := true;
  END;
  RESET ROLE;
  IF NOT _refused THEN
    RAISE EXCEPTION 'ROLLED BACK: anon ran the scheduled publisher';
  END IF;

  -- 5. The scheduler (no JWT, not anon/authenticated) publishes the due
  --    homework and the due test — and not the deleted scheduled row beside them.
  PERFORM set_config('request.jwt.claims', '', true);
  PERFORM public.publish_due_scheduled_work();
  IF (SELECT status FROM public.homework WHERE id = _sched) <> 'published'
     OR (SELECT published_at FROM public.homework WHERE id = _sched) IS NULL THEN
    RAISE EXCEPTION 'ROLLED BACK: the scheduler did not publish a due scheduled homework';
  END IF;
  IF (SELECT status FROM public.tests WHERE id = _test) <> 'published' THEN
    RAISE EXCEPTION 'ROLLED BACK: the scheduler did not publish a due scheduled test';
  END IF;
  IF (SELECT status FROM public.homework WHERE id = _gone_sched) <> 'scheduled' THEN
    RAISE EXCEPTION 'ROLLED BACK: the scheduler published a deleted homework';
  END IF;

  -- 6. POSITIVE CONTROL for 1: now it is published, the same student reads it.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', _student_user, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO _n FROM public.homework WHERE id = _sched;
  RESET ROLE;
  IF _n <> 1 THEN
    RAISE EXCEPTION 'ROLLED BACK: the student could not read homework once it was published — the fence is closed to everything';
  END IF;

  -- 7. A teacher's run publishes their own school's due row and leaves another
  --    school's alone.
  INSERT INTO public.homework (school_id, class_id, subject, title, description, due_date, status, scheduled_publish_at, created_by)
  VALUES (_school, _class, 'Mathematics', '[verify 20260925100000] later', 'q', current_date + 7, 'scheduled', now() - interval '1 minute', _teacher)
  RETURNING id INTO _later;
  INSERT INTO public.homework (school_id, class_id, subject, title, description, due_date, status, scheduled_publish_at, created_by)
  VALUES (_other_school, _other_class, 'Mathematics', '[verify 20260925100000] elsewhere', 'q', current_date + 7, 'scheduled', now() - interval '1 minute', _teacher)
  RETURNING id INTO _elsewhere;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', _teacher, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  PERFORM public.publish_due_scheduled_work();
  RESET ROLE;
  IF (SELECT status FROM public.homework WHERE id = _later) <> 'published' THEN
    RAISE EXCEPTION 'ROLLED BACK: a teacher''s run did not publish their own school''s due homework';
  END IF;
  IF (SELECT status FROM public.homework WHERE id = _elsewhere) <> 'scheduled' THEN
    RAISE EXCEPTION 'ROLLED BACK: a teacher''s run published another school''s homework';
  END IF;

  -- 8. The job is there, and it calls the function that exists.
  SELECT command INTO _job FROM cron.job WHERE jobname = 'publish-due-scheduled-work';
  IF _job IS NULL OR _job NOT LIKE '%publish_due_scheduled_work()%' THEN
    RAISE EXCEPTION 'ROLLED BACK: no scheduler job runs publish_due_scheduled_work (found: %)', _job;
  END IF;
  IF to_regprocedure('public.publish_due_scheduled_homework(uuid)') IS NOT NULL THEN
    RAISE EXCEPTION 'ROLLED BACK: the old unfenced publisher still exists';
  END IF;

  PERFORM set_config('request.jwt.claims', '', true);
  RAISE EXCEPTION USING ERRCODE = 'P0999', MESSAGE = 'verify fixtures rolled back';
EXCEPTION WHEN SQLSTATE 'P0999' THEN
  NULL;
END;

  IF EXISTS (SELECT 1 FROM public.homework WHERE title LIKE '[verify 20260925100000]%')
     OR EXISTS (SELECT 1 FROM public.schools WHERE name LIKE '[verify 20260925100000]%') THEN
    RAISE EXCEPTION 'ROLLED BACK: verify fixtures survived the savepoint';
  END IF;

  RAISE NOTICE 'verify OK: students and parents read only published, undeleted homework; the publisher refuses a student and anon, publishes due homework and tests for the scheduler, skips deleted rows, and keeps a teacher to their own school; the job exists — and nothing the proof did survived';
END
$verify$;