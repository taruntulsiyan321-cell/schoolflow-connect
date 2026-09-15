-- Rollback for 20261002000000.
--
-- Puts concept_mastery_classification_check back to
-- 'weak' | 'average' | 'strong' | 'mastered'.
--
-- READ THIS FIRST. That list does not contain 'normal', and 'normal' is what
-- the classification column — a GENERATED column — computes for any
-- confidence_score from 60 to 79.99. So this rollback restores a table that
-- refuses a value it computes itself, and because the write happens inside
-- rpc_finish_practice_session, the failure aborts the whole finish: a student
-- sitting anywhere between 60% and 80% on a concept cannot save a practice
-- session at all.
--
-- Measured before the fix: 447 concept_mastery rows, none whatsoever between
-- 60 and 80, with students appearing either at 100.0 or under 50.0 — the hole
-- a silently rejected write leaves in the data.
--
-- Two of the four words restored here ('average', 'mastered') cannot be
-- produced by anything.
--
-- There is no reason to run this except to reproduce the old behaviour.

BEGIN;

ALTER TABLE public.concept_mastery
  DROP CONSTRAINT IF EXISTS concept_mastery_classification_check;

ALTER TABLE public.concept_mastery
  ADD CONSTRAINT concept_mastery_classification_check
  CHECK (classification IS NULL
         OR classification = ANY (ARRAY['weak'::text, 'average'::text, 'strong'::text, 'mastered'::text]));

COMMIT;
