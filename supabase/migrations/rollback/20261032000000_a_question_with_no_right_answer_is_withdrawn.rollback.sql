-- ROLLBACK for 20261032000000_a_question_with_no_right_answer_is_withdrawn.
--
-- PARTIAL BY NECESSITY, AND IT RESTORES A DEFECT.
--
-- Making the four questions servable again is one UPDATE and is done below.
-- The five attempts and five mistake rows they produced are NOT recoverable:
-- they were deleted, not flagged, and nothing here holds their ids, answers
-- or timestamps.
--
-- That asymmetry is deliberate. These four questions have no correct option;
-- an attempt on one is not a measurement of anything, and a mistake-book row
-- from one is a debt the student does not owe. Keeping them "just in case"
-- would mean leaving them in the weak-topic counts, the recovery ladder and
-- the revision schedule they had already polluted.
--
-- Run this only to restore the questions themselves — for instance to correct
-- their options rather than withdraw them. The session summaries are already
-- consistent with the remaining attempts and are left alone.

BEGIN;

-- is_active only; is_approved was never changed (a trigger reserves it for a
-- super admin), so there is nothing to put back.
UPDATE public.question_bank
   SET is_active = true
 WHERE id IN (
   '0c17acaf-3306-4b3b-be00-f4677daa9916',
   '0df19259-ddc5-42d9-acca-5988082a25e8',
   'c0a682d4-7608-4d45-ac34-a8c7b1507144',
   'fc19f881-29ce-44df-a47b-689d1a4ea9cc'
 );

DO $$
BEGIN
  RAISE NOTICE 'four unanswerable variants are servable again; their attempts and mistakes are NOT restored';
END $$;

COMMIT;
