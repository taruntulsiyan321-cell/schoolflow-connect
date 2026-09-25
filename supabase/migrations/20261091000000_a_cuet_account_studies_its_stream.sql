-- ===========================================================================
-- A CUET ACCOUNT STUDIES ITS STREAM
--
-- CUET is sat by commerce, science and humanities students, each on the
-- subjects of their stream. Gurukul launches CUET Commerce (ruled 2026-09-25):
-- Accountancy, Business Studies, Economics, Mathematics / Applied Mathematics,
-- English and the General Aptitude Test.
--
-- An exam account had no stream, so nothing said which subjects were its
-- own. A question captured from a Chemistry section a commerce student opened
-- by mistake had nowhere correct to go — and "no chapter" is not allowed
-- either (ruled 2026-09-25: no question stays untagged). With a stream:
--
--   * a question in the stream's subjects is always tagged to one of the
--     stream's syllabus chapters;
--   * a question outside them is not the student's CUET work, and is not
--     saved (ruled 2026-09-25).
--
-- exam_accounts.stream   commerce | science | humanities, commerce by default
-- exam_syllabus_chapters the chapters of an exam's stream, in syllabus order —
--                        the ONE list of what a stream studies. A subject is in
--                        a stream when one of its chapters is. The bank
--                        catalog and the taggers read it.
--
-- ROLLBACK: rollback/20261091000000_a_cuet_account_studies_its_stream.rollback.sql
-- ===========================================================================

BEGIN;

ALTER TABLE public.exam_accounts
  ADD COLUMN stream text NOT NULL DEFAULT 'commerce'
  CONSTRAINT exam_accounts_stream_check CHECK (stream IN ('commerce', 'science', 'humanities'));
COMMENT ON COLUMN public.exam_accounts.stream IS
  'The stream the account prepares in; its subjects are the stream''s syllabus (exam_syllabus_chapters).';

CREATE TABLE public.exam_syllabus_chapters (
  exam_id    uuid NOT NULL REFERENCES public.competitive_exams(id) ON DELETE CASCADE,
  stream     text NOT NULL CHECK (stream IN ('commerce', 'science', 'humanities')),
  chapter_id uuid NOT NULL REFERENCES public.chapters(id) ON DELETE CASCADE,
  sequence   int  NOT NULL,
  PRIMARY KEY (exam_id, stream, chapter_id)
);
ALTER TABLE public.exam_syllabus_chapters ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.exam_syllabus_chapters FROM PUBLIC, anon;
GRANT SELECT ON public.exam_syllabus_chapters TO authenticated;
-- Reference data: every signed-in account may read every stream's syllabus.
CREATE POLICY exam_syllabus_chapters_read ON public.exam_syllabus_chapters
  FOR SELECT TO authenticated USING (true);
COMMENT ON TABLE public.exam_syllabus_chapters IS
  'The chapters each stream of a competitive exam studies, in syllabus order. 20261091000000.';

-- CUET Commerce, from the NTA CUET(UG) 2026 syllabi (see 20261090000000).
WITH cuet AS (
  SELECT ce.id AS exam_id, cc.id AS class_id
    FROM public.competitive_exams ce
    JOIN public.boards b ON b.code = ce.code
    JOIN public.curriculum_classes cc ON cc.board_id = b.id
   WHERE ce.code = 'cuet'
), syllabus (subject, subject_rank, chapter, seq) AS (VALUES
  ('Accountancy', 1, 'Accounting for Partnership', 1),
  ('Accountancy', 1, 'Reconstitution of Partnership', 2),
  ('Accountancy', 1, 'Admission of a New Partner', 3),
  ('Accountancy', 1, 'Retirement and Death of a Partner', 4),
  ('Accountancy', 1, 'Dissolution of a Partnership Firm', 5),
  ('Accountancy', 1, 'Accounting for Share Capital', 6),
  ('Accountancy', 1, 'Issue of Debentures', 7),
  ('Accountancy', 1, 'Financial Statements and Tools for Financial Analysis', 8),
  ('Accountancy', 1, 'Ratio Analysis', 9),
  ('Accountancy', 1, 'Cash Flow Statement', 10),
  ('Accountancy', 1, 'Computerised Accounting System', 11),
  ('Business Studies', 2, 'Nature and Significance of Management', 1),
  ('Business Studies', 2, 'Principles of Management', 2),
  ('Business Studies', 2, 'Business Environment', 3),
  ('Business Studies', 2, 'Planning', 4),
  ('Business Studies', 2, 'Organising', 5),
  ('Business Studies', 2, 'Staffing', 6),
  ('Business Studies', 2, 'Directing', 7),
  ('Business Studies', 2, 'Controlling', 8),
  ('Business Studies', 2, 'Financial Management', 9),
  ('Business Studies', 2, 'Financial Markets', 10),
  ('Business Studies', 2, 'Marketing Management', 11),
  ('Business Studies', 2, 'Consumer Protection', 12),
  ('Economics', 3, 'Introduction and Theory of Consumer Behaviour', 1),
  ('Economics', 3, 'Production and Costs', 2),
  ('Economics', 3, 'Theory of the Firm under Perfect Competition', 3),
  ('Economics', 3, 'Market Equilibrium and Simple Applications', 4),
  ('Economics', 3, 'Introduction and National Income Accounting', 5),
  ('Economics', 3, 'Money and Banking', 6),
  ('Economics', 3, 'Determination of Income and Employment', 7),
  ('Economics', 3, 'Government Budget and the Economy', 8),
  ('Economics', 3, 'Open Economy Macroeconomics', 9),
  ('Economics', 3, 'Development Policies and Experience (1947-90)', 10),
  ('Economics', 3, 'Economic Reforms since 1991', 11),
  ('Economics', 3, 'Current Challenges facing the Indian Economy', 12),
  ('Economics', 3, 'Development Experience of India: A Comparison with Neighbours', 13),
  ('Mathematics', 4, 'Relations and Functions', 1),
  ('Mathematics', 4, 'Inverse Trigonometric Functions', 2),
  ('Mathematics', 4, 'Matrices', 3),
  ('Mathematics', 4, 'Determinants', 4),
  ('Mathematics', 4, 'Continuity and Differentiability', 5),
  ('Mathematics', 4, 'Applications of Derivatives', 6),
  ('Mathematics', 4, 'Integrals', 7),
  ('Mathematics', 4, 'Applications of the Integrals', 8),
  ('Mathematics', 4, 'Differential Equations', 9),
  ('Mathematics', 4, 'Vectors', 10),
  ('Mathematics', 4, 'Three-dimensional Geometry', 11),
  ('Mathematics', 4, 'Linear Programming', 12),
  ('Mathematics', 4, 'Probability', 13),
  ('Mathematics', 4, 'Numbers, Quantification and Numerical Applications', 14),
  ('Mathematics', 4, 'Probability Distributions', 15),
  ('Mathematics', 4, 'Time Based Data', 16),
  ('Mathematics', 4, 'Inferential Statistics', 17),
  ('Mathematics', 4, 'Financial Mathematics', 18),
  ('English', 5, 'Reading Comprehension', 1),
  ('English', 5, 'Verbal Ability', 2),
  ('General Aptitude Test', 6, 'General Knowledge and Current Affairs', 1),
  ('General Aptitude Test', 6, 'General Mental Ability and Numerical Ability', 2),
  ('General Aptitude Test', 6, 'Quantitative Reasoning', 3),
  ('General Aptitude Test', 6, 'Logical and Analytical Reasoning', 4),
  ('General Aptitude Test', 6, 'General Science and Environment Literacy', 5)
)
INSERT INTO public.exam_syllabus_chapters (exam_id, stream, chapter_id, sequence)
SELECT cuet.exam_id, 'commerce', c.id, s.subject_rank * 100 + s.seq
  FROM syllabus s
  CROSS JOIN cuet
  JOIN public.curriculum_subjects cs ON cs.curriculum_class_id = cuet.class_id AND cs.name = s.subject
  JOIN public.chapters c ON c.curriculum_subject_id = cs.id AND c.name = s.chapter;

