-- ═══════════════════════════════════════════════════════════════════════════
-- CHUNK 7.5a — the schema the Tests feature actually needs
--
-- 7.5 is written as a repoint: move testService's query sites from `dpps` onto
-- `tests` / `test_marks`. The schemas make it a rebuild, and that has to be
-- said plainly before any of it is built:
--
--   tests       (13 cols)  section_subject_id, topic, date, max_mark, status
--   test_marks  (7 cols)   test_id, student_id, mark      <- ONE MARK per student
--
--   dpps            (28 cols)  duration_sec, negative_marking, passing_marks,
--                              is_published, scheduled_publish_at, ...
--   dpp_questions              question, options, correct, marks, explanation
--                              stored INLINE, not linked to question_bank
--   dpp_attempts               started_at, submitted_at, score, status
--   dpp_answers                response, is_correct, marks_awarded, time_ms
--
-- test_marks stores a mark. There is nowhere to put a test's questions, no
-- attempt to resume, and no per-question answers — and a test cannot be scored
-- without those existing at least while the session is open. Converging as
-- literally written would delete the ability to take a test in the app.
--
-- Ruled: add test_questions + test_attempts, with per-question answers held
-- transiently and purged at submit. So this migration adds the three tables
-- the live feature needs, and 7.5b repoints the client onto them before 7.5c
-- removes anything.
--
-- ── §10.8, applied ────────────────────────────────────────────────────────
--
-- A test is teacher-set and a mark is the point, so it is SCHOOL DATA: the
-- mark in test_marks is durable and per-question correctness is legitimately
-- recordable for it. But the transient rule still buys something real here,
-- and 7.5's own verification asks for it (item 3): the per-question answers
-- are working state needed to grade, and are purged once the session closes.
-- What survives is the mark, plus the WRONG answers in student_mistakes. That
-- is the same shape batch 2c gave battles, for a different reason — there
-- because practice is private, here because nothing needs it after grading.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 1. tests gains the states and config a takeable test needs ────────────
-- status was draft|submitted, which are the Chunk 6 marks-entry states. A
-- student can only take a test that has been PUBLISHED to them, and there was
-- no such state. 'submitted' keeps its meaning (marks are in).
ALTER TABLE public.tests DROP CONSTRAINT IF EXISTS tests_status_check;
ALTER TABLE public.tests
  ADD CONSTRAINT tests_status_check
  CHECK (status = ANY (ARRAY['draft', 'published', 'submitted']));

ALTER TABLE public.tests
  ADD COLUMN IF NOT EXISTS duration_sec  integer CHECK (duration_sec IS NULL OR duration_sec > 0),
  ADD COLUMN IF NOT EXISTS passing_marks numeric CHECK (passing_marks IS NULL OR passing_marks >= 0),
  ADD COLUMN IF NOT EXISTS published_at  timestamptz;

-- Nullable, all three. G4: a test with no time limit is not a test with a
-- limit of zero, and a test with no pass threshold is not one you pass at 0.
-- The client must render "no limit" from NULL rather than from a sentinel.

-- ── 2. test_questions — teacher-authored, stored inline ───────────────────
-- Inline rather than a link into question_bank, because that is what the live
-- feature does: dpp_questions carries the text, options and answer itself and
-- has no FK to the bank. Teachers author these; they do not pick from a bank.
--
-- chapter_id is the keyed form (7A); chapter text is kept alongside it during
-- the transition, the same way the rest of the schema still carries both.
CREATE TABLE IF NOT EXISTS public.test_questions (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  test_id      uuid NOT NULL REFERENCES public.tests(id) ON DELETE CASCADE,
  school_id    uuid NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  order_index  integer NOT NULL,
  question     text NOT NULL,
  options      jsonb,
  correct      jsonb,
  marks        numeric NOT NULL DEFAULT 1 CHECK (marks > 0),
  explanation  text,
  chapter_id   uuid REFERENCES public.chapters(id) ON DELETE SET NULL,
  chapter      text,
  concept      text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT test_questions_order_unique UNIQUE (test_id, order_index)
);

-- ── 3. test_attempts — one per student per test ───────────────────────────
CREATE TABLE IF NOT EXISTS public.test_attempts (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  test_id        uuid NOT NULL REFERENCES public.tests(id) ON DELETE CASCADE,
  student_id     uuid REFERENCES public.students(id) ON DELETE CASCADE,
  user_id        uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  school_id      uuid NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  started_at     timestamptz NOT NULL DEFAULT now(),
  submitted_at   timestamptz,
  score          numeric NOT NULL DEFAULT 0 CHECK (score >= 0),
  max_score      numeric NOT NULL DEFAULT 0 CHECK (max_score >= 0),
  correct_count  integer NOT NULL DEFAULT 0 CHECK (correct_count >= 0),
  total_count    integer NOT NULL DEFAULT 0 CHECK (total_count >= 0),
  time_spent_sec integer,
  status         text NOT NULL DEFAULT 'in_progress'
                 CHECK (status = ANY (ARRAY['in_progress', 'submitted'])),
  CONSTRAINT test_attempts_one_per_student UNIQUE (test_id, user_id)
);

