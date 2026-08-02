-- ============================================================================
-- Academic taxonomy registry + concept slug normalization
-- Companion: src/academic/taxonomy (SSOT presentation via presentAcademicLabel)
-- Mojibake chapter cleanup: see 20260802260000_fix_academic_display_text.sql
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.academic_taxonomy_terms (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL
    CHECK (kind IN (
      'board', 'class_level', 'subject', 'chapter', 'topic', 'concept', 'question_type'
    )),
  term_id text NOT NULL,
  display_name text NOT NULL,
  aliases jsonb NOT NULL DEFAULT '[]'::jsonb,
  board text NULL,
  class_level int NULL,
  subject text NULL,
  parent_term_id text NULL,
  description text NULL,
  keywords jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (kind, term_id)
);

CREATE INDEX IF NOT EXISTS academic_taxonomy_terms_kind_idx
  ON public.academic_taxonomy_terms (kind);
CREATE INDEX IF NOT EXISTS academic_taxonomy_terms_subject_idx
  ON public.academic_taxonomy_terms (subject)
  WHERE subject IS NOT NULL;
CREATE INDEX IF NOT EXISTS academic_taxonomy_terms_aliases_gin
  ON public.academic_taxonomy_terms USING gin (aliases);

ALTER TABLE public.academic_taxonomy_terms ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS academic_taxonomy_terms_select_authenticated
  ON public.academic_taxonomy_terms;
CREATE POLICY academic_taxonomy_terms_select_authenticated
  ON public.academic_taxonomy_terms
  FOR SELECT TO authenticated
  USING (true);

-- School operators may upsert taxonomy terms (never super_admin-only)
DROP POLICY IF EXISTS academic_taxonomy_terms_write_operators
  ON public.academic_taxonomy_terms;
CREATE POLICY academic_taxonomy_terms_write_operators
  ON public.academic_taxonomy_terms
  FOR ALL TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin')
    OR public.has_role(auth.uid(), 'principal')
    OR public.has_role(auth.uid(), 'teacher')
  )
  WITH CHECK (
    public.has_role(auth.uid(), 'admin')
    OR public.has_role(auth.uid(), 'principal')
    OR public.has_role(auth.uid(), 'teacher')
  );

-- Seed high-value commerce concept display names (idempotent)
INSERT INTO public.academic_taxonomy_terms
  (kind, term_id, display_name, aliases, board, subject)
VALUES
  ('concept', 'cash_book', 'Cash Book', '["cash book","cashbook"]'::jsonb, 'rbse', 'Accountancy'),
  ('concept', 'brs_purpose', 'Purpose of Bank Reconciliation Statement', '["brs purpose","purpose of brs"]'::jsonb, 'rbse', 'Accountancy'),
  ('concept', 'bank_reconciliation_statement', 'Bank Reconciliation Statement', '["BRS","brs","bank reconciliation"]'::jsonb, 'rbse', 'Accountancy'),
  ('concept', 'double_entry', 'Double Entry System', '["double entry","double-entry"]'::jsonb, 'rbse', 'Accountancy'),
  ('concept', 'journal_proper', 'Journal Proper', '["proper journal"]'::jsonb, 'rbse', 'Accountancy'),
  ('concept', 'accounting_equation', 'Accounting Equation', '[]'::jsonb, 'rbse', 'Accountancy'),
  ('concept', 'bookkeeping_vs_accounting', 'Bookkeeping vs Accounting', '[]'::jsonb, 'rbse', 'Accountancy'),
  ('concept', 'adjustments_bs', 'Adjustments in the Balance Sheet', '["adjustments bs"]'::jsonb, 'rbse', 'Accountancy'),
  ('concept', 'trial_balance', 'Trial Balance', '[]'::jsonb, 'rbse', 'Accountancy'),
  ('concept', 'trading_account', 'Trading Account', '[]'::jsonb, 'rbse', 'Accountancy'),
  ('concept', 'pl_account', 'Profit and Loss Account', '["p&l","profit and loss"]'::jsonb, 'rbse', 'Accountancy'),
  ('concept', 'balance_sheet', 'Balance Sheet', '[]'::jsonb, 'rbse', 'Accountancy'),
  ('subject', 'accountancy', 'Accountancy', '["accounts","accounting"]'::jsonb, 'rbse', NULL),
  ('subject', 'business_studies', 'Business Studies', '["bst"]'::jsonb, 'rbse', NULL),
  ('subject', 'economics', 'Economics', '["eco"]'::jsonb, 'rbse', NULL),
  ('subject', 'mathematics', 'Mathematics', '["maths","math"]'::jsonb, 'rbse', NULL),
  ('subject', 'english', 'English', '[]'::jsonb, 'rbse', NULL),
  ('subject', 'hindi', 'Hindi', '[]'::jsonb, 'rbse', NULL),
  ('subject', 'physics', 'Physics', '[]'::jsonb, 'rbse', NULL),
  ('subject', 'chemistry', 'Chemistry', '[]'::jsonb, 'rbse', NULL),
  ('subject', 'biology', 'Biology', '[]'::jsonb, 'rbse', NULL),
  ('chapter', 'bank_reconciliation_statement', 'Bank Reconciliation Statement', '["BRS","brs"]'::jsonb, 'rbse', 'Accountancy'),
  ('question_type', 'mcq', 'Multiple Choice', '["mcq"]'::jsonb, NULL, NULL),
  ('question_type', 'short', 'Short Answer', '[]'::jsonb, NULL, NULL),
  ('question_type', 'numerical', 'Numerical', '[]'::jsonb, NULL, NULL)
