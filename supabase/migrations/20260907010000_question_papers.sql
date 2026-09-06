-- ═══════════════════════════════════════════════════════════════════════════
-- The teacher question paper: blueprint, sections, and the questions in them
--
-- Three tables. None of them existed; there is no `question_paper` /
-- `blueprint` table anywhere in the live schema, checked before writing this.
--
-- WHAT ALREADY EXISTED AND IS NOT THIS. `_shared/questionPaperPlan.ts` (and its
-- mirror in `src/academic/ai/`) is a PLANNER: `dry_run: true`,
-- `generates_questions: false`. It allocates marks across chapters and stops.
-- It is reached only through `aiRouter.ts` -> `ai-gateway`, which is frozen, so
-- it is neither revived nor extended here. This feature produces actual
-- questions and stores them.
--
-- TENANCY. Unlike `question_bank` — which §10.9 makes "centralised and shared
-- across all schools" and which therefore has no `school_id` — A PAPER IS
-- SCHOOL DATA. Every table here carries `school_id` and the house RESTRICTIVE
-- fence (`school_id IN (SELECT my_accessible_school_ids())`, ALL, anon+
-- authenticated), copied from `test_questions`. The permissive layer is
-- owner-or-admin, also copied from there.
--
-- WHY QUESTIONS ARE DENORMALISED. `question_paper_questions` stores the
-- question text, options and answer rather than only pointing at
-- `question_bank`. A generated question IS written back to the bank, but the
-- author fence (20260906030000) lets its author delete it, and a paper that
-- silently loses questions when the bank changes is not a paper. `bank_id` is
-- kept alongside, ON DELETE SET NULL, for provenance only.
--
-- MARKS. Section-level `marks_per_question` with a per-question `marks`
-- override that is NULL when not overridden. The paper's total is COMPUTED from
-- these, never stored, so it cannot drift from the questions it is the sum of.
--
-- PROVENANCE. `origin` is 'retrieved' or 'generated' and is NOT NULL — every
-- question says where it came from, with no default, so it cannot be forgotten.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── the paper ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.question_papers (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id        uuid NOT NULL REFERENCES public.schools(id) ON DELETE RESTRICT,
  created_by       uuid NOT NULL,
  title            text NOT NULL,
  subject          text NOT NULL,
  class_level      integer,
  board            text,
  duration_minutes integer,
  status           text NOT NULL DEFAULT 'draft',
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT question_papers_status_check
    CHECK (status IN ('draft','final')),
  CONSTRAINT question_papers_class_level_check
    CHECK (class_level IS NULL OR (class_level >= 6 AND class_level <= 12)),
  CONSTRAINT question_papers_board_check
    CHECK (board IS NULL OR board IN ('rbse','cbse','both'))
);

-- ── the blueprint: one row per section, written BEFORE any question ───────
-- `target_count` is what the teacher asked for. The number of rows actually in
-- the section may be lower, and the difference is the shortfall the teacher is
-- shown -- so the ask has to survive as data, not be inferred from what arrived.
CREATE TABLE IF NOT EXISTS public.question_paper_sections (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  paper_id           uuid NOT NULL REFERENCES public.question_papers(id) ON DELETE CASCADE,
  school_id          uuid NOT NULL REFERENCES public.schools(id) ON DELETE RESTRICT,
  order_index        integer NOT NULL,
  title              text NOT NULL,
  question_format    text NOT NULL,
  marks_per_question numeric NOT NULL,
  target_count       integer NOT NULL,
  difficulty         text,
  chapters           text[] NOT NULL DEFAULT '{}',
  created_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT qps_format_check
    CHECK (question_format IN ('mcq','short','long')),
  CONSTRAINT qps_marks_positive       CHECK (marks_per_question > 0),
  CONSTRAINT qps_target_count_positive CHECK (target_count > 0),
  CONSTRAINT qps_difficulty_check
    CHECK (difficulty IS NULL OR difficulty IN ('easy','medium','hard')),
  UNIQUE (paper_id, order_index)
);

-- ── the questions ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.question_paper_questions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  paper_id      uuid NOT NULL REFERENCES public.question_papers(id) ON DELETE CASCADE,
  section_id    uuid NOT NULL REFERENCES public.question_paper_sections(id) ON DELETE CASCADE,
  school_id     uuid NOT NULL REFERENCES public.schools(id) ON DELETE RESTRICT,
  order_index   integer NOT NULL,
  -- provenance, required
  origin        text NOT NULL,
  bank_id       uuid REFERENCES public.question_bank(id) ON DELETE SET NULL,
  -- the question itself, denormalised on purpose
  question      text NOT NULL,
  options       jsonb,
  correct_index integer,
  answer        text,
  explanation   text,
  chapter       text,
  -- NULL means "use the section's marks_per_question"
  marks         numeric,
  created_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT qpq_origin_check CHECK (origin IN ('retrieved','generated')),
  CONSTRAINT qpq_marks_positive CHECK (marks IS NULL OR marks > 0),
  -- An MCQ needs options and an index; a written answer needs answer text.
  -- This is what stops an answerless question being stored at all.
  CONSTRAINT qpq_answer_shape CHECK (
    (options IS NOT NULL AND correct_index IS NOT NULL)
    OR (answer IS NOT NULL AND length(btrim(answer)) > 0)
  ),
  UNIQUE (section_id, order_index)
);

