-- Rollback for 20260925110000_homework_is_one_file_and_two_decisions.
--
-- Restores the seven-status, typed-and-graded homework model as it was, with
-- every defect the migration removed: students writing their own submission
-- rows (status 'graded' included), the lock that a file swap slipped past, the
-- deadline split across due_date, due_time and a UTC-cast closes_at, and the
-- three dead paths — homework_questions, homework_answers, homework_completions
-- and rpc_close_homework. Roll back only to undo a deployment, and roll back
-- 20260925120000 first: it builds on this one.
--
-- DATA. The migration copied every row into the two _pre_ snapshots before it
-- reshaped anything, and it did not stamp updated_at while doing so.
--   * A row whose updated_at still equals its snapshot's has not been touched
--     since. It comes back exactly as it was, and this rollback proves that
--     before it drops the snapshots.
--   * A row a person or the scheduler changed since keeps what happened, said
--     in the old vocabulary — submitted → submitted, accepted → reviewed,
--     rejected → returned, the one file → a one-element attachments array; a
--     homework keeps its deadline, with due_date and due_time derived from it in
--     school-local time. Everything the snapshot held that the new model had no
--     column for (typed content, grade, marks, remark, tags, links…) comes back
--     onto it; nothing in the snapshot is discarded.
--   * A not_submitted row the closure job wrote has no old equivalent — in the
--     old model, no row meant nothing was handed in — and is deleted.
--   * XP stays as it was applied. What accepting awarded and what missing
--     homework cost are progression history, recorded by the engine with its own
--     keys; undoing the model does not rewrite a student's past. The column that
--     excused homework released before the cost (`missed_costs_xp`) goes.
-- Grants and tenant fences are restored as the live project held them on
-- 2026-09-13: ALL to anon and authenticated on every homework table, and the
-- my_accessible_school_ids() form of the fence. Recreated tables and functions
-- take the project's default privileges (tables: ALL to anon, authenticated and
-- service_role; functions: service_role), which is what they held; only what
-- differs from the default is granted here.
-- Column ORDER is not restored: re-added columns come last. Nothing in this
-- schema or in src/ reads a homework column by position.

-- ── 0. Preconditions ──────────────────────────────────────────────────────

DO $pre$
BEGIN
  IF to_regclass('public.homework_pre_20260925110000') IS NULL
     OR to_regclass('public.homework_submissions_pre_20260925110000') IS NULL THEN
    RAISE EXCEPTION 'ABORT: the 20260925110000 snapshots are gone, so this rollback would bring the removed columns back empty. Restore from a backup instead.';
  END IF;
  IF to_regprocedure('public.rpc_homework_delete(uuid)') IS NOT NULL THEN
    RAISE EXCEPTION 'ABORT: 20260925120000 is still applied. Roll it back first.';
  END IF;
END
$pre$;

-- ── 1. The new model's machinery goes ─────────────────────────────────────

SELECT cron.unschedule('resolve-closed-homework')
 WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'resolve-closed-homework');

DROP FUNCTION public.rpc_homework_submit(uuid, jsonb);
DROP FUNCTION public.rpc_homework_decide(uuid, text);
DROP FUNCTION public.resolve_closed_homework();
DROP TRIGGER trg_homework_lifecycle ON public.homework;
DROP FUNCTION public.tg_homework_lifecycle();

-- The publisher exactly as 20260925100000 wrote it, before this migration held
-- homework back once its deadline had passed.
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

ALTER TABLE public.homework DISABLE TRIGGER trg_emit_homework_event;
ALTER TABLE public.homework DISABLE TRIGGER homework_set_updated;
ALTER TABLE public.homework_submissions DISABLE TRIGGER trg_emit_homework_submission_event;
ALTER TABLE public.homework_submissions DISABLE TRIGGER hw_sub_set_updated;

CREATE TEMP TABLE rollback_untouched_homework AS
  SELECT h.id FROM public.homework h
  JOIN public.homework_pre_20260925110000 p ON p.id = h.id
 WHERE h.updated_at = p.updated_at;
CREATE TEMP TABLE rollback_untouched_submissions AS
  SELECT hs.id FROM public.homework_submissions hs
  JOIN public.homework_submissions_pre_20260925110000 p ON p.id = hs.id
 WHERE hs.updated_at = p.updated_at;

-- ── 2. Submissions ────────────────────────────────────────────────────────

ALTER TABLE public.homework_submissions
  DROP CONSTRAINT homework_submissions_state,
  DROP CONSTRAINT homework_submissions_file_shape,
  DROP CONSTRAINT homework_submissions_status_check,
  ADD COLUMN content text DEFAULT ''::text,
  ADD COLUMN grade text,
  ADD COLUMN teacher_remarks text,
  ADD COLUMN graded_at timestamp with time zone,
  ADD COLUMN is_late boolean DEFAULT false,
  ADD COLUMN version integer DEFAULT 1,
  ADD COLUMN attachments jsonb DEFAULT '[]'::jsonb,
  ADD COLUMN external_links jsonb DEFAULT '[]'::jsonb,
  ADD COLUMN returned_at timestamp with time zone,
  ADD COLUMN reviewed_at timestamp with time zone,
  ADD COLUMN marks_obtained numeric;

