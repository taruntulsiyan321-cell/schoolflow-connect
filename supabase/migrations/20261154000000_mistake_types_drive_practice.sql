-- ═══════════════════════════════════════════════════════════════════════════
-- MISTAKE TYPES DRIVE PRACTICE (docs/TODO.md C5)
-- ═══════════════════════════════════════════════════════════════════════════
--
-- A student who marks their mistakes "Calculation error" should be able to
-- drill questions that are worked out to a figure; one who marks "Misread
-- the question" should drill statement-based and assertion–reason questions,
-- where reading is the whole question. The second is a filter the bank can
-- already make (question_format, 20261141000000). The first needs the bank
-- to know which questions are answered with a figure.
--
-- 1. public.answers_are_numbers(options) is true when every option is a
--    number or an amount — "₹ 40,000", "12.5%", "3 : 2", "(b) 1,20,000" —
--    and there are at least two. That is a question worked out to a figure.
--    It says nothing about a question whose figure is in the stem and whose
--    options are words, and it does not try to.
-- 2. question_bank_student, the view the app reads the bank through, carries
--    it at the end, computed from each row's options as it is read; nothing
--    else in the view changes. NOT a stored column: the bank is 273 MB, and
--    adding one rewrites the table under an exclusive lock that stops every
--    practice load while it runs (measured: the round trip of a stored
--    column outlasted the 100-second API limit). Computed in the view it
--    cannot drift from the options and costs a regular expression on the rows
--    a session already narrowed to.
--
-- Measured 2026-10-09 across active approved questions: Accountancy 287,
-- Economics 106, Mathematics 1,403, Business Studies 11, English 1.
--
-- ROLLBACK: rollback/20261154000000_mistake_types_drive_practice.rollback.sql
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 1. What a figure is ─────────────────────────────────────────────────────
CREATE FUNCTION public.answers_are_numbers(_options jsonb)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = pg_catalog
AS $fn$
  SELECT jsonb_typeof(_options) = 'array'
     AND jsonb_array_length(_options) >= 2
     AND NOT EXISTS (
       SELECT 1 FROM jsonb_array_elements_text(_options) AS o(v)
        WHERE v !~ '^\s*(\(?[A-Da-d][).]\s*)?(₹|Rs\.?|INR)?\s*-?[0-9][0-9,]*(\.[0-9]+)?\s*(%|lakhs?|crores?|times|:\s*[0-9]+(\.[0-9]+)?)?\s*$')
$fn$;

COMMENT ON FUNCTION public.answers_are_numbers(jsonb) IS
  'True when every option of a multiple-choice question is a number or an amount: a question worked out to a figure (20261154000000, C5).';

GRANT EXECUTE ON FUNCTION public.answers_are_numbers(jsonb) TO authenticated, service_role;

-- ── 2. The student's view of the bank carries it ────────────────────────────
-- As live had it (pg_get_viewdef, 2026-10-09), with the column added last.
CREATE OR REPLACE VIEW public.question_bank_student AS
 SELECT id,
    class_level,
    subject,
    chapter,
    difficulty,
    question,
    options,
    source,
    is_approved,
    created_at,
    board,
    source_type,
    exam_year,
    stream,
    question_format,
    updated_at,
    is_active,
    chapter_id,
    variant_tier,
    topic_id,
    exam_id,
    COALESCE(public.answers_are_numbers(options), false) AS answers_are_numbers
   FROM question_bank q
  WHERE is_approved AND (exam_id IS NULL AND NOT (EXISTS ( SELECT 1
           FROM exam_accounts ea
          WHERE ea.school_id = (( SELECT get_my_school_id() AS get_my_school_id)))) AND (board IS NULL OR board = 'both'::text OR board = (( SELECT s.board
           FROM schools s
          WHERE s.id = (( SELECT get_my_school_id() AS get_my_school_id))))) OR exam_id IS NOT NULL AND (chapter_id IN ( SELECT s.chapter_id
           FROM exam_accounts ea
             JOIN exam_syllabus_chapters s ON s.exam_id = ea.exam_id AND s.stream = ea.stream
          WHERE ea.school_id = (( SELECT get_my_school_id() AS get_my_school_id)) AND ea.exam_id = q.exam_id)));

-- ── PROOF, before COMMIT ────────────────────────────────────────────────────
DO $proof$
DECLARE
  _uid  uuid;
  _n    int;
  _bad  text;
BEGIN
  -- 1. The reading, on the shapes the bank holds.
  SELECT string_agg(f.label, '; ') INTO _bad
    FROM (VALUES
      ('amounts',        '["₹ 40,000", "₹ 50,000", "₹ 60,000", "₹ 70,000"]'::jsonb, true),
      ('rupees spelled', '["Rs. 1,20,000", "Rs 80,000", "INR 5000", "4,500"]'::jsonb, true),
      ('percentages',    '["12.5%", "15%", "20 %", "25%"]'::jsonb, true),
      ('ratios',         '["3 : 2", "2:1", "1 : 1", "5:3"]'::jsonb, true),
      ('labelled',       '["(a) 1,000", "(b) 2,000", "c) 3,000", "D. 4,000"]'::jsonb, true),
      ('times',          '["2 times", "3 times", "1.5 times", "4 times"]'::jsonb, true),
      ('words',          '["Planning", "Organising", "Staffing", "Directing"]'::jsonb, false),
      -- A figure inside words is read as words: the reading is conservative.
      ('words and figures', '["Profit ₹ 40,000", "Loss ₹ 10,000", "Profit ₹ 5,000", "Loss ₹ 2,000"]'::jsonb, false),
      ('one word',       '["₹ 40,000", "₹ 50,000", "Neither", "₹ 70,000"]'::jsonb, false),
      ('statements',     '["I and II only", "II and III only", "I only", "All"]'::jsonb, false),
      ('one option',     '["₹ 40,000"]'::jsonb, false),
      ('not a list',     '{"a": "1"}'::jsonb, false)
    ) AS f(label, options, want)
   WHERE COALESCE(public.answers_are_numbers(f.options), false) <> f.want;
  IF _bad IS NOT NULL THEN
    RAISE EXCEPTION 'VERIFY FAILED: answers_are_numbers misreads: %', _bad;
  END IF;

  -- 2. Enough of the bank reads as answered with a figure to drill.
  SELECT count(*) INTO _n FROM public.question_bank qb
   WHERE qb.is_active AND qb.is_approved AND qb.subject = 'Accountancy' AND public.answers_are_numbers(qb.options);
  IF _n < 100 THEN RAISE EXCEPTION 'VERIFY FAILED: only % Accountancy questions read as answered with a figure', _n; END IF;

  -- 3. Read through the student's view, as a CUET student.
  SELECT ea.account_id INTO _uid FROM public.exam_accounts ea ORDER BY ea.account_id LIMIT 1;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', _uid, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO _n FROM public.question_bank_student v WHERE v.answers_are_numbers AND v.subject = 'Accountancy';
  RESET ROLE;
  IF _n = 0 THEN RAISE EXCEPTION 'VERIFY FAILED: the student view serves no question answered with a figure'; END IF;
END $proof$;

COMMIT;
