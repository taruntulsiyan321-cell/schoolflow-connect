-- Rollback for 20260914020000_class_level_follows_the_curriculum.sql
--
-- Re-archives Class 5 and restores the 6..12 range. Order matters: the rows
-- must go inactive BEFORE the constraint is added, or the ADD fails validation
-- against the very rows it is meant to exclude — which is the same ordering
-- `20260821120000` had to use, and for the same reason.
--
-- WHAT THIS UNDOES IS A SPEC RULING, NOT A PREFERENCE. §10.9 names Class 5 as
-- the worked example of the tagging rule. Rolling back re-hides 2,189 keyed,
-- gradable questions from the only students they were written for. Do it only
-- to unblock something else, and re-apply.
--
-- The trigger is dropped, so `class_level` may once again disagree with
-- `chapter_id`. Nothing else re-checks that: the agreement was measured at 0
-- violations across 21,681 keyed rows before the trigger existed, but nothing
-- was ENFORCING it.

BEGIN;

DROP TRIGGER IF EXISTS trg_question_bank_class_follows_chapter ON public.question_bank;
DROP FUNCTION IF EXISTS public.tg_question_bank_class_follows_chapter();

UPDATE public.question_bank
   SET is_active = false, updated_at = now()
 WHERE is_active
   AND (class_level = 5 OR class_level IS NULL);

ALTER TABLE public.question_bank
  DROP CONSTRAINT IF EXISTS question_bank_class_level_check;
ALTER TABLE public.question_bank
  ADD CONSTRAINT question_bank_class_level_check
  CHECK (is_active = false OR (class_level IS NOT NULL AND class_level BETWEEN 6 AND 12));

COMMIT;

DO $verify$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_trigger
              WHERE tgrelid = 'public.question_bank'::regclass
                AND tgname = 'trg_question_bank_class_follows_chapter'
                AND NOT tgisinternal) THEN
    RAISE EXCEPTION 'ABORT: the trigger survived the rollback';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conrelid = 'public.question_bank'::regclass
                    AND conname = 'question_bank_class_level_check') THEN
    RAISE EXCEPTION 'ABORT: the range constraint was not restored';
  END IF;
  -- Positive control: the keying rule is a different migration's and must live.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conrelid = 'public.question_bank'::regclass
                    AND conname = 'question_bank_active_must_be_keyed') THEN
    RAISE EXCEPTION 'ABORT: the rollback removed question_bank_active_must_be_keyed';
  END IF;
  RAISE NOTICE 'Class 5 is archived again and the 6..12 range is back.';
END $verify$;