DELETE FROM public.homework_submissions hs
 WHERE hs.status = 'not_submitted'
   AND NOT EXISTS (SELECT 1 FROM public.homework_submissions_pre_20260925110000 p WHERE p.id = hs.id);

UPDATE public.homework_submissions hs
   SET status = p.status, content = p.content, grade = p.grade, teacher_remarks = p.teacher_remarks,
       submitted_at = p.submitted_at, graded_at = p.graded_at, is_late = p.is_late, version = p.version,
       attachments = p.attachments, external_links = p.external_links, returned_at = p.returned_at,
       reviewed_at = p.reviewed_at, marks_obtained = p.marks_obtained, updated_at = p.updated_at
  FROM public.homework_submissions_pre_20260925110000 p
 WHERE p.id = hs.id
   AND hs.id IN (SELECT id FROM rollback_untouched_submissions);

UPDATE public.homework_submissions hs
   SET status = CASE hs.status WHEN 'submitted' THEN 'submitted'
                               WHEN 'accepted' THEN 'reviewed'
                               WHEN 'rejected' THEN 'returned'
                               ELSE 'pending' END,
       attachments = CASE WHEN hs.file IS NULL THEN coalesce(x.attachments, '[]'::jsonb)
                          ELSE jsonb_build_array(jsonb_strip_nulls(jsonb_build_object(
                                 'name', hs.file->>'name',
                                 'url', 'academic-files/' || (hs.file->>'path'),
                                 'mimeType', hs.file->>'mime',
                                 'sizeBytes', hs.file->'size'))) END,
       reviewed_at = CASE WHEN hs.status = 'accepted' THEN hs.decided_at ELSE x.reviewed_at END,
       returned_at = CASE WHEN hs.status = 'rejected' THEN hs.decided_at ELSE x.returned_at END,
       content = coalesce(x.content, ''),
       grade = x.grade,
       teacher_remarks = x.teacher_remarks,
       marks_obtained = x.marks_obtained,
       graded_at = x.graded_at,
       external_links = coalesce(x.external_links, '[]'::jsonb),
       version = coalesce(x.version, 1),
       is_late = false
  FROM (SELECT h2.id AS sub_id, p.attachments, p.reviewed_at, p.returned_at, p.content, p.grade,
               p.teacher_remarks, p.marks_obtained, p.graded_at, p.external_links, p.version
          FROM public.homework_submissions h2
          LEFT JOIN public.homework_submissions_pre_20260925110000 p ON p.id = h2.id) x
 WHERE x.sub_id = hs.id
   AND hs.id NOT IN (SELECT id FROM rollback_untouched_submissions);

ALTER TABLE public.homework_submissions
  DROP COLUMN file,
  DROP COLUMN decided_at,
  DROP COLUMN decided_by;
ALTER TABLE public.homework_submissions ALTER COLUMN status SET DEFAULT 'pending'::text;
ALTER TABLE public.homework_submissions
  ADD CONSTRAINT homework_submissions_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'submitted'::text, 'late'::text, 'reviewed'::text, 'returned'::text, 'graded'::text, 'completed'::text])));
COMMENT ON COLUMN public.homework_submissions.status IS NULL;
COMMENT ON COLUMN public.homework_submissions.is_late IS 'Frozen historical field. Submission now locks at the due date, so this can never again become true. The 9 rows already marked late predate that rule (docs/decisions.md D1); they are kept, not rewritten.';

-- ── 3. Homework ───────────────────────────────────────────────────────────

REVOKE INSERT (school_id, class_id, subject, title, description, question_file, chapter_id, topic_id, topic,
               closes_at, priority, work_kind, status, scheduled_publish_at),
       UPDATE (subject, title, description, question_file, chapter_id, topic_id, topic,
               closes_at, priority, work_kind, status, scheduled_publish_at)
    ON public.homework FROM authenticated;

ALTER TABLE public.homework
  DROP CONSTRAINT homework_question_file_shape,
  DROP CONSTRAINT homework_question_is_text_or_file,
  DROP CONSTRAINT homework_scheduled_has_a_release,
  DROP CONSTRAINT homework_releases_before_its_deadline;
ALTER TABLE public.homework ALTER COLUMN closes_at DROP NOT NULL;

CREATE TYPE public.homework_submission_mode AS ENUM ('none', 'digital', 'upload');

ALTER TABLE public.homework
  ADD COLUMN legacy_due_date date,
  ADD COLUMN attachment_url text,
  ADD COLUMN subject_id uuid,
  ADD COLUMN instructions text,
  ADD COLUMN due_time time without time zone,
  ADD COLUMN estimated_minutes integer,
  ADD COLUMN difficulty text,
  ADD COLUMN max_marks numeric,
  ADD COLUMN tags text[] DEFAULT '{}'::text[],
  ADD COLUMN external_links jsonb DEFAULT '[]'::jsonb,
  ADD COLUMN attachments jsonb DEFAULT '[]'::jsonb,
  ADD COLUMN section_subject_id uuid,
  ADD COLUMN academic_year_id uuid,
  ADD COLUMN assigned_date date,
  ADD COLUMN submission_mode public.homework_submission_mode DEFAULT 'none'::public.homework_submission_mode NOT NULL;

