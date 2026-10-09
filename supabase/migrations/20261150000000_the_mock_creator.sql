-- ═══════════════════════════════════════════════════════════════════════════
-- THE MOCK CREATOR: PAPERS BUILT TO THE BLUEPRINT, FROM A LIBRARY, NEVER TWICE
-- ═══════════════════════════════════════════════════════════════════════════
--
-- docs/TODO.md B (owner, 2026-10-03/04). A student asks for a mock — a whole
-- subject or one chapter — and gets a paper built like the real CUET paper.
-- Until now a mock was 50 random questions from a subject, spread by a cap.
--
-- 1. THE BLUEPRINT IS DATA (A1, approved 2026-10-09; docs/cuet-blueprint.md):
--    exam_blueprint_chapters says how many questions each chapter gives a
--    subject paper, exam_blueprint_forms how many of each form (direct,
--    statement set, match, sequence, case), and exam_blueprint_options the two
--    choices a student makes once: Accountancy's Unit V (Analysis of Financial
--    Statements or Computerised Accounting) and Mathematics' Section B (B1 or
--    B2). The choices are exam_option_choices. The old spread rule
--    (min_chapters, max_per_chapter) is gone: the blueprint replaces it.
-- 2. WHAT A MOCK MAY HOLD (_mock_pool): an active, gradable question of the
--    student's syllabus — never assertion–reason (A1 decision 2: the paper does
--    not set it), never an AI-written question without a passing quality review
--    (B6, A2), never one whose key is disputed.
-- 3. HOW A PAPER IS BUILT (_mock_build, B4): the questions the student has
--    never met first; then the ones they met and got wrong, skipped or guessed;
--    then the ones they got right longest ago. The paper's forms come first up
--    to their share where a chapter has room, then each chapter to its share;
--    a chapter that cannot fill its share is made up by the rest, and the paper
--    says which.
-- 4. A LIBRARY OF PAPERS (mock_papers, B3): a paper may be given to any number
--    of students and is never given to one student twice (a unique index). A
--    student is given a library paper none of whose questions they have met;
--    otherwise one is built for them and kept. A new paper is never the same
--    set of questions as one they have sat.
-- 5. PREPARE, THEN START: rpc_mock_prepare builds or picks the paper and says
--    before the clock starts how many of its questions the student has seen
--    before and which (B4.3); rpc_mock_start(paper) starts it and counts the
--    plan (B7: unchanged, to be discussed with the owner).
-- 6. CHAPTER MOCKS (B2): 50 questions from one chapter, 60 minutes, the
--    subject's form shares.
-- 7. AFTER THE PAPER (B5): mock_answers.guessed (the "I'm guessing" tap), and
--    rpc_mock_analysis_context — the paper, the last mock of the same kind and
--    each question's earlier answer — so the result is the same four tabs a
--    practice session has.
--
-- No mock has ever been sat (0 attempts measured 2026-10-09), so the attempts
-- table is reshaped in place: an attempt names its paper.
--
-- ROLLBACK: rollback/20261150000000_the_mock_creator.rollback.sql
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 1. The blueprint, as data ───────────────────────────────────────────────

CREATE TABLE public.exam_blueprint_options (
  exam_id      uuid NOT NULL REFERENCES public.competitive_exams(id) ON DELETE CASCADE,
  subject      text NOT NULL,
  option_group text NOT NULL CHECK (option_group <> ''),
  -- What the choice is called: "Unit V", "Section B".
  group_label  text NOT NULL,
  option       text NOT NULL CHECK (option <> ''),
  label        text NOT NULL,
  position     smallint NOT NULL,
  PRIMARY KEY (exam_id, subject, option_group, option)
);
COMMENT ON TABLE public.exam_blueprint_options IS
  'A choice a student makes once for a subject''s paper (20261150000000): Accountancy''s Unit V, Mathematics'' Section B.';

CREATE TABLE public.exam_blueprint_chapters (
  exam_id      uuid NOT NULL REFERENCES public.competitive_exams(id) ON DELETE CASCADE,
  chapter_id   uuid NOT NULL REFERENCES public.chapters(id) ON DELETE CASCADE,
  -- '' for every student; otherwise only for those who chose this option.
  option_group text NOT NULL DEFAULT '',
  option       text NOT NULL DEFAULT '',
  questions    smallint NOT NULL CHECK (questions > 0),
  PRIMARY KEY (exam_id, chapter_id, option_group, option),
  CHECK ((option_group = '') = (option = ''))
);
COMMENT ON TABLE public.exam_blueprint_chapters IS
  'How many questions each chapter gives a subject paper (20261150000000; docs/cuet-blueprint.md, approved 2026-10-09).';

CREATE TABLE public.exam_blueprint_forms (
  exam_id      uuid NOT NULL REFERENCES public.competitive_exams(id) ON DELETE CASCADE,
  subject      text NOT NULL,
  option_group text NOT NULL DEFAULT '',
  option       text NOT NULL DEFAULT '',
  form         text NOT NULL CHECK (form IN ('mcq', 'statements', 'match', 'sequence', 'case_based')),
  questions    smallint NOT NULL CHECK (questions > 0),
  PRIMARY KEY (exam_id, subject, option_group, option, form),
  CHECK ((option_group = '') = (option = ''))
);
COMMENT ON TABLE public.exam_blueprint_forms IS
  'How many questions of each form a paper holds (20261150000000; docs/cuet-blueprint.md). Assertion–reason has none: the real paper does not set it.';

CREATE TABLE public.exam_option_choices (
  account_id   uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  exam_id      uuid NOT NULL,
  subject      text NOT NULL,
  option_group text NOT NULL,
  option       text NOT NULL,
  chosen_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (account_id, exam_id, subject, option_group),
  FOREIGN KEY (exam_id, subject, option_group, option)
    REFERENCES public.exam_blueprint_options (exam_id, subject, option_group, option) ON DELETE CASCADE
);
COMMENT ON TABLE public.exam_option_choices IS
  'The choices a student made for their papers (20261150000000) — set through rpc_set_exam_option.';

ALTER TABLE public.exam_blueprint_options  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.exam_blueprint_chapters ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.exam_blueprint_forms    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.exam_option_choices     ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.exam_blueprint_options, public.exam_blueprint_chapters, public.exam_blueprint_forms,
              public.exam_option_choices FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.exam_blueprint_options, public.exam_blueprint_chapters, public.exam_blueprint_forms,
             public.exam_option_choices TO service_role;

-- ── 2. The CUET blueprint (docs/cuet-blueprint.md, approved 2026-10-09) ─────

INSERT INTO public.exam_blueprint_options (exam_id, subject, option_group, group_label, option, label, position)
SELECT e.id, v.subject, v.grp, v.glabel, v.opt, v.label, v.pos
  FROM public.competitive_exams e,
       (VALUES
  ('Accountancy', 'unit_v', 'Unit V', 'analysis', 'Analysis of Financial Statements', 1),
  ('Accountancy', 'unit_v', 'Unit V', 'cas', 'Computerised Accounting System', 2),
  ('Mathematics', 'section_b', 'Section B', 'mathematics', 'Section B1: Mathematics', 1),
  ('Mathematics', 'section_b', 'Section B', 'applied', 'Section B2: Applied Mathematics', 2)
       ) AS v(subject, grp, glabel, opt, label, pos)
 WHERE e.code = 'cuet';

CREATE TEMP TABLE _blueprint_chapters (subject text, chapter text, questions smallint, grp text, opt text) ON COMMIT DROP;
INSERT INTO _blueprint_chapters VALUES
  ('Accountancy', 'Accounting for Share Capital', 9, '', ''),
  ('Accountancy', 'Dissolution of a Partnership Firm', 7, '', ''),
  ('Accountancy', 'Admission of a New Partner', 5, '', ''),
  ('Accountancy', 'Accounting for Partnership', 5, '', ''),
  ('Accountancy', 'Issue of Debentures', 4, '', ''),
  ('Accountancy', 'Retirement and Death of a Partner', 4, '', ''),
  ('Accountancy', 'Reconstitution of Partnership', 3, '', ''),
  ('Accountancy', 'Ratio Analysis', 5, 'unit_v', 'analysis'),
  ('Accountancy', 'Cash Flow Statement', 4, 'unit_v', 'analysis'),
  ('Accountancy', 'Financial Statements and Tools for Financial Analysis', 4, 'unit_v', 'analysis'),
  ('Accountancy', 'Computerised Accounting System', 13, 'unit_v', 'cas'),
  ('Business Studies', 'Planning', 6, '', ''),
  ('Business Studies', 'Marketing Management', 5, '', ''),
  ('Business Studies', 'Staffing', 5, '', ''),
  ('Business Studies', 'Organising', 5, '', ''),
  ('Business Studies', 'Nature and Significance of Management', 5, '', ''),
  ('Business Studies', 'Directing', 4, '', ''),
  ('Business Studies', 'Controlling', 4, '', ''),
  ('Business Studies', 'Financial Management', 4, '', ''),
  ('Business Studies', 'Principles of Management', 4, '', ''),
  ('Business Studies', 'Business Environment', 3, '', ''),
  ('Business Studies', 'Consumer Protection', 3, '', ''),
  ('Business Studies', 'Financial Markets', 2, '', ''),
  ('Economics', 'Determination of Income and Employment', 7, '', ''),
  ('Economics', 'Introduction and National Income Accounting', 6, '', ''),
  ('Economics', 'Money and Banking', 5, '', ''),
  ('Economics', 'Government Budget and the Economy', 4, '', ''),
  ('Economics', 'Open Economy Macroeconomics', 3, '', ''),
  ('Economics', 'Introduction and Theory of Consumer Behaviour', 4, '', ''),
  ('Economics', 'Production and Costs', 4, '', ''),
  ('Economics', 'Theory of the Firm under Perfect Competition', 2, '', ''),
  ('Economics', 'Market Equilibrium and Simple Applications', 2, '', ''),
  ('Economics', 'Development Policies and Experience (1947-90)', 4, '', ''),
  ('Economics', 'Current Challenges facing the Indian Economy', 5, '', ''),
  ('Economics', 'Economic Reforms since 1991', 2, '', ''),
  ('Economics', 'Development Experience of India: A Comparison with Neighbours', 2, '', ''),
  ('English', 'Reading Comprehension', 24, '', ''),
  ('English', 'Verbal Ability', 26, '', ''),
  ('General Aptitude Test', 'Quantitative Reasoning', 15, '', ''),
  ('General Aptitude Test', 'General Knowledge and Current Affairs', 14, '', ''),
  ('General Aptitude Test', 'General Mental Ability and Numerical Ability', 9, '', ''),
  ('General Aptitude Test', 'Logical and Analytical Reasoning', 6, '', ''),
  ('General Aptitude Test', 'General Science and Environment Literacy', 6, '', ''),
  ('Mathematics', 'Matrices', 2, '', ''),
  ('Mathematics', 'Linear Programming', 2, '', ''),
  ('Mathematics', 'Integrals', 2, '', ''),
  ('Mathematics', 'Applications of Derivatives', 2, '', ''),
  ('Mathematics', 'Continuity and Differentiability', 2, '', ''),
  ('Mathematics', 'Differential Equations', 1, '', ''),
  ('Mathematics', 'Applications of the Integrals', 1, '', ''),
  ('Mathematics', 'Determinants', 1, '', ''),
  ('Mathematics', 'Probability Distributions', 1, '', ''),
  ('Mathematics', 'Probability', 1, '', ''),
  ('Mathematics', 'Probability', 4, 'section_b', 'mathematics'),
  ('Mathematics', 'Three-dimensional Geometry', 4, 'section_b', 'mathematics'),
  ('Mathematics', 'Vectors', 3, 'section_b', 'mathematics'),
  ('Mathematics', 'Determinants', 3, 'section_b', 'mathematics'),
  ('Mathematics', 'Applications of Derivatives', 3, 'section_b', 'mathematics'),
  ('Mathematics', 'Integrals', 3, 'section_b', 'mathematics'),
  ('Mathematics', 'Continuity and Differentiability', 3, 'section_b', 'mathematics'),
  ('Mathematics', 'Matrices', 3, 'section_b', 'mathematics'),
  ('Mathematics', 'Applications of the Integrals', 2, 'section_b', 'mathematics'),
  ('Mathematics', 'Differential Equations', 2, 'section_b', 'mathematics'),
  ('Mathematics', 'Relations and Functions', 2, 'section_b', 'mathematics'),
  ('Mathematics', 'Linear Programming', 2, 'section_b', 'mathematics'),
  ('Mathematics', 'Inverse Trigonometric Functions', 1, 'section_b', 'mathematics'),
  ('Mathematics', 'Financial Mathematics', 7, 'section_b', 'applied'),
  ('Mathematics', 'Numbers, Quantification and Numerical Applications', 6, 'section_b', 'applied'),
  ('Mathematics', 'Probability Distributions', 5, 'section_b', 'applied'),
  ('Mathematics', 'Inferential Statistics', 3, 'section_b', 'applied'),
  ('Mathematics', 'Time Based Data', 3, 'section_b', 'applied'),
  ('Mathematics', 'Matrices', 3, 'section_b', 'applied'),
  ('Mathematics', 'Applications of Derivatives', 2, 'section_b', 'applied'),
  ('Mathematics', 'Determinants', 2, 'section_b', 'applied'),
  ('Mathematics', 'Linear Programming', 2, 'section_b', 'applied'),
  ('Mathematics', 'Continuity and Differentiability', 1, 'section_b', 'applied'),
  ('Mathematics', 'Integrals', 1, 'section_b', 'applied');

