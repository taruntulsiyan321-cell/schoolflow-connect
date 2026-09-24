-- ===========================================================================
-- PRACTICE CARRIES THE EXAM
--
-- Individual accounts have no class/board. question_bank gains nullable exam_id;
-- school rows stay NULL. CUET gets a curriculum tree + starter approved questions.
-- Catalog: school path requires exam_id IS NULL; exam path keys on exam_id.
--
-- Rollback: rollback/20261048000000_practice_carries_the_exam.rollback.sql
-- ===========================================================================

BEGIN;

ALTER TABLE public.question_bank
  ADD COLUMN IF NOT EXISTS exam_id uuid REFERENCES public.competitive_exams(id) ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS question_bank_exam_id_idx
  ON public.question_bank (exam_id)
  WHERE exam_id IS NOT NULL;

COMMENT ON COLUMN public.question_bank.exam_id IS
  'Competitive exam this row belongs to. NULL = school board bank.';

ALTER TABLE public.question_bank DROP CONSTRAINT IF EXISTS question_bank_board_check;
ALTER TABLE public.question_bank
  ADD CONSTRAINT question_bank_board_check
  CHECK (board IS NULL OR board IN ('rbse', 'cbse', 'icse', 'other', 'both', 'cuet'));

DROP FUNCTION IF EXISTS public.rpc_practice_bank_catalog(integer, text, text, text);

CREATE FUNCTION public.rpc_practice_bank_catalog(
  _class_level integer,
  _board text,
  _stream text DEFAULT NULL,
  _subject text DEFAULT NULL,
  _exam_id uuid DEFAULT NULL
)
RETURNS TABLE (subject text, chapter text, questions integer)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path TO 'public'
AS $catalog$
  SELECT qb.subject, qb.chapter, count(*)::int
    FROM public.question_bank qb
   WHERE qb.is_approved
     AND qb.is_active
     AND NULLIF(btrim(qb.subject), '') IS NOT NULL
     AND (
       (_exam_id IS NOT NULL AND qb.exam_id = _exam_id)
       OR
       (_exam_id IS NULL
        AND qb.exam_id IS NULL
        AND qb.class_level = _class_level
        AND (qb.board = _board OR qb.board = 'both' OR qb.board IS NULL)
        AND (_stream IS NULL OR qb.stream = _stream OR qb.stream IS NULL))
     )
     AND (_subject IS NULL OR lower(qb.subject) = lower(_subject))
   GROUP BY qb.subject, qb.chapter
   ORDER BY qb.subject, qb.chapter
$catalog$;

COMMENT ON FUNCTION public.rpc_practice_bank_catalog(integer, text, text, text, uuid) IS
  'Practice subject/chapter counts. School: class+board+stream, exam_id IS NULL. Individual: exam_id.';