-- A referenced row deleted since the migration would have nulled the reference
-- (or been refused) had the column still existed; it comes back NULL.
UPDATE public.homework h
   SET legacy_due_date = p.due_date, due_time = p.due_time, closes_at = p.closes_at,
       description = p.description, attachment_url = p.attachment_url, instructions = p.instructions,
       estimated_minutes = p.estimated_minutes, difficulty = p.difficulty, max_marks = p.max_marks,
       tags = p.tags, external_links = p.external_links, attachments = p.attachments,
       assigned_date = p.assigned_date,
       submission_mode = p.submission_mode::public.homework_submission_mode,
       subject_id = (SELECT s.id FROM public.subjects s WHERE s.id = p.subject_id),
       academic_year_id = (SELECT y.id FROM public.academic_years y WHERE y.id = p.academic_year_id),
       section_subject_id = (SELECT ss.id FROM public.section_subjects ss
                              WHERE ss.id = p.section_subject_id AND ss.school_id = p.school_id),
       updated_at = p.updated_at
  FROM public.homework_pre_20260925110000 p
 WHERE p.id = h.id
   AND h.id IN (SELECT id FROM rollback_untouched_homework);

UPDATE public.homework h
   SET legacy_due_date = (h.closes_at AT TIME ZONE 'Asia/Kolkata')::date,
       due_time = CASE WHEN x.pre_id IS NOT NULL AND x.due_time IS NULL
                        AND (h.closes_at AT TIME ZONE 'Asia/Kolkata')::time = '23:59:59'::time THEN NULL
                       ELSE (h.closes_at AT TIME ZONE 'Asia/Kolkata')::time END,
       attachments = CASE WHEN h.question_file IS NULL THEN coalesce(x.attachments, '[]'::jsonb)
                          ELSE jsonb_build_array(jsonb_strip_nulls(jsonb_build_object(
                                 'name', h.question_file->>'name',
                                 'url', 'academic-files/' || (h.question_file->>'path'),
                                 'mimeType', h.question_file->>'mime',
                                 'sizeBytes', h.question_file->'size'))) END,
       attachment_url = x.attachment_url, instructions = x.instructions,
       estimated_minutes = x.estimated_minutes, difficulty = x.difficulty, max_marks = x.max_marks,
       tags = coalesce(x.tags, '{}'::text[]), external_links = coalesce(x.external_links, '[]'::jsonb),
       assigned_date = x.assigned_date,
       submission_mode = coalesce(x.submission_mode::public.homework_submission_mode, 'none'),
       subject_id = (SELECT s.id FROM public.subjects s WHERE s.id = x.subject_id),
       academic_year_id = (SELECT y.id FROM public.academic_years y WHERE y.id = x.academic_year_id),
       section_subject_id = (SELECT ss.id FROM public.section_subjects ss
                              WHERE ss.id = x.section_subject_id AND ss.school_id = h.school_id)
  FROM (SELECT h2.id AS hw_id, p.id AS pre_id, p.due_time, p.attachments, p.attachment_url, p.instructions,
               p.estimated_minutes, p.difficulty, p.max_marks, p.tags, p.external_links, p.assigned_date,
               p.submission_mode, p.subject_id, p.academic_year_id, p.section_subject_id
          FROM public.homework h2
          LEFT JOIN public.homework_pre_20260925110000 p ON p.id = h2.id) x
 WHERE x.hw_id = h.id
   AND h.id NOT IN (SELECT id FROM rollback_untouched_homework);

DROP INDEX public.homework_awaiting_resolution_idx;
ALTER TABLE public.homework DROP COLUMN due_date;
ALTER TABLE public.homework RENAME COLUMN legacy_due_date TO due_date;
ALTER TABLE public.homework ALTER COLUMN due_date SET NOT NULL;
ALTER TABLE public.homework DROP COLUMN resolved_at, DROP COLUMN question_file, DROP COLUMN missed_costs_xp;
DROP FUNCTION public.school_local_date(timestamptz);
DROP FUNCTION public.homework_question_file_ok(jsonb);
DROP FUNCTION public.homework_hand_in_ok(jsonb);

ALTER TABLE public.homework
  ADD CONSTRAINT homework_academic_year_id_fkey FOREIGN KEY (academic_year_id) REFERENCES public.academic_years(id) ON DELETE SET NULL,
  ADD CONSTRAINT homework_section_subject_fk FOREIGN KEY (section_subject_id, school_id) REFERENCES public.section_subjects(id, school_id) ON DELETE RESTRICT,
  ADD CONSTRAINT homework_subject_id_fkey FOREIGN KEY (subject_id) REFERENCES public.subjects(id) ON DELETE SET NULL;
CREATE INDEX idx_homework_due ON public.homework USING btree (due_date);
CREATE INDEX idx_homework_school_due ON public.homework USING btree (school_id, due_date);
CREATE INDEX homework_due_date_idx ON public.homework USING btree (school_id, due_date);
CREATE INDEX homework_subject_id_idx ON public.homework USING btree (subject_id);
CREATE INDEX homework_section_subject_idx ON public.homework USING btree (section_subject_id);

COMMENT ON COLUMN public.homework.closes_at IS 'When this homework closes and its report is generated. Defaults to the end of due_date; a teacher may set it earlier. Closed is derived from closes_at <= now(), never stored separately.';
COMMENT ON COLUMN public.homework.description IS NULL;
COMMENT ON COLUMN public.homework.topic_id IS 'Structured topic for homework with no questions (upload/none modes). Digital homework carries topic per answer on homework_answers.topic_id — §10.22: per question, not per test.';