DO $verify$
DECLARE _bad text;
BEGIN
  -- Every chapter named matches exactly one chapter of the CUET syllabus.
  SELECT string_agg(b.subject || ' › ' || b.chapter, '; ') INTO _bad
    FROM _blueprint_chapters b
   WHERE (SELECT count(*) FROM public.exam_syllabus_chapters esc
            JOIN public.competitive_exams e ON e.id = esc.exam_id AND e.code = 'cuet'
            JOIN public.chapters c ON c.id = esc.chapter_id AND c.name = b.chapter
            JOIN public.curriculum_subjects s ON s.id = c.curriculum_subject_id AND s.name = b.subject) <> 1;
  IF _bad IS NOT NULL THEN
    RAISE EXCEPTION 'VERIFY FAILED: blueprint chapters not matching exactly one CUET chapter: %', _bad;
  END IF;
END $verify$;

INSERT INTO public.exam_blueprint_chapters (exam_id, chapter_id, option_group, option, questions)
SELECT e.id, c.id, b.grp, b.opt, b.questions
  FROM _blueprint_chapters b
  JOIN public.competitive_exams e ON e.code = 'cuet'
  JOIN public.exam_syllabus_chapters esc ON esc.exam_id = e.id
  JOIN public.chapters c ON c.id = esc.chapter_id AND c.name = b.chapter
  JOIN public.curriculum_subjects s ON s.id = c.curriculum_subject_id AND s.name = b.subject;
DROP TABLE _blueprint_chapters;

INSERT INTO public.exam_blueprint_forms (exam_id, subject, form, questions, option_group, option)
SELECT e.id, v.subject, v.form, v.n, v.grp, v.opt
  FROM public.competitive_exams e,
       (VALUES
  ('Accountancy', 'mcq', 24, '', ''),
  ('Accountancy', 'statements', 5, '', ''),
  ('Accountancy', 'match', 5, '', ''),
  ('Accountancy', 'sequence', 6, '', ''),
  ('Accountancy', 'case_based', 10, '', ''),
  ('Business Studies', 'mcq', 26, '', ''),
  ('Business Studies', 'statements', 4, '', ''),
  ('Business Studies', 'match', 5, '', ''),
  ('Business Studies', 'sequence', 5, '', ''),
  ('Business Studies', 'case_based', 10, '', ''),
  ('Economics', 'mcq', 26, '', ''),
  ('Economics', 'statements', 5, '', ''),
  ('Economics', 'match', 5, '', ''),
  ('Economics', 'sequence', 4, '', ''),
  ('Economics', 'case_based', 10, '', ''),
  ('English', 'case_based', 24, '', ''),
  ('English', 'mcq', 14, '', ''),
  ('English', 'match', 6, '', ''),
  ('English', 'sequence', 6, '', ''),
  ('General Aptitude Test', 'mcq', 39, '', ''),
  ('General Aptitude Test', 'statements', 5, '', ''),
  ('General Aptitude Test', 'sequence', 3, '', ''),
  ('General Aptitude Test', 'match', 3, '', ''),
  ('Mathematics', 'mcq', 13, '', ''),
  ('Mathematics', 'statements', 1, '', ''),
  ('Mathematics', 'match', 1, '', ''),
  ('Mathematics', 'mcq', 25, 'section_b', 'mathematics'),
  ('Mathematics', 'statements', 5, 'section_b', 'mathematics'),
  ('Mathematics', 'match', 5, 'section_b', 'mathematics'),
  ('Mathematics', 'mcq', 28, 'section_b', 'applied'),
  ('Mathematics', 'statements', 4, 'section_b', 'applied'),
  ('Mathematics', 'match', 3, 'section_b', 'applied')
       ) AS v(subject, form, n, grp, opt)
 WHERE e.code = 'cuet';


-- ── 3. The library of papers, and what an attempt is now ────────────────────

CREATE TABLE public.mock_papers (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  exam_id      uuid NOT NULL REFERENCES public.competitive_exams(id),
  subject      text NOT NULL CHECK (btrim(subject) <> ''),
  -- NULL for a whole-subject paper; the chapter for a chapter paper.
  chapter_id   uuid REFERENCES public.chapters(id) ON DELETE SET NULL,
  -- The choices it was built under, {"unit_v": "analysis"}: only papers built
  -- under the same choices are given to a student who made them.
  options      jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(options) = 'object'),
  question_ids uuid[] NOT NULL CHECK (cardinality(question_ids) > 0),
  -- The chapters that could not give their share, and how many they gave:
  -- [{"chapter_id", "chapter", "wanted", "got"}]. Said to the student before the paper starts.
  short        jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(short) = 'array'),
  created_at   timestamptz NOT NULL DEFAULT now(),
  -- Whom it was first built for — the library's provenance, never a fence.
  created_for  uuid REFERENCES auth.users(id) ON DELETE SET NULL
);
COMMENT ON TABLE public.mock_papers IS
  'The library of mock papers (20261150000000, TODO B3): given to any number of students, never twice to one (mock_attempts_one_sitting_per_paper).';
CREATE INDEX mock_papers_kind ON public.mock_papers (exam_id, subject, chapter_id, created_at);

ALTER TABLE public.mock_papers ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.mock_papers FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.mock_papers TO service_role;

-- An attempt names its paper; the paper's questions, subject and chapter are
-- read from it, in one home. `total` is the paper's size, frozen so the marking
-- can be checked by a constraint.
ALTER TABLE public.mock_attempts DROP CONSTRAINT mock_attempts_marked_when_submitted;
ALTER TABLE public.mock_attempts DROP CONSTRAINT mock_attempts_question_ids_check;
ALTER TABLE public.mock_attempts DROP CONSTRAINT mock_attempts_subject_check;
ALTER TABLE public.mock_attempts DROP COLUMN question_ids;
ALTER TABLE public.mock_attempts DROP COLUMN subject;
ALTER TABLE public.mock_attempts DROP COLUMN exam_id;
ALTER TABLE public.mock_attempts
  ADD COLUMN paper_id uuid NOT NULL REFERENCES public.mock_papers(id),
  ADD COLUMN total smallint NOT NULL CHECK (total > 0),
  ADD COLUMN seen_before smallint NOT NULL DEFAULT 0 CHECK (seen_before >= 0);
ALTER TABLE public.mock_attempts ADD CONSTRAINT mock_attempts_marked_when_submitted CHECK (
  (submitted_at IS NULL AND correct IS NULL AND wrong IS NULL AND unanswered IS NULL AND voided IS NULL AND score IS NULL)
  OR (submitted_at IS NOT NULL AND correct IS NOT NULL AND wrong IS NOT NULL AND unanswered IS NOT NULL
      AND voided IS NOT NULL AND score IS NOT NULL
      AND correct + wrong + unanswered + voided = total
      AND score = correct * marks_correct + wrong * marks_wrong));
-- The owner's ruling (2026-10-04): the same paper is never given to one student twice.
CREATE UNIQUE INDEX mock_attempts_one_sitting_per_paper ON public.mock_attempts (paper_id, user_id);

-- The "I'm guessing" tap: true marked as a guess, false answered without it, NULL not said.
ALTER TABLE public.mock_answers ADD COLUMN guessed boolean;

-- ── 4. The rules ────────────────────────────────────────────────────────────

-- The spread rule (min_chapters, max_per_chapter) is gone: the blueprint is the spread.
CREATE OR REPLACE FUNCTION public._mock_paper()
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  -- questions, minutes and marks are stated ONCE, here; max_score is arithmetic
  -- on them. How a paper's questions spread is the blueprint's
  -- (exam_blueprint_chapters, exam_blueprint_forms).
  SELECT jsonb_build_object(
    'questions',     k.questions,
    'minutes',       k.minutes,
    'marks_correct', k.marks_correct,
    'marks_wrong',   k.marks_wrong,
    'max_score',     k.questions * k.marks_correct)
  FROM (SELECT 50 AS questions, 60 AS minutes, 5 AS marks_correct, -1 AS marks_wrong) k
$$;

DROP FUNCTION public.rpc_mock_start(text);
DROP FUNCTION public._mock_pick_questions(text);
DROP FUNCTION public._mock_subject_supply();
DROP FUNCTION public.rpc_mock_save_answer(uuid, uuid, integer, boolean, integer);

-- ── 5. Building a paper ─────────────────────────────────────────────────────

-- The chapters of an exam account's syllabus, by subject, in the syllabus' order.
CREATE FUNCTION public._mock_syllabus(_exam uuid, _stream text)
RETURNS TABLE(subject text, chapter_id uuid, chapter text, seq integer)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT s.name, c.id, c.name, esc.sequence
    FROM public.exam_syllabus_chapters esc
    JOIN public.chapters c ON c.id = esc.chapter_id
    JOIN public.curriculum_subjects s ON s.id = c.curriculum_subject_id
   WHERE esc.exam_id = _exam AND esc.stream = _stream
$$;

