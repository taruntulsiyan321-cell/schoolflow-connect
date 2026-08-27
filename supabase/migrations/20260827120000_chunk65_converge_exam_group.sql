-- ---------------------------------------------------------------------
-- CHUNK 6.5 — CONVERGE exam_group_id
--
-- G9. Two shapes expressed "one event, several subjects" at different grains:
--
--   (a) exams.exam_group_id  — N per-subject `exams` rows sharing a group id.
--   (b) exams + exam_subjects — ONE `exams` row (the sitting) with N
--       `exam_subjects` rows beneath it.
--
-- (b) is the authority. §10.22 defines an exam as one sitting created by the
-- class teacher, with one max mark and pass mark ACROSS its subjects and a
-- subject-wise timetable. That is exactly (b).
--
-- These are not two ways of writing the same thing, and only one convergence
-- is actually available: exam_subjects.exam_id references exams(id), so
-- exam_subjects sits BELOW exams, not beside it. If `exams` stayed per-subject
-- there would be nothing for exam_group_id to converge INTO — exam_subjects
-- would be 1:1 with exams and could not express grouping at all. So the
-- fan-out goes, and one `exams` row becomes the sitting.
--
-- Handled carefully because it broke silently once: the column was dropped
-- inside another chunk, every `if (exam.examGroupId)` became false, finalising
-- one subject stopped finalising its group, and nothing threw. This migration
-- therefore ASSERTS the post-state rather than assuming it, and the client
-- change ships in the same commit.
-- ---------------------------------------------------------------------


-- ---------------------------------------------------------------------
-- SECTION 1 — Precondition. Prove "no marks moved" BEFORE acting.
--
-- Collapsing a group that spans several exams rows into one sitting would
-- move marks between rows. Verification item 4 forbids that. Rather than
-- assume the live shape, refuse to run if any group spans more than one exam.
-- On this database every group holds exactly one exam, so nothing collapses
-- and nothing moves. On any database where that is untrue, this migration is
-- wrong and must be revised rather than forced.
-- ---------------------------------------------------------------------

DO $chunk65_pre$
DECLARE
  _bad text;
BEGIN
  SELECT string_agg(format('%s (%s exams)', exam_group_id, c), ', ')
    INTO _bad
    FROM (
      SELECT exam_group_id, count(*) AS c
        FROM public.exams
       WHERE exam_group_id IS NOT NULL
       GROUP BY exam_group_id
      HAVING count(*) > 1
    ) t;

  IF _bad IS NOT NULL THEN
    RAISE EXCEPTION
      'Chunk 6.5 precondition failed: these exam groups span more than one exams row: %. Collapsing them would move marks between rows, which verification item 4 forbids. Revise this migration to carry a deliberate, written collapse rule.',
      _bad;
  END IF;
END
$chunk65_pre$;


-- ---------------------------------------------------------------------
-- SECTION 2 — Data repair, not a mapping.
--
-- One live exam names a subject its own section does not teach:
--
--   "Unit Test — Electricity (Arjun demo)"  subject = 'Science'
--   its section (Class 10A) teaches Mathematics and Physics
--
-- So it resolved to no section_subject, got no exam_subjects row, and its one
-- mark carried a NULL exam_subject_id. In the real app this cannot happen —
-- the teacher picks from their own section's subjects. It is a defect in demo
-- data, not a question about how subjects map.
--
-- The fix is therefore to correct THAT ROW, not to teach the resolver that
-- "Science" sometimes means "Physics". Evidence for Physics is local and
-- specific rather than a guess: the exam covers the chapter Electricity, and
-- the same section's other Electricity exam ("Half Yearly — Electricity")
-- already carries subject = 'Physics'.
--
-- Guarded three ways: by id, by the exact current value, and by the section
-- genuinely teaching Physics. If any of those has changed, this updates
-- nothing and Section 3's assertion reports the row instead of absorbing it.
--
-- NOTE (reported, not silently handled): these three "(Arjun demo)" exams were
-- created in the live database on 2026-08-25 and are reproduced by NO file in
-- this repository. SEED_DEMO_DATA.sql does not create them and is already
-- internally consistent — its own guard raises if a mark fails to resolve.
-- ---------------------------------------------------------------------

