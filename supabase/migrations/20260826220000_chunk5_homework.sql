-- =====================================================================
-- CHUNK 5 — HOMEWORK
--
-- Builds on the Chunk 2 identity (section_subject_id) and the Chunk 4 pattern
-- that the ABSENCE of a record is itself a state, never a zero.
--
-- ---------------------------------------------------------------------
-- DECISIONS AND DOC CONTRADICTIONS, flagged rather than silently followed
--
-- 1. `topics` IS created, seeded EMPTY. Chunk 2 removed the topics table
--    because a taxonomy could not be derived from question_bank's 11,917
--    free-text strings. §10.22 asks for something different: teachers pick a
--    topic from the chapter's existing list or add one when nothing fits,
--    "building a real taxonomy from the people who teach the subject — with no
--    curation project." Those are compatible: refusing to derive a tree from
--    legacy strings is not refusing to let one grow. Approved this session.
--    The legacy question_bank.topic string stays an unmapped label.
--
--    Topics are GLOBAL, hanging off chapters, which are global (G2). A topic
--    added by one school's teacher is visible to another's — consistent with
--    the question bank being centralised and shared (10.9). Flagged because it
--    is a real consequence, not an oversight.
--
-- 2. `homework.chapter_id` IS added, though Chunk 5's column list omits it.
--    §10.22: "When a teacher creates homework or a test, they pick the chapter
--    from a list." Homework cannot roll up to chapter without it. Nullable,
--    because §10.22 also allows a free-text label where no chapter fits — which
--    is what the doc's `topic (free text)` column is for.
--
-- 3. `not_yet_due` is NOT a stored status. The doc lists four values for
--    homework_completions.status, but not_yet_due is purely a function of
--    due_date vs now, and G5 forbids storing a derived value. It is the state
--    when NO completions row exists yet — exactly as Chunk 4 made the absence
--    of an attendance submission mean "not marked" rather than 0%. Three
--    values are stored: completed, not_completed, absent. The metric layer
--    reports not_yet_due; nothing writes it.
--
-- 4. Late submission — see docs/decisions.md D1. The lock is enforced at write
--    time, the is_late trigger stops firing, and the 9 rows already marked late
--    are left alone as a true record of what happened under the old rule.
--
-- 5. `homework_questions` and `homework_answers` carry school_id, which the
--    doc's column lists omit. G1 requires it on every institution-scoped table,
--    and without it they cannot take the restrictive tenant fence.
--
-- Reverse: supabase/migrations/rollback/20260826220000_chunk5_down.sql
-- =====================================================================


-- ---------------------------------------------------------------------
-- SECTION 1 — enumerated types
-- ---------------------------------------------------------------------

DO $$ BEGIN
  CREATE TYPE public.homework_submission_mode AS ENUM ('none', 'digital', 'upload');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  -- not_yet_due is deliberately absent: see note 3 in the header.
  CREATE TYPE public.homework_completion_status AS ENUM ('completed', 'not_completed', 'absent');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;


-- ---------------------------------------------------------------------
-- SECTION 2 — topics, grown by teachers
-- ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.topics (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  chapter_id uuid NOT NULL REFERENCES public.chapters(id) ON DELETE CASCADE,
  name       text NOT NULL,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT topics_chapter_name_key UNIQUE (chapter_id, name),
  CONSTRAINT topics_name_not_blank CHECK (btrim(name) <> '')
);

CREATE INDEX IF NOT EXISTS topics_chapter_idx ON public.topics (chapter_id);

COMMENT ON TABLE public.topics IS
  'Grown by teachers picking-or-adding per locked decision 10.22, never seeded from the legacy free-text bank labels. Chunk 2 refused to DERIVE a taxonomy from 11,917 strings; this lets one accumulate from the people who teach the subject.';


-- ---------------------------------------------------------------------
-- SECTION 3 — homework gains what the chunk requires
-- ---------------------------------------------------------------------