-- ── 4. The dead paths come back ───────────────────────────────────────────

CREATE TYPE public.homework_completion_status AS ENUM ('completed', 'not_completed', 'absent');

CREATE TABLE public.homework_questions (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  school_id uuid NOT NULL,
  homework_id uuid NOT NULL,
  question_id uuid NOT NULL,
  sequence integer NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT homework_questions_hw_question_key UNIQUE (homework_id, question_id),
  CONSTRAINT homework_questions_hw_sequence_key UNIQUE (homework_id, sequence),
  CONSTRAINT homework_questions_pkey PRIMARY KEY (id),
  CONSTRAINT homework_questions_sequence_positive CHECK ((sequence > 0)),
  CONSTRAINT homework_questions_homework_id_fkey FOREIGN KEY (homework_id) REFERENCES public.homework(id) ON DELETE CASCADE,
  CONSTRAINT homework_questions_question_id_fkey FOREIGN KEY (question_id) REFERENCES public.question_bank(id) ON DELETE RESTRICT,
  CONSTRAINT homework_questions_school_id_fkey FOREIGN KEY (school_id) REFERENCES public.schools(id) ON DELETE CASCADE
);
CREATE INDEX homework_questions_hw_idx ON public.homework_questions USING btree (homework_id);
ALTER TABLE public.homework_questions ENABLE ROW LEVEL SECURITY;
CREATE POLICY homework_questions_read ON public.homework_questions AS PERMISSIVE FOR SELECT TO authenticated
  USING (same_school(school_id));
CREATE POLICY homework_questions_tenant_fence ON public.homework_questions AS RESTRICTIVE FOR ALL TO anon, authenticated
  USING (school_id IS NULL OR school_id IN (SELECT public.my_accessible_school_ids()))
  WITH CHECK (school_id IS NULL OR school_id IN (SELECT public.my_accessible_school_ids()));
-- The old policy resolved the section through homework.section_subject_id,
-- which exists again by this point.
CREATE POLICY homework_questions_write_staff ON public.homework_questions AS PERMISSIVE FOR ALL TO authenticated
  USING ((same_school(school_id) AND (has_role(auth.uid(), 'admin'::app_role) OR (EXISTS ( SELECT 1
   FROM homework h
  WHERE ((h.id = homework_questions.homework_id) AND teacher_teaches_class(auth.uid(), COALESCE(( SELECT ss.section_id
           FROM section_subjects ss
          WHERE (ss.id = h.section_subject_id)), h.class_id))))))))
  WITH CHECK (same_school(school_id));

CREATE TABLE public.homework_answers (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  school_id uuid NOT NULL,
  homework_id uuid NOT NULL,
  student_id uuid NOT NULL,
  question_id uuid NOT NULL,
  chapter_id uuid,
  topic_id uuid,
  answer text,
  is_correct boolean,
  time_taken_seconds integer,
  answered_at timestamp with time zone DEFAULT now() NOT NULL,
  graded_by uuid,
  graded_at timestamp with time zone,
  CONSTRAINT homework_answers_hw_student_question_key UNIQUE (homework_id, student_id, question_id),
  CONSTRAINT homework_answers_pkey PRIMARY KEY (id),
  CONSTRAINT homework_answers_time_nonneg CHECK (((time_taken_seconds IS NULL) OR (time_taken_seconds >= 0))),
  CONSTRAINT homework_answers_chapter_id_fkey FOREIGN KEY (chapter_id) REFERENCES public.chapters(id) ON DELETE SET NULL,
  CONSTRAINT homework_answers_graded_by_fkey FOREIGN KEY (graded_by) REFERENCES auth.users(id) ON DELETE SET NULL,
  CONSTRAINT homework_answers_homework_id_fkey FOREIGN KEY (homework_id) REFERENCES public.homework(id) ON DELETE CASCADE,
  CONSTRAINT homework_answers_question_id_fkey FOREIGN KEY (question_id) REFERENCES public.question_bank(id) ON DELETE RESTRICT,
  CONSTRAINT homework_answers_school_id_fkey FOREIGN KEY (school_id) REFERENCES public.schools(id) ON DELETE CASCADE,
  CONSTRAINT homework_answers_student_id_fkey FOREIGN KEY (student_id) REFERENCES public.students(id) ON DELETE CASCADE,
  CONSTRAINT homework_answers_topic_id_fkey FOREIGN KEY (topic_id) REFERENCES public.topics(id) ON DELETE SET NULL
);
CREATE INDEX homework_answers_hw_idx ON public.homework_answers USING btree (homework_id);
CREATE INDEX homework_answers_student_idx ON public.homework_answers USING btree (student_id);
CREATE INDEX homework_answers_chapter_idx ON public.homework_answers USING btree (chapter_id);
ALTER TABLE public.homework_answers ENABLE ROW LEVEL SECURITY;
CREATE POLICY homework_answers_parent_read ON public.homework_answers AS PERMISSIVE FOR SELECT TO authenticated
  USING (is_my_child(student_id));
