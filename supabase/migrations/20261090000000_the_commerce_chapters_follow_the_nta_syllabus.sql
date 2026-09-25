-- ===========================================================================
-- THE CUET COMMERCE CHAPTERS FOLLOW THE NTA SYLLABUS
--
-- Source: the NTA CUET(UG) 2026 subject syllabi, cuet.nta.nic.in/cuetug-2026-
-- syllabus (Accountancy 301, Business Studies 305, Economics 309,
-- Mathematics/Applied Mathematics 319, English 101, General Test 501),
-- read 2026-09-25.
--
-- A captured or uploaded question is tagged to a chapter by the AI, and the
-- AI can only be as precise as the chapters it is given. Measured 2026-09-25
-- against the syllabi:
--
--   Economics     2 chapters ("Macroeconomics", "Microeconomics") for 13 NTA
--                 units — Indian Economic Development absent altogether
--   Mathematics   3 chapters (Algebra, Calculus, Probability) for the 13
--                 chapters of Section B1 and 5 units only Applied Mathematics has
--   English       4 chapters where the syllabus has 2 sections and 7 topics
--   Accountancy   Unit VI "Computerised Accounting System" absent
--   General Test  absent
--
-- This creates the NTA chapters, moves every question and every student row
-- that pointed at a replaced chapter onto its NTA chapter, and retires five
-- unsourced seed questions the syllabus does not cover (quadratic equations,
-- an arithmetic progression, the journal, the trial balance, straight-line
-- depreciation — Class 10/11 content). A replaced chapter is deleted once
-- nothing points at it. "Accounting Process" and "Financial Statements" held
-- only off-syllabus seed questions; they keep the history of the students who
-- answered them and stay, outside the syllabus (20261091000000 lists the
-- syllabus) — their mastery and tallies are not folded into a syllabus
-- chapter they were never about.
--
-- Every change is recorded in public.cuet_chapter_rebuild_20261090, which the
-- rollback reads.
--
-- ROLLBACK: rollback/20261090000000_the_commerce_chapters_follow_the_nta_syllabus.rollback.sql
-- ===========================================================================

BEGIN;

CREATE TABLE public.cuet_chapter_rebuild_20261090 (
  seq         bigserial PRIMARY KEY,
  kind        text NOT NULL,  -- created_subject | created_chapter | created_topic | set | deleted_topic | deleted_chapter
  table_name  text,
  row_id      uuid,
  column_name text,
  old_value   text,
  new_value   text,
  payload     jsonb
);
ALTER TABLE public.cuet_chapter_rebuild_20261090 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.cuet_chapter_rebuild_20261090 FROM PUBLIC, anon, authenticated;
COMMENT ON TABLE public.cuet_chapter_rebuild_20261090 IS
  'What 20261090000000 created, changed and deleted in the CUET catalog. Read by its rollback; no client access.';

-- Sets one column on one row and records what it was. Every change below goes
-- through here, so the rollback can undo exactly what was done.
CREATE FUNCTION pg_temp.set_col(_table text, _id uuid, _col text, _new text) RETURNS void
LANGUAGE plpgsql AS $f$
DECLARE _old text;
BEGIN
  EXECUTE format('SELECT %I::text FROM public.%I WHERE id = $1', _col, _table) INTO _old USING _id;
  IF _old IS NOT DISTINCT FROM _new THEN RETURN; END IF;
  INSERT INTO public.cuet_chapter_rebuild_20261090 (kind, table_name, row_id, column_name, old_value, new_value)
  VALUES ('set', _table, _id, _col, _old, _new);
  EXECUTE format('UPDATE public.%I SET %I = $1::%s WHERE id = $2', _table, _col,
                 (SELECT format_type(a.atttypid, a.atttypmod) FROM pg_attribute a
                   WHERE a.attrelid = ('public.' || _table)::regclass AND a.attname = _col))
    USING _new, _id;
END $f$;

-- ── The CUET curriculum ──────────────────────────────────────────────────────
CREATE TEMP TABLE _cls ON COMMIT DROP AS
SELECT cc.id AS class_id
  FROM public.curriculum_classes cc JOIN public.boards b ON b.id = cc.board_id
 WHERE b.code = 'cuet';
DO $c$ BEGIN
  IF (SELECT count(*) FROM _cls) <> 1 THEN RAISE EXCEPTION 'expected one CUET curriculum class'; END IF;
END $c$;

