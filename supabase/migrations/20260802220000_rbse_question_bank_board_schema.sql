-- ============================================================================
-- Phase 0: RBSE board model + question_bank taxonomy columns
-- Scope: schools.board; question_bank board/source_type/exam_year/concept/school_id/
--        stream/question_format; indexes; student-visible RLS (never super_admin)
-- ============================================================================

-- ── 1. schools.board ─────────────────────────────────────────────────────────
ALTER TABLE public.schools
  ADD COLUMN IF NOT EXISTS board text DEFAULT 'rbse';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'schools_board_check'
      AND conrelid = 'public.schools'::regclass
  ) THEN
    ALTER TABLE public.schools
      ADD CONSTRAINT schools_board_check
      CHECK (board IS NULL OR board IN ('rbse', 'cbse', 'icse', 'other', 'both'));
  END IF;
END $$;

UPDATE public.schools
SET board = coalesce(nullif(trim(board), ''), 'rbse')
WHERE board IS NULL OR trim(board) = '';

-- Wisdom Campus / default demo tenant
UPDATE public.schools
SET board = 'rbse', updated_at = now()
WHERE id = '00000000-0000-4000-8000-000000000001'
   OR lower(coalesce(slug, '')) = 'wisdom-campus'
   OR lower(coalesce(name, '')) LIKE '%wisdom campus%';

-- ── 2. question_bank taxonomy columns ────────────────────────────────────────
ALTER TABLE public.question_bank
  ADD COLUMN IF NOT EXISTS board text DEFAULT 'both',
  ADD COLUMN IF NOT EXISTS source_type text,
  ADD COLUMN IF NOT EXISTS exam_year int,
  ADD COLUMN IF NOT EXISTS school_id uuid REFERENCES public.schools(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS stream text,
  ADD COLUMN IF NOT EXISTS question_format text DEFAULT 'mcq';

-- concept already exists from concept_mastery migration; keep ADD IF NOT EXISTS for safety
ALTER TABLE public.question_bank
  ADD COLUMN IF NOT EXISTS concept text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'question_bank_board_check'
      AND conrelid = 'public.question_bank'::regclass
  ) THEN
    ALTER TABLE public.question_bank
      ADD CONSTRAINT question_bank_board_check
      CHECK (board IS NULL OR board IN ('rbse', 'cbse', 'both'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'question_bank_source_type_check'
      AND conrelid = 'public.question_bank'::regclass
  ) THEN
    ALTER TABLE public.question_bank
      ADD CONSTRAINT question_bank_source_type_check
      CHECK (
        source_type IS NULL OR source_type IN (
          'ncert_aligned',
          'ncert_exemplar_aligned',
          'teacher',
          'ai_generated',
          'licensed_import',
          'legacy'
        )
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'question_bank_question_format_check'
      AND conrelid = 'public.question_bank'::regclass
  ) THEN
    ALTER TABLE public.question_bank
      ADD CONSTRAINT question_bank_question_format_check
      CHECK (
        question_format IS NULL OR question_format IN (
          'mcq', 'short', 'long', 'numerical', 'assertion_reason', 'case_based', 'concept'
        )
      );
  END IF;
END $$;

-- Legacy rows: treat null board as visible to all boards
UPDATE public.question_bank
SET board = coalesce(board, 'both'),
    question_format = coalesce(question_format, 'mcq'),
    source_type = coalesce(source_type, CASE WHEN source LIKE 'seed%' THEN 'legacy' ELSE source_type END)
WHERE board IS NULL OR question_format IS NULL OR (source_type IS NULL AND source LIKE 'seed%');

-- ── 3. Indexes ───────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_qb_board_subject_class
  ON public.question_bank (board, subject, class_level)
  WHERE is_approved;

CREATE INDEX IF NOT EXISTS idx_qb_school_board
  ON public.question_bank (school_id, board)
  WHERE is_approved;

CREATE INDEX IF NOT EXISTS idx_qb_stream_subject
  ON public.question_bank (stream, subject, class_level)
  WHERE is_approved AND stream IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_qb_source_type
  ON public.question_bank (source_type)
  WHERE source_type IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_schools_board
  ON public.schools (board);

-- ── 4. RLS — students see approved platform or same-school items matching board ─
-- Never grant via super_admin. School operators: admin | principal | teacher.

DROP POLICY IF EXISTS "qb read auth" ON public.question_bank;
DROP POLICY IF EXISTS qb_select_approved_board ON public.question_bank;
DROP POLICY IF EXISTS "qb teacher insert" ON public.question_bank;
DROP POLICY IF EXISTS qb_teacher_insert ON public.question_bank;
DROP POLICY IF EXISTS "qb admin manage" ON public.question_bank;
DROP POLICY IF EXISTS qb_staff_manage ON public.question_bank;

CREATE POLICY qb_select_approved_board ON public.question_bank
  FOR SELECT TO authenticated
  USING (
    is_approved = true
    AND (school_id IS NULL OR school_id = public.get_my_school_id())
    AND (
      board IS NULL
      OR board = 'both'
      OR board = coalesce(
        (SELECT s.board FROM public.schools s WHERE s.id = public.get_my_school_id()),
        'rbse'
      )
    )
  );

CREATE POLICY qb_teacher_insert ON public.question_bank
  FOR INSERT TO authenticated
  WITH CHECK (
    (
      public.has_role(auth.uid(), 'teacher')
      OR public.has_role(auth.uid(), 'admin')
      OR public.has_role(auth.uid(), 'principal')
    )
    AND (school_id IS NULL OR school_id = public.get_my_school_id())
  );

CREATE POLICY qb_staff_manage ON public.question_bank
  FOR ALL TO authenticated
  USING (
    (
      public.has_role(auth.uid(), 'admin')
      OR public.has_role(auth.uid(), 'principal')
      OR public.has_role(auth.uid(), 'teacher')
    )
    AND (school_id IS NULL OR school_id = public.get_my_school_id())
  )
  WITH CHECK (
    (
      public.has_role(auth.uid(), 'admin')
      OR public.has_role(auth.uid(), 'principal')
      OR public.has_role(auth.uid(), 'teacher')
    )
    AND (school_id IS NULL OR school_id = public.get_my_school_id())
  );

NOTIFY pgrst, 'reload schema';