CREATE POLICY homework_answers_staff ON public.homework_answers AS PERMISSIVE FOR ALL TO authenticated
  USING ((same_school(school_id) AND (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'principal'::app_role) OR (EXISTS ( SELECT 1
   FROM students s
  WHERE ((s.id = homework_answers.student_id) AND teacher_teaches_class(auth.uid(), s.class_id)))))))
  WITH CHECK ((same_school(school_id) AND (has_role(auth.uid(), 'admin'::app_role) OR (EXISTS ( SELECT 1
   FROM students s
  WHERE ((s.id = homework_answers.student_id) AND teacher_teaches_class(auth.uid(), s.class_id)))))));
CREATE POLICY homework_answers_student_own ON public.homework_answers AS PERMISSIVE FOR ALL TO authenticated
  USING (is_my_student_record(student_id))
  WITH CHECK (is_my_student_record(student_id));
CREATE POLICY homework_answers_tenant_fence ON public.homework_answers AS RESTRICTIVE FOR ALL TO anon, authenticated
  USING (school_id IS NULL OR school_id IN (SELECT public.my_accessible_school_ids()))
  WITH CHECK (school_id IS NULL OR school_id IN (SELECT public.my_accessible_school_ids()));
COMMENT ON COLUMN public.homework_answers.is_correct IS 'NULL = not graded yet (no answer key and the teacher has not acted). G4: not-recorded is NULL, never false.';
COMMENT ON COLUMN public.homework_answers.graded_by IS 'NULL when auto-graded from the answer key; set when a teacher grades or overrides.';

CREATE TABLE public.homework_completions (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  school_id uuid NOT NULL,
  homework_id uuid NOT NULL,
  student_id uuid NOT NULL,
  status public.homework_completion_status NOT NULL,
  marked_by uuid,
  marked_at timestamp with time zone DEFAULT now() NOT NULL,
  comment text,
  CONSTRAINT homework_completions_hw_student_key UNIQUE (homework_id, student_id),
  CONSTRAINT homework_completions_pkey PRIMARY KEY (id),
  CONSTRAINT homework_completions_homework_id_fkey FOREIGN KEY (homework_id) REFERENCES public.homework(id) ON DELETE CASCADE,
  CONSTRAINT homework_completions_marked_by_fkey FOREIGN KEY (marked_by) REFERENCES auth.users(id) ON DELETE SET NULL,
  CONSTRAINT homework_completions_school_id_fkey FOREIGN KEY (school_id) REFERENCES public.schools(id) ON DELETE CASCADE,
  CONSTRAINT homework_completions_student_id_fkey FOREIGN KEY (student_id) REFERENCES public.students(id) ON DELETE CASCADE
);
CREATE INDEX homework_completions_hw_idx ON public.homework_completions USING btree (homework_id);
CREATE INDEX homework_completions_student_idx ON public.homework_completions USING btree (student_id);
ALTER TABLE public.homework_completions ENABLE ROW LEVEL SECURITY;
CREATE POLICY homework_completions_parent_read ON public.homework_completions AS PERMISSIVE FOR SELECT TO authenticated
  USING (is_my_child(student_id));
CREATE POLICY homework_completions_staff ON public.homework_completions AS PERMISSIVE FOR ALL TO authenticated
  USING ((same_school(school_id) AND (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'principal'::app_role) OR (EXISTS ( SELECT 1
   FROM students s
  WHERE ((s.id = homework_completions.student_id) AND teacher_teaches_class(auth.uid(), s.class_id)))))))
  WITH CHECK ((same_school(school_id) AND (has_role(auth.uid(), 'admin'::app_role) OR (EXISTS ( SELECT 1
   FROM students s
  WHERE ((s.id = homework_completions.student_id) AND teacher_teaches_class(auth.uid(), s.class_id)))))));
CREATE POLICY homework_completions_student_own ON public.homework_completions AS PERMISSIVE FOR SELECT TO authenticated
  USING (is_my_student_record(student_id));
CREATE POLICY homework_completions_tenant_fence ON public.homework_completions AS RESTRICTIVE FOR ALL TO anon, authenticated
  USING (school_id IS NULL OR school_id IN (SELECT public.my_accessible_school_ids()))
  WITH CHECK (school_id IS NULL OR school_id IN (SELECT public.my_accessible_school_ids()));
COMMENT ON TABLE public.homework_completions IS 'The closure report. A row exists only once the homework has closed; its absence means not yet due. absent is derived by joining attendance on the due date and is reportable separately from not_completed.';

CREATE OR REPLACE FUNCTION public.tg_homework_compute_is_late()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF TG_OP = 'INSERT' OR NEW.status IN ('submitted', 'late') THEN
    NEW.submitted_at := now();

    SELECT (h.due_date + COALESCE(h.due_time, '23:59:59'::time)) AT TIME ZONE 'Asia/Kolkata' < NEW.submitted_at
    INTO NEW.is_late
    FROM public.homework h
    WHERE h.id = NEW.homework_id;

    NEW.status := CASE WHEN NEW.is_late THEN 'late' ELSE 'submitted' END;
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.tg_homework_submission_lock_at_due()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _closes timestamptz;
  _due date;