-- ── 4. test_answers — WORKING STATE, purged at submit ─────────────────────
-- Deliberately not a durable record. rpc_test_submit grades from these rows,
-- writes the mark to test_marks, sends the wrong ones to student_mistakes, and
-- then deletes them. The table exists so a student can answer question 3, go
-- back to question 1, and resume after a dropped connection.
CREATE TABLE IF NOT EXISTS public.test_answers (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  attempt_id    uuid NOT NULL REFERENCES public.test_attempts(id) ON DELETE CASCADE,
  question_id   uuid NOT NULL REFERENCES public.test_questions(id) ON DELETE CASCADE,
  school_id     uuid NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  response      jsonb,
  is_correct    boolean,
  marks_awarded numeric,
  time_ms       integer,
  created_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT test_answers_unique UNIQUE (attempt_id, question_id)
);

CREATE INDEX IF NOT EXISTS test_questions_test_idx ON public.test_questions (test_id);
CREATE INDEX IF NOT EXISTS test_attempts_user_idx  ON public.test_attempts (user_id);
CREATE INDEX IF NOT EXISTS test_answers_attempt_idx ON public.test_answers (attempt_id);

-- ── 5. student_mistakes.chapter_id ────────────────────────────────────────
-- 7.5 verification item 2 requires wrong answers to land with chapter_id set.
-- The table carries `chapter` as TEXT only, which is the chapter-text-versus-
-- chapter_id debt 7A opened and left for 7B/7C to repoint as they rebuild.
-- A test question knows its chapter_id, so this is where the keyed form starts
-- being written. The text column stays for now: every existing reader uses it,
-- and dropping it here would be a second convergence inside this one.
ALTER TABLE public.student_mistakes
  ADD COLUMN IF NOT EXISTS chapter_id uuid REFERENCES public.chapters(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS student_mistakes_chapter_idx ON public.student_mistakes (chapter_id);

-- ── 6. RLS — the 6.6/6.7 pattern, born correct ────────────────────────────
-- school_id is NOT NULL on all three, so no fence carries an `IS NULL` arm.
ALTER TABLE public.test_questions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.test_attempts  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.test_answers   ENABLE ROW LEVEL SECURITY;

DO $rls$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['test_questions', 'test_attempts', 'test_answers'] LOOP
    EXECUTE format(
      'CREATE POLICY %I ON public.%I AS RESTRICTIVE FOR ALL TO anon, authenticated
         USING      (school_id IN (SELECT public.my_accessible_school_ids()))
         WITH CHECK (school_id IN (SELECT public.my_accessible_school_ids()))',
      t || '_tenant_fence', t);
  END LOOP;
END $rls$;

-- Questions are readable by anyone in the institution who can see the test.
-- They are school data, not practice: a test is teacher-set and the mark is
-- the point, so the practice fence does not apply. `correct` is NOT excluded
-- at the policy level -- see the note in 7.5b's RPC work, where the student
-- read path goes through a definer that withholds it.
CREATE POLICY test_questions_read ON public.test_questions
  FOR SELECT TO authenticated
  USING (school_id IN (SELECT public.my_accessible_school_ids()));

CREATE POLICY test_questions_write ON public.test_questions
  FOR ALL TO authenticated
  USING      ((SELECT public.is_principal_or_admin(auth.uid()))
              OR EXISTS (SELECT 1 FROM public.tests t WHERE t.id = test_id AND t.created_by = (SELECT auth.uid())))
  WITH CHECK ((SELECT public.is_principal_or_admin(auth.uid()))
              OR EXISTS (SELECT 1 FROM public.tests t WHERE t.id = test_id AND t.created_by = (SELECT auth.uid())));

-- An attempt is the student's own. Staff see attempts for tests they own,
-- because a teacher marking a test must see who sat it.
CREATE POLICY test_attempts_self ON public.test_attempts
  FOR ALL TO authenticated
  USING      (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()));

CREATE POLICY test_attempts_staff_read ON public.test_attempts
  FOR SELECT TO authenticated
  USING (
    (SELECT public.is_principal_or_admin(auth.uid()))
    OR EXISTS (SELECT 1 FROM public.tests t WHERE t.id = test_id AND t.created_by = (SELECT auth.uid()))
  );

-- Answers are the student's own working state and nobody else's, staff
-- included: they exist only until the mark is written.
CREATE POLICY test_answers_self ON public.test_answers
  FOR ALL TO authenticated
  USING      (EXISTS (SELECT 1 FROM public.test_attempts a
                       WHERE a.id = attempt_id AND a.user_id = (SELECT auth.uid())))
  WITH CHECK (EXISTS (SELECT 1 FROM public.test_attempts a
                       WHERE a.id = attempt_id AND a.user_id = (SELECT auth.uid())));

COMMIT;