WITH ins AS (
  INSERT INTO public.curriculum_subjects (curriculum_class_id, name)
  SELECT class_id, 'General Aptitude Test' FROM _cls
  ON CONFLICT (curriculum_class_id, name) DO NOTHING
  RETURNING id
)
INSERT INTO public.cuet_chapter_rebuild_20261090 (kind, table_name, row_id)
SELECT 'created_subject', 'curriculum_subjects', id FROM ins;

-- ── The NTA chapters, in syllabus order ──────────────────────────────────────
CREATE TEMP TABLE _nta (subject text, seq int, chapter text) ON COMMIT DROP;
INSERT INTO _nta VALUES
  ('Accountancy', 11, 'Computerised Accounting System'),
  ('Economics',  1, 'Introduction and Theory of Consumer Behaviour'),
  ('Economics',  2, 'Production and Costs'),
  ('Economics',  3, 'Theory of the Firm under Perfect Competition'),
  ('Economics',  4, 'Market Equilibrium and Simple Applications'),
  ('Economics',  5, 'Introduction and National Income Accounting'),
  ('Economics',  6, 'Money and Banking'),
  ('Economics',  7, 'Determination of Income and Employment'),
  ('Economics',  8, 'Government Budget and the Economy'),
  ('Economics',  9, 'Open Economy Macroeconomics'),
  ('Economics', 10, 'Development Policies and Experience (1947-90)'),
  ('Economics', 11, 'Economic Reforms since 1991'),
  ('Economics', 12, 'Current Challenges facing the Indian Economy'),
  ('Economics', 13, 'Development Experience of India: A Comparison with Neighbours'),
  ('Mathematics',  1, 'Relations and Functions'),
  ('Mathematics',  2, 'Inverse Trigonometric Functions'),
  ('Mathematics',  3, 'Matrices'),
  ('Mathematics',  4, 'Determinants'),
  ('Mathematics',  5, 'Continuity and Differentiability'),
  ('Mathematics',  6, 'Applications of Derivatives'),
  ('Mathematics',  7, 'Integrals'),
  ('Mathematics',  8, 'Applications of the Integrals'),
  ('Mathematics',  9, 'Differential Equations'),
  ('Mathematics', 10, 'Vectors'),
  ('Mathematics', 11, 'Three-dimensional Geometry'),
  ('Mathematics', 12, 'Linear Programming'),
  ('Mathematics', 13, 'Probability'),
  ('Mathematics', 14, 'Numbers, Quantification and Numerical Applications'),
  ('Mathematics', 15, 'Probability Distributions'),
  ('Mathematics', 16, 'Time Based Data'),
  ('Mathematics', 17, 'Inferential Statistics'),
  ('Mathematics', 18, 'Financial Mathematics'),
  ('English', 1, 'Reading Comprehension'),
  ('English', 2, 'Verbal Ability'),
  ('General Aptitude Test', 1, 'General Knowledge and Current Affairs'),
  ('General Aptitude Test', 2, 'General Mental Ability and Numerical Ability'),
  ('General Aptitude Test', 3, 'Quantitative Reasoning'),
  ('General Aptitude Test', 4, 'Logical and Analytical Reasoning'),
  ('General Aptitude Test', 5, 'General Science and Environment Literacy');

-- "Probability", "Reading Comprehension" and "Verbal Ability" already exist
-- under those names and become the NTA chapters as they are.
WITH ins AS (
  INSERT INTO public.chapters (curriculum_subject_id, name, sequence)
  SELECT cs.id, n.chapter, n.seq
    FROM _nta n
    JOIN public.curriculum_subjects cs ON cs.name = n.subject AND cs.curriculum_class_id = (SELECT class_id FROM _cls)
  ON CONFLICT (curriculum_subject_id, name) DO NOTHING
  RETURNING id
)
INSERT INTO public.cuet_chapter_rebuild_20261090 (kind, table_name, row_id)
SELECT 'created_chapter', 'chapters', id FROM ins;

CREATE TEMP TABLE _ch ON COMMIT DROP AS
SELECT cs.name AS subject, c.name AS chapter, c.id
  FROM public.chapters c JOIN public.curriculum_subjects cs ON cs.id = c.curriculum_subject_id
 WHERE cs.curriculum_class_id = (SELECT class_id FROM _cls);

