-- ═══════════════════════════════════════════════════════════════════════════
-- An online test is all MCQ, and its marks are whole (§10.24, product ruling
-- 2026-09-12: "for the online test, only MCQ questions can be given … the test
-- automatically gets marked")
--
-- ── WHAT COULD BE WRITTEN BEFORE THIS, AND WHAT IT DID ───────────────────
--
-- `test_questions_question_format_check` admits five formats:
--
--     mcq · multi · numerical · short · long
--
-- and the teacher's builder offered six kinds mapping onto them (MCQ, True /
-- False, fill, short, long, numerical). `rpc_test_submit` marks by ONE rule:
--
--     is_correct = (a.response IS NOT NULL AND a.response = q.correct)
--
-- jsonb equality against the answer key. What that means per format:
--
--   mcq          works. The key is {"indexes":[i]} and QuestionRenderer can
--                only send an index it drew.
--   numerical    works only by luck of typing: the key is {"value":n} and the
--                renderer sends a number, so 6 matches 6 — but 6.0 vs 6 and any
--                tolerance ("within 0.01") are not expressible, and
--                `test_questions_shape_matches_format` does not require one.
--   multi        CANNOT WORK. The renderer appends indexes in CLICK ORDER, so a
--                student choosing B then A sends {"indexes":[1,0]} while the key
--                says {"indexes":[0,1]}. jsonb array equality is order-
--                sensitive: the right answer marks wrong. Nothing writes this
--                format today, which is the only reason it has not bitten.
--   short, long  CANNOT WORK BY DESIGN. `correct` is NULL for these (the CHECK
--                requires it) and `answer` holds prose, so `a.response =
--                q.correct` is NULL -> not correct. Every written answer scores
--                zero, silently, and then the class report ranks its topic as
--                100% wrong. There is no marking screen anywhere in the product
--                that could award them: the teacher never marks an online test
--                — that is the point of it.
--
-- So three of the five formats were reachable from the builder and unmarkable.
-- This trigger closes the table to them rather than leaving the builder as the
-- only fence: `rpc_question_paper_to_test` writes here too, and so would any
-- future importer.
--
-- ── WHY WHOLE MARKS ──────────────────────────────────────────────────────
--
--     tests.max_mark    integer NOT NULL   CHECK (max_mark > 0)
--     test_marks.mark   integer
--     test_questions.marks  numeric        CHECK (marks > 0)
--
-- The question carries a numeric and everything downstream of it is an integer.
-- A three-question paper at 0.5 each already stored `max_mark = 2` (rounded by
-- the cast) and a student scoring 1.5 already stored `mark = 2`: the marks a
-- parent and a principal read were not the marks the student earned. The
-- builder's own input allowed 0.5 explicitly. Rather than widen two integer
-- columns that every marks surface reads, the half-mark is refused where it
-- enters — with a message that says which question and what to do.
--
-- ── WHY A TRIGGER AND NOT A CHECK ───────────────────────────────────────
--
-- A CHECK would apply to the 576 rows already in the table, and this project
-- does not know that all of them are MCQs with whole marks — it knows the
-- INVARIANTS THAT MATTER held when last measured (20260914110000: 0 empty keys,
-- 0 out-of-range indexes, 0 non-numeric numerical values). A BEFORE INSERT OR
-- UPDATE trigger binds every row written from now on and leaves history alone,
-- the same choice and the same reason as
-- `trg_test_question_key_addresses_an_option`, which this sits beside and does
-- not replace: that one checks the key addresses a real option, this one checks
-- the question is markable at all.
--
-- Rollback: supabase/migrations/rollback/
--           20260920020000_an_online_test_is_all_mcq_and_marks_are_whole.rollback.sql
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.tg_test_question_is_a_markable_mcq()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.question_format <> 'mcq' THEN
    RAISE EXCEPTION
      'An online test can only hold MCQ questions, and question % is "%": nothing in the product marks a written or multi-select answer, so it would score zero and its topic would rank 100%% wrong on the class report. Put it on a printed question paper instead (/teacher/question-papers).',
      NEW.order_index + 1, NEW.question_format
      USING ERRCODE = '23514';
  END IF;

  IF NEW.marks IS NULL OR NEW.marks <> trunc(NEW.marks) THEN
    RAISE EXCEPTION
      'Question % carries % marks: an online test''s marks must be whole numbers, because tests.max_mark and test_marks.mark are integers and a fraction is silently rounded into the mark a parent and a principal read.',
      NEW.order_index + 1, NEW.marks
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_test_question_is_a_markable_mcq ON public.test_questions;
CREATE TRIGGER trg_test_question_is_a_markable_mcq
  BEFORE INSERT OR UPDATE OF question_format, marks, correct, options ON public.test_questions
  FOR EACH ROW EXECUTE FUNCTION public.tg_test_question_is_a_markable_mcq();