UPDATE public.exams e
   SET subject = 'Physics'
 WHERE e.id = 'e7000001-0010-4000-8000-000000000003'
   AND btrim(e.subject) = 'Science'
   AND EXISTS (
     SELECT 1
       FROM public.classes c
       JOIN public.class_groups g         ON g.id = c.class_group_id
       JOIN public.curriculum_subjects cs ON cs.curriculum_class_id = g.curriculum_class_id
       JOIN public.section_subjects ss    ON ss.section_id = c.id
                                         AND ss.curriculum_subject_id = cs.id
      WHERE c.id = e.class_id
        AND cs.name = 'Physics'
   );


-- ---------------------------------------------------------------------
-- SECTION 3 — Every exam gets its exam_subjects row, or we stop.
-- ---------------------------------------------------------------------

INSERT INTO public.exam_subjects (school_id, exam_id, section_subject_id, scheduled_at)
SELECT e.school_id, e.id, ss.id, e.exam_date::timestamptz
  FROM public.exams e
  JOIN public.classes c             ON c.id = e.class_id
  JOIN public.class_groups g        ON g.id = c.class_group_id
  JOIN public.curriculum_subjects cs
    ON cs.curriculum_class_id = g.curriculum_class_id AND cs.name = btrim(e.subject)
  JOIN public.section_subjects ss
    ON ss.section_id = c.id AND ss.curriculum_subject_id = cs.id
 WHERE e.school_id IS NOT NULL
   AND e.subject IS NOT NULL
ON CONFLICT (exam_id, section_subject_id) DO NOTHING;

DO $chunk65_es$
DECLARE
  _bad text;
BEGIN
  SELECT string_agg(format('%s (%L on a section teaching %s)', e.id, e.subject,
           coalesce((SELECT string_agg(cs.name, ', ' ORDER BY cs.name)
                       FROM public.section_subjects ss
                       JOIN public.curriculum_subjects cs ON cs.id = ss.curriculum_subject_id
                      WHERE ss.section_id = e.class_id), 'nothing')), '; ')
    INTO _bad
    FROM public.exams e
   WHERE NOT EXISTS (SELECT 1 FROM public.exam_subjects es WHERE es.exam_id = e.id);

  IF _bad IS NOT NULL THEN
    RAISE EXCEPTION
      'Chunk 6.5: these exams still resolve to no section_subject, so their marks cannot be anchored: %. Fix the data so each exam names a subject its own section teaches. Do not add a subject-name mapping.',
      _bad;
  END IF;
END
$chunk65_es$;


-- ---------------------------------------------------------------------
-- SECTION 4 — marks.exam_subject_id becomes NOT NULL.
--
-- This is the structural half of Section 2. Once the anchor is mandatory, an
-- exam that names a subject its section does not teach can no longer carry
-- marks at all — the defect becomes unexpressible instead of merely absent.
-- ---------------------------------------------------------------------

UPDATE public.marks m
   SET exam_subject_id = es.id
  FROM public.exam_subjects es
 WHERE m.exam_subject_id IS NULL
   AND es.exam_id = m.exam_id;

DO $chunk65_marks$
DECLARE
  _n bigint;
BEGIN
  SELECT count(*) INTO _n FROM public.marks WHERE exam_subject_id IS NULL;
  IF _n > 0 THEN
    RAISE EXCEPTION 'Chunk 6.5: % marks rows still have a NULL exam_subject_id after backfill.', _n;
  END IF;
END
$chunk65_marks$;

ALTER TABLE public.marks ALTER COLUMN exam_subject_id SET NOT NULL;

ALTER TABLE public.marks DROP CONSTRAINT IF EXISTS marks_exam_subject_fk;
ALTER TABLE public.marks
  ADD CONSTRAINT marks_exam_subject_fk
  FOREIGN KEY (exam_subject_id, school_id)
  REFERENCES public.exam_subjects (id, school_id) ON DELETE CASCADE;

COMMENT ON COLUMN public.marks.exam_subject_id IS
  'The doc''s exam_marks anchor: which subject OF WHICH SITTING this mark is for. NOT NULL since Chunk 6.5 — it was nullable only to accommodate one demo exam that named a subject its section did not teach, which was a data defect and is now repaired. With UNIQUE (exam_subject_id, student_id) this is what makes a multi-subject sitting hold one mark per student per subject.';


-- ---------------------------------------------------------------------
-- SECTION 5 — exams becomes the sitting.
--
-- A sitting spanning several subjects has no single subject, so the per-subject
-- columns stop being authoritative. exams.subject is kept, nullable, as a
-- legacy display label for the single-subject rows that predate this change;
-- exam_subjects is the authority from here.
-- ---------------------------------------------------------------------