-- Topics: English as the syllabus names them; the seed questions' own topics
-- carried to their NTA chapters.
CREATE TEMP TABLE _nta_topic (chapter text, topic text) ON COMMIT DROP;
INSERT INTO _nta_topic VALUES
  ('Reading Comprehension', 'Factual Passages'),
  ('Reading Comprehension', 'Narrative Passages'),
  ('Reading Comprehension', 'Literary Passages'),
  ('Verbal Ability', 'Rearranging the Parts'),
  ('Verbal Ability', 'Match the Following'),
  ('Verbal Ability', 'Choosing the Correct Word'),
  ('Verbal Ability', 'Synonyms and Antonyms'),
  ('Money and Banking', 'Money and banking'),
  ('Introduction and National Income Accounting', 'National income'),
  ('Introduction and Theory of Consumer Behaviour', 'Demand'),
  ('Introduction and Theory of Consumer Behaviour', 'Elasticity'),
  ('Continuity and Differentiability', 'Differentiation'),
  ('Accounting for Partnership', 'Profit sharing');

WITH ins AS (
  INSERT INTO public.topics (chapter_id, name)
  SELECT ch.id, t.topic FROM _nta_topic t JOIN _ch ch ON ch.chapter = t.chapter
  ON CONFLICT (chapter_id, name) DO NOTHING
  RETURNING id
)
INSERT INTO public.cuet_chapter_rebuild_20261090 (kind, table_name, row_id)
SELECT 'created_topic', 'topics', id FROM ins;

-- ── Replaced chapters, and where their rows go ───────────────────────────────
CREATE TEMP TABLE _replace (subject text, old_chapter text, new_chapter text) ON COMMIT DROP;
INSERT INTO _replace VALUES
  ('Economics',   'Macroeconomics',       'Money and Banking'),
  ('Economics',   'Microeconomics',       'Introduction and Theory of Consumer Behaviour'),
  ('Mathematics', 'Algebra',              'Matrices'),
  ('Mathematics', 'Calculus',             'Continuity and Differentiability'),
  ('English',     'Grammar',              'Verbal Ability'),
  ('English',     'Vocabulary',           'Verbal Ability'),
  ('Accountancy', 'Partnership Accounts', 'Accounting for Partnership');

CREATE TEMP TABLE _chmap ON COMMIT DROP AS
SELECT o.id AS old_id, n.id AS new_id, r.old_chapter, r.new_chapter, r.subject
  FROM _replace r
  JOIN _ch o ON o.subject = r.subject AND o.chapter = r.old_chapter
  JOIN _ch n ON n.subject = r.subject AND n.chapter = r.new_chapter;

-- Each seed question, by id: its NTA chapter and topic, or retired.
CREATE TEMP TABLE _q (id uuid, chapter text, topic text, retire boolean) ON COMMIT DROP;
INSERT INTO _q VALUES
  ('89f9e49e-04df-4484-90c7-94216373887d', 'Accounting for Partnership', 'Profit sharing', false),
  ('a888245c-ba7e-4388-8f22-49ef222a635c', 'Money and Banking', 'Money and banking', false),
  ('1e3e32ec-8871-4197-b8da-a33cf053cf3b', 'Introduction and National Income Accounting', 'National income', false),
  ('93ff3f1f-57dc-4ca6-b728-622c962ae5a7', 'Introduction and Theory of Consumer Behaviour', 'Elasticity', false),
  ('72a8ee7b-b83c-48d8-b95f-4bc893cd79fa', 'Introduction and Theory of Consumer Behaviour', 'Demand', false),
  ('7470482d-f513-4bea-8eb2-cfc010c6ed0e', 'Continuity and Differentiability', 'Differentiation', false),
  ('2ef45e18-d856-4eab-b956-535b4c7347a1', 'Probability', 'Basic probability', false),
  ('4a469789-7a18-4923-92d6-554f2e314a94', 'Verbal Ability', 'Choosing the Correct Word', false),
  ('a45db281-b60b-4bb2-b2c9-5654eedefde1', 'Reading Comprehension', NULL, false),
  ('4d64ab09-98d5-4208-8485-020fd50cf0c8', 'Verbal Ability', 'Rearranging the Parts', false),
  ('ff64b9b5-e7fd-482e-8950-2cbe937d6405', 'Verbal Ability', 'Synonyms and Antonyms', false),
  ('6b22e7af-ba99-4dc8-858a-e93da96e72c4', NULL, NULL, true),   -- the journal (Class 11)
  ('7778a420-8133-47db-a6d3-3fa5a9305b0a', NULL, NULL, true),   -- the trial balance (Class 11)
  ('2b918a76-6a5e-49de-8a0a-168d40292ea0', NULL, NULL, true),   -- straight-line depreciation (Class 11)
  ('506ecb59-95f3-4d6b-b590-a689ed6036a1', NULL, NULL, true),   -- quadratic equations (Class 10)
  ('ef81fcb0-b823-47a6-8d04-5e64cc8a1907', NULL, NULL, true);   -- arithmetic progression (Class 10)

