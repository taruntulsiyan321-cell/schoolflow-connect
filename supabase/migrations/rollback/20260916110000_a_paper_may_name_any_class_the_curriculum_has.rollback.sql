-- Rollback for 20260916110000_a_paper_may_name_any_class_the_curriculum_has
--
-- Restores the 6..12 range literal and drops the curriculum lookup. Class 5
-- papers become impossible again, and the 2,189 usable Class 5 questions in
-- the bank go back to having nowhere to go — KNOWN_ISSUES 27 reopened.
--
-- IT REFUSES IF A PAPER WOULD BE ORPHANED. Restoring a CHECK on a table that
-- already violates it makes the constraint NOT VALID or fails outright, and
-- either way a paper someone built would become unwritable. The block below
-- stops first and names the rows, rather than leaving that to Postgres.

DO $guard$
DECLARE _outside int;
BEGIN
  SELECT count(*) INTO _outside
    FROM public.question_papers
   WHERE class_level IS NOT NULL AND (class_level < 6 OR class_level > 12);
  IF _outside > 0 THEN
    RAISE EXCEPTION
      'REFUSING TO ROLL BACK: % paper(s) name a class outside 6..12 and would '
      'violate the restored constraint. Move or delete them deliberately first.',
      _outside;
  END IF;
END $guard$;

DROP TRIGGER IF EXISTS trg_question_paper_class_is_in_curriculum ON public.question_papers;
DROP FUNCTION IF EXISTS public.tg_question_paper_class_is_in_curriculum();

ALTER TABLE public.question_papers
  ADD CONSTRAINT question_papers_class_level_check
  CHECK ((class_level IS NULL) OR ((class_level >= 6) AND (class_level <= 12)));

DO $verify$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.question_papers'::regclass
       AND conname = 'question_papers_class_level_check'
  ) THEN
    RAISE EXCEPTION 'ROLLED BACK: the range constraint was not restored';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_trigger
     WHERE tgrelid = 'public.question_papers'::regclass
       AND tgname = 'trg_question_paper_class_is_in_curriculum'
  ) THEN
    RAISE EXCEPTION 'ROLLED BACK: the curriculum trigger is still attached';
  END IF;

  RAISE NOTICE 'question_papers is back to the 6..12 literal; Class 5 papers are impossible again.';
END $verify$;