CREATE INDEX IF NOT EXISTS question_papers_school_creator_idx
  ON public.question_papers (school_id, created_by, created_at DESC);
CREATE INDEX IF NOT EXISTS qps_paper_idx ON public.question_paper_sections (paper_id, order_index);
CREATE INDEX IF NOT EXISTS qpq_paper_idx ON public.question_paper_questions (paper_id, order_index);
CREATE INDEX IF NOT EXISTS qpq_section_idx ON public.question_paper_questions (section_id, order_index);

-- ── RLS: house pattern, copied from test_questions ────────────────────────
ALTER TABLE public.question_papers          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.question_paper_sections  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.question_paper_questions ENABLE ROW LEVEL SECURITY;

-- RESTRICTIVE tenancy fence first: nothing below can widen past the school.
CREATE POLICY question_papers_tenant_fence ON public.question_papers
  AS RESTRICTIVE FOR ALL TO anon, authenticated
  USING (school_id IN (SELECT public.my_accessible_school_ids()))
  WITH CHECK (school_id IN (SELECT public.my_accessible_school_ids()));

CREATE POLICY qps_tenant_fence ON public.question_paper_sections
  AS RESTRICTIVE FOR ALL TO anon, authenticated
  USING (school_id IN (SELECT public.my_accessible_school_ids()))
  WITH CHECK (school_id IN (SELECT public.my_accessible_school_ids()));

CREATE POLICY qpq_tenant_fence ON public.question_paper_questions
  AS RESTRICTIVE FOR ALL TO anon, authenticated
  USING (school_id IN (SELECT public.my_accessible_school_ids()))
  WITH CHECK (school_id IN (SELECT public.my_accessible_school_ids()));

-- A paper belongs to the teacher who wrote it. Principals and admins see and
-- manage their school's papers, matching test_questions' own staff rule.
CREATE POLICY question_papers_owner ON public.question_papers
  FOR ALL TO authenticated
  USING (
    (SELECT public.is_principal_or_admin(auth.uid()))
    OR created_by = (SELECT auth.uid())
  )
  WITH CHECK (
    (SELECT public.is_principal_or_admin(auth.uid()))
    OR created_by = (SELECT auth.uid())
  );

CREATE POLICY qps_owner ON public.question_paper_sections
  FOR ALL TO authenticated
  USING (
    (SELECT public.is_principal_or_admin(auth.uid()))
    OR EXISTS (SELECT 1 FROM public.question_papers p
                WHERE p.id = question_paper_sections.paper_id
                  AND p.created_by = (SELECT auth.uid()))
  )
  WITH CHECK (
    (SELECT public.is_principal_or_admin(auth.uid()))
    OR EXISTS (SELECT 1 FROM public.question_papers p
                WHERE p.id = question_paper_sections.paper_id
                  AND p.created_by = (SELECT auth.uid()))
  );

CREATE POLICY qpq_owner ON public.question_paper_questions
  FOR ALL TO authenticated
  USING (
    (SELECT public.is_principal_or_admin(auth.uid()))
    OR EXISTS (SELECT 1 FROM public.question_papers p
                WHERE p.id = question_paper_questions.paper_id
                  AND p.created_by = (SELECT auth.uid()))
  )
  WITH CHECK (
    (SELECT public.is_principal_or_admin(auth.uid()))
    OR EXISTS (SELECT 1 FROM public.question_papers p
                WHERE p.id = question_paper_questions.paper_id
                  AND p.created_by = (SELECT auth.uid()))
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON public.question_papers          TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.question_paper_sections  TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.question_paper_questions TO authenticated;

COMMENT ON TABLE public.question_papers IS
  'A teacher-authored question paper. School data (unlike question_bank, which '
  'is cross-school by §10.9), fenced by school and owned by its creator.';
COMMENT ON COLUMN public.question_paper_questions.origin IS
  'retrieved (from question_bank) or generated. NOT NULL and no default: every '
  'question states its provenance.';
COMMENT ON COLUMN public.question_paper_questions.marks IS
  'Per-question override. NULL means use the section marks_per_question. The '
  'paper total is computed from these and never stored.';

COMMIT;
