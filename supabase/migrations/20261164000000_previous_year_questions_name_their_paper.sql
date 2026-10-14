-- ═══════════════════════════════════════════════════════════════════════════
-- PREVIOUS-YEAR QUESTIONS NAME THEIR PAPER
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Owner, 2026-10-14: the CUET previous-year questions they gathered
-- (Mathematics, Accountancy, Economics, Business Studies) go into the bank,
-- each classified, explained, and shown with the paper it was set in.
--
-- The app already knows what a previous-year question is: one that names its
-- exam_year (practiceService.studentBankQuery; the Previous Year Questions
-- screen lists the years the bank holds). It had none: 0 rows carried a year.
-- Two things were missing for these:
--
--   1. A source_type that says what they are. None of the six fits: they are
--      not NCERT-aligned, licensed, AI-written or a teacher's. Now
--      'previous_year'.
--   2. The paper, as a student reads it, on the question: "CUET (UG) 2023 ·
--      30 May · Shift 3 · Section A". It lives in `source`, which the student
--      view already serves. The year is then said twice, in exam_year (what a
--      student filters on) and in the label (what a student reads), so one rule
--      holds them together: a previous-year question has a year, and the first
--      year its label names is that year. A label that drifted from its year,
--      or a year with no label, is refused.
--
-- question_bank is 273 MB. Both constraints are added NOT VALID (no scan under
-- the exclusive lock) and then validated, which scans without blocking reads
-- or writes. No previous_year row exists before this, so validation cannot
-- fail on data.
--
-- ROLLBACK: rollback/20261164000000_previous_year_questions_name_their_paper.rollback.sql
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

SET LOCAL lock_timeout = '3s';

ALTER TABLE public.question_bank DROP CONSTRAINT question_bank_source_type_check;
ALTER TABLE public.question_bank ADD CONSTRAINT question_bank_source_type_check
  CHECK (source_type IS NULL OR source_type = ANY (ARRAY[
    'ncert_aligned', 'ncert_exemplar_aligned', 'teacher', 'ai_generated',
    'licensed_import', 'legacy', 'previous_year'
  ]::text[])) NOT VALID;

ALTER TABLE public.question_bank ADD CONSTRAINT question_bank_previous_year_names_its_paper
  CHECK (
    source_type IS DISTINCT FROM 'previous_year'
    -- coalesce: a label with no year in it (or none at all) makes the
    -- comparison NULL, and a CHECK lets NULL through.
    OR coalesce(substring(source FROM '\d{4}') = exam_year::text, false)
  ) NOT VALID;

COMMENT ON CONSTRAINT question_bank_previous_year_names_its_paper ON public.question_bank IS
  'A previous-year question has its exam_year, and the first year its source label names is that year (20261164000000).';

ALTER TABLE public.question_bank VALIDATE CONSTRAINT question_bank_source_type_check;
ALTER TABLE public.question_bank VALIDATE CONSTRAINT question_bank_previous_year_names_its_paper;

-- ── Proof ──────────────────────────────────────────────────────────────────
-- Each case writes a row and undoes it (P0099), so nothing is left behind.
-- The accepted case is the control: without it, a constraint that refused
-- every previous-year row would pass the refusals.
DO $proof$
DECLARE
  _outcome text;
  _case record;
BEGIN
  FOR _case IN
    SELECT * FROM (VALUES
      ('accepted', 2023, 'CUET (UG) 2023 · 30 May · Shift 3 · Section A'),
      ('accepted', 2023, 'CUET (UG) 2023 · 30 May · Shift 3 (also 2025 · 24 May · Shift 1)'),
      ('refused',  NULL, 'CUET (UG) 2023 · 30 May · Shift 3'),
      ('refused',  2024, 'CUET (UG) 2023 · 30 May · Shift 3'),
      ('refused',  2023, NULL),
      ('refused',  2023, 'CUET (UG) · 30 May')
    ) AS c(expect, yr, label)
  LOOP
    BEGIN
      INSERT INTO public.question_bank (subject, question, options, correct_index, source_type, exam_year, source, is_active, is_approved)
      VALUES ('Accountancy', 'proof row', '["one","two"]'::jsonb, 0, 'previous_year', _case.yr, _case.label, false, false);
      _outcome := 'accepted';
      RAISE EXCEPTION USING ERRCODE = 'P0099';
    EXCEPTION
      WHEN check_violation THEN _outcome := 'refused';
      WHEN SQLSTATE 'P0099' THEN NULL;
    END;
    IF _outcome IS DISTINCT FROM _case.expect THEN
      RAISE EXCEPTION 'proof: year % label "%" was %, expected %', _case.yr, _case.label, _outcome, _case.expect;
    END IF;
  END LOOP;

  -- An unknown source_type is still refused.
  BEGIN
    INSERT INTO public.question_bank (subject, question, options, correct_index, source_type, is_active, is_approved)
    VALUES ('Accountancy', 'proof row', '["one","two"]'::jsonb, 0, 'scraped', false, false);
    RAISE EXCEPTION 'proof: source_type ''scraped'' was accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
END $proof$;

COMMIT;