BEGIN
  SELECT h.closes_at, h.due_date INTO _closes, _due
    FROM public.homework h WHERE h.id = NEW.homework_id;

  IF _due IS NULL THEN
    RETURN NEW;
  END IF;

  _closes := COALESCE(_closes, (_due + 1)::timestamptz);

  IF COALESCE(NEW.submitted_at, now()) > _closes THEN
    RAISE EXCEPTION
      'Homework closed at % and cannot be submitted to. There is no late submission.', _closes;
  END IF;

  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.tg_homework_submission_student_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.students s
    WHERE s.user_id = auth.uid() AND s.id = NEW.student_id
  ) AND NOT (
    public.has_role(auth.uid(), 'admin'::public.app_role)
    OR public.has_role(auth.uid(), 'principal'::public.app_role)
    OR public.has_role(auth.uid(), 'teacher'::public.app_role)
  ) THEN
    IF TG_OP = 'UPDATE' THEN
      IF NEW.grade IS DISTINCT FROM OLD.grade
         OR NEW.teacher_remarks IS DISTINCT FROM OLD.teacher_remarks
         OR NEW.marks_obtained IS DISTINCT FROM OLD.marks_obtained
         OR NEW.graded_at IS DISTINCT FROM OLD.graded_at
         OR NEW.reviewed_at IS DISTINCT FROM OLD.reviewed_at
         OR NEW.returned_at IS DISTINCT FROM OLD.returned_at
         OR (
           NEW.status IS DISTINCT FROM OLD.status
           AND NEW.status IN ('graded', 'reviewed', 'completed', 'returned')
         ) THEN
        RAISE EXCEPTION 'Students cannot modify review or grade fields';
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.tg_homework_answer_autograde()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _key int;
BEGIN
  -- A teacher grading or overriding sets graded_by; never overwrite that.
  IF NEW.graded_by IS NOT NULL THEN
    NEW.graded_at := COALESCE(NEW.graded_at, now());
    RETURN NEW;
  END IF;

  SELECT qb.correct_index INTO _key
    FROM public.question_bank qb WHERE qb.id = NEW.question_id;

  IF _key IS NULL THEN
    -- No stored answer. Stays NULL -- not false -- until a teacher acts (G4).
    NEW.is_correct := NULL;
    NEW.graded_at  := NULL;
    RETURN NEW;
  END IF;

  IF NEW.answer IS NULL OR btrim(NEW.answer) = '' THEN
    NEW.is_correct := NULL;
    NEW.graded_at  := NULL;
    RETURN NEW;
  END IF;

  -- MCQ answers are stored as the selected option index.
  IF NEW.answer ~ '^[0-9]+$' THEN
    NEW.is_correct := (NEW.answer::int = _key);
    NEW.graded_at  := now();
  ELSE
    NEW.is_correct := NULL;
    NEW.graded_at  := NULL;
  END IF;

  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.tg_homework_answer_topic_matches_chapter()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _topic_chapter uuid;