-- What a mock may hold, for the CALLER: question_bank_student reads the
-- caller's exam and syllabus. Active and gradable; never assertion–reason
-- (A1 decision 2); never an AI-written question without a passing quality
-- review (B6, A2); never one whose key is disputed.
CREATE FUNCTION public._mock_pool(_exam uuid, _subject text, _chapter uuid)
RETURNS TABLE(id uuid, chapter_id uuid, form text)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT v.id, v.chapter_id, COALESCE(v.question_format, 'mcq')
    FROM public.question_bank_student v
    JOIN public.question_bank q ON q.id = v.id
   WHERE v.is_active
     AND v.exam_id = _exam
     AND v.chapter_id IS NOT NULL
     AND lower(v.subject) = lower(_subject)
     AND (_chapter IS NULL OR v.chapter_id = _chapter)
     AND q.correct_index IS NOT NULL
     AND COALESCE(v.question_format, 'mcq') <> 'assertion_reason'
     AND q.explanation_status IS DISTINCT FROM 'disputed'
     AND (q.source_type IS DISTINCT FROM 'ai_generated' OR public._quality_review_passes(q.quality_review))
$$;

-- Every bank question this student has met — in practice or on a mock — when
-- they last met it, and whether it ever went badly: wrong, skipped, timed out,
-- left blank, or answered as a guess (B4).
CREATE FUNCTION public._mock_history(_uid uuid)
RETURNS TABLE(qid uuid, last_at timestamptz, troubled boolean)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT x.qid, max(x.at), bool_or(x.troubled)
    FROM (
      SELECT qa.bank_question_id AS qid, qa.created_at AS at,
             (qa.is_correct IS NOT TRUE OR COALESCE(qa.skipped, false)
              OR COALESCE(qa.timed_out, false) OR qa.confidence = 0) AS troubled
        FROM public.question_attempts qa
       WHERE qa.user_id = _uid AND qa.bank_question_id IS NOT NULL
      UNION ALL
      SELECT q.qid, a.started_at,
             (ans.is_correct IS NOT TRUE OR COALESCE(ans.guessed, false))
        FROM public.mock_attempts a
        JOIN public.mock_papers p ON p.id = a.paper_id
        CROSS JOIN LATERAL unnest(p.question_ids) AS q(qid)
        LEFT JOIN public.mock_answers ans ON ans.attempt_id = a.id AND ans.question_id = q.qid
       WHERE a.user_id = _uid
    ) x
   GROUP BY x.qid
$$;

-- The choices that shape this paper, as the student made them: every choice of
-- the subject for a subject paper; for a chapter paper only those that change
-- its forms (Mathematics' Section B). A choice not made is simply absent.
CREATE FUNCTION public._mock_options(_uid uuid, _exam uuid, _subject text, _chapter uuid)
RETURNS jsonb
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(jsonb_object_agg(c.option_group, c.option), '{}'::jsonb)
    FROM public.exam_option_choices c
   WHERE c.account_id = _uid AND c.exam_id = _exam AND lower(c.subject) = lower(_subject)
     AND (_chapter IS NULL OR EXISTS (
           SELECT 1 FROM public.exam_blueprint_forms f
            WHERE f.exam_id = _exam AND lower(f.subject) = lower(_subject) AND f.option_group = c.option_group))
$$;

-- The targets a paper is built to: per chapter (kind 'chapter', key the
-- chapter's id) and per form (kind 'form'). A whole-subject paper takes every
-- chapter's share under the student's choices; a chapter paper is the whole
-- paper from one chapter, with the subject's form shares. Refuses when a
-- choice the targets depend on has not been made.
CREATE FUNCTION public._mock_targets(_exam uuid, _subject text, _chapter uuid, _options jsonb)
RETURNS TABLE(kind text, key text, questions integer)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _want    int := (public._mock_paper()->>'questions')::int;
  _missing text;
BEGIN
  SELECT string_agg(DISTINCT o.label_group, '; ') INTO _missing
    FROM (SELECT o.option_group, string_agg(o.label, ' or ' ORDER BY o.position) AS label_group
            FROM public.exam_blueprint_options o
           WHERE o.exam_id = _exam AND lower(o.subject) = lower(_subject)
             AND (_chapter IS NULL OR EXISTS (
                   SELECT 1 FROM public.exam_blueprint_forms f
                    WHERE f.exam_id = _exam AND lower(f.subject) = lower(_subject) AND f.option_group = o.option_group))
           GROUP BY o.option_group) o
   WHERE NOT EXISTS (SELECT 1 FROM public.exam_blueprint_options c
                      WHERE c.exam_id = _exam AND lower(c.subject) = lower(_subject)
                        AND c.option_group = o.option_group AND c.option = _options->>o.option_group);
  IF _missing IS NOT NULL THEN
    RAISE EXCEPTION 'mock_option_not_chosen' USING ERRCODE = 'P0001',
      DETAIL = format('Choose first: %s.', _missing);
  END IF;

  IF _chapter IS NULL THEN
    RETURN QUERY
      SELECT 'chapter'::text, b.chapter_id::text, sum(b.questions)::int
        FROM public.exam_blueprint_chapters b
        JOIN public.chapters c ON c.id = b.chapter_id
        JOIN public.curriculum_subjects s ON s.id = c.curriculum_subject_id
       WHERE b.exam_id = _exam AND lower(s.name) = lower(_subject)
         AND (b.option_group = '' OR b.option = _options->>b.option_group)
       GROUP BY b.chapter_id;
  ELSE
    RETURN QUERY SELECT 'chapter'::text, _chapter::text, _want;
  END IF;
  RETURN QUERY
    SELECT 'form'::text, f.form, sum(f.questions)::int
      FROM public.exam_blueprint_forms f
     WHERE f.exam_id = _exam AND lower(f.subject) = lower(_subject)
       AND (f.option_group = '' OR f.option = _options->>f.option_group)
     GROUP BY f.form;
END $$;

-- One paper for one student, or NULL when the pool cannot fill it (B4):
--   candidates best first — never met; then met and went badly, longest ago
--   first; then met and right, longest ago first;
--   1. the forms the real paper sets beside direct questions, up to their
--      share, where the chapter has room;
--   2. each chapter to its share — direct questions and forms with room first;
--   3. a chapter that cannot give its share is made up by the rest of the
--      paper, one question per chapter a round, and is reported as short.
-- Returns {"ids", "seen_before", "troubled", "short"}.
CREATE FUNCTION public._mock_build(_uid uuid, _exam uuid, _subject text, _chapter uuid, _options jsonb)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _want   int := (public._mock_paper()->>'questions')::int;
  _t      record;
  _ccap   jsonb := '{}'::jsonb;
  _fcap   jsonb := '{}'::jsonb;
  _wanted jsonb;
  _ids    uuid[];
  _chs    text[];
  _forms  text[];
  _ranks  int[];
  _n      int;
  _take   boolean[];
  _total  int := 0;
  _i      int;
  _pass   int;
  _round  boolean;
  _seen   jsonb;
  _picked uuid[];
  _short  jsonb;
BEGIN
  FOR _t IN SELECT * FROM public._mock_targets(_exam, _subject, _chapter, _options) LOOP
    IF _t.kind = 'chapter' THEN
      _ccap := _ccap || jsonb_build_object(_t.key, _t.questions);
    ELSE
      _fcap := _fcap || jsonb_build_object(_t.key, _t.questions);
    END IF;
  END LOOP;
  _wanted := _ccap;

  SELECT array_agg(c.id          ORDER BY c.rnk, c.last_at NULLS FIRST, c.r),
         array_agg(c.chapter_id::text ORDER BY c.rnk, c.last_at NULLS FIRST, c.r),
         array_agg(c.form        ORDER BY c.rnk, c.last_at NULLS FIRST, c.r),
         array_agg(c.rnk         ORDER BY c.rnk, c.last_at NULLS FIRST, c.r)
    INTO _ids, _chs, _forms, _ranks
    FROM (SELECT p.id, p.chapter_id, p.form,
                 CASE WHEN h.qid IS NULL THEN 0 WHEN h.troubled THEN 1 ELSE 2 END AS rnk,
                 h.last_at, random() AS r
            FROM public._mock_pool(_exam, _subject, _chapter) p
            LEFT JOIN public._mock_history(_uid) h ON h.qid = p.id
           WHERE _ccap ? p.chapter_id::text) c;

  _n := COALESCE(cardinality(_ids), 0);
  IF _n < _want THEN
    RETURN NULL;
  END IF;
  _take := array_fill(false, ARRAY[_n]);

  -- 1. The paper's forms beside direct questions, up to their share.
  FOR _i IN 1.._n LOOP
    EXIT WHEN _total >= _want;
    IF _forms[_i] <> 'mcq' AND COALESCE((_fcap->>_forms[_i])::int, 0) > 0
       AND (_ccap->>_chs[_i])::int > 0 THEN
      _take[_i] := true;
      _total := _total + 1;
      _fcap := jsonb_set(_fcap, ARRAY[_forms[_i]], to_jsonb((_fcap->>_forms[_i])::int - 1));
      _ccap := jsonb_set(_ccap, ARRAY[_chs[_i]], to_jsonb((_ccap->>_chs[_i])::int - 1));
    END IF;
  END LOOP;

  -- 2. Each chapter to its share: direct questions and forms with room first, then any.
  FOR _pass IN 1..2 LOOP
    FOR _i IN 1.._n LOOP
      EXIT WHEN _total >= _want;
      CONTINUE WHEN _take[_i] OR (_ccap->>_chs[_i])::int <= 0;
      CONTINUE WHEN _pass = 1 AND _forms[_i] <> 'mcq' AND COALESCE((_fcap->>_forms[_i])::int, 0) <= 0;
      _take[_i] := true;
      _total := _total + 1;
      _ccap := jsonb_set(_ccap, ARRAY[_chs[_i]], to_jsonb((_ccap->>_chs[_i])::int - 1));
      IF _fcap ? _forms[_i] THEN
        _fcap := jsonb_set(_fcap, ARRAY[_forms[_i]], to_jsonb((_fcap->>_forms[_i])::int - 1));
      END IF;
    END LOOP;
  END LOOP;

  -- 3. What a short chapter could not give, from the rest: one per chapter a round.
  WHILE _total < _want LOOP
    _round := false;
    _seen := '{}'::jsonb;
    FOR _i IN 1.._n LOOP
      EXIT WHEN _total >= _want;
      CONTINUE WHEN _take[_i] OR _seen ? _chs[_i];
      _take[_i] := true;
      _total := _total + 1;
      _seen := _seen || jsonb_build_object(_chs[_i], true);
      _round := true;
    END LOOP;
    EXIT WHEN NOT _round;
  END LOOP;
  IF _total < _want THEN
    RETURN NULL;
  END IF;

  SELECT array_agg(u.x ORDER BY random()) INTO _picked
    FROM unnest(_ids) WITH ORDINALITY AS u(x, o)
   WHERE _take[u.o];

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'chapter_id', w.key, 'chapter', c.name, 'wanted', w.value::int, 'got', COALESCE(g.got, 0))
           ORDER BY c.name), '[]'::jsonb)
    INTO _short
    FROM jsonb_each_text(_wanted) w
    JOIN public.chapters c ON c.id = w.key::uuid
    LEFT JOIN (SELECT _chs[o] AS ch, count(*)::int AS got
                 FROM generate_subscripts(_ids, 1) AS o WHERE _take[o] GROUP BY _chs[o]) g ON g.ch = w.key
   WHERE COALESCE(g.got, 0) < w.value::int;

  RETURN jsonb_build_object(
    'ids',         to_jsonb(_picked),
    'seen_before', (SELECT count(*) FROM generate_subscripts(_ids, 1) AS o WHERE _take[o] AND _ranks[o] > 0),
    'troubled',    (SELECT count(*) FROM generate_subscripts(_ids, 1) AS o WHERE _take[o] AND _ranks[o] = 1),
    'short',       _short);