DO $move$
DECLARE r record; _ch_id uuid; _topic_id uuid; _t text;
BEGIN
  IF (SELECT count(*) FROM _chmap) <> 7 THEN RAISE EXCEPTION 'expected 7 replaced chapters, found %', (SELECT count(*) FROM _chmap); END IF;

  -- The seed questions.
  FOR r IN SELECT q.*, b.chapter_id AS old_chapter_id FROM _q q JOIN public.question_bank b ON b.id = q.id LOOP
    IF r.retire THEN
      PERFORM pg_temp.set_col('question_bank', r.id, 'is_active', 'false');
      -- Off the replaced chapter, so it can go; "Accounting Process" stays.
      IF r.old_chapter_id IN (SELECT old_id FROM _chmap) THEN
        PERFORM pg_temp.set_col('question_bank', r.id, 'topic_id', NULL);
        PERFORM pg_temp.set_col('question_bank', r.id, 'chapter_id', NULL);
      END IF;
    ELSE
      SELECT id INTO _ch_id FROM _ch WHERE chapter = r.chapter AND subject = (SELECT subject FROM public.question_bank WHERE id = r.id);
      IF _ch_id IS NULL THEN RAISE EXCEPTION 'no NTA chapter % for %', r.chapter, r.id; END IF;
      SELECT id INTO _topic_id FROM public.topics WHERE chapter_id = _ch_id AND name = r.topic;
      -- topic before chapter would break (topic_id, chapter_id) -> topics; clear it first.
      PERFORM pg_temp.set_col('question_bank', r.id, 'topic_id', NULL);
      PERFORM pg_temp.set_col('question_bank', r.id, 'chapter_id', _ch_id::text);
      PERFORM pg_temp.set_col('question_bank', r.id, 'chapter', r.chapter);
      PERFORM pg_temp.set_col('question_bank', r.id, 'topic_id', _topic_id::text);
    END IF;
  END LOOP;

  -- Anything else in the bank still on a replaced chapter would be silently
  -- orphaned by the delete below: refuse instead.
  IF EXISTS (SELECT 1 FROM public.question_bank WHERE chapter_id IN (SELECT old_id FROM _chmap)) THEN
    RAISE EXCEPTION 'bank rows remain on a replaced chapter';
  END IF;

  -- Student rows that point at a replaced chapter follow it.
  FOREACH _t IN ARRAY ARRAY['student_mistakes','chapter_tally','chapter_state','recovery_sessions',
                            'revision_sessions','student_upload_questions','student_upload_notes',
                            'student_capture_questions','homework','tests','test_questions'] LOOP
    FOR r IN EXECUTE format('SELECT x.id, m.new_id FROM public.%I x JOIN _chmap m ON m.old_id = x.chapter_id', _t) LOOP
      PERFORM pg_temp.set_col(_t, r.id, 'chapter_id', r.new_id::text);
    END LOOP;
  END LOOP;

  -- Private questions' topics follow to the carried topic of the same name, or clear.
  FOREACH _t IN ARRAY ARRAY['student_upload_questions','student_upload_notes','student_capture_questions'] LOOP
    FOR r IN EXECUTE format(
      'SELECT x.id, (SELECT nt.id FROM public.topics nt WHERE nt.chapter_id = x.chapter_id AND nt.name = ot.name) AS new_topic
         FROM public.%I x JOIN public.topics ot ON ot.id = x.topic_id
        WHERE ot.chapter_id IN (SELECT old_id FROM _chmap)', _t) LOOP
      PERFORM pg_temp.set_col(_t, r.id, 'topic_id', r.new_topic::text);
    END LOOP;
  END LOOP;

  -- Chapter NAMES in exam accounts' own rows. An attempt on a re-tagged bank
  -- question takes that question's chapter; every other row the chapter's
  -- replacement.
  FOR r IN SELECT qa.id, b.chapter AS new_name, qa.chapter AS old_name
             FROM public.question_attempts qa JOIN public.question_bank b ON b.id = qa.bank_question_id
            WHERE qa.bank_question_id IN (SELECT id FROM _q WHERE NOT retire)
              AND qa.chapter IS DISTINCT FROM b.chapter LOOP
    PERFORM pg_temp.set_col('question_attempts', r.id, 'chapter', r.new_name);
    FOREACH _t IN ARRAY ARRAY['concept','subconcept','topic'] LOOP
      PERFORM pg_temp.set_col('question_attempts', r.id, _t, r.new_name)
         FROM public.question_attempts WHERE id = r.id AND (to_jsonb(question_attempts)->>_t) = r.old_name;
    END LOOP;
  END LOOP;

  FOR r IN
    SELECT 'practice_sessions' t, x.id, 'chapter' c, m.new_chapter FROM public.practice_sessions x JOIN _chmap m ON m.old_chapter = x.chapter AND m.subject = x.subject WHERE x.user_id IN (SELECT account_id FROM public.exam_accounts)
    UNION ALL SELECT 'question_attempts', x.id, col, m.new_chapter FROM public.question_attempts x JOIN _chmap m ON m.subject = x.subject
      CROSS JOIN LATERAL (VALUES ('chapter'), ('concept'), ('subconcept'), ('topic')) v(col)
      WHERE x.user_id IN (SELECT account_id FROM public.exam_accounts) AND (to_jsonb(x)->>col) = m.old_chapter
    UNION ALL SELECT 'concept_mastery', x.id, col, m.new_chapter FROM public.concept_mastery x JOIN _chmap m ON m.subject = x.subject
      CROSS JOIN LATERAL (VALUES ('chapter'), ('concept'), ('subconcept')) v(col)
      WHERE x.user_id IN (SELECT account_id FROM public.exam_accounts) AND (to_jsonb(x)->>col) = m.old_chapter
    UNION ALL SELECT 'revision_queue', x.id, col, m.new_chapter FROM public.revision_queue x JOIN _chmap m ON m.subject = x.subject
      CROSS JOIN LATERAL (VALUES ('chapter'), ('topic')) v(col)
      WHERE x.user_id IN (SELECT account_id FROM public.exam_accounts) AND (to_jsonb(x)->>col) = m.old_chapter
    UNION ALL SELECT 'student_mistakes', x.id, col, m.new_chapter FROM public.student_mistakes x JOIN _chmap m ON m.subject = x.subject
      CROSS JOIN LATERAL (VALUES ('chapter'), ('topic'), ('concept'), ('subconcept')) v(col)
      WHERE x.user_id IN (SELECT account_id FROM public.exam_accounts) AND (to_jsonb(x)->>col) = m.old_chapter
  LOOP
    PERFORM pg_temp.set_col(r.t, r.id, r.c, r.new_chapter);
  END LOOP;
END $move$;

-- ── The replaced chapters go, with their topics ──────────────────────────────
WITH gone AS (
  DELETE FROM public.topics t WHERE t.chapter_id IN (SELECT old_id FROM _chmap)
  RETURNING t.id, to_jsonb(t) AS row
)
INSERT INTO public.cuet_chapter_rebuild_20261090 (kind, table_name, row_id, payload)
SELECT 'deleted_topic', 'topics', id, row FROM gone;

WITH gone AS (
  DELETE FROM public.chapters c WHERE c.id IN (SELECT old_id FROM _chmap)
  RETURNING c.id, to_jsonb(c) AS row
)
INSERT INTO public.cuet_chapter_rebuild_20261090 (kind, table_name, row_id, payload)
SELECT 'deleted_chapter', 'chapters', id, row FROM gone;

-- ── Verify (each check can fail) ─────────────────────────────────────────────
DO $proof$
DECLARE _n int;
BEGIN
  SELECT count(*) INTO _n FROM _nta n JOIN _ch c ON c.subject = n.subject AND c.chapter = n.chapter;
  IF _n <> (SELECT count(*) FROM _nta) THEN RAISE EXCEPTION 'only % of % NTA chapters exist', _n, (SELECT count(*) FROM _nta); END IF;

  SELECT count(*) INTO _n FROM public.chapters WHERE id IN (SELECT old_id FROM _chmap);
  IF _n <> 0 THEN RAISE EXCEPTION '% replaced chapters survive', _n; END IF;

  SELECT count(*) INTO _n FROM public.question_bank b JOIN _q q ON q.id = b.id
   WHERE NOT q.retire AND (b.chapter <> q.chapter OR b.chapter_id IS NULL OR NOT b.is_active);
  IF _n <> 0 THEN RAISE EXCEPTION '% seed questions not on their NTA chapter', _n; END IF;

  SELECT count(*) INTO _n FROM public.question_bank b JOIN _q q ON q.id = b.id WHERE q.retire AND b.is_active;
  IF _n <> 0 THEN RAISE EXCEPTION '% off-syllabus questions still served', _n; END IF;

  SELECT count(*) INTO _n FROM _chmap m
    JOIN public.student_mistakes x ON x.chapter = m.old_chapter AND x.subject = m.subject
   WHERE x.user_id IN (SELECT account_id FROM public.exam_accounts);
  IF _n <> 0 THEN RAISE EXCEPTION '% exam-account mistakes still name a replaced chapter', _n; END IF;
END
$proof$;

COMMIT;