ALTER TABLE public.exams ALTER COLUMN subject DROP NOT NULL;

COMMENT ON COLUMN public.exams.subject IS
  'LEGACY display label, nullable since Chunk 6.5. An exams row is now one SITTING (§10.22), which may span several subjects and therefore has no single subject. exam_subjects is the authority for which subjects a sitting covers. Never use this column to decide access or to resolve a subject — join exam_subjects -> section_subjects instead.';

COMMENT ON COLUMN public.exams.max_marks IS
  'One max mark ACROSS the sitting''s subjects (§10.22). Not per subject: exam_subjects deliberately has no max_marks.';


-- ---------------------------------------------------------------------
-- SECTION 6 — Drop the column. Not deprecated, not commented.
-- ---------------------------------------------------------------------

ALTER TABLE public.exams DROP COLUMN IF EXISTS exam_group_id;


-- ---------------------------------------------------------------------
-- SECTION 7 — G12 role dispatch on teacher-on-marks.
--
-- can_upload_exam_marks evaluated has_role(admin) and then
-- teacher_teaches_class as OR arms, so every caller paid the teacher path.
-- Measured at 14ms/row: fine at the demo's 26 rows, ~2.8s at 200, and exactly
-- the shape the parent panel had before it became a 500. Dispatch on the role
-- first so only the matching arm is evaluated.
--
-- G12/G11: has_role(uid,'admin') is NOT the same predicate as
-- active_membership_role() = 'admin'. It carries a second arm — a super admin
-- holding an active grant. Dispatching on the membership role alone would
-- silently revoke super-admin upload, since a super admin acting inside a
-- granted institution has no membership row of their own. That arm is restated
-- here rather than left to the sibling "marks admin all" policy to carry, so
-- this helper states every guarantee it depends on. Both restated calls take
-- no arguments and are constant per statement; the per-row cost that dispatch
-- removes is teacher_teaches_class.
--
-- Principal is absent deliberately, and was before: oversight, not editor —
-- the same call as attendance and homework_submissions.
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.can_upload_exam_marks(_exam_subject_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
  SELECT EXISTS (
    SELECT 1
      FROM public.exam_subjects es
      JOIN public.exams e             ON e.id = es.exam_id
      JOIN public.section_subjects ss ON ss.id = es.section_subject_id
     WHERE es.id = _exam_subject_id
       AND public.same_school(es.school_id)
       AND (
         CASE public.active_membership_role()
           WHEN 'admin'   THEN true
           WHEN 'teacher' THEN NOT e.marks_locked
                               AND public.teacher_teaches_class(auth.uid(), ss.section_id)
           ELSE false
         END
         OR (public.is_super_admin() AND public.super_admin_has_any_access())
       )
  )
$fn$;

COMMENT ON FUNCTION public.can_upload_exam_marks(uuid) IS
  'Who may write a mark for one subject of one sitting. Dispatches on the active membership role (G12) so the per-row teacher_teaches_class lookup is paid only by teachers. Restates has_role()''s super-admin arm explicitly. Reads e.marks_locked, which is what makes finalising a sitting close every one of its subjects at once.';


-- ---------------------------------------------------------------------
-- SECTION 8 — Assert the post-state.
-- ---------------------------------------------------------------------

DO $chunk65_post$
DECLARE
  _n bigint;
BEGIN
  SELECT count(*) INTO _n
    FROM information_schema.columns
   WHERE table_schema = 'public' AND column_name = 'exam_group_id';
  IF _n > 0 THEN
    RAISE EXCEPTION 'Chunk 6.5: exam_group_id still exists on % column(s).', _n;
  END IF;

  -- prokind 'f'/'p' only: pg_get_functiondef() raises on aggregates and
  -- window functions, and public holds at least one custom aggregate.
  SELECT count(*) INTO _n
    FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
   WHERE ns.nspname = 'public'
     AND p.prokind IN ('f', 'p')
     AND p.prosrc ILIKE '%exam_group_id%';
  IF _n > 0 THEN
    RAISE EXCEPTION 'Chunk 6.5: % function(s) still reference exam_group_id.', _n;
  END IF;

  SELECT count(*) INTO _n FROM public.marks WHERE exam_subject_id IS NULL;
  IF _n > 0 THEN
    RAISE EXCEPTION 'Chunk 6.5: % marks rows have a NULL exam_subject_id.', _n;
  END IF;
END
$chunk65_post$;