END $$;

-- What a paper is, before it starts, for this student: its subject, chapter,
-- size and clock; how many of its questions they have met and how many of those
-- went badly; its forms against the blueprint's; the chapters that came up short.
CREATE FUNCTION public._mock_paper_preview(_paper uuid, _uid uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _p     public.mock_papers%ROWTYPE;
  _shape jsonb := public._mock_paper();
BEGIN
  SELECT * INTO _p FROM public.mock_papers WHERE id = _paper;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'mock_paper_not_found' USING ERRCODE = 'P0002';
  END IF;
  RETURN jsonb_build_object(
    'paper_id',     _p.id,
    'subject',      _p.subject,
    'chapter_id',   _p.chapter_id,
    'chapter',      (SELECT c.name FROM public.chapters c WHERE c.id = _p.chapter_id),
    'options',      (SELECT COALESCE(jsonb_agg(jsonb_build_object('group', o.option_group, 'option', o.option, 'label', o.label)
                                               ORDER BY o.option_group), '[]'::jsonb)
                       FROM public.exam_blueprint_options o
                      WHERE o.exam_id = _p.exam_id AND o.subject = _p.subject
                        AND o.option = _p.options->>o.option_group),
    'total',        cardinality(_p.question_ids),
    'minutes',      _shape->'minutes',
    'marks_correct', _shape->'marks_correct',
    'marks_wrong',  _shape->'marks_wrong',
    'seen_before',  (SELECT count(*) FROM unnest(_p.question_ids) q JOIN public._mock_history(_uid) h ON h.qid = q),
    'troubled',     (SELECT count(*) FROM unnest(_p.question_ids) q JOIN public._mock_history(_uid) h ON h.qid = q AND h.troubled),
    'forms',        (SELECT COALESCE(jsonb_object_agg(f.form, f.n), '{}'::jsonb)
                       FROM (SELECT COALESCE(qb.question_format, 'mcq') AS form, count(*)::int AS n
                               FROM unnest(_p.question_ids) q JOIN public.question_bank qb ON qb.id = q
                              GROUP BY 1) f),
    'blueprint_forms', (SELECT COALESCE(jsonb_object_agg(t.key, t.questions), '{}'::jsonb)
                          FROM public._mock_targets(_p.exam_id, _p.subject, _p.chapter_id, _p.options) t
                         WHERE t.kind = 'form'),
    'short',        _p.short);
END $$;

-- ── 5. The student's doors ──────────────────────────────────────────────────

-- Every subject of the student's syllabus: how many questions a mock may draw
-- on, the choices it asks for, whether a whole paper can be built under the
-- choices made, and every chapter with whether a chapter paper can be.
CREATE OR REPLACE FUNCTION public.rpc_mock_catalog()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid    uuid := auth.uid();
  _exam   uuid;
  _stream text;
  _want   int := (public._mock_paper()->>'questions')::int;
  _open   uuid;
  _subs   jsonb := '[]'::jsonb;
  _s      record;
  _opts   jsonb;
  _ready  boolean;
  _hist   int;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'auth required' USING ERRCODE = '42501'; END IF;

  SELECT ea.exam_id, ea.stream INTO _exam, _stream FROM public.exam_accounts ea WHERE ea.account_id = _uid;
  IF _exam IS NULL THEN
    -- A school student practises by chapter and sits their school's tests;
    -- a full CUET paper is not theirs to sit.
    RETURN jsonb_build_object('individual', false, 'paper', public._mock_paper());
  END IF;

  PERFORM public._mock_close_expired(_uid);
  SELECT a.id INTO _open FROM public.mock_attempts a
   WHERE a.user_id = _uid AND a.submitted_at IS NULL ORDER BY a.started_at DESC LIMIT 1;

  FOR _s IN SELECT DISTINCT y.subject FROM public._mock_syllabus(_exam, _stream) y ORDER BY y.subject LOOP
    _opts := public._mock_options(_uid, _exam, _s.subject, NULL);
    -- Ready: every choice made, and the chapters of the blueprint under them
    -- hold a paper's worth (a short chapter is made up by the rest).
    BEGIN
      _ready := (SELECT count(*) FROM public._mock_pool(_exam, _s.subject, NULL) p
                  WHERE p.chapter_id::text IN (SELECT t.key FROM public._mock_targets(_exam, _s.subject, NULL, _opts) t
                                                WHERE t.kind = 'chapter')) >= _want;
    EXCEPTION WHEN others THEN
      IF SQLERRM <> 'mock_option_not_chosen' THEN RAISE; END IF;
      _ready := false;
    END;
    _subs := _subs || jsonb_build_object(
      'subject',   _s.subject,
      'questions', (SELECT count(*) FROM public._mock_pool(_exam, _s.subject, NULL)),
      'ready',     _ready,
      'options',   (SELECT COALESCE(jsonb_agg(jsonb_build_object(
                              'group',   g.option_group,
                              'label',   g.group_label,
                              'chosen',  _opts->>g.option_group,
                              'choices', g.choices) ORDER BY g.option_group), '[]'::jsonb)
                       FROM (SELECT o.option_group, min(o.group_label) AS group_label,
                                    jsonb_agg(jsonb_build_object('option', o.option, 'label', o.label) ORDER BY o.position) AS choices
                               FROM public.exam_blueprint_options o
                              WHERE o.exam_id = _exam AND o.subject = _s.subject
                              GROUP BY o.option_group) g),
      'chapters',  (SELECT COALESCE(jsonb_agg(jsonb_build_object(
                              'chapter_id', y.chapter_id,
                              'chapter',    y.chapter,
                              'questions',  COALESCE(n.cnt, 0),
                              'ready',      COALESCE(n.cnt, 0) >= _want) ORDER BY y.seq), '[]'::jsonb)
                       FROM public._mock_syllabus(_exam, _stream) y
                       LEFT JOIN (SELECT p.chapter_id, count(*)::int AS cnt
                                    FROM public._mock_pool(_exam, _s.subject, NULL) p GROUP BY p.chapter_id) n
                              ON n.chapter_id = y.chapter_id
                      WHERE y.subject = _s.subject));
  END LOOP;

  SELECT count(*)::int INTO _hist FROM public.mock_attempts a WHERE a.user_id = _uid AND a.submitted_at IS NOT NULL;

  RETURN jsonb_build_object(
    'individual', true,
    'paper',      public._mock_paper(),
    'subjects',   _subs,
    'taken',      _hist,
    -- The plan's answer WITHOUT counting a use: the screen shows what is left
    -- before anyone starts anything.
    'plan',       public._premium_decide(_uid, 'mock_test.start', 1, false),
    'open',       CASE WHEN _open IS NULL THEN NULL ELSE public._mock_paper_view(_open) END);
END $$;

-- A choice made once for a subject's papers (A1 decisions 4 and 5): Unit V,
-- Section B. It can be changed; papers already sat keep the choice they had.
CREATE FUNCTION public.rpc_set_exam_option(_subject text, _group text, _option text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid  uuid := auth.uid();
  _exam uuid;
  _o    public.exam_blueprint_options%ROWTYPE;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'auth required' USING ERRCODE = '42501'; END IF;
  SELECT ea.exam_id INTO _exam FROM public.exam_accounts ea WHERE ea.account_id = _uid;
  IF _exam IS NULL THEN
    RAISE EXCEPTION 'mock_tests_are_for_exam_accounts' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO _o FROM public.exam_blueprint_options o
   WHERE o.exam_id = _exam AND lower(o.subject) = lower(btrim(COALESCE(_subject, '')))
     AND o.option_group = _group AND o.option = _option;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'mock_option_unknown' USING ERRCODE = 'P0001';
  END IF;
  INSERT INTO public.exam_option_choices (account_id, exam_id, subject, option_group, option)
  VALUES (_uid, _exam, _o.subject, _o.option_group, _o.option)
  ON CONFLICT (account_id, exam_id, subject, option_group)
  DO UPDATE SET option = EXCLUDED.option, chosen_at = now();
  RETURN jsonb_build_object('subject', _o.subject, 'group', _o.option_group, 'option', _o.option, 'label', _o.label);
END $$;

-- The paper the student would sit, before the clock starts: a library paper
-- none of whose questions they have met and which they have not sat — the
-- oldest first, so papers are shared — or else one built for them (B4) and
-- kept in the library. Counts nothing against the plan.
CREATE FUNCTION public.rpc_mock_prepare(_subject text, _chapter uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid    uuid := auth.uid();
  _exam   uuid;
  _stream text;
  _subj   text;
  _want   int := (public._mock_paper()->>'questions')::int;
  _opts   jsonb;
  _pid    uuid;
  _built  jsonb;
  _try    int;
  _ids    uuid[];
  _have   int;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'auth required' USING ERRCODE = '42501'; END IF;
  SELECT ea.exam_id, ea.stream INTO _exam, _stream FROM public.exam_accounts ea WHERE ea.account_id = _uid;
  IF _exam IS NULL THEN
    RAISE EXCEPTION 'mock_tests_are_for_exam_accounts' USING ERRCODE = '42501',
      DETAIL = 'A full CUET paper belongs to an exam account.';
  END IF;

  -- The subject and chapter as the student's syllabus names them.
  SELECT y.subject INTO _subj FROM public._mock_syllabus(_exam, _stream) y
   WHERE lower(y.subject) = lower(btrim(COALESCE(_subject, '')))
     AND (_chapter IS NULL OR y.chapter_id = _chapter)
   LIMIT 1;
  IF _subj IS NULL THEN
    RAISE EXCEPTION 'mock_subject_unknown' USING ERRCODE = 'P0001',
      DETAIL = format('%s is not in this account''s syllabus.', COALESCE(_subject, ''));
  END IF;

  _opts := public._mock_options(_uid, _exam, _subj, _chapter);

  -- 1. A library paper this student has never met a question of, nor sat, and
  --    every question of which may still be in a mock.
  SELECT p.id INTO _pid
    FROM public.mock_papers p
   WHERE p.exam_id = _exam AND p.subject = _subj
     AND p.chapter_id IS NOT DISTINCT FROM _chapter
     AND p.options = _opts
     AND NOT EXISTS (SELECT 1 FROM public.mock_attempts a WHERE a.paper_id = p.id AND a.user_id = _uid)
     AND NOT EXISTS (SELECT 1 FROM unnest(p.question_ids) q JOIN public._mock_history(_uid) h ON h.qid = q)
     AND (SELECT count(*) FROM unnest(p.question_ids) q
           WHERE q IN (SELECT m.id FROM public._mock_pool(_exam, _subj, _chapter) m)) = cardinality(p.question_ids)
   ORDER BY p.created_at, p.id
   LIMIT 1;

  -- 2. Otherwise one built for this student, never the set of a paper they have sat.
  IF _pid IS NULL THEN
    FOR _try IN 1..5 LOOP
      _built := public._mock_build(_uid, _exam, _subj, _chapter, _opts);
      IF _built IS NULL THEN
        SELECT count(*) INTO _have FROM public._mock_pool(_exam, _subj, _chapter);
        RAISE EXCEPTION 'mock_not_enough_questions' USING ERRCODE = 'P0001',
          DETAIL = format('%s has %s of the %s questions a paper needs.',
                          COALESCE((SELECT c.name FROM public.chapters c WHERE c.id = _chapter), _subj), _have, _want);
      END IF;
      SELECT array_agg(x::uuid) INTO _ids FROM jsonb_array_elements_text(_built->'ids') x;
      EXIT WHEN NOT EXISTS (
        SELECT 1 FROM public.mock_attempts a JOIN public.mock_papers p ON p.id = a.paper_id
         WHERE a.user_id = _uid
           AND (SELECT array_agg(x ORDER BY x) FROM unnest(p.question_ids) x)
             = (SELECT array_agg(x ORDER BY x) FROM unnest(_ids) x));
      _ids := NULL;
    END LOOP;
    IF _ids IS NULL THEN
      RAISE EXCEPTION 'mock_paper_exhausted' USING ERRCODE = 'P0001',
        DETAIL = 'Every paper these questions can make is one you have already sat.';
    END IF;
    INSERT INTO public.mock_papers (exam_id, subject, chapter_id, options, question_ids, short, created_for)
    VALUES (_exam, _subj, _chapter, _opts, _ids, _built->'short', _uid)
    RETURNING id INTO _pid;
  END IF;

  RETURN public._mock_paper_preview(_pid, _uid);
END $$;

-- Start a prepared paper: one open at a time, never a paper this student has
-- sat, and the plan decides and counts in one statement (B7: unchanged).
CREATE FUNCTION public.rpc_mock_start(_paper uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid   uuid := auth.uid();
  _shape jsonb := public._mock_paper();
  _exam  uuid;
  _p     public.mock_papers%ROWTYPE;
  _att   uuid;
  _d     jsonb;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'auth required' USING ERRCODE = '42501'; END IF;
  SELECT ea.exam_id INTO _exam FROM public.exam_accounts ea WHERE ea.account_id = _uid;
  IF _exam IS NULL THEN
    RAISE EXCEPTION 'mock_tests_are_for_exam_accounts' USING ERRCODE = '42501',
      DETAIL = 'A full CUET paper belongs to an exam account.';
  END IF;

  PERFORM public._mock_close_expired(_uid);
  IF EXISTS (SELECT 1 FROM public.mock_attempts a WHERE a.user_id = _uid AND a.submitted_at IS NULL) THEN
    RAISE EXCEPTION 'mock_attempt_already_open' USING ERRCODE = 'P0001',
      DETAIL = 'One paper at a time: finish or submit the one already open.';
  END IF;

  SELECT * INTO _p FROM public.mock_papers p WHERE p.id = _paper AND p.exam_id = _exam;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'mock_paper_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF EXISTS (SELECT 1 FROM public.mock_attempts a WHERE a.paper_id = _p.id AND a.user_id = _uid) THEN
    RAISE EXCEPTION 'mock_paper_already_sat' USING ERRCODE = 'P0001',
      DETAIL = 'You have sat this paper. Prepare another.';
  END IF;

  -- The plan decides and counts in one statement. It raises plan_limit:<feature>
  -- with the decision as DETAIL, which is what the app recognises.
  _d := public._premium_require(_uid, 'mock_test.start', 1);

  INSERT INTO public.mock_attempts (user_id, paper_id, total, seen_before, marks_correct, marks_wrong, deadline, usage_period_key)
  VALUES (
    _uid, _p.id, cardinality(_p.question_ids),
    (SELECT count(*) FROM unnest(_p.question_ids) q JOIN public._mock_history(_uid) h ON h.qid = q),
    (_shape->>'marks_correct')::int, (_shape->>'marks_wrong')::int,
    now() + make_interval(mins => (_shape->>'minutes')::int),
    _d->>'period_key')
  RETURNING id INTO _att;

  RETURN public._mock_paper_view(_att);
END $$;

-- The paper as it is sat: the questions WITHOUT any answer, and the student's
-- own choices, marks and guesses.
CREATE OR REPLACE FUNCTION public._mock_paper_view(_attempt uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
  _a   public.mock_attempts%ROWTYPE;
  _p   public.mock_papers%ROWTYPE;
  _qs  jsonb;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'auth required' USING ERRCODE = '42501'; END IF;

  SELECT * INTO _a FROM public.mock_attempts a WHERE a.id = _attempt AND a.user_id = _uid;
  IF NOT FOUND THEN
    -- The same answer for another account's paper and for one that does not
    -- exist: whose papers exist is not the caller's business either.
    RAISE EXCEPTION 'mock_attempt_not_found' USING ERRCODE = 'P0002';
  END IF;
  SELECT * INTO _p FROM public.mock_papers WHERE id = _a.paper_id;

  SELECT jsonb_agg(jsonb_build_object(
           'order',     q.ord,
           'id',        q.qid,
           'available', qb.id IS NOT NULL,
           'question',  qb.question,
           'options',   COALESCE(qb.options, '[]'::jsonb),
           'format',    COALESCE(qb.question_format, 'mcq'),
           'chapter',   qb.chapter,
           'choice',    ans.choice,
           'marked',    COALESCE(ans.marked, false),
           'guessed',   ans.guessed
         ) ORDER BY q.ord)
    INTO _qs
    FROM unnest(_p.question_ids) WITH ORDINALITY AS q(qid, ord)
    LEFT JOIN public.question_bank qb ON qb.id = q.qid
    LEFT JOIN public.mock_answers ans ON ans.attempt_id = _a.id AND ans.question_id = q.qid;

  RETURN jsonb_build_object(
    'id',            _a.id,
    'paper_id',      _p.id,
    'subject',       _p.subject,
    'chapter_id',    _p.chapter_id,
    'chapter',       (SELECT c.name FROM public.chapters c WHERE c.id = _p.chapter_id),
    'started_at',    _a.started_at,
    'deadline',      _a.deadline,
    'submitted_at',  _a.submitted_at,
    'total',         _a.total,
    'seen_before',   _a.seen_before,
    'marks_correct', _a.marks_correct,
    'marks_wrong',   _a.marks_wrong,
    'max_score',     _a.total * _a.marks_correct,
    'questions',     COALESCE(_qs, '[]'::jsonb));
END $$;

-- Save one answer: the choice (NULL clears it), the mark for review, the
-- time on it, and whether it was a guess.
CREATE FUNCTION public.rpc_mock_save_answer(
  _attempt uuid, _question uuid,
  _choice integer DEFAULT NULL, _marked boolean DEFAULT NULL, _time_ms integer DEFAULT NULL,
  _guessed boolean DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid  uuid := auth.uid();
  _view jsonb;
  _q    jsonb;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'auth required' USING ERRCODE = '42501'; END IF;

  -- One read, and it is the same view the paper is sat from: it fences the
  -- attempt to the caller, and it says what the questions and options are.
  _view := public._mock_paper_view(_attempt);

  IF (_view->>'submitted_at') IS NOT NULL THEN
    RAISE EXCEPTION 'mock_already_submitted' USING ERRCODE = 'P0001',
      DETAIL = 'This paper is already marked.';
  END IF;
  IF (_view->>'deadline')::timestamptz <= now() THEN
    RAISE EXCEPTION 'mock_time_is_up' USING ERRCODE = 'P0001',
      DETAIL = 'The hour is over. Submit to see the result.';
  END IF;

  SELECT e INTO _q FROM jsonb_array_elements(_view->'questions') e
   WHERE (e->>'id')::uuid = _question;
  IF _q IS NULL THEN
    RAISE EXCEPTION 'mock_question_not_in_paper' USING ERRCODE = 'P0001';
  END IF;
  IF _choice IS NOT NULL
     AND (_choice < 0 OR _choice >= jsonb_array_length(_q->'options')) THEN
    RAISE EXCEPTION 'mock_choice_out_of_range' USING ERRCODE = '22023';
  END IF;

  -- A guess is said of an answer, so a blank one — never given, or cleared —
  -- is no guess, whatever was sent with it.
  INSERT INTO public.mock_answers AS m (attempt_id, question_id, choice, marked, time_ms, guessed)
  VALUES (_attempt, _question, _choice, COALESCE(_marked, false), _time_ms,
          CASE WHEN _choice IS NULL THEN NULL ELSE _guessed END)
  ON CONFLICT (attempt_id, question_id) DO UPDATE SET
    choice     = EXCLUDED.choice,
    marked     = COALESCE(_marked, m.marked),
    time_ms    = GREATEST(COALESCE(EXCLUDED.time_ms, 0), COALESCE(m.time_ms, 0)),
    guessed    = CASE WHEN EXCLUDED.choice IS NULL THEN NULL ELSE COALESCE(EXCLUDED.guessed, m.guessed) END,
    updated_at = now();

  RETURN jsonb_build_object('saved', true, 'deadline', _view->>'deadline');
END $$;

-- Mark a paper, once: each answer against the bank, a withdrawn question
-- voided, every wrong answer into the Mistake Book as practice puts it there.
CREATE OR REPLACE FUNCTION public._mock_grade(_attempt uuid, _auto boolean)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _a          public.mock_attempts%ROWTYPE;
  _p          public.mock_papers%ROWTYPE;
  _q          record;
  _g          record;
  _gradable   boolean;
  _chapter_id uuid;
  _correct    int := 0;
  _wrong      int := 0;
  _unanswered int := 0;
  _voided     int := 0;
BEGIN
  SELECT * INTO _a FROM public.mock_attempts a WHERE a.id = _attempt FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'mock_attempt_not_found' USING ERRCODE = 'P0002'; END IF;
  IF _a.submitted_at IS NOT NULL THEN RETURN; END IF;   -- already marked; marking is once
  SELECT * INTO _p FROM public.mock_papers WHERE id = _a.paper_id;

  FOR _q IN
    SELECT q.qid, q.ord, ans.choice
      FROM unnest(_p.question_ids) WITH ORDINALITY AS q(qid, ord)
      LEFT JOIN public.mock_answers ans ON ans.attempt_id = _a.id AND ans.question_id = q.qid
     ORDER BY q.ord
  LOOP
    IF _q.choice IS NULL THEN
      _unanswered := _unanswered + 1;
      CONTINUE;
    END IF;

    _gradable := true;
    BEGIN
      SELECT * INTO _g
        FROM public._practice_grade_from_bank(_q.qid, jsonb_build_object('index', _q.choice));
      IF NOT FOUND THEN _gradable := false; END IF;
    EXCEPTION WHEN others THEN
      -- The only expected failure is a question that is no longer in the bank
      -- or no longer approved. Anything else is a real error and must not be
      -- swallowed into a quiet zero.
      IF SQLERRM <> 'bank_question_not_found' THEN RAISE; END IF;
      _gradable := false;
    END;

    IF NOT _gradable THEN
      _voided := _voided + 1;
      UPDATE public.mock_answers SET is_correct = NULL
       WHERE attempt_id = _a.id AND question_id = _q.qid;
      CONTINUE;
    END IF;

    UPDATE public.mock_answers SET is_correct = _g.is_correct
     WHERE attempt_id = _a.id AND question_id = _q.qid;

    IF _g.is_correct THEN
      _correct := _correct + 1;
    ELSE
      _wrong := _wrong + 1;
      -- The chapter, from the question's own topic: §5.1 reads this ARGUMENT
      -- to decide whether the miss bumps mastery and joins revision.
      SELECT t.chapter_id INTO _chapter_id FROM public.topics t WHERE t.id = _g.topic_id;
      PERFORM public.rpc_record_concept_mistake(
        'practice', _a.id, _q.qid,
        COALESCE(_g.subject, _p.subject), _g.chapter,
        COALESCE(_g.topic, _g.chapter), COALESCE(_g.topic, _g.chapter),
        _g.class_level,
        COALESCE(_g.question_text, ''),
        COALESCE(_g.options, '[]'::jsonb),
        jsonb_build_object('index', _q.choice),
        _g.correct_answer,
        COALESCE(_g.explanation, ''),
        _chapter_id);
    END IF;
  END LOOP;

  UPDATE public.mock_attempts a
     SET submitted_at   = now(),
         auto_submitted = _auto,
         correct        = _correct,
         wrong          = _wrong,
         unanswered     = _unanswered,
         voided         = _voided,
         score          = _correct * a.marks_correct + _wrong * a.marks_wrong
   WHERE a.id = _a.id;
END $$;

-- A marked paper: the score, and every question with the right answer, its
-- topic, form and difficulty, the time on it and whether it was a guess — the
-- rows the four-tab analysis reads (B5). Refused while the paper is open.
CREATE OR REPLACE FUNCTION public._mock_result_json(_attempt uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid  uuid := auth.uid();
  _a    public.mock_attempts%ROWTYPE;
  _p    public.mock_papers%ROWTYPE;
  _q    record;
  _g    record;
  _rows jsonb := '[]'::jsonb;
  _gradable boolean;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'auth required' USING ERRCODE = '42501'; END IF;
  SELECT * INTO _a FROM public.mock_attempts a WHERE a.id = _attempt AND a.user_id = _uid;
  IF NOT FOUND THEN RAISE EXCEPTION 'mock_attempt_not_found' USING ERRCODE = 'P0002'; END IF;
  IF _a.submitted_at IS NULL THEN
    -- Nothing about the answers travels while the paper is still open.
    RAISE EXCEPTION 'mock_not_submitted' USING ERRCODE = 'P0001';
  END IF;
  SELECT * INTO _p FROM public.mock_papers WHERE id = _a.paper_id;

  FOR _q IN
    SELECT q.qid, q.ord, ans.choice, ans.is_correct, ans.time_ms, ans.guessed,
           COALESCE(qb.question_format, 'mcq') AS form
      FROM unnest(_p.question_ids) WITH ORDINALITY AS q(qid, ord)
      LEFT JOIN public.mock_answers ans ON ans.attempt_id = _a.id AND ans.question_id = q.qid
      LEFT JOIN public.question_bank qb ON qb.id = q.qid
     ORDER BY q.ord
  LOOP
    _gradable := true;
    BEGIN
      SELECT * INTO _g
        FROM public._practice_grade_from_bank(_q.qid, jsonb_build_object('index', COALESCE(_q.choice, -1)));
      IF NOT FOUND THEN _gradable := false; END IF;
    EXCEPTION WHEN others THEN
      IF SQLERRM <> 'bank_question_not_found' THEN RAISE; END IF;
      _gradable := false;
    END;

    _rows := _rows || jsonb_build_object(
      'order',      _q.ord,
      'id',         _q.qid,
      'available',  _gradable,
      'question',   CASE WHEN _gradable THEN _g.question_text END,
      'options',    CASE WHEN _gradable THEN _g.options ELSE '[]'::jsonb END,
      'format',     _q.form,
      'chapter',    CASE WHEN _gradable THEN _g.chapter END,
      'topic',      CASE WHEN _gradable THEN _g.topic END,
      'difficulty', CASE WHEN _gradable THEN _g.difficulty END,
      'explanation',CASE WHEN _gradable THEN _g.explanation END,
      'correct',    CASE WHEN _gradable THEN _g.correct_answer END,
      'choice',     _q.choice,
      'is_correct', _q.is_correct,
      'guessed',    _q.guessed,
      'marks',      CASE
                      WHEN _q.choice IS NULL OR _q.is_correct IS NULL THEN 0
                      WHEN _q.is_correct THEN _a.marks_correct
                      ELSE _a.marks_wrong
                    END,
      'time_ms',    _q.time_ms);
  END LOOP;

  RETURN jsonb_build_object(
    'id',             _a.id,
    'paper_id',       _p.id,
    'subject',        _p.subject,
    'chapter_id',     _p.chapter_id,
    'chapter',        (SELECT c.name FROM public.chapters c WHERE c.id = _p.chapter_id),
    'started_at',     _a.started_at,
    'submitted_at',   _a.submitted_at,
    'auto_submitted', _a.auto_submitted,
    'seconds_taken',  GREATEST(0, floor(EXTRACT(EPOCH FROM (_a.submitted_at - _a.started_at)))::int),
    'total',          _a.total,
    'seen_before',    _a.seen_before,
    'correct',        _a.correct,
    'wrong',          _a.wrong,
    'unanswered',     _a.unanswered,
    'voided',         _a.voided,
    'score',          _a.score,
    'max_score',      _a.total * _a.marks_correct,
    'marks_correct',  _a.marks_correct,
    'marks_wrong',    _a.marks_wrong,
    'questions',      _rows);
END $$;

CREATE OR REPLACE FUNCTION public.rpc_my_mock_history()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid  uuid := auth.uid();
  _rows jsonb;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'auth required' USING ERRCODE = '42501'; END IF;
  PERFORM public._mock_close_expired(_uid);

  SELECT jsonb_agg(jsonb_build_object(
           'id',             a.id,
           'subject',        p.subject,
           'chapter',        c.name,
           'started_at',     a.started_at,
           'submitted_at',   a.submitted_at,
           'auto_submitted', a.auto_submitted,
           'correct',        a.correct,
           'wrong',          a.wrong,
           'unanswered',     a.unanswered,
           'voided',         a.voided,
           'score',          a.score,
           'total',          a.total,
           'max_score',      a.total * a.marks_correct,
           'seconds_taken',  GREATEST(0, floor(EXTRACT(EPOCH FROM (a.submitted_at - a.started_at)))::int)
         ) ORDER BY a.started_at DESC)
    INTO _rows
    FROM public.mock_attempts a
    JOIN public.mock_papers p ON p.id = a.paper_id
    LEFT JOIN public.chapters c ON c.id = p.chapter_id
   WHERE a.user_id = _uid AND a.submitted_at IS NOT NULL;

  RETURN COALESCE(_rows, '[]'::jsonb);
END $$;

-- What a marked paper's analysis needs beyond its own answers (B5), in the
-- shape rpc_session_analysis_context gives a practice session: the paper, the
-- last marked mock of the same kind (subject, or the same chapter) before this
-- one, and each question's last answer before this paper started.
CREATE FUNCTION public.rpc_mock_analysis_context(_attempt uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid  uuid := auth.uid();
  _a    public.mock_attempts%ROWTYPE;
  _p    public.mock_papers%ROWTYPE;
  _prev public.mock_attempts%ROWTYPE;
  _pp   public.mock_papers%ROWTYPE;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'auth required' USING ERRCODE = '42501'; END IF;
  SELECT * INTO _a FROM public.mock_attempts a WHERE a.id = _attempt AND a.user_id = _uid;
  IF NOT FOUND THEN RAISE EXCEPTION 'mock_attempt_not_found' USING ERRCODE = 'P0002'; END IF;
  IF _a.submitted_at IS NULL THEN RAISE EXCEPTION 'mock_not_submitted' USING ERRCODE = 'P0001'; END IF;
  SELECT * INTO _p FROM public.mock_papers WHERE id = _a.paper_id;

  SELECT a.* INTO _prev
    FROM public.mock_attempts a JOIN public.mock_papers p ON p.id = a.paper_id
   WHERE a.user_id = _uid AND a.id <> _a.id AND a.submitted_at IS NOT NULL
     AND a.submitted_at < _a.submitted_at
     AND p.subject = _p.subject AND p.chapter_id IS NOT DISTINCT FROM _p.chapter_id
   ORDER BY a.submitted_at DESC, a.id
   LIMIT 1;
  IF _prev.id IS NOT NULL THEN
    SELECT * INTO _pp FROM public.mock_papers WHERE id = _prev.paper_id;
  END IF;

  RETURN jsonb_build_object(
    'paper', (SELECT jsonb_build_object('questions', m->'questions', 'minutes', m->'minutes',
                                        'marks_correct', m->'marks_correct', 'marks_wrong', m->'marks_wrong')
                FROM (SELECT public._mock_paper() AS m) x),
    'previous', CASE WHEN _prev.id IS NULL THEN NULL ELSE jsonb_build_object(
      'id', _prev.id,
      'finished_at', _prev.submitted_at,
      'attempts', (SELECT COALESCE(jsonb_agg(jsonb_build_object(
                     'topic', t.name,
                     'is_correct', ans.is_correct,
                     'skipped', ans.choice IS NULL,
                     'timed_out', false,
                     'time_taken_ms', ans.time_ms,
                     'excluded', ans.choice IS NOT NULL AND ans.is_correct IS NULL) ORDER BY q.ord), '[]'::jsonb)
                     FROM unnest(_pp.question_ids) WITH ORDINALITY AS q(qid, ord)
                     LEFT JOIN public.mock_answers ans ON ans.attempt_id = _prev.id AND ans.question_id = q.qid
                     LEFT JOIN public.question_bank qb ON qb.id = q.qid
                     LEFT JOIN public.topics t ON t.id = qb.topic_id)) END,
    'earlier', (SELECT COALESCE(jsonb_agg(jsonb_build_object(
                  'bank_question_id', e.qid, 'is_correct', e.is_correct, 'skipped', e.skipped, 'at', e.at)), '[]'::jsonb)
                  FROM (SELECT DISTINCT ON (x.qid) x.qid, x.is_correct, x.skipped, x.at
                          FROM (SELECT qa.bank_question_id AS qid, qa.is_correct, COALESCE(qa.skipped, false) AS skipped, qa.created_at AS at
                                  FROM public.question_attempts qa
                                 WHERE qa.user_id = _uid AND qa.created_at < _a.started_at
                                   AND NOT COALESCE(qa.excluded_from_accuracy, false)
                                   AND qa.bank_question_id = ANY (_p.question_ids)
                                UNION ALL
                                SELECT ans.question_id, ans.is_correct, ans.choice IS NULL, a2.started_at
                                  FROM public.mock_attempts a2
                                  JOIN public.mock_answers ans ON ans.attempt_id = a2.id
                                 WHERE a2.user_id = _uid AND a2.id <> _a.id AND a2.submitted_at IS NOT NULL
                                   AND a2.started_at < _a.started_at
                                   AND ans.question_id = ANY (_p.question_ids)) x
                         ORDER BY x.qid, x.at DESC) e)
  );
END $$;

-- ── 6. Who may call what ────────────────────────────────────────────────────

REVOKE ALL ON FUNCTION public._mock_syllabus(uuid, text)                       FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._mock_pool(uuid, text, uuid)                     FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._mock_history(uuid)                              FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._mock_options(uuid, uuid, text, uuid)            FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._mock_targets(uuid, text, uuid, jsonb)           FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._mock_build(uuid, uuid, text, uuid, jsonb)       FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._mock_paper_preview(uuid, uuid)                  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._mock_paper()                                    FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._mock_paper_view(uuid)                           FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._mock_grade(uuid, boolean)                       FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._mock_result_json(uuid)                          FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION public.rpc_mock_catalog()                               FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.rpc_set_exam_option(text, text, text)            FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.rpc_mock_prepare(text, uuid)                     FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.rpc_mock_start(uuid)                             FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.rpc_mock_save_answer(uuid, uuid, integer, boolean, integer, boolean) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.rpc_my_mock_history()                            FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.rpc_mock_analysis_context(uuid)                  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rpc_mock_catalog()                            TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_set_exam_option(text, text, text)         TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_mock_prepare(text, uuid)                  TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_mock_start(uuid)                          TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_mock_save_answer(uuid, uuid, integer, boolean, integer, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_my_mock_history()                         TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_mock_analysis_context(uuid)               TO authenticated;

-- ── VERIFY ──────────────────────────────────────────────────────────────────

-- 1. Every subject's blueprint is a whole paper under every choice: its
--    chapters and its forms each add up to the paper's questions.
DO $verify$
DECLARE
  _want int := (public._mock_paper()->>'questions')::int;
  _s    record;
  _o    record;
  _c    int;
  _f    int;
BEGIN
  FOR _s IN SELECT DISTINCT f.exam_id, f.subject FROM public.exam_blueprint_forms f LOOP
    IF (SELECT count(DISTINCT o.option_group) FROM public.exam_blueprint_options o
         WHERE o.exam_id = _s.exam_id AND o.subject = _s.subject) > 1 THEN
      RAISE EXCEPTION 'VERIFY FAILED: % has two choices; this proof covers one', _s.subject;
    END IF;
    FOR _o IN
      SELECT o.option_group, o.option FROM public.exam_blueprint_options o
       WHERE o.exam_id = _s.exam_id AND o.subject = _s.subject
      UNION ALL
      SELECT '', '' WHERE NOT EXISTS (SELECT 1 FROM public.exam_blueprint_options o
                                       WHERE o.exam_id = _s.exam_id AND o.subject = _s.subject)
    LOOP
      SELECT COALESCE(sum(b.questions), 0) INTO _c
        FROM public.exam_blueprint_chapters b
        JOIN public.chapters c ON c.id = b.chapter_id
        JOIN public.curriculum_subjects cs ON cs.id = c.curriculum_subject_id
       WHERE b.exam_id = _s.exam_id AND cs.name = _s.subject
         AND (b.option_group = '' OR (b.option_group = _o.option_group AND b.option = _o.option));
      SELECT COALESCE(sum(f.questions), 0) INTO _f
        FROM public.exam_blueprint_forms f
       WHERE f.exam_id = _s.exam_id AND f.subject = _s.subject
         AND (f.option_group = '' OR (f.option_group = _o.option_group AND f.option = _o.option));
      IF _c <> _want OR _f <> _want THEN
        RAISE EXCEPTION 'VERIFY FAILED: % under "%" has % questions by chapter and % by form, not %',
          _s.subject, NULLIF(_o.option, ''), _c, _f, _want;
      END IF;
    END LOOP;
  END LOOP;
  IF (SELECT count(DISTINCT f.subject) FROM public.exam_blueprint_forms f) <> 6 THEN
    RAISE EXCEPTION 'VERIFY FAILED: the blueprint covers % subjects, not the six of the commerce stream',
      (SELECT count(DISTINCT f.subject) FROM public.exam_blueprint_forms f);
  END IF;
END $verify$;

-- 2. The journey, as a real exam account, and then rolled back on purpose.
DO $verify$
DECLARE
  _want     int := (public._mock_paper()->>'questions')::int;
  _acct     uuid;
  _exam     uuid;
  _stream   text;
  _cat      jsonb;
  _acc      jsonb;
  _prep     jsonb;
  _prep2    jsonb;
  _ids      uuid[];
  _ids2     uuid[];
  _view     jsonb;
  _att      uuid;
  _res      jsonb;
  _ctx      jsonb;
  _q        jsonb;
  _key      int;
  _right    int := 0;
  _wrongly  int := 0;
  _guess    int := 0;
  _leaked   int;
  _ch       uuid;
  _chname   text;
  _pool     int;
  _unmet    int;
  _troubled int;
  _err      text;
  _bad      text;
BEGIN
  -- The exam account whose syllabus holds the most Accountancy a mock may use.
  SELECT ea.account_id, ea.exam_id, ea.stream INTO _acct, _exam, _stream
    FROM public.exam_accounts ea
    JOIN public.competitive_exams e ON e.id = ea.exam_id AND e.code = 'cuet'
   ORDER BY (SELECT count(*) FROM public.question_bank q
              WHERE q.exam_id = ea.exam_id AND q.is_active AND q.is_approved AND q.subject = 'Accountancy'
                AND q.chapter_id IN (SELECT s.chapter_id FROM public.exam_syllabus_chapters s
                                      WHERE s.exam_id = ea.exam_id AND s.stream = ea.stream)) DESC,
            ea.created_at
   LIMIT 1;
  IF _acct IS NULL THEN
    RAISE EXCEPTION 'VERIFY FAILED: there is no CUET exam account to prove the mock creator with';
  END IF;

  BEGIN
    PERFORM set_config('request.jwt.claims', json_build_object('sub', _acct, 'role', 'authenticated')::text, true);
    DELETE FROM public.exam_option_choices WHERE account_id = _acct;

    -- 2a. Unit V not chosen: the catalog says Accountancy is not ready, and preparing refuses.
    SET LOCAL ROLE authenticated;
    _cat := public.rpc_mock_catalog();
    RESET ROLE;
    SELECT e INTO _acc FROM jsonb_array_elements(_cat->'subjects') e WHERE e->>'subject' = 'Accountancy';
    IF _acc IS NULL OR (_acc->>'ready')::boolean OR (_acc->'options'->0->>'group') <> 'unit_v'
       OR (_acc->'options'->0->>'chosen') IS NOT NULL THEN
      RAISE EXCEPTION 'VERIFY FAILED: Accountancy with Unit V unchosen reads %', _acc;
    END IF;
    SET LOCAL ROLE authenticated;
    BEGIN
      PERFORM public.rpc_mock_prepare('Accountancy');
      _err := 'none';
    EXCEPTION WHEN raise_exception THEN
      _err := SQLERRM;
    END;
    RESET ROLE;
    IF _err <> 'mock_option_not_chosen' THEN
      RAISE EXCEPTION 'VERIFY FAILED: an Accountancy paper without Unit V chosen gave %', _err;
    END IF;

    -- 2b. Analysis chosen: a whole paper, chapter by chapter as the blueprint says.
    SET LOCAL ROLE authenticated;
    PERFORM public.rpc_set_exam_option('Accountancy', 'unit_v', 'analysis');
    _cat := public.rpc_mock_catalog();
    _prep := public.rpc_mock_prepare('Accountancy');
    RESET ROLE;
    SELECT e INTO _acc FROM jsonb_array_elements(_cat->'subjects') e WHERE e->>'subject' = 'Accountancy';
    IF NOT (_acc->>'ready')::boolean THEN
      RAISE EXCEPTION 'VERIFY FAILED: Accountancy is not ready under Analysis: %', _acc;
    END IF;
    SELECT question_ids INTO _ids FROM public.mock_papers WHERE id = (_prep->>'paper_id')::uuid;
    IF cardinality(_ids) <> _want OR (SELECT count(DISTINCT x) FROM unnest(_ids) x) <> _want THEN
      RAISE EXCEPTION 'VERIFY FAILED: the Accountancy paper holds % questions, % distinct',
        cardinality(_ids), (SELECT count(DISTINCT x) FROM unnest(_ids) x);
    END IF;
    SELECT string_agg(format('%s %s of %s', c.name, COALESCE(g.n, 0), b.questions), '; ') INTO _bad
      FROM public.exam_blueprint_chapters b
      JOIN public.chapters c ON c.id = b.chapter_id
      LEFT JOIN (SELECT q.chapter_id, count(*)::int AS n FROM public.question_bank q WHERE q.id = ANY(_ids) GROUP BY 1) g
             ON g.chapter_id = b.chapter_id
     WHERE b.exam_id = _exam AND c.name IN (SELECT y.chapter FROM public._mock_syllabus(_exam, _stream) y WHERE y.subject = 'Accountancy')
       AND (b.option_group = '' OR b.option = 'analysis')
       AND COALESCE(g.n, 0) <> b.questions
       AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(_prep->'short') s WHERE (s->>'chapter_id')::uuid = b.chapter_id);
    IF _bad IS NOT NULL THEN
      RAISE EXCEPTION 'VERIFY FAILED: the Accountancy paper is off its blueprint: %', _bad;
    END IF;
    IF EXISTS (SELECT 1 FROM public.question_bank q JOIN public.chapters c ON c.id = q.chapter_id
                WHERE q.id = ANY(_ids) AND c.name = 'Computerised Accounting System') THEN
      RAISE EXCEPTION 'VERIFY FAILED: an Analysis paper holds Computerised Accounting questions';
    END IF;
    IF EXISTS (SELECT 1 FROM public.question_bank q WHERE q.id = ANY(_ids)
                AND (q.question_format = 'assertion_reason' OR q.explanation_status = 'disputed'
                     OR (q.source_type = 'ai_generated' AND NOT public._quality_review_passes(q.quality_review)))) THEN
      RAISE EXCEPTION 'VERIFY FAILED: the paper holds an assertion–reason, disputed or unreviewed AI question';
    END IF;

    -- 2c. Computerised Accounting chosen: its chapter is in, and if it is short the paper says so.
    SET LOCAL ROLE authenticated;
    PERFORM public.rpc_set_exam_option('Accountancy', 'unit_v', 'cas');
    _prep2 := public.rpc_mock_prepare('Accountancy');
    RESET ROLE;
    SELECT question_ids INTO _ids2 FROM public.mock_papers WHERE id = (_prep2->>'paper_id')::uuid;
    IF NOT EXISTS (SELECT 1 FROM public.question_bank q JOIN public.chapters c ON c.id = q.chapter_id
                    WHERE q.id = ANY(_ids2) AND c.name = 'Computerised Accounting System')
       OR EXISTS (SELECT 1 FROM public.question_bank q JOIN public.chapters c ON c.id = q.chapter_id
                   WHERE q.id = ANY(_ids2) AND c.name IN ('Ratio Analysis', 'Cash Flow Statement')) THEN
      RAISE EXCEPTION 'VERIFY FAILED: a Computerised Accounting paper does not follow its choice';
    END IF;
    IF (SELECT count(*) FROM public.question_bank q JOIN public.chapters c ON c.id = q.chapter_id
         WHERE q.id = ANY(_ids2) AND c.name = 'Computerised Accounting System') < 13
       AND NOT (_prep2->'short' @> '[{"chapter": "Computerised Accounting System"}]') THEN
      RAISE EXCEPTION 'VERIFY FAILED: Computerised Accounting gave fewer than its 13 and the paper did not say so: %', _prep2->'short';
    END IF;

    -- 2c'. What a mock may hold: no assertion–reason, no AI question without a
    --      passing review, no disputed key — checked on the pool itself, with the
    --      bank shown to hold such questions, so this cannot pass by finding none.
    IF NOT EXISTS (SELECT 1 FROM public.question_bank q WHERE q.exam_id = _exam AND q.is_active AND q.subject = 'Accountancy'
                    AND q.question_format = 'assertion_reason')
       OR NOT EXISTS (SELECT 1 FROM public.question_bank q WHERE q.exam_id = _exam AND q.is_active AND q.subject = 'Accountancy'
                       AND q.source_type = 'ai_generated' AND NOT public._quality_review_passes(q.quality_review)) THEN
      RAISE EXCEPTION 'VERIFY FAILED: the positive control is gone — no assertion–reason or unreviewed AI question to exclude';
    END IF;
    IF EXISTS (SELECT 1 FROM public._mock_pool(_exam, 'Accountancy', NULL) p JOIN public.question_bank q ON q.id = p.id
                WHERE q.question_format = 'assertion_reason' OR q.explanation_status = 'disputed'
                   OR (q.source_type = 'ai_generated' AND NOT public._quality_review_passes(q.quality_review))) THEN
      RAISE EXCEPTION 'VERIFY FAILED: the mock pool holds a question a mock must not';
    END IF;

    -- 2d. A subject that cannot fill a paper refuses, saying how short it is.
    SET LOCAL ROLE authenticated;
    BEGIN
      PERFORM public.rpc_mock_prepare('Economics');
      _err := 'none';
    EXCEPTION WHEN raise_exception THEN
      _err := SQLERRM;
    END;
    RESET ROLE;
    IF (SELECT count(*) FROM public._mock_pool(_exam, 'Economics', NULL)) < _want AND _err <> 'mock_not_enough_questions' THEN
      RAISE EXCEPTION 'VERIFY FAILED: Economics, short of a paper, gave %', _err;
    END IF;

    -- 2e. A chapter paper, sat and marked: an Accountancy chapter of about one
    --     and a half papers, so the next paper must CHOOSE which questions to
    --     repeat — a chapter of 51 would repeat nearly all of them whatever the order.
    SELECT y.chapter_id, y.chapter, n.cnt INTO _ch, _chname, _pool
      FROM public._mock_syllabus(_exam, _stream) y
      JOIN (SELECT p.chapter_id, count(*)::int AS cnt FROM public._mock_pool(_exam, 'Accountancy', NULL) p GROUP BY 1) n
        ON n.chapter_id = y.chapter_id
     WHERE y.subject = 'Accountancy' AND n.cnt >= _want
     ORDER BY abs(n.cnt - (_want * 3) / 2), y.chapter
     LIMIT 1;
    IF _ch IS NULL THEN
      RAISE EXCEPTION 'VERIFY FAILED: no Accountancy chapter holds a chapter paper to prove with';
    END IF;

    SET LOCAL ROLE authenticated;
    _prep := public.rpc_mock_prepare('Accountancy', _ch);
    _view := public.rpc_mock_start((_prep->>'paper_id')::uuid);
    RESET ROLE;
    _att := (_view->>'id')::uuid;
    IF jsonb_array_length(_view->'questions') <> _want THEN
      RAISE EXCEPTION 'VERIFY FAILED: the chapter paper handed over % questions', jsonb_array_length(_view->'questions');
    END IF;
    SELECT question_ids INTO _ids FROM public.mock_papers WHERE id = (_prep->>'paper_id')::uuid;
    IF (SELECT count(*) FROM public.question_bank q WHERE q.id = ANY(_ids) AND q.chapter_id <> _ch) > 0 THEN
      RAISE EXCEPTION 'VERIFY FAILED: a chapter paper holds another chapter''s questions';
    END IF;

    -- Nothing about the answers travels with the paper.
    _leaked := 0;
    FOR _q IN SELECT e FROM jsonb_array_elements(_view->'questions') e LOOP
      IF _q ?| ARRAY['correct', 'correct_index', 'answer', 'explanation', 'is_correct'] THEN _leaked := _leaked + 1; END IF;
    END LOOP;
    IF _leaked > 0 THEN
      RAISE EXCEPTION 'VERIFY FAILED: % questions handed to the student carry the answer', _leaked;
    END IF;

    -- Answer: 35 right, five wrong, two right but guessed, the rest blank — so
    --     most of what was met went well, and the questions that went badly are few.
    --     One blank is saved with the guess tap on, and must not count as a guess.
    FOR _q IN SELECT e FROM jsonb_array_elements(_view->'questions') e ORDER BY (e->>'order')::int LIMIT 43 LOOP
      SELECT qb.correct_index INTO _key FROM public.question_bank qb WHERE qb.id = (_q->>'id')::uuid;
      SET LOCAL ROLE authenticated;
      IF _right < 35 THEN
        PERFORM public.rpc_mock_save_answer(_att, (_q->>'id')::uuid, _key, false, 4000, false);
        _right := _right + 1;
      ELSIF _wrongly < 5 THEN
        PERFORM public.rpc_mock_save_answer(_att, (_q->>'id')::uuid, CASE WHEN _key = 0 THEN 1 ELSE 0 END, false, 9000, false);
        _wrongly := _wrongly + 1;
      ELSIF _guess < 2 THEN
        PERFORM public.rpc_mock_save_answer(_att, (_q->>'id')::uuid, _key, false, 3000, true);
        _guess := _guess + 1;
      ELSE
        PERFORM public.rpc_mock_save_answer(_att, (_q->>'id')::uuid, NULL, true, 2000, true);
      END IF;
      RESET ROLE;
    END LOOP;

    SET LOCAL ROLE authenticated;
    BEGIN
      PERFORM public.rpc_mock_result(_att);
      _err := 'none';
    EXCEPTION WHEN raise_exception THEN
      _err := SQLERRM;
    END;
    _res := public.rpc_mock_submit(_att);
    _ctx := public.rpc_mock_analysis_context(_att);
    RESET ROLE;
    IF _err <> 'mock_not_submitted' THEN
      RAISE EXCEPTION 'VERIFY FAILED: the result before submission gave %', _err;
    END IF;
    IF (_res->>'correct')::int <> _right + _guess OR (_res->>'wrong')::int <> _wrongly
       OR (_res->>'unanswered')::int <> _want - _right - _wrongly - _guess THEN
      RAISE EXCEPTION 'VERIFY FAILED: marked %', _res - 'questions';
    END IF;
    IF (SELECT count(*) FROM jsonb_array_elements(_res->'questions') e WHERE (e->>'guessed')::boolean) <> _guess
       OR (SELECT count(*) FROM jsonb_array_elements(_res->'questions') e WHERE e ? 'correct' AND e->'correct' <> 'null'::jsonb) = 0 THEN
      RAISE EXCEPTION 'VERIFY FAILED: the result does not carry the guesses and the answers';
    END IF;
    IF (_ctx->'paper'->>'questions')::int <> _want OR jsonb_typeof(_ctx->'earlier') <> 'array' THEN
      RAISE EXCEPTION 'VERIFY FAILED: the analysis context reads %', _ctx;
    END IF;

    -- 2f. The same chapter again (B4): never the paper just sat; the questions
    --     never met first; then the ones that went badly; and it says how many repeat.
    SELECT count(*) FILTER (WHERE h.qid IS NULL), count(*) FILTER (WHERE h.troubled)
      INTO _unmet, _troubled
      FROM public._mock_pool(_exam, 'Accountancy', _ch) p
      LEFT JOIN public._mock_history(_acct) h ON h.qid = p.id;
    SET LOCAL ROLE authenticated;
    _prep2 := public.rpc_mock_prepare('Accountancy', _ch);
    BEGIN
      PERFORM public.rpc_mock_start((_prep->>'paper_id')::uuid);
      _err := 'none';
    EXCEPTION WHEN raise_exception THEN
      _err := SQLERRM;
    END;
    RESET ROLE;
    IF _err <> 'mock_paper_already_sat' THEN
      RAISE EXCEPTION 'VERIFY FAILED: sitting the same paper again gave %', _err;
    END IF;
    IF _prep2->>'paper_id' = _prep->>'paper_id' THEN
      RAISE EXCEPTION 'VERIFY FAILED: the student was given the paper they had just sat';
    END IF;
    IF (_prep2->>'seen_before')::int <> _want - LEAST(_want, _unmet) THEN
      RAISE EXCEPTION 'VERIFY FAILED: % of the chapter''s questions were never met, so % should repeat; the paper repeats %',
        _unmet, _want - LEAST(_want, _unmet), _prep2->>'seen_before';
    END IF;
    IF (_prep2->>'troubled')::int <> LEAST((_prep2->>'seen_before')::int, _troubled) THEN
      RAISE EXCEPTION 'VERIFY FAILED: of % repeats, % went badly before, though % such questions were there to repeat',
        _prep2->>'seen_before', _prep2->>'troubled', _troubled;
    END IF;

    RAISE EXCEPTION 'proved';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'proved' THEN RAISE; END IF;
  END;
  PERFORM set_config('request.jwt.claims', NULL, true);
END $verify$;

-- 3. The doors: the helpers are no one's, the RPCs a signed-in student's, the tables nobody's.
DO $verify$
DECLARE
  _f text;
BEGIN
  FOREACH _f IN ARRAY ARRAY['public._mock_syllabus(uuid,text)', 'public._mock_pool(uuid,text,uuid)',
    'public._mock_history(uuid)', 'public._mock_options(uuid,uuid,text,uuid)', 'public._mock_targets(uuid,text,uuid,jsonb)',
    'public._mock_build(uuid,uuid,text,uuid,jsonb)', 'public._mock_paper_preview(uuid,uuid)', 'public._mock_paper_view(uuid)',
    'public._mock_grade(uuid,boolean)', 'public._mock_result_json(uuid)'] LOOP
    IF has_function_privilege('authenticated', _f, 'EXECUTE') OR has_function_privilege('anon', _f, 'EXECUTE') THEN
      RAISE EXCEPTION 'VERIFY FAILED: % is callable by a client role', _f;
    END IF;
  END LOOP;
  FOREACH _f IN ARRAY ARRAY['public.rpc_mock_catalog()', 'public.rpc_set_exam_option(text,text,text)',
    'public.rpc_mock_prepare(text,uuid)', 'public.rpc_mock_start(uuid)',
    'public.rpc_mock_save_answer(uuid,uuid,integer,boolean,integer,boolean)', 'public.rpc_my_mock_history()',
    'public.rpc_mock_analysis_context(uuid)'] LOOP
    IF NOT has_function_privilege('authenticated', _f, 'EXECUTE') OR has_function_privilege('anon', _f, 'EXECUTE') THEN
      RAISE EXCEPTION 'VERIFY FAILED: % is not a signed-in student''s alone', _f;
    END IF;
  END LOOP;
  IF has_table_privilege('authenticated', 'public.mock_papers', 'SELECT')
     OR has_table_privilege('authenticated', 'public.exam_option_choices', 'SELECT')
     OR has_table_privilege('authenticated', 'public.exam_blueprint_chapters', 'SELECT') THEN
    RAISE EXCEPTION 'VERIFY FAILED: a client role can read the mock tables directly';
  END IF;
END $verify$;

COMMIT;