COMMENT ON FUNCTION public.tg_test_question_is_a_markable_mcq() IS
  'An online test question must be an MCQ with whole marks: rpc_test_submit '
  'marks by jsonb equality against the key, which only an MCQ position can '
  'satisfy, and every mark surface downstream of it is an integer column. '
  'See 20260920020000 for the three formats this refuses and why each is '
  'unmarkable.';

-- ── Proof ─────────────────────────────────────────────────────────────────
DO $verify$
DECLARE
  _school uuid; _ss uuid; _teacher uuid; _test uuid;
  _refused int := 0;
  _ok uuid;
BEGIN
  SELECT ss.school_id, ss.id, t.user_id INTO _school, _ss, _teacher
    FROM public.section_subjects ss
    JOIN public.teacher_classes tc ON tc.class_id = ss.section_id
    JOIN public.teachers t ON t.id = tc.teacher_id AND t.user_id IS NOT NULL
   LIMIT 1;
  IF _ss IS NULL THEN
    RAISE EXCEPTION 'ROLLED BACK: no section-subject with a teacher — nothing here could be measured';
  END IF;

  INSERT INTO public.tests (school_id, section_subject_id, created_by, title, max_mark, status)
  VALUES (_school, _ss, _teacher, '[verify 20260920020000] markable questions only', 1, 'draft')
  RETURNING id INTO _test;

  -- 1. A short-answer question is refused.
  BEGIN
    INSERT INTO public.test_questions (test_id, school_id, order_index, question_format, question, answer, marks)
    VALUES (_test, _school, 0, 'short', 'verify: explain Ohm''s law', 'V = IR', 1);
    RAISE EXCEPTION 'ROLLED BACK: a short-answer question was accepted onto an online test';
  EXCEPTION WHEN check_violation THEN _refused := _refused + 1;
  END;

  -- 2. A long-answer question is refused.
  BEGIN
    INSERT INTO public.test_questions (test_id, school_id, order_index, question_format, question, answer, marks)
    VALUES (_test, _school, 0, 'long', 'verify: derive it', 'a derivation', 5);
    RAISE EXCEPTION 'ROLLED BACK: a long-answer question was accepted onto an online test';
  EXCEPTION WHEN check_violation THEN _refused := _refused + 1;
  END;

  -- 3. A numerical question is refused.
  BEGIN
    INSERT INTO public.test_questions (test_id, school_id, order_index, question_format, question, correct, marks)
    VALUES (_test, _school, 0, 'numerical', 'verify: 2 + 2', '{"value":4}', 1);
    RAISE EXCEPTION 'ROLLED BACK: a numerical question was accepted onto an online test';
  EXCEPTION WHEN check_violation THEN _refused := _refused + 1;
  END;

  -- 4. A multi-select question is refused — the order-sensitive one.
  BEGIN
    INSERT INTO public.test_questions (test_id, school_id, order_index, question_format, question, options, correct, marks)
    VALUES (_test, _school, 0, 'multi', 'verify: which are prime', '["2","3","4"]', '{"indexes":[0,1]}', 1);
    RAISE EXCEPTION 'ROLLED BACK: a multi-select question was accepted onto an online test';
  EXCEPTION WHEN check_violation THEN _refused := _refused + 1;
  END;

  -- 5. A half-mark MCQ is refused.
  BEGIN
    INSERT INTO public.test_questions (test_id, school_id, order_index, question_format, question, options, correct, marks)
    VALUES (_test, _school, 0, 'mcq', 'verify: half a mark', '["a","b"]', '{"indexes":[0]}', 0.5);
    RAISE EXCEPTION 'ROLLED BACK: a half-mark question was accepted';
  EXCEPTION WHEN check_violation THEN _refused := _refused + 1;
  END;

  IF _refused <> 5 THEN
    RAISE EXCEPTION 'ROLLED BACK: % of 5 unmarkable shapes were refused', _refused;
  END IF;

  -- THE POSITIVE CONTROL. Without it, a trigger that refused EVERYTHING would
  -- pass all five claims above.
  INSERT INTO public.test_questions (test_id, school_id, order_index, question_format, question, options, correct, marks)
  VALUES (_test, _school, 0, 'mcq', 'verify: 2 + 2 ?', '["3","4"]', '{"indexes":[1]}', 1)
  RETURNING id INTO _ok;

  IF _ok IS NULL THEN
    RAISE EXCEPTION 'ROLLED BACK: a plain whole-mark MCQ was refused too — the trigger refuses everything';
  END IF;

  DELETE FROM public.test_questions WHERE test_id = _test;
  DELETE FROM public.tests WHERE id = _test;

  RAISE NOTICE 'verify OK: short, long, numerical, multi and half-mark refused; a whole-mark MCQ accepted';
END
$verify$;