-- The practice catalog serves an exam account its stream's syllabus only.
-- Unchanged otherwise from 20261080000000.
CREATE OR REPLACE FUNCTION public.rpc_practice_bank_catalog(
  _class_level integer,
  _board text,
  _stream text DEFAULT NULL::text,
  _subject text DEFAULT NULL::text,
  _exam_id uuid DEFAULT NULL::uuid
)
 RETURNS TABLE(subject text, chapter text, questions integer)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT qb.subject, qb.chapter, count(*)::int
    FROM public.question_bank qb
   WHERE qb.is_approved
     AND qb.is_active
     AND NULLIF(btrim(qb.subject), '') IS NOT NULL
     AND (
       (_exam_id IS NOT NULL
        AND qb.exam_id = _exam_id
        AND qb.chapter_id IN (
          SELECT s.chapter_id
            FROM public.exam_accounts ea
            JOIN public.exam_syllabus_chapters s ON s.exam_id = ea.exam_id AND s.stream = ea.stream
           WHERE ea.school_id = (SELECT public.get_my_school_id())
             AND ea.exam_id = _exam_id))
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
$function$;

-- ── Verify (each check can fail) ─────────────────────────────────────────────
DO $proof$
DECLARE _n int; _subjects int; _exam uuid; _acct uuid; _cat int; _all int;
BEGIN
  SELECT count(*), count(DISTINCT c.curriculum_subject_id) INTO _n, _subjects
    FROM public.exam_syllabus_chapters s JOIN public.chapters c ON c.id = s.chapter_id
   WHERE s.stream = 'commerce';
  IF _n <> 61 OR _subjects <> 6 THEN
    RAISE EXCEPTION 'CUET Commerce syllabus has % chapters in % subjects, expected 61 in 6', _n, _subjects;
  END IF;

  IF EXISTS (SELECT 1 FROM public.exam_accounts WHERE stream IS DISTINCT FROM 'commerce') THEN
    RAISE EXCEPTION 'an existing exam account did not default to commerce';
  END IF;

  -- The catalog, as a CUET account: every chapter it lists is in the syllabus,
  -- and the retired off-syllabus chapters are not among them.
  SELECT ea.exam_id, ea.account_id INTO _exam, _acct FROM public.exam_accounts ea
    JOIN public.competitive_exams ce ON ce.id = ea.exam_id WHERE ce.code = 'cuet' LIMIT 1;
  IF _acct IS NULL THEN RAISE WARNING 'no CUET account to probe the catalog as'; RETURN; END IF;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', _acct, 'role', 'authenticated')::text, true);
  SELECT count(*) INTO _cat FROM public.rpc_practice_bank_catalog(NULL, 'cuet', NULL, NULL, _exam) c
   WHERE NOT EXISTS (SELECT 1 FROM public.exam_syllabus_chapters s JOIN public.chapters ch ON ch.id = s.chapter_id
                      WHERE s.exam_id = _exam AND ch.name = c.chapter);
  SELECT count(*) INTO _all FROM public.rpc_practice_bank_catalog(NULL, 'cuet', NULL, NULL, _exam);
  IF _cat <> 0 THEN RAISE EXCEPTION 'the catalog lists % chapters outside the syllabus', _cat; END IF;
  IF _all = 0 THEN RAISE EXCEPTION 'the catalog lists nothing for a CUET account'; END IF;
END
$proof$;

COMMIT;
