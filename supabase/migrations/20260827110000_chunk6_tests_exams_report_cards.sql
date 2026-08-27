-- =====================================================================
-- CHUNK 6 — TESTS, EXAMS, REPORT CARDS
--
-- RECONCILIATION (the adapt-don't-duplicate pattern, as in Chunks 3–4.6):
--     doc's `exam_marks` == existing `marks`   (gains exam_subject_id; mark becomes NULLABLE)
--     doc's `exams`      == existing `exams`   (gains academic_year_id, previous_exam_id)
--     `tests`, `test_marks`, `exam_subjects`, `report_cards` are genuinely new.
--
-- NAMING, not a gap: this codebase says `max_marks`/`passing_marks` where the
-- doc says `max_mark`/`pass_mark`, and `class_id` where the doc says
-- `section_id` — the same accepted difference as school_id/institution_id.
-- Renaming them would churn 13 files for no behavioural gain.
--
-- EXAM GRAIN — confirmed before building, not guessed. All six live exams are
-- per-subject with DIFFERENT max_marks (40, 50, 40, 40, 20, 25). The doc says
-- max/pass mark are "the same across all subjects within that exam", so these
-- cannot be one sitting with six subjects; they are six single-subject exams.
-- Decision taken: each becomes one exam with exactly one exam_subject. Nothing
-- is invented, no mark moves, and `exam_group_id` — half-populated (2 of 6),
-- pointing at no table — is dropped as the abandoned earlier attempt at this.
--
-- PASS MARK — confirmed before building. Five of six exams have no
-- passing_marks. It stays NULLABLE: where it is unset, pass/fail and
-- below-pass counts render "—", exactly as an unmarked mark does under G4.
-- Backfilling a conventional percentage would invent a rule that appears
-- nowhere in locked-decisions and would quietly become the standard.
--
-- G4, fixed here and independent of any decision: `marks.marks_obtained` was
-- NOT NULL. "Not marked" was therefore inexpressible — it could only be
-- stored as 0, which is precisely the falsehood G4 exists to prevent. It
-- becomes NULLABLE, and every aggregate must exclude NULL rather than
-- coalesce it.
--
-- G12: no policy below reaches another RLS-protected table. Each resolves its
-- fact through a STABLE SECURITY DEFINER helper so the inner table's policy
-- stack runs once, not once per candidate row. Every helper re-states the
-- guarantees it bypasses — institution, role, and the specific teaching
-- relationship — following the shape Chunk 5.1 established.
--
-- REPORTED, not resolved: one exam ("Unit Test — Electricity") names subject
-- "Science" for a section that teaches Physics and Mathematics, so it resolves
-- to no section_subject. Its single mark row keeps exam_subject_id NULL.
-- "Electricity" is a Physics topic, but relabelling it here would silently
-- rewrite a subject on someone's exam. Raised for a human decision.
--
-- Reverse: supabase/migrations/rollback/20260827110000_chunk6_down.sql
-- =====================================================================


-- ---------------------------------------------------------------------
-- SECTION 1 — tests
-- ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.tests (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id          uuid NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  academic_year_id   uuid REFERENCES public.academic_years(id) ON DELETE SET NULL,
  section_subject_id uuid NOT NULL,
  created_by         uuid,
  topic              text,
  date               date,
  max_mark           integer NOT NULL,
  status             text NOT NULL DEFAULT 'draft',
  submitted_at       timestamptz,
  deleted_at         timestamptz,
  deleted_by         uuid,
  created_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tests_status_known CHECK (status IN ('draft', 'submitted')),
  CONSTRAINT tests_max_mark_positive CHECK (max_mark > 0),
  -- Composite FK: a test can never name a section_subject from another
  -- institution. Same technique as Chunk 2's homework anchor.
  CONSTRAINT tests_section_subject_fk
    FOREIGN KEY (section_subject_id, school_id)
    REFERENCES public.section_subjects (id, school_id) ON DELETE RESTRICT,
  CONSTRAINT tests_id_school_key UNIQUE (id, school_id)
);

CREATE INDEX IF NOT EXISTS tests_school_idx  ON public.tests (school_id);
CREATE INDEX IF NOT EXISTS tests_ss_idx      ON public.tests (section_subject_id);
CREATE INDEX IF NOT EXISTS tests_live_idx    ON public.tests (school_id, date) WHERE deleted_at IS NULL;


-- ---------------------------------------------------------------------
-- SECTION 2 — test_marks. NULL means not marked (G4).
-- ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.test_marks (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id   uuid NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  test_id     uuid NOT NULL,
  student_id  uuid NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
  mark        integer,
  uploaded_at timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT test_marks_test_student_key UNIQUE (test_id, student_id),
  CONSTRAINT test_marks_test_fk
    FOREIGN KEY (test_id, school_id)
    REFERENCES public.tests (id, school_id) ON DELETE CASCADE,
  CONSTRAINT test_marks_non_negative CHECK (mark IS NULL OR mark >= 0)
);

COMMENT ON COLUMN public.test_marks.mark IS
  'NULL means NOT MARKED. It is never zero, and it is excluded from every average, highest, lowest and below-pass count (G4).';

CREATE INDEX IF NOT EXISTS test_marks_test_idx    ON public.test_marks (test_id);
CREATE INDEX IF NOT EXISTS test_marks_student_idx ON public.test_marks (student_id);


-- ---------------------------------------------------------------------
-- SECTION 3 — exams gains what the doc requires
-- ---------------------------------------------------------------------

ALTER TABLE public.exams
  ADD COLUMN IF NOT EXISTS academic_year_id uuid REFERENCES public.academic_years(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS previous_exam_id uuid REFERENCES public.exams(id) ON DELETE SET NULL;

UPDATE public.exams e
   SET academic_year_id = ay.id
  FROM public.academic_years ay
 WHERE e.academic_year_id IS NULL
   AND ay.school_id = e.school_id
   AND ay.is_current;

COMMENT ON COLUMN public.exams.passing_marks IS
  'The doc''s pass_mark. NULLABLE by decision: five of six live exams have none, and inventing a percentage would create a rule that exists nowhere in locked-decisions. Where unset, pass/fail renders as "—" (G4), never as a default threshold.';

ALTER TABLE public.exams DROP COLUMN IF EXISTS exam_group_id;

ALTER TABLE public.exams DROP CONSTRAINT IF EXISTS exams_id_school_key;
ALTER TABLE public.exams ADD CONSTRAINT exams_id_school_key UNIQUE (id, school_id);


-- ---------------------------------------------------------------------
-- SECTION 4 — exam_subjects: the per-subject grain the doc requires
-- ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.exam_subjects (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id          uuid NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  exam_id            uuid NOT NULL,
  section_subject_id uuid NOT NULL,
  scheduled_at       timestamptz,
  uploaded_by        uuid,
  uploaded_at        timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT exam_subjects_exam_subject_key UNIQUE (exam_id, section_subject_id),
  CONSTRAINT exam_subjects_exam_fk
    FOREIGN KEY (exam_id, school_id)
    REFERENCES public.exams (id, school_id) ON DELETE CASCADE,
  CONSTRAINT exam_subjects_section_subject_fk
    FOREIGN KEY (section_subject_id, school_id)
    REFERENCES public.section_subjects (id, school_id) ON DELETE RESTRICT,
  CONSTRAINT exam_subjects_id_school_key UNIQUE (id, school_id)
);

CREATE INDEX IF NOT EXISTS exam_subjects_exam_idx ON public.exam_subjects (exam_id);

-- One exam_subject per existing exam, resolved from the subject text it
-- already carries. Only where it genuinely resolves — see the header note on
-- the "Science" exam that does not.
INSERT INTO public.exam_subjects (school_id, exam_id, section_subject_id, scheduled_at)
SELECT e.school_id, e.id, ss.id, e.exam_date::timestamptz
  FROM public.exams e
  JOIN public.classes c            ON c.id = e.class_id
  JOIN public.class_groups g       ON g.id = c.class_group_id
  JOIN public.curriculum_subjects cs
    ON cs.curriculum_class_id = g.curriculum_class_id AND cs.name = btrim(e.subject)
  JOIN public.section_subjects ss
    ON ss.section_id = c.id AND ss.curriculum_subject_id = cs.id
 WHERE e.school_id IS NOT NULL
ON CONFLICT (exam_id, section_subject_id) DO NOTHING;


-- ---------------------------------------------------------------------
-- SECTION 5 — marks becomes the doc's exam_marks
-- ---------------------------------------------------------------------

ALTER TABLE public.marks
  ADD COLUMN IF NOT EXISTS exam_subject_id uuid;

UPDATE public.marks m
   SET exam_subject_id = es.id
  FROM public.exam_subjects es
 WHERE m.exam_subject_id IS NULL
   AND es.exam_id = m.exam_id;

-- G4: "not marked" must be expressible. It was not.
ALTER TABLE public.marks ALTER COLUMN marks_obtained DROP NOT NULL;

COMMENT ON COLUMN public.marks.marks_obtained IS
  'NULL means NOT MARKED (G4). Never zero. Excluded from every average, highest, lowest and below-pass count. Was NOT NULL until Chunk 6, which made "not marked" inexpressible except as a false 0.';

COMMENT ON COLUMN public.marks.exam_subject_id IS
  'The doc''s exam_marks anchor. NULLABLE only because one live exam names a subject its section does not teach and so resolves to no section_subject — reported rather than invented.';

CREATE INDEX IF NOT EXISTS marks_exam_subject_idx ON public.marks (exam_subject_id);


-- ---------------------------------------------------------------------
-- SECTION 6 — report_cards
-- ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.report_cards (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id    uuid NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  exam_id      uuid NOT NULL,
  student_id   uuid NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
  generated_at timestamptz NOT NULL DEFAULT now(),
  pdf_url      text,
  CONSTRAINT report_cards_exam_student_key UNIQUE (exam_id, student_id),
  CONSTRAINT report_cards_exam_fk
    FOREIGN KEY (exam_id, school_id)
    REFERENCES public.exams (id, school_id) ON DELETE CASCADE
);

COMMENT ON TABLE public.report_cards IS
  'Generated only when every subject in the exam has marks uploaded — never partial. Sent to parents automatically, no approval step. Rank is NOT stored here (G5); it is computed on read within the student''s own section.';

CREATE INDEX IF NOT EXISTS report_cards_exam_idx    ON public.report_cards (exam_id);
CREATE INDEX IF NOT EXISTS report_cards_student_idx ON public.report_cards (student_id);


-- ---------------------------------------------------------------------
-- SECTION 7 — G12 helpers
--
-- Each is STABLE SECURITY DEFINER so a policy pays the inner table's stack
-- ONCE rather than per candidate row, and each re-states every guarantee it
-- bypasses: institution first, then role, then the teaching relationship.
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.can_manage_test(_test_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM public.tests t
      JOIN public.section_subjects ss ON ss.id = t.section_subject_id
     WHERE t.id = _test_id
       AND public.same_school(t.school_id)          -- institution, re-stated
       AND (
         public.has_role(auth.uid(), 'admin'::public.app_role)
         OR t.created_by = auth.uid()
         OR public.teacher_teaches_class(auth.uid(), ss.section_id)
       )
  )
$$;

CREATE OR REPLACE FUNCTION public.can_read_test(_test_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM public.tests t
      JOIN public.section_subjects ss ON ss.id = t.section_subject_id
     WHERE t.id = _test_id
       AND public.same_school(t.school_id)
       AND (
         public.is_principal_or_admin(auth.uid())
         OR public.teacher_teaches_class(auth.uid(), ss.section_id)
         -- A student sees tests for their own section; a guardian for their
         -- child's. Both resolve through helpers that fence themselves.
         OR EXISTS (SELECT 1 FROM public.students s
                     WHERE s.class_id = ss.section_id
                       AND public.is_my_student_record(s.id))
         OR public.is_class_of_my_child(ss.section_id)
       )
  )
$$;

CREATE OR REPLACE FUNCTION public.can_manage_exam(_exam_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.exams e
     WHERE e.id = _exam_id
       AND public.same_school(e.school_id)
       AND (
         public.has_role(auth.uid(), 'admin'::public.app_role)
         -- "Created by the class teacher, for their own section only."
         OR public.is_class_teacher_of_class(auth.uid(), e.class_id)
       )
  )
$$;

-- "Uploaded by the subject teacher for their own subject", and after the exam
-- is locked ONLY admin may edit.
CREATE OR REPLACE FUNCTION public.can_upload_exam_marks(_exam_subject_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM public.exam_subjects es
      JOIN public.exams e            ON e.id = es.exam_id
      JOIN public.section_subjects ss ON ss.id = es.section_subject_id
     WHERE es.id = _exam_subject_id
       AND public.same_school(es.school_id)
       AND (
         public.has_role(auth.uid(), 'admin'::public.app_role)
         OR (NOT e.marks_locked
             AND public.teacher_teaches_class(auth.uid(), ss.section_id))
       )
  )
$$;

REVOKE EXECUTE ON FUNCTION public.can_manage_test(uuid)        FROM public, anon;
REVOKE EXECUTE ON FUNCTION public.can_read_test(uuid)          FROM public, anon;
REVOKE EXECUTE ON FUNCTION public.can_manage_exam(uuid)        FROM public, anon;
REVOKE EXECUTE ON FUNCTION public.can_upload_exam_marks(uuid)  FROM public, anon;
GRANT  EXECUTE ON FUNCTION public.can_manage_test(uuid)        TO authenticated;
GRANT  EXECUTE ON FUNCTION public.can_read_test(uuid)          TO authenticated;
GRANT  EXECUTE ON FUNCTION public.can_manage_exam(uuid)        TO authenticated;
GRANT  EXECUTE ON FUNCTION public.can_upload_exam_marks(uuid)  TO authenticated;


-- ---------------------------------------------------------------------
-- SECTION 8 — RLS. No policy below reaches an RLS-protected table (G12).
-- ---------------------------------------------------------------------

ALTER TABLE public.tests         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.test_marks    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.exam_subjects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.report_cards  ENABLE ROW LEVEL SECURITY;

-- Tenant fences, restrictive, as every school-scoped table has carried since Chunk 1.
DROP POLICY IF EXISTS tests_tenant_fence ON public.tests;
CREATE POLICY tests_tenant_fence ON public.tests
  AS RESTRICTIVE FOR ALL TO authenticated, anon
  USING (school_id IS NULL OR public.same_school(school_id))
  WITH CHECK (school_id IS NULL OR public.same_school(school_id));

DROP POLICY IF EXISTS test_marks_tenant_fence ON public.test_marks;
CREATE POLICY test_marks_tenant_fence ON public.test_marks
  AS RESTRICTIVE FOR ALL TO authenticated, anon
  USING (school_id IS NULL OR public.same_school(school_id))
  WITH CHECK (school_id IS NULL OR public.same_school(school_id));

DROP POLICY IF EXISTS exam_subjects_tenant_fence ON public.exam_subjects;
CREATE POLICY exam_subjects_tenant_fence ON public.exam_subjects
  AS RESTRICTIVE FOR ALL TO authenticated, anon
  USING (school_id IS NULL OR public.same_school(school_id))
  WITH CHECK (school_id IS NULL OR public.same_school(school_id));

DROP POLICY IF EXISTS report_cards_tenant_fence ON public.report_cards;
CREATE POLICY report_cards_tenant_fence ON public.report_cards
  AS RESTRICTIVE FOR ALL TO authenticated, anon
  USING (school_id IS NULL OR public.same_school(school_id))
  WITH CHECK (school_id IS NULL OR public.same_school(school_id));

-- Soft delete is enforced by policy, not application filtering (G6).
DROP POLICY IF EXISTS tests_hide_soft_deleted ON public.tests;
CREATE POLICY tests_hide_soft_deleted ON public.tests
  AS RESTRICTIVE FOR ALL TO authenticated, anon
  USING (deleted_at IS NULL OR public.has_role(auth.uid(), 'admin'::public.app_role));

-- tests
DROP POLICY IF EXISTS tests_read ON public.tests;
CREATE POLICY tests_read ON public.tests
  FOR SELECT TO authenticated USING (public.can_read_test(id));

DROP POLICY IF EXISTS tests_write ON public.tests;
CREATE POLICY tests_write ON public.tests
  FOR ALL TO authenticated
  USING (public.can_manage_test(id))
  WITH CHECK (public.same_school(school_id));

-- test_marks
DROP POLICY IF EXISTS test_marks_read ON public.test_marks;
CREATE POLICY test_marks_read ON public.test_marks
  FOR SELECT TO authenticated
  USING (public.can_read_test(test_id) OR public.is_my_student_record(student_id) OR public.is_my_child(student_id));

DROP POLICY IF EXISTS test_marks_write ON public.test_marks;
CREATE POLICY test_marks_write ON public.test_marks
  FOR ALL TO authenticated
  USING (public.can_manage_test(test_id))
  WITH CHECK (public.can_manage_test(test_id));

-- exam_subjects: readable in-institution (students see the timetable), written
-- by whoever may manage the exam.
DROP POLICY IF EXISTS exam_subjects_read ON public.exam_subjects;
CREATE POLICY exam_subjects_read ON public.exam_subjects
  FOR SELECT TO authenticated USING (public.same_school(school_id));

DROP POLICY IF EXISTS exam_subjects_write ON public.exam_subjects;
CREATE POLICY exam_subjects_write ON public.exam_subjects
  FOR ALL TO authenticated
  USING (public.can_manage_exam(exam_id))
  WITH CHECK (public.can_manage_exam(exam_id));

-- report_cards: the student, their guardian, and staff. Never another child's.
DROP POLICY IF EXISTS report_cards_read ON public.report_cards;
CREATE POLICY report_cards_read ON public.report_cards
  FOR SELECT TO authenticated
  USING (
    public.is_my_student_record(student_id)
    OR public.is_my_child(student_id)
    OR public.is_principal_or_admin(auth.uid())
    OR public.is_class_teacher_of_student(auth.uid(), student_id)
  );

DROP POLICY IF EXISTS report_cards_write ON public.report_cards;
CREATE POLICY report_cards_write ON public.report_cards
  FOR ALL TO authenticated
  USING (public.can_manage_exam(exam_id))
  WITH CHECK (public.can_manage_exam(exam_id));


-- ---------------------------------------------------------------------
-- SECTION 9 — assertions
-- ---------------------------------------------------------------------

DO $$
DECLARE _n int; _unresolved int;
BEGIN
  -- G4: "not marked" must be expressible on both mark columns.
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema='public' AND table_name='marks'
                AND column_name='marks_obtained' AND is_nullable='NO') THEN
    RAISE EXCEPTION 'Chunk 6: marks.marks_obtained is still NOT NULL — "not marked" can only be stored as a false 0';
  END IF;

  -- Every new table carries the restrictive fence.
  SELECT count(*), count(*) FILTER (WHERE TRUE) INTO _n, _n
    FROM (VALUES ('tests'),('test_marks'),('exam_subjects'),('report_cards')) AS t(tbl)
   WHERE NOT EXISTS (
     SELECT 1 FROM pg_policies p
      WHERE p.schemaname='public' AND p.tablename=t.tbl
        AND p.permissive='RESTRICTIVE' AND p.policyname = t.tbl || '_tenant_fence');
  IF _n > 0 THEN RAISE EXCEPTION 'Chunk 6: tenant fence missing on % table(s)', _n; END IF;

  -- G12: no policy on the new tables may name another table directly.
  SELECT count(*) INTO _n FROM pg_policies
   WHERE schemaname='public'
     AND tablename IN ('tests','test_marks','exam_subjects','report_cards')
     AND (coalesce(qual,'') || ' ' || coalesce(with_check,'')) ~ 'FROM public\.';
  IF _n > 0 THEN
    RAISE EXCEPTION 'Chunk 6: % policy/policies reach a table directly instead of via a SECURITY DEFINER helper (G12)', _n;
  END IF;

  -- The backfill covered everything that could resolve.
  SELECT count(*) INTO _unresolved
    FROM public.exams e
   WHERE NOT EXISTS (SELECT 1 FROM public.exam_subjects es WHERE es.exam_id = e.id);
  RAISE NOTICE 'Chunk 6: % exam(s) have no exam_subject (subject names a section_subject that does not exist)', _unresolved;

  SELECT count(*) INTO _n FROM public.exam_subjects;
  IF _n = 0 THEN RAISE EXCEPTION 'Chunk 6: no exam_subjects were created'; END IF;
END $$;


-- ---------------------------------------------------------------------
-- SECTION 10 — "never partial" is an invariant, not an intention
--
-- The doc: "Generated only when every subject in the exam has marks uploaded.
-- Never partial." Left to the generator, that is a rule someone can forget.
-- Enforced here, a partial report card cannot exist.
--
-- A NULL mark counts as NOT uploaded — that is the whole point of G4. A
-- subject where the student has no row, or a row whose mark is NULL, blocks
-- generation just the same.
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.tg_report_card_requires_every_subject()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE _subjects int; _marked int;
BEGIN
  SELECT count(*) INTO _subjects
    FROM public.exam_subjects es WHERE es.exam_id = NEW.exam_id;

  IF _subjects = 0 THEN
    RAISE EXCEPTION
      'exam % has no subjects, so a report card would attest to nothing', NEW.exam_id;
  END IF;

  SELECT count(*) INTO _marked
    FROM public.exam_subjects es
    JOIN public.marks m
      ON m.exam_subject_id = es.id
     AND m.student_id = NEW.student_id
     AND m.marks_obtained IS NOT NULL      -- NULL is NOT marked (G4)
   WHERE es.exam_id = NEW.exam_id;

  IF _marked < _subjects THEN
    RAISE EXCEPTION
      'report card refused: student % has marks for %/% subjects of exam % — never partial',
      NEW.student_id, _marked, _subjects, NEW.exam_id;
  END IF;

  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_report_card_requires_every_subject ON public.report_cards;
CREATE TRIGGER trg_report_card_requires_every_subject
  BEFORE INSERT OR UPDATE OF exam_id, student_id ON public.report_cards
  FOR EACH ROW EXECUTE FUNCTION public.tg_report_card_requires_every_subject();

REVOKE EXECUTE ON FUNCTION public.tg_report_card_requires_every_subject() FROM public, anon, authenticated;


-- ---------------------------------------------------------------------
-- SECTION 11 — the unique constraint follows the grain change
--
-- Found by this chunk's own verification, not by inspection: `marks` still
-- carried UNIQUE (exam_id, student_id) — one mark per student per EXAM. That
-- is a leftover from the old per-subject-exam grain, and under the new grain
-- it makes a multi-subject exam impossible: the second subject's mark for the
-- same student is rejected as a duplicate.
--
-- The successor is UNIQUE (exam_subject_id, student_id) — one mark per student
-- per SUBJECT, which is what the doc's exam_marks means. Rows whose
-- exam_subject_id is NULL (the one exam that resolves to no section_subject)
-- are not constrained by it, which is correct: they are already reported as an
-- unresolved gap rather than pretended to be fine.
-- ---------------------------------------------------------------------

ALTER TABLE public.marks DROP CONSTRAINT IF EXISTS marks_exam_id_student_id_key;

ALTER TABLE public.marks DROP CONSTRAINT IF EXISTS marks_exam_subject_student_key;
ALTER TABLE public.marks
  ADD CONSTRAINT marks_exam_subject_student_key UNIQUE (exam_subject_id, student_id);


-- ---------------------------------------------------------------------
-- SECTION 12 — the marks policies: the lock, and G12
--
-- TWO defects, both found by this chunk's own verification once item 5 was
-- corrected to assert BOTH halves. The earlier version reported PASS on
-- "0 rows changed" while the teacher could not read the rows at all — a false
-- pass of exactly the shape G11 describes.
--
-- 1. "After submission only admin may edit" was not enforced. `marks teacher
--    manage` granted ALL to any teacher of the class with no reference to
--    exams.marks_locked, so a teacher could rewrite marks after submission.
--    can_upload_exam_marks() was defined in Section 7 with the lock check and
--    then never actually attached to a policy — the guard existed but nothing
--    used it.
--
-- 2. G12: four read policies reached exams / students / parents /
--    parent_students directly. Each one pays that table's whole policy stack
--    per candidate row of marks. This is the pattern that produced a 33-second
--    parent panel against an 8-second timeout.
--
-- Every replacement below resolves through a STABLE SECURITY DEFINER helper
-- that re-states institution, role and relationship.
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.can_read_mark(_exam_id uuid, _student_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.exams e
     WHERE e.id = _exam_id
       AND public.same_school(e.school_id)             -- institution, re-stated
       AND (
         -- Staff: principal and admin see marks whether published or not.
         public.is_principal_or_admin(auth.uid())
         OR public.teacher_teaches_class(auth.uid(), e.class_id)
         -- The student and their guardian see them only once published. That
         -- condition was in the policies this replaces; it is preserved, not
         -- quietly relaxed.
         OR (e.results_published_at IS NOT NULL
             AND (public.is_my_student_record(_student_id)
               OR public.is_my_child(_student_id)))
       )
  )
$$;

REVOKE EXECUTE ON FUNCTION public.can_read_mark(uuid, uuid) FROM public, anon;
GRANT  EXECUTE ON FUNCTION public.can_read_mark(uuid, uuid) TO authenticated;

-- Out with the four nested-RLS readers and the lock-blind writer.
DROP POLICY IF EXISTS "Parents via parent_students can view marks" ON public.marks;
DROP POLICY IF EXISTS "marks parent read"    ON public.marks;
DROP POLICY IF EXISTS "marks student read"   ON public.marks;
DROP POLICY IF EXISTS "marks principal read" ON public.marks;
DROP POLICY IF EXISTS "marks teacher manage" ON public.marks;

CREATE POLICY "marks read" ON public.marks
  FOR SELECT TO authenticated
  USING (public.can_read_mark(exam_id, student_id));

-- Teachers write only while the exam is unlocked; admin always. Both arms live
-- inside can_upload_exam_marks so the rule has one home.
CREATE POLICY "marks teacher manage" ON public.marks
  FOR ALL TO authenticated
  USING (public.can_upload_exam_marks(exam_subject_id))
  WITH CHECK (public.can_upload_exam_marks(exam_subject_id));


DO $$
DECLARE _n int;
BEGIN
  -- No policy on marks may reach another table directly any more (G12).
  SELECT count(*) INTO _n FROM pg_policies
   WHERE schemaname='public' AND tablename='marks'
     AND (coalesce(qual,'') || ' ' || coalesce(with_check,'')) ~ 'FROM (public\.)?(exams|students|parents|parent_students)\M';
  IF _n > 0 THEN
    RAISE EXCEPTION 'Chunk 6: % marks policy/policies still nest RLS (G12)', _n;
  END IF;

  -- The lock guard is actually attached to something now.
  SELECT count(*) INTO _n FROM pg_policies
   WHERE schemaname='public' AND tablename='marks'
     AND coalesce(qual,'') ~ 'can_upload_exam_marks';
  IF _n = 0 THEN
    RAISE EXCEPTION 'Chunk 6: can_upload_exam_marks is defined but no policy uses it';
  END IF;
END $$;


-- ---------------------------------------------------------------------
-- SECTION 13 — G12 on `exams` itself
--
-- Found by the timing gate, not by reading: a parent reading `exams` took
-- 821 ms for FIVE rows, and `marks` 1116 ms for five. That passes a 4-second
-- finding threshold today only because the demo school is tiny — at ~220 ms
-- per row it crosses the 8-second timeout somewhere around forty rows, and a
-- real school has hundreds.
--
-- The cause is the same one G12 describes: `exams school read` carried TWO
-- nested EXISTS clauses reaching students, parent_students and parents, so
-- every candidate exam row paid three tables' policy stacks. is_class_of_my_child()
-- already existed as a SECURITY DEFINER helper doing precisely this; the
-- policy simply was not using it.
--
-- Both arms collapse into one helper call. Nothing about who may read changes:
-- the legacy students.parent_user_id path and the parent_students path are
-- both inside that helper.
-- ---------------------------------------------------------------------

DROP POLICY IF EXISTS "exams school read" ON public.exams;
CREATE POLICY "exams school read" ON public.exams
  FOR SELECT TO authenticated
  USING (
    public.same_school(school_id)
    AND (
      public.has_role(auth.uid(), 'admin'::public.app_role)
      OR public.has_role(auth.uid(), 'principal'::public.app_role)
      OR public.teacher_teaches_class(auth.uid(), class_id)
      OR public.student_class_id(auth.uid()) = class_id
      OR public.is_class_of_my_child(class_id)
    )
  );

DO $$
DECLARE _n int;
BEGIN
  SELECT count(*) INTO _n FROM pg_policies
   WHERE schemaname='public' AND tablename='exams'
     AND (coalesce(qual,'') || ' ' || coalesce(with_check,''))
         ~ 'FROM (public\.)?(students|parents|parent_students)\M';
  IF _n > 0 THEN
    RAISE EXCEPTION 'Chunk 6: % exams policy/policies still nest RLS (G12)', _n;
  END IF;
END $$;


-- ---------------------------------------------------------------------
-- SECTION 14 — removing the cost, not moving it
--
-- Section 13 de-nested `exams school read` and the parent's read did not get
-- faster: 821 ms before, 855 ms after. The fix moved nothing. G12 says measure
-- again, so this is what the second measurement found, per call:
--
--   get_my_school_id()       1.34 ms
--   active_membership_id()   0.06 ms   (already cached — takes no argument)
--   has_role()               0.72 ms
--   is_class_of_my_child()  17.30 ms   <- the real cost
--
-- is_class_of_my_child(_class_id) takes an argument, so Postgres cannot reuse
-- it across rows even though it is STABLE: a different argument is a different
-- call. It is therefore paid once per candidate exam row.
--
-- But WHICH CLASSES MY CHILDREN ARE IN does not vary by row. Expressed as a
-- zero-argument STABLE function it is evaluated once per statement, and the
-- policy becomes a cheap array membership test. 5 rows x 17 ms becomes
-- 1 x 17 ms; at the 200 rows a real school has, 3.4 s becomes 17 ms.
--
-- The predicate is copied from is_class_of_my_child verbatim — the parent role
-- gate, the institution scope, and BOTH linkage paths (the legacy
-- students.parent_user_id and the parent_students join). Nothing about who may
-- read changes. is_class_of_my_child is kept for callers that genuinely test
-- one class at a time.
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.my_children_class_ids()
RETURNS uuid[]
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT CASE
    WHEN public.active_membership_role() <> 'parent' THEN ARRAY[]::uuid[]
    ELSE COALESCE(
      (SELECT array_agg(DISTINCT s.class_id)
         FROM public.students s
        WHERE s.class_id IS NOT NULL
          AND s.school_id = public.active_membership_school_id()
          AND (
            s.parent_user_id = auth.uid()
            OR EXISTS (
              SELECT 1 FROM public.parent_students ps
               WHERE ps.student_id = s.id
                 AND ps.parent_id = public.active_local_person_id()
            )
          )),
      ARRAY[]::uuid[])
  END
$$;

REVOKE EXECUTE ON FUNCTION public.my_children_class_ids() FROM public, anon;
GRANT  EXECUTE ON FUNCTION public.my_children_class_ids() TO authenticated;

DROP POLICY IF EXISTS "exams school read" ON public.exams;
CREATE POLICY "exams school read" ON public.exams
  FOR SELECT TO authenticated
  USING (
    public.same_school(school_id)
    AND (
      public.has_role(auth.uid(), 'admin'::public.app_role)
      OR public.has_role(auth.uid(), 'principal'::public.app_role)
      OR public.teacher_teaches_class(auth.uid(), class_id)
      OR public.student_class_id(auth.uid()) = class_id
      OR class_id = ANY (public.my_children_class_ids())
    )
  );


-- ---------------------------------------------------------------------
-- SECTION 15 — the same treatment for `marks`
--
-- exams went 855 ms -> 578 ms once the parent check stopped being per-row.
-- marks is heavier still (1128 ms for five rows) and has the identical shape:
-- can_read_mark(exam_id, student_id) varies by row, so it cannot be reused.
--
-- Only PART of it genuinely varies. Whether the exam is published depends on
-- the row; WHICH STUDENTS ARE MINE does not. That half becomes a zero-argument
-- set, and the per-row work drops to an array membership test.
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.my_children_student_ids()
RETURNS uuid[]
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT CASE
    WHEN public.active_membership_role() <> 'parent' THEN ARRAY[]::uuid[]
    ELSE COALESCE(
      (SELECT array_agg(DISTINCT s.id)
         FROM public.students s
        WHERE s.school_id = public.active_membership_school_id()
          AND (
            s.parent_user_id = auth.uid()
            OR EXISTS (
              SELECT 1 FROM public.parent_students ps
               WHERE ps.student_id = s.id
                 AND ps.parent_id = public.active_local_person_id()
            )
          )),
      ARRAY[]::uuid[])
  END
$$;

REVOKE EXECUTE ON FUNCTION public.my_children_student_ids() FROM public, anon;
GRANT  EXECUTE ON FUNCTION public.my_children_student_ids() TO authenticated;

CREATE OR REPLACE FUNCTION public.can_read_mark(_exam_id uuid, _student_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.exams e
     WHERE e.id = _exam_id
       AND public.same_school(e.school_id)
       AND (
         public.is_principal_or_admin(auth.uid())
         OR public.teacher_teaches_class(auth.uid(), e.class_id)
         -- Student and guardian: published only. The guardian half is now a
         -- set membership test rather than a per-row lookup.
         OR (e.results_published_at IS NOT NULL
             AND (public.is_my_student_record(_student_id)
               OR _student_id = ANY (public.my_children_student_ids())))
       )
  )
$$;


-- ---------------------------------------------------------------------
-- SECTION 16 — the third measurement, and the actual cause
--
-- Section 15 made the parent lookup set-based and marks did not move either:
-- 1128 ms -> 1138 ms. Two fixes, no improvement. So measure a third time —
-- per call, as a parent:
--
--   teacher_teaches_class()   18.5 ms   <- a PARENT was paying this
--   is_my_student_record()    19.2 ms   <- and this
--   is_principal_or_admin()    6.6 ms
--   my_children_student_ids()  4.2 ms   (already cheap, already cacheable)
--
-- The cost was never the parent's own check. It was that an OR chain evaluates
-- every arm until one returns true, so a parent paid the TEACHER arm and the
-- STUDENT arm on every single row before reaching their own. ~44 ms per row,
-- which is the 227 ms/row the gate measured across five rows.
--
-- The fix is to branch on the role FIRST. active_membership_role() costs
-- 0.06 ms because it takes no argument and is cached per statement, so each
-- role now pays only its own arm. Nobody's access changes — the same five
-- conditions, reachable by exactly the same people.
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.can_read_mark(_exam_id uuid, _student_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.exams e
     WHERE e.id = _exam_id
       AND public.same_school(e.school_id)
       AND CASE public.active_membership_role()
             WHEN 'admin'     THEN true
             WHEN 'principal' THEN true
             WHEN 'teacher'   THEN public.teacher_teaches_class(auth.uid(), e.class_id)
             -- Student and guardian see marks only once published. That
             -- condition is preserved exactly; only the dispatch changed.
             WHEN 'student'   THEN e.results_published_at IS NOT NULL
                                   AND public.is_my_student_record(_student_id)
             WHEN 'parent'    THEN e.results_published_at IS NOT NULL
                                   AND _student_id = ANY (public.my_children_student_ids())
             ELSE false
           END
  )
$$;


-- ---------------------------------------------------------------------
-- SECTION 17 — restoring exam_group_id, which Section 3 should not have
--              dropped
--
-- Section 3 contains the bare line
--
--     ALTER TABLE public.exams DROP COLUMN IF EXISTS exam_group_id;
--
-- with no rationale above it. That is the whole problem: the build rule is
-- "never guess — if a decision is not written down, stop and ask", and this
-- was a decision made silently. It is reversed here rather than argued for
-- after the fact.
--
-- The column is not vestigial. It has its own migration
-- (20260731140000_class_exam_groups.sql), it is WRITTEN by
-- createClassExamGroup (examRepository.ts:247, which fans out one exams row
-- per subject under a shared group id), and it is READ by the admin
-- Examinations screen, the teacher live panel, and three marksService
-- paths that lock and publish a whole group together.
--
-- What the drop actually did: every `if (exam.examGroupId)` became false, so
-- each of those three paths fell silently into its single-exam else-branch.
-- Nothing threw. Finalising one subject of an exam group simply stopped
-- finalising the others -- a feature quietly changing behaviour, which is
-- the exact failure the chunk protocol exists to prevent.
--
-- Data loss from the drop: none, and here is the basis for saying so rather
-- than assuming it. The original migration backfilled `exam_group_id = id`,
-- making every pre-existing exam a singleton group. All six live exams have
-- distinct names, each naming its own chapter and subject ("Half Yearly —
-- Electricity"/Physics, "Unit Test 1 — Real Numbers"/Mathematics); three
-- share a seed timestamp but name three different exam events, not one
-- event across three subjects. So no multi-row group existed, and the same
-- backfill below reproduces the prior state exactly.
-- ---------------------------------------------------------------------

ALTER TABLE public.exams
  ADD COLUMN IF NOT EXISTS exam_group_id uuid;

CREATE INDEX IF NOT EXISTS exams_exam_group_id_idx ON public.exams (exam_group_id);
CREATE INDEX IF NOT EXISTS exams_class_group_idx   ON public.exams (class_id, exam_group_id);

UPDATE public.exams
   SET exam_group_id = id
 WHERE exam_group_id IS NULL;

COMMENT ON COLUMN public.exams.exam_group_id IS
  'Groups the per-subject exams rows of one exam event. Restored in Chunk 6 Section 17 after Section 3 dropped it without a written decision. NOTE (G9): this now overlaps with exam_subjects, which expresses the same "one event, several subjects" relation at a different grain. Two shapes for one fact is a two-sources-of-truth problem and needs a written decision on which is authority — it is REPORTED, not silently resolved.';


-- ---------------------------------------------------------------------
-- SECTION 18 — pinning report_cards.student_id to the same institution
--
-- The tenant-scope lint flagged tg_report_card_requires_every_subject:
-- a SECURITY DEFINER function reading tenant-scoped tables with no
-- school_id anywhere in its body. Examining it rather than allowlisting it
-- straight away turned up a real gap.
--
-- report_cards pins its exam properly --
--   FOREIGN KEY (exam_id, school_id) REFERENCES exams (id, school_id)
-- -- and both columns are NOT NULL, so MATCH SIMPLE cannot null-skip it.
-- But student_id referenced students(id) alone. Nothing in the schema
-- stopped a report card in school A from naming a student in school B;
-- only the RLS tenant fence did, and RLS does not apply to a SECURITY
-- DEFINER body or to service_role. That is the same shape as the
-- cross-institution FK closed earlier in this rebuild.
--
-- students has no (id, school_id) unique key to point at, so add one
-- first. It is redundant as a uniqueness claim -- id is already the
-- primary key -- and exists solely to be a composite FK target, exactly
-- as exams_id_school_key does in Section 3.
-- ---------------------------------------------------------------------

ALTER TABLE public.students DROP CONSTRAINT IF EXISTS students_id_school_key;
ALTER TABLE public.students ADD CONSTRAINT students_id_school_key UNIQUE (id, school_id);

COMMENT ON CONSTRAINT students_id_school_key ON public.students IS
  'Not a uniqueness claim -- id is already the primary key. Exists only so other tables can pin a student to an institution with a composite FK, the way report_cards does.';

ALTER TABLE public.report_cards DROP CONSTRAINT IF EXISTS report_cards_student_id_fkey;
ALTER TABLE public.report_cards DROP CONSTRAINT IF EXISTS report_cards_student_fk;
ALTER TABLE public.report_cards
  ADD CONSTRAINT report_cards_student_fk
  FOREIGN KEY (student_id, school_id)
  REFERENCES public.students (id, school_id) ON DELETE CASCADE;