ALTER TABLE public.homework
  ADD COLUMN IF NOT EXISTS academic_year_id uuid REFERENCES public.academic_years(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS chapter_id       uuid REFERENCES public.chapters(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS topic            text,
  ADD COLUMN IF NOT EXISTS assigned_date    date,
  ADD COLUMN IF NOT EXISTS submission_mode  public.homework_submission_mode NOT NULL DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS closes_at        timestamptz,
  ADD COLUMN IF NOT EXISTS deleted_at       timestamptz,
  ADD COLUMN IF NOT EXISTS deleted_by       uuid REFERENCES auth.users(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.homework.topic IS
  'Free-text label for the case where no chapter fits (locked decision 10.22). Per-question topics are structured, on homework_answers.topic_id.';
COMMENT ON COLUMN public.homework.closes_at IS
  'When this homework closes and its report is generated. Defaults to the end of due_date; a teacher may set it earlier. Closed is derived from closes_at <= now(), never stored separately.';

UPDATE public.homework SET assigned_date = created_at::date WHERE assigned_date IS NULL;

UPDATE public.homework
   SET academic_year_id = (SELECT ay.id FROM public.academic_years ay
                            WHERE ay.school_id = homework.school_id AND ay.is_current LIMIT 1)
 WHERE academic_year_id IS NULL;

-- closes_at defaults to the end of the due date: "submission locks at due_date".
UPDATE public.homework
   SET closes_at = (due_date + 1)::timestamptz
 WHERE closes_at IS NULL AND due_date IS NOT NULL;

-- due_date is mandatory: without it the completion rate cannot be computed.
-- Verified before setting: zero existing rows have a NULL due_date.
ALTER TABLE public.homework ALTER COLUMN due_date SET NOT NULL;

-- Continue the Chunk 2 backfill of the section_subject anchor now that more
-- section_subjects exist.
UPDATE public.homework h
   SET section_subject_id = ss.id
  FROM public.classes c
  JOIN public.class_groups g ON g.id = c.class_group_id
  JOIN public.curriculum_subjects cs ON cs.curriculum_class_id = g.curriculum_class_id
  JOIN public.section_subjects ss ON ss.section_id = c.id AND ss.curriculum_subject_id = cs.id
 WHERE h.section_subject_id IS NULL
   AND c.id = h.class_id
   AND cs.name = btrim(h.subject);

CREATE INDEX IF NOT EXISTS homework_due_date_idx ON public.homework (school_id, due_date);
CREATE INDEX IF NOT EXISTS homework_not_deleted_idx ON public.homework (school_id) WHERE deleted_at IS NULL;


-- ---------------------------------------------------------------------
-- SECTION 4 — homework_questions (digital mode)
-- ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.homework_questions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id   uuid NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  homework_id uuid NOT NULL REFERENCES public.homework(id) ON DELETE CASCADE,
  question_id uuid NOT NULL REFERENCES public.question_bank(id) ON DELETE RESTRICT,
  sequence    int  NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT homework_questions_hw_question_key UNIQUE (homework_id, question_id),
  CONSTRAINT homework_questions_hw_sequence_key UNIQUE (homework_id, sequence),
  CONSTRAINT homework_questions_sequence_positive CHECK (sequence > 0)
);

CREATE INDEX IF NOT EXISTS homework_questions_hw_idx ON public.homework_questions (homework_id);


-- ---------------------------------------------------------------------
-- SECTION 5 — homework_answers (digital MCQ only)
--
-- "School data, not practice. Visible to teacher, principal, the student, and
-- the parent for their own child. Never stored in a practice table." That is
-- why this is its own table and not question_attempts, which Chunk 1.6 made
-- student-private.
-- ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.homework_answers (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id          uuid NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  homework_id        uuid NOT NULL REFERENCES public.homework(id) ON DELETE CASCADE,
  student_id         uuid NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
  question_id        uuid NOT NULL REFERENCES public.question_bank(id) ON DELETE RESTRICT,
  chapter_id         uuid REFERENCES public.chapters(id) ON DELETE SET NULL,
  topic_id           uuid REFERENCES public.topics(id) ON DELETE SET NULL,
  answer             text,
  -- G4: NULL means not graded yet. It is never false-by-default, because
  -- "wrong" and "nobody has marked this" are different facts.
  is_correct         boolean,
  time_taken_seconds int,
  answered_at        timestamptz NOT NULL DEFAULT now(),
  graded_by          uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  graded_at          timestamptz,
  CONSTRAINT homework_answers_hw_student_question_key UNIQUE (homework_id, student_id, question_id),
  CONSTRAINT homework_answers_time_nonneg CHECK (time_taken_seconds IS NULL OR time_taken_seconds >= 0)
);

COMMENT ON COLUMN public.homework_answers.is_correct IS
  'NULL = not graded yet (no answer key and the teacher has not acted). G4: not-recorded is NULL, never false.';
COMMENT ON COLUMN public.homework_answers.graded_by IS
  'NULL when auto-graded from the answer key; set when a teacher grades or overrides.';

CREATE INDEX IF NOT EXISTS homework_answers_hw_idx      ON public.homework_answers (homework_id);
CREATE INDEX IF NOT EXISTS homework_answers_student_idx ON public.homework_answers (student_id);
CREATE INDEX IF NOT EXISTS homework_answers_chapter_idx ON public.homework_answers (chapter_id);


-- ---------------------------------------------------------------------
-- SECTION 6 — homework_completions
--
-- Written at closure. Before closure there are no rows, and that absence IS
-- "not yet due" — the Chunk 4 pattern.
-- ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.homework_completions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id   uuid NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  homework_id uuid NOT NULL REFERENCES public.homework(id) ON DELETE CASCADE,
  student_id  uuid NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
  status      public.homework_completion_status NOT NULL,
  marked_by   uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  marked_at   timestamptz NOT NULL DEFAULT now(),
  comment     text,
  CONSTRAINT homework_completions_hw_student_key UNIQUE (homework_id, student_id)
);

CREATE INDEX IF NOT EXISTS homework_completions_hw_idx      ON public.homework_completions (homework_id);
CREATE INDEX IF NOT EXISTS homework_completions_student_idx ON public.homework_completions (student_id);

COMMENT ON TABLE public.homework_completions IS
  'The closure report. A row exists only once the homework has closed; its absence means not yet due. absent is derived by joining attendance on the due date and is reportable separately from not_completed.';


-- ---------------------------------------------------------------------
-- SECTION 7 — submission locks at the due date (docs/decisions.md D1)
--
-- The rule wins going forward; the mechanism that contradicted it stops; the
-- history stays. The 9 rows already marked late are a true record of what
-- happened under the previous rule and are not rewritten -- the same treatment
-- the legacy marks zeros were given.
-- ---------------------------------------------------------------------

DROP TRIGGER IF EXISTS trg_homework_is_late ON public.homework_submissions;

COMMENT ON COLUMN public.homework_submissions.is_late IS
  'Frozen historical field. Submission now locks at the due date, so this can never again become true. The 9 rows already marked late predate that rule (docs/decisions.md D1); they are kept, not rewritten.';

CREATE OR REPLACE FUNCTION public.tg_homework_submission_lock_at_due()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
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
$$;

DROP TRIGGER IF EXISTS trg_homework_submission_lock ON public.homework_submissions;
CREATE TRIGGER trg_homework_submission_lock
  BEFORE INSERT OR UPDATE OF submitted_at, homework_id ON public.homework_submissions
  FOR EACH ROW EXECUTE FUNCTION public.tg_homework_submission_lock_at_due();

REVOKE EXECUTE ON FUNCTION public.tg_homework_submission_lock_at_due() FROM public, anon, authenticated;


-- ---------------------------------------------------------------------
-- SECTION 8 — auto-grading
--
-- "If a stored correct answer exists, grade automatically. Otherwise the
-- teacher grades manually. One field decides it." That field is
-- question_bank.correct_index.
--
-- graded_by distinguishes the two: NULL means the key graded it, a uuid means
-- a person did -- which is also how an override is recorded.
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.tg_homework_answer_autograde()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
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
$$;

DROP TRIGGER IF EXISTS trg_homework_answer_autograde ON public.homework_answers;
CREATE TRIGGER trg_homework_answer_autograde
  BEFORE INSERT OR UPDATE OF answer, question_id, graded_by ON public.homework_answers
  FOR EACH ROW EXECUTE FUNCTION public.tg_homework_answer_autograde();

REVOKE EXECUTE ON FUNCTION public.tg_homework_answer_autograde() FROM public, anon, authenticated;


-- ---------------------------------------------------------------------
-- SECTION 9 — closing generates the report
--
-- "Closes automatically at the due date, or the teacher closes it early.
-- Whichever happens, closing generates the report. Closed is final. No
-- reopening."
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.rpc_close_homework(_homework_id uuid, _early boolean DEFAULT false)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
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
$$;

REVOKE EXECUTE ON FUNCTION public.rpc_close_homework(uuid, boolean) FROM public, anon;
GRANT  EXECUTE ON FUNCTION public.rpc_close_homework(uuid, boolean) TO authenticated;


-- ---------------------------------------------------------------------
-- SECTION 10 — soft delete, 7 days (G6)
--
-- "Excluded from every query by default via the RLS policy or a view -- not by
-- application filtering." A RESTRICTIVE policy is that exclusion: it ANDs with
-- every existing permissive policy on homework, so no present or future policy
-- can surface a deleted row to anyone but the admin who may restore it.
-- ---------------------------------------------------------------------

DROP POLICY IF EXISTS homework_soft_delete_fence ON public.homework;
CREATE POLICY homework_soft_delete_fence ON public.homework
  AS RESTRICTIVE FOR SELECT TO authenticated, anon
  USING (deleted_at IS NULL OR public.has_role(auth.uid(), 'admin'::public.app_role));

CREATE OR REPLACE FUNCTION public.rpc_purge_deleted_homework()
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE _n int;
BEGIN
  -- G6: Homework is retained 7 days, restorable by admin, then permanent.
  WITH gone AS (
    DELETE FROM public.homework
     WHERE deleted_at IS NOT NULL
       AND deleted_at < now() - interval '7 days'
    RETURNING 1
  )
  SELECT count(*) INTO _n FROM gone;
  RETURN _n;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.rpc_purge_deleted_homework() FROM public, anon, authenticated;


-- ---------------------------------------------------------------------
-- SECTION 11 — RLS
--
-- homework_answers is SCHOOL data, not practice (Chunk 5): teacher, principal,
-- the student, and the parent of that child. Chunk 1.6 made practice tables
-- student-only; this is deliberately not one of them.
-- ---------------------------------------------------------------------

ALTER TABLE public.topics               ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.homework_questions   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.homework_answers     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.homework_completions ENABLE ROW LEVEL SECURITY;

-- topics: global like the curriculum it hangs off. Read by any signed-in user;
-- added by teachers and admins, never deleted from the panel (a topic in use
-- would orphan the answers referencing it).
DROP POLICY IF EXISTS topics_read ON public.topics;
CREATE POLICY topics_read ON public.topics
  FOR SELECT TO authenticated USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS topics_insert_staff ON public.topics;
CREATE POLICY topics_insert_staff ON public.topics
  FOR INSERT TO authenticated
  WITH CHECK (
    public.has_role(auth.uid(), 'teacher'::public.app_role)
    OR public.has_role(auth.uid(), 'admin'::public.app_role)
    OR public.is_super_admin()
  );

DROP POLICY IF EXISTS topics_write_super ON public.topics;
CREATE POLICY topics_write_super ON public.topics
  FOR ALL TO authenticated
  USING (public.is_super_admin()) WITH CHECK (public.is_super_admin());

-- The three institution-scoped tables take the standard restrictive fence.
DROP POLICY IF EXISTS homework_questions_tenant_fence ON public.homework_questions;
CREATE POLICY homework_questions_tenant_fence ON public.homework_questions
  AS RESTRICTIVE FOR ALL TO authenticated, anon
  USING (school_id IS NULL OR public.same_school(school_id))
  WITH CHECK (school_id IS NULL OR public.same_school(school_id));

DROP POLICY IF EXISTS homework_answers_tenant_fence ON public.homework_answers;
CREATE POLICY homework_answers_tenant_fence ON public.homework_answers
  AS RESTRICTIVE FOR ALL TO authenticated, anon
  USING (school_id IS NULL OR public.same_school(school_id))
  WITH CHECK (school_id IS NULL OR public.same_school(school_id));

DROP POLICY IF EXISTS homework_completions_tenant_fence ON public.homework_completions;
CREATE POLICY homework_completions_tenant_fence ON public.homework_completions
  AS RESTRICTIVE FOR ALL TO authenticated, anon
  USING (school_id IS NULL OR public.same_school(school_id))
  WITH CHECK (school_id IS NULL OR public.same_school(school_id));

-- homework_questions: anyone in the institution who can see the homework.
DROP POLICY IF EXISTS homework_questions_read ON public.homework_questions;
CREATE POLICY homework_questions_read ON public.homework_questions
  FOR SELECT TO authenticated USING (public.same_school(school_id));

DROP POLICY IF EXISTS homework_questions_write_staff ON public.homework_questions;
CREATE POLICY homework_questions_write_staff ON public.homework_questions
  FOR ALL TO authenticated
  USING (
    public.same_school(school_id)
    AND (public.has_role(auth.uid(), 'admin'::public.app_role)
      OR EXISTS (SELECT 1 FROM public.homework h
                  WHERE h.id = homework_questions.homework_id
                    AND public.teacher_teaches_class(auth.uid(),
                          COALESCE((SELECT ss.section_id FROM public.section_subjects ss
                                     WHERE ss.id = h.section_subject_id), h.class_id))))
  )
  WITH CHECK (public.same_school(school_id));

-- homework_answers: the student's own, their parent's, and the staff who teach them.
DROP POLICY IF EXISTS homework_answers_student_own ON public.homework_answers;
CREATE POLICY homework_answers_student_own ON public.homework_answers
  FOR ALL TO authenticated
  USING (
    public.active_membership_role() = 'student'
    AND student_id = public.active_local_person_id()
  )
  WITH CHECK (
    public.active_membership_role() = 'student'
    AND student_id = public.active_local_person_id()
  );

DROP POLICY IF EXISTS homework_answers_parent_read ON public.homework_answers;
CREATE POLICY homework_answers_parent_read ON public.homework_answers
  FOR SELECT TO authenticated
  USING (
    public.active_membership_role() = 'parent'
    AND EXISTS (
      SELECT 1 FROM public.parent_students ps
       WHERE ps.student_id = homework_answers.student_id
         AND ps.parent_id = public.active_local_person_id()
    )
  );

DROP POLICY IF EXISTS homework_answers_staff ON public.homework_answers;
CREATE POLICY homework_answers_staff ON public.homework_answers
  FOR ALL TO authenticated
  USING (
    public.same_school(school_id)
    AND (public.has_role(auth.uid(), 'admin'::public.app_role)
      OR public.has_role(auth.uid(), 'principal'::public.app_role)
      OR EXISTS (SELECT 1 FROM public.students s
                  WHERE s.id = homework_answers.student_id
                    AND public.teacher_teaches_class(auth.uid(), s.class_id)))
  )
  WITH CHECK (
    public.same_school(school_id)
    AND (public.has_role(auth.uid(), 'admin'::public.app_role)
      OR EXISTS (SELECT 1 FROM public.students s
                  WHERE s.id = homework_answers.student_id
                    AND public.teacher_teaches_class(auth.uid(), s.class_id)))
  );

-- homework_completions: same audience.
DROP POLICY IF EXISTS homework_completions_student_own ON public.homework_completions;
CREATE POLICY homework_completions_student_own ON public.homework_completions
  FOR SELECT TO authenticated
  USING (
    public.active_membership_role() = 'student'
    AND student_id = public.active_local_person_id()
  );

DROP POLICY IF EXISTS homework_completions_parent_read ON public.homework_completions;
CREATE POLICY homework_completions_parent_read ON public.homework_completions
  FOR SELECT TO authenticated
  USING (
    public.active_membership_role() = 'parent'
    AND EXISTS (
      SELECT 1 FROM public.parent_students ps
       WHERE ps.student_id = homework_completions.student_id
         AND ps.parent_id = public.active_local_person_id()
    )
  );

DROP POLICY IF EXISTS homework_completions_staff ON public.homework_completions;
CREATE POLICY homework_completions_staff ON public.homework_completions
  FOR ALL TO authenticated
  USING (
    public.same_school(school_id)
    AND (public.has_role(auth.uid(), 'admin'::public.app_role)
      OR public.has_role(auth.uid(), 'principal'::public.app_role)
      OR EXISTS (SELECT 1 FROM public.students s
                  WHERE s.id = homework_completions.student_id
                    AND public.teacher_teaches_class(auth.uid(), s.class_id)))
  )
  WITH CHECK (
    public.same_school(school_id)
    AND (public.has_role(auth.uid(), 'admin'::public.app_role)
      OR EXISTS (SELECT 1 FROM public.students s
                  WHERE s.id = homework_completions.student_id
                    AND public.teacher_teaches_class(auth.uid(), s.class_id)))
  );


-- ---------------------------------------------------------------------
-- SECTION 12 — assertions
-- ---------------------------------------------------------------------

DO $$
DECLARE _n int; _d text;
BEGIN
  -- due_date is mandatory.
  IF (SELECT is_nullable FROM information_schema.columns
       WHERE table_schema='public' AND table_name='homework' AND column_name='due_date') <> 'NO' THEN
    RAISE EXCEPTION 'Chunk 5: homework.due_date is still nullable';
  END IF;

  -- not_yet_due must not be storable (note 3 in the header).
  IF EXISTS (SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
              WHERE t.typname = 'homework_completion_status' AND e.enumlabel = 'not_yet_due') THEN
    RAISE EXCEPTION 'Chunk 5: not_yet_due is a stored status; it is derived from due_date and must not be';
  END IF;

  -- The is_late mechanism has stopped, and the history is intact (D1).
  IF EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_homework_is_late' AND NOT tgisinternal) THEN
    RAISE EXCEPTION 'Chunk 5: the is_late trigger still fires';
  END IF;
  SELECT count(*) INTO _n FROM public.homework_submissions WHERE is_late;
  IF _n <> 9 THEN
    RAISE EXCEPTION 'Chunk 5: expected the 9 historical late rows to be untouched, found %', _n;
  END IF;

  -- Every new institution-scoped table carries the fence.
  SELECT count(*), string_agg(t.tbl, ', ') INTO _n, _d
    FROM (VALUES ('homework_questions'),('homework_answers'),('homework_completions')) AS t(tbl)
   WHERE NOT EXISTS (
     SELECT 1 FROM pg_policies p
      WHERE p.schemaname='public' AND p.tablename=t.tbl
        AND p.permissive='RESTRICTIVE' AND p.policyname = t.tbl || '_tenant_fence');
  IF _n > 0 THEN RAISE EXCEPTION 'Chunk 5: tenant fence missing on %', _d; END IF;

  -- RLS on everything new.
  SELECT count(*), string_agg(c.relname, ', ') INTO _n, _d
    FROM pg_class c JOIN pg_namespace ns ON ns.oid = c.relnamespace
   WHERE ns.nspname='public' AND c.relkind='r'
     AND c.relname IN ('topics','homework_questions','homework_answers','homework_completions')
     AND NOT c.relrowsecurity;
  IF _n > 0 THEN RAISE EXCEPTION 'Chunk 5: RLS not enabled on %', _d; END IF;

  -- topics starts empty: it grows from teachers, never from the legacy bank.
  SELECT count(*) INTO _n FROM public.topics;
  IF _n > 0 THEN
    RAISE EXCEPTION 'Chunk 5: topics was seeded with % row(s); it must start empty', _n;
  END IF;

  -- The soft-delete fence is restrictive, so no permissive policy can leak a
  -- deleted row.
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='homework'
      AND policyname='homework_soft_delete_fence' AND permissive='RESTRICTIVE') THEN
    RAISE EXCEPTION 'Chunk 5: the homework soft-delete fence is missing or not restrictive';
  END IF;
END $$;