REVOKE ALL ON FUNCTION public.rpc_practice_bank_catalog(integer, text, text, text, uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rpc_practice_bank_catalog(integer, text, text, text, uuid)
  TO authenticated;

DO $seed$
DECLARE
  _exam   uuid;
  _board  uuid;
  _class  uuid;
  _subj   uuid;
  _ch     uuid;
  _topic  uuid;
  _qcount int;
  r       RECORD;
BEGIN
  SELECT id INTO _exam FROM public.competitive_exams WHERE code = 'cuet' AND is_active;
  IF _exam IS NULL THEN
    RAISE EXCEPTION 'ROLLED BACK: no active cuet exam';
  END IF;

  INSERT INTO public.boards (name, code) VALUES ('CUET', 'cuet')
  ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name;
  SELECT id INTO _board FROM public.boards WHERE code = 'cuet';

  INSERT INTO public.curriculum_classes (board_id, label, level)
  VALUES (_board, 'CUET', 12)
  ON CONFLICT (board_id, level) DO UPDATE SET label = EXCLUDED.label;
  SELECT id INTO _class FROM public.curriculum_classes WHERE board_id = _board AND level = 12;

  INSERT INTO public.curriculum_subjects (curriculum_class_id, name)
  SELECT _class, n FROM unnest(ARRAY[
    'Accountancy', 'Mathematics', 'Business Studies', 'Economics', 'English'
  ]) AS n
  ON CONFLICT (curriculum_class_id, name) DO NOTHING;

  CREATE TEMP TABLE _cuet_q (
    subject text, chapter text, topic text, difficulty text,
    question text, options jsonb, correct_index int, explanation text
  ) ON COMMIT DROP;

  INSERT INTO _cuet_q VALUES
  ('Accountancy', 'Accounting Process', 'Journal entries', 'easy',
   'Goods purchased on credit are recorded in which book first?',
   '["Cash Book","Purchases Journal","Sales Journal","Petty Cash Book"]'::jsonb, 1,
   'Credit purchases are first entered in the Purchases Journal.'),
  ('Accountancy', 'Accounting Process', 'Trial balance', 'medium',
   'A trial balance is mainly prepared to',
   '["Find net profit","Check arithmetical accuracy of ledger balances","Prepare the balance sheet only","Record cash receipts"]'::jsonb, 1,
   'A trial balance verifies arithmetical accuracy of ledger balances.'),
  ('Accountancy', 'Financial Statements', 'Depreciation', 'medium',
   'Under the straight-line method, annual depreciation is',
   '["Cost minus scrap value, divided by useful life","Cost multiplied by useful life","Scrap value divided by cost","Current market value of the asset"]'::jsonb, 0,
   'Straight-line depreciation equals (cost − scrap value) ÷ useful life.'),
  ('Accountancy', 'Partnership Accounts', 'Profit sharing', 'hard',
   'If a partnership deed is silent on the profit-sharing ratio, profits are shared',
   '["In capital ratio","Equally among partners","In the ratio of drawings","Only by the managing partner"]'::jsonb, 1,
   'When the deed is silent, profits are shared equally.'),
  ('Mathematics', 'Algebra', 'Quadratic equations', 'easy',
   'The roots of x² − 5x + 6 = 0 are',
   '["2 and 3","−2 and −3","1 and 6","0 and 5"]'::jsonb, 0,
   'Factors are (x − 2)(x − 3) = 0.'),
  ('Mathematics', 'Algebra', 'Arithmetic progression', 'medium',
   'The 10th term of the AP 3, 7, 11, 15, … is',
   '["35","39","43","47"]'::jsonb, 1,
   'a₁₀ = 3 + 9×4 = 39.'),
  ('Mathematics', 'Calculus', 'Differentiation', 'medium',
   'If f(x) = 3x² + 2x − 1, then f′(x) is',
   '["6x + 2","3x + 2","6x − 1","x² + 2"]'::jsonb, 0,
   'd/dx(3x²)=6x and d/dx(2x)=2.'),
  ('Mathematics', 'Probability', 'Basic probability', 'hard',
   'A fair die is rolled once. Probability of getting a prime number is',
   '["1/2","1/3","1/6","2/3"]'::jsonb, 0,
   'Prime faces are 2, 3 and 5 → 3/6 = 1/2.'),
  ('Business Studies', 'Business Environment', 'Dimensions of environment', 'easy',
   'Which of the following is a component of the economic environment?',
   '["Interest rates","Religious beliefs","Language","Customs"]'::jsonb, 0,
   'Interest rates belong to the economic environment.'),
  ('Business Studies', 'Principles of Management', 'Fayol principles', 'medium',
   'Unity of command means an employee should receive orders from',
   '["Many superiors","Only one superior","Peers only","Customers"]'::jsonb, 1,
   'Each employee takes orders from a single superior.'),
  ('Business Studies', 'Marketing Management', 'Marketing mix', 'medium',
   'In the 4Ps of marketing, Place refers to',
   '["Product design","Distribution channels","Advertising copy","Price discounts"]'::jsonb, 1,
   'Place covers distribution channels.'),
  ('Business Studies', 'Financial Management', 'Capital structure', 'hard',
   'Trading on equity is beneficial when',
   '["Return on investment exceeds interest rate on borrowed funds","Interest rate exceeds return on investment","Debt is zero","Equity is never used"]'::jsonb, 0,
   'Debt helps when ROI exceeds the cost of debt.'),
  ('Economics', 'Microeconomics', 'Demand', 'easy',
   'Other things equal, a rise in the price of a normal good usually',
   '["Increases its quantity demanded","Decreases its quantity demanded","Has no effect on demand","Makes supply perfectly inelastic"]'::jsonb, 1,
   'Quantity demanded falls as price rises.'),
  ('Economics', 'Microeconomics', 'Elasticity', 'medium',
   'If price elasticity of demand is greater than 1, demand is called',
   '["Perfectly inelastic","Unitary elastic","Elastic","Zero elastic"]'::jsonb, 2,
   'When |e| > 1, demand is elastic.'),
  ('Economics', 'Macroeconomics', 'National income', 'medium',
   'GDP at market price includes',
   '["Only wages","Value of final goods and services produced within a country","Only government spending","Imports alone"]'::jsonb, 1,
   'GDP is the market value of final domestic output.'),
  ('Economics', 'Macroeconomics', 'Money and banking', 'hard',
   'Which function of money solves the problem of double coincidence of wants?',
   '["Store of value","Medium of exchange","Unit of account","Standard of deferred payment"]'::jsonb, 1,
   'Money as a medium of exchange removes barter coincidence.'),
  ('English', 'Reading Comprehension', 'Main idea', 'easy',
   'In a passage, the central idea is best described as',
   '["A minor detail","The main point the author wants to convey","A vocabulary list","The authors biography"]'::jsonb, 1,
   'The central idea is the primary message of the passage.'),
  ('English', 'Vocabulary', 'Synonyms', 'medium',
   'The word closest in meaning to benevolent is',
   '["Cruel","Kind","Angry","Lazy"]'::jsonb, 1,
   'Benevolent means kindly.'),
  ('English', 'Grammar', 'Subject-verb agreement', 'medium',
   'Choose the correct sentence:',
   '["The list of items are on the desk.","The list of items is on the desk.","The list of items were on the desk.","The list of items be on the desk."]'::jsonb, 1,
   'Singular subject list takes is.'),
  ('English', 'Verbal Ability', 'Sentence rearrangement', 'hard',
   'Which arrangement forms a coherent sentence? (1) to succeed (2) hard work (3) is essential (4) in life',
   '["2-3-1-4","1-2-3-4","4-1-2-3","3-2-1-4"]'::jsonb, 0,
   'Hard work is essential to succeed in life.');

  FOR r IN SELECT * FROM _cuet_q LOOP
    SELECT cs.id INTO _subj FROM public.curriculum_subjects cs
     WHERE cs.curriculum_class_id = _class AND cs.name = r.subject;
    IF _subj IS NULL THEN
      RAISE EXCEPTION 'ROLLED BACK: missing subject %', r.subject;
    END IF;

    INSERT INTO public.chapters (curriculum_subject_id, name, sequence)
    VALUES (_subj, r.chapter, 1)
    ON CONFLICT (curriculum_subject_id, name) DO NOTHING;
    SELECT id INTO _ch FROM public.chapters
     WHERE curriculum_subject_id = _subj AND name = r.chapter;

    INSERT INTO public.topics (chapter_id, name)
    VALUES (_ch, r.topic)
    ON CONFLICT (chapter_id, name) DO NOTHING;
    SELECT id INTO _topic FROM public.topics WHERE chapter_id = _ch AND name = r.topic;

    IF NOT EXISTS (
      SELECT 1 FROM public.question_bank qb
       WHERE qb.exam_id = _exam AND qb.question = r.question
    ) THEN
      INSERT INTO public.question_bank (
        subject, chapter, chapter_id, topic_id, difficulty, question, options,
        correct_index, explanation, board, stream, class_level, exam_id,
        is_approved, is_active, source_type, question_format, approved_at
      ) VALUES (
        r.subject, r.chapter, _ch, _topic, r.difficulty, r.question, r.options,
        r.correct_index, r.explanation, 'cuet', NULL, 12, _exam,
        true, true, 'ncert_aligned', 'mcq', now()
      );
    END IF;
  END LOOP;

  SELECT count(*)::int INTO _qcount
    FROM public.question_bank WHERE exam_id = _exam AND is_approved AND is_active;
  IF _qcount < 20 THEN
    RAISE EXCEPTION 'ROLLED BACK: expected ≥20 CUET rows, got %', _qcount;
  END IF;

  IF (SELECT count(*) FROM public.rpc_practice_bank_catalog(NULL, NULL, NULL, NULL, _exam)) < 5 THEN
    RAISE EXCEPTION 'ROLLED BACK: exam catalog too thin';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.question_bank qb
     WHERE qb.exam_id = _exam AND qb.board IS DISTINCT FROM 'cuet'
  ) THEN
    RAISE EXCEPTION 'ROLLED BACK: CUET rows must carry board=cuet';
  END IF;

  -- School catalog must not count exam-tagged rows (exam_id IS NULL fence).
  IF EXISTS (
    SELECT 1
      FROM public.rpc_practice_bank_catalog(12, 'rbse', NULL, NULL, NULL) c
      JOIN public.question_bank qb
        ON qb.exam_id = _exam
       AND qb.subject = c.subject
       AND qb.chapter IS NOT DISTINCT FROM c.chapter
       AND qb.is_approved AND qb.is_active
     WHERE NOT EXISTS (
       SELECT 1 FROM public.question_bank s
        WHERE s.exam_id IS NULL AND s.is_approved AND s.is_active
          AND s.class_level = 12
          AND (s.board = 'rbse' OR s.board = 'both' OR s.board IS NULL)
          AND s.subject = c.subject
          AND s.chapter IS NOT DISTINCT FROM c.chapter
     )
  ) THEN
    RAISE EXCEPTION 'ROLLED BACK: school catalog surfaced a CUET-only chapter';
  END IF;

  RAISE NOTICE 'OK: CUET tree + % questions; exam catalog live', _qcount;
END
$seed$;

COMMIT;
