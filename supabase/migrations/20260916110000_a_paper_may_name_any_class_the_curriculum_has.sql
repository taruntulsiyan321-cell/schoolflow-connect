-- ═══════════════════════════════════════════════════════════════════════════
-- A paper may name any class the curriculum has (§10.9, no threshold literals)
--
-- `question_papers_class_level_check` is `class_level >= 6 AND <= 12`. The
-- curriculum tree holds classes 5 THROUGH 12, and the question bank holds
-- 2,189 usable Class 5 questions — measured 2026-09-09.
--
-- So a Class 5 paper cannot be created, and those 2,189 questions can never
-- reach a paper. That is KNOWN_ISSUES 27, and it is NOT an open ruling: the
-- decision was already taken. `20260914020000` removed the identical 6..12
-- range from `question_bank` for exactly this reason, and the bank carries
-- **zero** class-level constraints today. `question_papers` was created on
-- 2026-09-07, before that fix, and never got the memo.
--
-- §10.9 names Class 5 by hand: "a Class 5 student is only ever served Class 5
-- content for their own board."
--
-- ── A RANGE LITERAL IS THE WRONG SHAPE, NOT JUST THE WRONG NUMBERS ──────
--
-- Replacing 6..12 with 5..12 would be the same defect one year later, when a
-- Class 4 is seeded. Which classes exist is the CURRICULUM TREE's answer, and
-- the schema should ask it rather than carry a copy.
--
-- A CHECK cannot hold a subquery, so this is a BEFORE INSERT/UPDATE trigger —
-- the same shape the house rules prescribe for a constraint that needs a
-- lookup, and the same one `tg_question_bank_class_follows_chapter` already
-- uses to keep the bank honest.
--
-- Rollback: supabase/migrations/rollback/
--           20260916110000_a_paper_may_name_any_class_the_curriculum_has.rollback.sql
-- Assertion: verification/caller-privileges/probe39.sql (claim: a Class 5 paper)
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE public.question_papers
  DROP CONSTRAINT IF EXISTS question_papers_class_level_check;

CREATE OR REPLACE FUNCTION public.tg_question_paper_class_is_in_curriculum()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  -- A paper with no class is allowed: the column is nullable and a teacher may
  -- save a blueprint before deciding. Only a NAMED class has to be real.
  IF NEW.class_level IS NULL THEN
    RETURN NEW;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.curriculum_classes cc WHERE cc.level = NEW.class_level
  ) THEN
    RAISE EXCEPTION
      'Class % is not in the curriculum, so a paper cannot be built for it '
      '(§10.9: a student is only ever served their own class''s content)',
      NEW.class_level
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_question_paper_class_is_in_curriculum ON public.question_papers;
CREATE TRIGGER trg_question_paper_class_is_in_curriculum
  BEFORE INSERT OR UPDATE OF class_level ON public.question_papers
  FOR EACH ROW EXECUTE FUNCTION public.tg_question_paper_class_is_in_curriculum();

-- ── Proof, before this commits ───────────────────────────────────────────
DO $verify$
DECLARE
  sch_a   uuid := '00000000-0000-4000-8000-000000000001';
  teacher uuid;
  lvls    int;
  has5    boolean;
BEGIN
  SELECT id INTO teacher FROM auth.users WHERE email = 'priya.sharma@wisdomcampus.com';
  SELECT count(*), bool_or(level = 5) INTO lvls, has5 FROM public.curriculum_classes;

  IF teacher IS NULL OR lvls = 0 THEN
    RAISE EXCEPTION
      'ROLLED BACK: fixtures missing (teacher=%, curriculum classes=%) — a check '
      'that cannot run is not a check that passed', teacher, lvls;
  END IF;

  -- The literal is gone.
  IF EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.question_papers'::regclass
       AND conname = 'question_papers_class_level_check'
  ) THEN
    RAISE EXCEPTION 'ROLLED BACK: the 6..12 range constraint is still there';
  END IF;

  -- Class 5 is genuinely in the tree — otherwise the whole premise is wrong
  -- and this migration is fixing nothing.
  IF NOT has5 THEN
    RAISE EXCEPTION
      'ROLLED BACK: the curriculum has no Class 5, so the 2,189 Class 5 bank '
      'questions are a different problem than this migration claims';
  END IF;

  -- BEHAVIOUR, both directions, inside a savepoint that always rolls back.
  BEGIN
    INSERT INTO public.question_papers
      (school_id, created_by, title, subject, class_level)
    VALUES (sch_a, teacher, '__verify class 5__', 'Science', 5);

    -- ...and a class the curriculum does NOT have is still refused, or the
    -- trigger is admitting everything and proves nothing (G11).
    BEGIN
      INSERT INTO public.question_papers
        (school_id, created_by, title, subject, class_level)
      VALUES (sch_a, teacher, '__verify class 99__', 'Science', 99);
      RAISE EXCEPTION 'ROLLED BACK: a paper was created for Class 99';
    EXCEPTION
      WHEN sqlstate '23514' THEN NULL;  -- correct
      WHEN OTHERS THEN
        IF SQLERRM LIKE 'ROLLED BACK:%' THEN RAISE; END IF;
        RAISE EXCEPTION 'ROLLED BACK: Class 99 failed for the WRONG reason: %', SQLERRM;
    END;

    RAISE EXCEPTION '__verify_done__';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM LIKE 'ROLLED BACK:%' THEN RAISE; END IF;
      IF SQLERRM <> '__verify_done__' THEN
        RAISE EXCEPTION 'ROLLED BACK: a Class 5 paper was refused: %', SQLERRM;
      END IF;
  END;

  RAISE NOTICE
    'question_papers now accepts any of the % curriculum classes, Class 5 included, and refuses the rest.', lvls;
END $verify$;
