-- NO ATTEMPTS IS NO MASTERY.
--
-- 20261085000000 recomputed every concept_mastery row from its counts. For
-- the 14 rows with total_attempts = 0 — seeded rows; neither writer creates
-- one — the formula's neutral accuracy (50) produced 56.8, a mastery figure
-- for a concept never attempted. They read 0 before it ran (every such row
-- in the sample measured that day). Put back.
UPDATE public.concept_mastery SET mastery_score = 0
 WHERE total_attempts = 0 AND mastery_score <> 0;

DO $proof$
BEGIN
  IF EXISTS (SELECT 1 FROM public.concept_mastery WHERE total_attempts = 0 AND mastery_score <> 0) THEN
    RAISE EXCEPTION 'a concept with no attempts still carries a mastery score';
  END IF;
END
$proof$;
