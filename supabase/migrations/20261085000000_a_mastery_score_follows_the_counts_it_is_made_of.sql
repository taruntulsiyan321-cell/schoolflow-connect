-- A MASTERY SCORE FOLLOWS THE COUNTS IT IS MADE OF.
--
-- concept_mastery has two writers. _upsert_concept_mastery adds each answer
-- to the counts and recomputes mastery_score from them. _recompute_concept_
-- confidence_for_session rebuilds total_attempts and correct_attempts from
-- every answer in the topic — and left mastery_score alone ("still owned by
-- _upsert_concept_mastery"). So whenever the rebuild changed the counts, the
-- score kept describing counts the row no longer held. Measured 2026-09-24:
-- 226 of 653 rows more than 15 points away from their own counts; a CUET
-- account's "Dissolution / Realisation" read 98.5 mastery on 1 correct of 2,
-- and Nova quoted that number to the student (its allowed-percentages guard
-- passes any stored mastery_score).
--
-- One formula, _compute_mastery_score, applied by both writers whenever the
-- counts change; every row recomputed from the counts it holds now.
--
-- WHAT THIS ACTUALLY DID, recorded after it ran (2026-09-24). The backfill
-- was meant to cover only the 24 rows both writers keep (confidence_score
-- set). The edit that would have scoped it failed and this file was applied
-- as it stands, so the UPDATE below recomputed EVERY row whose stored score
-- differed from the formula at recency now(): 446 of 653. Measured before
-- it ran: 207 of those moved by under 1 point, 202 by 1–5, 138 by 5–15 and
-- 106 by 15 or more — many of them seeded rows from an older formula. Their
-- previous values were not kept. 14 rows with no attempts at all went from 0
-- to 56.8 (the formula's neutral value); 20261086000000 puts those back. Both
-- writers pass now() as the attempt time, so a stored score always carries
-- the recency of the moment it was written; the recompute does the same, so
-- it changes the rows whose counts moved and not every row that has aged.
DO $mig$
DECLARE _def text; _n int;
  _old CONSTANT text := $x$    last_attempt_at  = now(),
    updated_at       = now();
    -- mastery_score deliberately untouched: still owned by _upsert_concept_mastery.$x$;
  _new CONSTANT text := $x$    last_attempt_at  = now(),
    updated_at       = now(),
    -- The counts just changed, so the score made of them changes with them:
    -- the same formula _upsert_concept_mastery applies (20261085000000).
    mastery_score    = public._compute_mastery_score(
      EXCLUDED.total_attempts, EXCLUDED.correct_attempts,
      cm.recovery_attempts, cm.recovery_correct, cm.mistake_count, now());$x$;
BEGIN
  SELECT replace(pg_get_functiondef('public._recompute_concept_confidence_for_session(uuid)'::regprocedure), E'\r\n', E'\n') INTO _def;
  _n := (length(_def) - length(replace(_def, _old, ''))) / length(_old);
  IF _n <> 1 THEN RAISE EXCEPTION 'recompute tail matched % times', _n; END IF;
  EXECUTE replace(_def, _old, _new);
END
$mig$;

UPDATE public.concept_mastery cm
   SET mastery_score = public._compute_mastery_score(
         cm.total_attempts, cm.correct_attempts, cm.recovery_attempts,
         cm.recovery_correct, cm.mistake_count, now())
 WHERE cm.mastery_score IS DISTINCT FROM public._compute_mastery_score(
         cm.total_attempts, cm.correct_attempts, cm.recovery_attempts,
         cm.recovery_correct, cm.mistake_count, now());

DO $proof$
DECLARE _stale int;
BEGIN
  SELECT count(*) INTO _stale FROM public.concept_mastery cm
   WHERE cm.mastery_score IS DISTINCT FROM public._compute_mastery_score(
           cm.total_attempts, cm.correct_attempts, cm.recovery_attempts,
           cm.recovery_correct, cm.mistake_count, now());
  IF _stale <> 0 THEN RAISE EXCEPTION '% mastery scores still disagree with their counts', _stale; END IF;
  IF position('mastery_score    = public._compute_mastery_score' IN
       pg_get_functiondef('public._recompute_concept_confidence_for_session(uuid)'::regprocedure)) = 0 THEN
    RAISE EXCEPTION 'the rebuild still leaves mastery_score behind';
  END IF;
END
$proof$;