BEGIN
  IF NEW.topic_id IS NULL THEN RETURN NEW; END IF;
  SELECT t.chapter_id INTO _topic_chapter FROM public.topics t WHERE t.id = NEW.topic_id;
  IF NEW.chapter_id IS NOT NULL AND _topic_chapter IS DISTINCT FROM NEW.chapter_id THEN
    RAISE EXCEPTION 'answer topic % belongs to chapter %, not %',
      NEW.topic_id, _topic_chapter, NEW.chapter_id;
  END IF;
  -- Derive the chapter from the topic when only the topic was supplied.
  IF NEW.chapter_id IS NULL THEN NEW.chapter_id := _topic_chapter; END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.rpc_close_homework(_homework_id uuid, _early boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _hw record;
  _section uuid;
  _n int;
BEGIN
  SELECT h.*, COALESCE(ss.section_id, h.class_id) AS resolved_section
    INTO _hw
    FROM public.homework h
    LEFT JOIN public.section_subjects ss ON ss.id = h.section_subject_id
   WHERE h.id = _homework_id;

  IF NOT FOUND THEN RAISE EXCEPTION 'Homework % does not exist', _homework_id; END IF;
  IF NOT public.same_school(_hw.school_id) THEN
    RAISE EXCEPTION 'Homework % is outside the current institution', _homework_id;
  END IF;
  IF _hw.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'Homework % is deleted', _homework_id;
  END IF;

  _section := _hw.resolved_section;
  IF _section IS NULL THEN
    RAISE EXCEPTION 'Homework % has no section to report on', _homework_id;
  END IF;

  -- Closed is final. The report existing IS the closed state.
  IF EXISTS (SELECT 1 FROM public.homework_completions WHERE homework_id = _homework_id) THEN
    RAISE EXCEPTION 'Homework % is already closed. Closed is final; there is no reopening.', _homework_id;
  END IF;

  IF _early THEN
    IF NOT (public.has_role(auth.uid(), 'admin'::public.app_role)
            OR public.teacher_teaches_class(auth.uid(), _section)) THEN
      RAISE EXCEPTION 'Only a teacher of this section or an admin may close homework early';
    END IF;
    UPDATE public.homework SET closes_at = now() WHERE id = _homework_id;
  ELSIF COALESCE(_hw.closes_at, (_hw.due_date + 1)::timestamptz) > now() THEN
    RAISE EXCEPTION 'Homework % is not due yet. Pass _early to close it early.', _homework_id;
  END IF;

  -- Every student of the section gets exactly one row.
  --   completed     -- submitted before it closed
  --   absent        -- attendance on the due date says so; reportable separately
  --   not_completed -- everything else
  INSERT INTO public.homework_completions (school_id, homework_id, student_id, status, marked_by)
  SELECT _hw.school_id, _homework_id, s.id,
         CASE
           WHEN EXISTS (SELECT 1 FROM public.homework_submissions hs
                         WHERE hs.homework_id = _homework_id AND hs.student_id = s.id)
             THEN 'completed'::public.homework_completion_status
           WHEN EXISTS (SELECT 1
                          FROM public.attendance a
                          JOIN public.attendance_submissions asub ON asub.id = a.submission_id
                         WHERE a.student_id = s.id
                           AND asub.date = _hw.due_date
                           AND a.status = 'absent')
             THEN 'absent'::public.homework_completion_status
           ELSE 'not_completed'::public.homework_completion_status
         END,
         auth.uid()
    FROM public.students s
   WHERE s.class_id = _section
     AND s.school_id = _hw.school_id
     AND s.deleted_at IS NULL
  ON CONFLICT (homework_id, student_id) DO NOTHING;

  GET DIAGNOSTICS _n = ROW_COUNT;
  RETURN jsonb_build_object('homework_id', _homework_id, 'completions_written', _n);
END;
$function$;
GRANT EXECUTE ON FUNCTION public.rpc_close_homework(uuid, boolean) TO authenticated;

CREATE TRIGGER trg_homework_submission_lock BEFORE INSERT OR UPDATE OF submitted_at, homework_id ON public.homework_submissions FOR EACH ROW EXECUTE FUNCTION public.tg_homework_submission_lock_at_due();
CREATE TRIGGER trg_homework_submission_student_guard BEFORE UPDATE ON public.homework_submissions FOR EACH ROW EXECUTE FUNCTION public.tg_homework_submission_student_guard();
CREATE TRIGGER trg_homework_answer_autograde BEFORE INSERT OR UPDATE OF answer, question_id, graded_by ON public.homework_answers FOR EACH ROW EXECUTE FUNCTION public.tg_homework_answer_autograde();
CREATE TRIGGER trg_homework_answer_topic_matches_chapter BEFORE INSERT OR UPDATE OF topic_id, chapter_id ON public.homework_answers FOR EACH ROW EXECUTE FUNCTION public.tg_homework_answer_topic_matches_chapter();

-- ── 5. The emitters as they were ──────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.tg_emit_homework_event()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _etype text;
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM public.emit_academic_event(
      'homework.deleted',
      'homework',
      OLD.id,
      OLD.school_id,
      NULL,
      OLD.class_id,
      NULL,
      jsonb_build_object(
        'title', OLD.title,
        'subject', OLD.subject,
        'status', OLD.status,
        'work_kind', OLD.work_kind,
        'created_by', OLD.created_by
      )
    );
    PERFORM public.write_academic_audit(
      'homework', OLD.id, 'delete', to_jsonb(OLD), NULL, OLD.school_id
    );
    RETURN OLD;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.status IN ('published', 'active') THEN
      _etype := 'homework.published';
    ELSIF NEW.status = 'scheduled' THEN
      _etype := 'homework.scheduled';
    ELSE
      _etype := 'homework.created';
    END IF;
  ELSIF TG_OP = 'UPDATE'
    AND NEW.status IS DISTINCT FROM OLD.status
    AND NEW.status IN ('published', 'active') THEN
    _etype := 'homework.published';
  ELSIF TG_OP = 'UPDATE'
    AND NEW.status IS DISTINCT FROM OLD.status
    AND NEW.status = 'scheduled' THEN
    _etype := 'homework.scheduled';
  ELSIF TG_OP = 'UPDATE'
    AND NEW.status IS DISTINCT FROM OLD.status
    AND OLD.status IN ('published', 'active')
    AND NEW.status = 'draft' THEN
    _etype := 'homework.unpublished';
  ELSIF TG_OP = 'UPDATE'
    AND NEW.status IS DISTINCT FROM OLD.status
    AND NEW.status = 'archived' THEN
    _etype := 'homework.archived';
  ELSE
    _etype := 'homework.updated';
  END IF;

  PERFORM public.emit_academic_event(
    _etype,
    'homework',
    NEW.id,
    NEW.school_id,
    NULL,
    NEW.class_id,
    NULL,
    jsonb_build_object(
      'title', NEW.title,
      'subject', NEW.subject,
      'status', NEW.status,
      'work_kind', NEW.work_kind,
      'subject_id', NEW.subject_id,
      'due_date', NEW.due_date,
      'created_by', NEW.created_by,
      'priority', NEW.priority,
      'scheduled_publish_at', NEW.scheduled_publish_at
    )
  );

  PERFORM public.write_academic_audit(
    'homework', NEW.id,
    lower(TG_OP),
    CASE WHEN TG_OP = 'UPDATE' THEN to_jsonb(OLD) ELSE NULL END,
    to_jsonb(NEW),
    NEW.school_id
  );
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.tg_emit_homework_submission_event()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _etype text;
  _row public.homework_submissions%ROWTYPE;
  _hw record;
BEGIN
  _row := CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  SELECT * INTO _hw FROM public.homework WHERE id = _row.homework_id;

  IF TG_OP = 'DELETE' THEN
    _etype := 'homework.submission.deleted';
  ELSIF TG_OP = 'INSERT' AND NEW.status IN ('submitted', 'late') THEN
    _etype := 'homework.submitted';
  ELSIF TG_OP = 'UPDATE'
    AND NEW.status IN ('submitted', 'late')
    AND coalesce(OLD.version, 1) < coalesce(NEW.version, 1)
    AND OLD.status IN ('submitted', 'late', 'returned') THEN
    _etype := 'homework.resubmitted';
  ELSIF TG_OP = 'UPDATE'
    AND NEW.status IN ('submitted', 'late')
    AND OLD.status IS DISTINCT FROM NEW.status THEN
    _etype := 'homework.submitted';
  ELSIF TG_OP = 'UPDATE'
    AND NEW.status = 'returned'
    AND OLD.status IS DISTINCT FROM NEW.status THEN
    _etype := 'homework.returned';
  ELSIF TG_OP = 'UPDATE'
    AND NEW.status IN ('graded', 'completed')
    AND OLD.status IS DISTINCT FROM NEW.status THEN
    _etype := 'homework.graded';
  ELSIF TG_OP = 'UPDATE'
    AND NEW.status = 'reviewed'
    AND OLD.status IS DISTINCT FROM NEW.status THEN
    _etype := 'homework.reviewed';
  ELSE
    _etype := 'homework.updated';
  END IF;

  PERFORM public.emit_academic_event(
    _etype,
    'homework_submission',
    _row.id,
    coalesce(_row.school_id, _hw.school_id),
    _row.student_id,
    _hw.class_id,
    NULL,
    jsonb_build_object(
      'homework_id', _row.homework_id,
      'status', _row.status,
      'is_late', _row.is_late,
      'grade', _row.grade,
      'version', _row.version,
      'title', _hw.title
    )
  );

  PERFORM public.write_academic_audit(
    'homework_submission', _row.id,
    lower(TG_OP),
    CASE WHEN TG_OP IN ('UPDATE', 'DELETE') THEN to_jsonb(OLD) ELSE NULL END,
    CASE WHEN TG_OP = 'DELETE' THEN NULL ELSE to_jsonb(NEW) END,
    coalesce(_row.school_id, _hw.school_id)
  );
  RETURN _row;
END;
$function$;

ALTER TABLE public.homework ENABLE TRIGGER trg_emit_homework_event;
ALTER TABLE public.homework ENABLE TRIGGER homework_set_updated;
ALTER TABLE public.homework_submissions ENABLE TRIGGER trg_emit_homework_submission_event;
ALTER TABLE public.homework_submissions ENABLE TRIGGER hw_sub_set_updated;

-- ── 6. Policies and grants as they were ───────────────────────────────────

DROP POLICY "hw_sub student read own" ON public.homework_submissions;
DROP POLICY "hw_sub teacher read" ON public.homework_submissions;
DROP POLICY "hw_sub admin read" ON public.homework_submissions;
DROP POLICY "hw_sub principal read" ON public.homework_submissions;
CREATE POLICY "hw_sub admin all" ON public.homework_submissions AS PERMISSIVE FOR ALL TO PUBLIC
  USING ((has_role(auth.uid(), 'admin'::app_role) AND same_school(school_id)))
  WITH CHECK ((has_role(auth.uid(), 'admin'::app_role) AND same_school(school_id)));
CREATE POLICY "hw_sub principal read" ON public.homework_submissions AS PERMISSIVE FOR SELECT TO PUBLIC
  USING ((has_role(auth.uid(), 'principal'::app_role) AND same_school(school_id)));
CREATE POLICY "hw_sub student own" ON public.homework_submissions AS PERMISSIVE FOR ALL TO authenticated
  USING (is_my_student_record(student_id))
  WITH CHECK (is_my_student_record(student_id));
CREATE POLICY "hw_sub teacher manage" ON public.homework_submissions AS PERMISSIVE FOR ALL TO authenticated
  USING (can_manage_homework(homework_id))
  WITH CHECK (can_manage_homework(homework_id));

GRANT ALL ON public.homework, public.homework_submissions TO anon, authenticated;

-- ── 7. Proof, then the snapshots go ───────────────────────────────────────

DO $verify$
DECLARE _hw int; _sub int;
BEGIN
  SELECT count(*) INTO _hw
    FROM rollback_untouched_homework u
    JOIN public.homework h ON h.id = u.id
    JOIN public.homework_pre_20260925110000 p ON p.id = u.id
   WHERE to_jsonb(h) IS DISTINCT FROM to_jsonb(p);
  SELECT count(*) INTO _sub
    FROM rollback_untouched_submissions u
    JOIN public.homework_submissions hs ON hs.id = u.id
    JOIN public.homework_submissions_pre_20260925110000 p ON p.id = u.id
   WHERE to_jsonb(hs) IS DISTINCT FROM to_jsonb(p);
  IF _hw + _sub > 0 THEN
    RAISE EXCEPTION 'ROLLED BACK: % homework and % submission row(s) nobody touched did not come back exactly as the snapshot holds them', _hw, _sub;
  END IF;
  RAISE NOTICE 'rollback verify OK: % untouched homework and % untouched submissions restored exactly',
    (SELECT count(*) FROM rollback_untouched_homework), (SELECT count(*) FROM rollback_untouched_submissions);
END
$verify$;

DROP TABLE rollback_untouched_homework;
DROP TABLE rollback_untouched_submissions;
DROP TABLE public.homework_pre_20260925110000;
DROP TABLE public.homework_submissions_pre_20260925110000;