ON CONFLICT (kind, term_id) DO UPDATE
SET
  display_name = EXCLUDED.display_name,
  aliases = EXCLUDED.aliases,
  board = COALESCE(EXCLUDED.board, public.academic_taxonomy_terms.board),
  subject = COALESCE(EXCLUDED.subject, public.academic_taxonomy_terms.subject),
  updated_at = now();

-- Normalize concept / topic columns to slug ids where they look like Title Case duplicates of known slugs
-- (keep already-slug values; do not invent ids for free prose)
UPDATE public.question_bank qb
SET concept = lower(regexp_replace(regexp_replace(btrim(qb.concept), '[^a-zA-Z0-9]+', '_', 'g'), '^_|_$', '', 'g'))
WHERE qb.concept IS NOT NULL
  AND qb.concept ~ '[A-Z ]'
  AND qb.concept !~ '_'
  AND length(btrim(qb.concept)) BETWEEN 3 AND 64
  AND EXISTS (
    SELECT 1 FROM public.academic_taxonomy_terms t
    WHERE t.kind = 'concept'
      AND (
        t.term_id = lower(regexp_replace(regexp_replace(btrim(qb.concept), '[^a-zA-Z0-9]+', '_', 'g'), '^_|_$', '', 'g'))
        OR lower(t.display_name) = lower(btrim(qb.concept))
      )
  );

UPDATE public.question_bank qb
SET topic = lower(regexp_replace(regexp_replace(btrim(qb.topic), '[^a-zA-Z0-9]+', '_', 'g'), '^_|_$', '', 'g'))
WHERE qb.topic IS NOT NULL
  AND qb.topic ~ '[A-Z ]'
  AND qb.topic !~ '_'
  AND length(btrim(qb.topic)) BETWEEN 3 AND 64
  AND EXISTS (
    SELECT 1 FROM public.academic_taxonomy_terms t
    WHERE t.kind IN ('concept', 'topic')
      AND (
        t.term_id = lower(regexp_replace(regexp_replace(btrim(qb.topic), '[^a-zA-Z0-9]+', '_', 'g'), '^_|_$', '', 'g'))
        OR lower(t.display_name) = lower(btrim(qb.topic))
      )
  );

-- Re-apply mojibake chapter cleanup helper if present
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = '_fix_academic_display_text'
  ) THEN
    UPDATE public.question_bank
    SET chapter = public._fix_academic_display_text(chapter)
    WHERE chapter IS NOT NULL
      AND (chapter LIKE '%â€%' OR chapter LIKE '%Â%' OR chapter ~ '[‐‑‒–—―−]');
  END IF;
END $$;
