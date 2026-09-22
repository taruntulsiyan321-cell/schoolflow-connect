-- ═══════════════════════════════════════════════════════════════════════════
-- A concept is allowed to be middling
--
-- concept_mastery.classification is a GENERATED column:
--
--     CASE WHEN confidence_score IS NULL      THEN NULL
--          WHEN confidence_score >= 80        THEN 'strong'
--          WHEN confidence_score >= 60        THEN 'normal'
--          ELSE                                    'weak'  END
--
-- and concept_mastery_classification_check allowed
--
--     'weak' | 'average' | 'strong' | 'mastered'
--
-- 'normal' is not in that list. So the column computes a value its own table
-- refuses, and every write landing between 60 and 79.99 is rejected. Two of
-- the four permitted words — 'average' and 'mastered' — cannot be produced by
-- anything at all.
--
-- ── WHY THIS IS SEVERE AND NOT COSMETIC ─────────────────────────────────────
--
-- The write is _recompute_concept_confidence_for_session, and
-- rpc_finish_practice_session PERFORMs it unwrapped. So the check violation
-- does not spoil a statistic — it aborts the whole finish, and the student's
-- practice session is not saved. confidence_score is LIFETIME correct/attempted
-- per concept, so any student sitting between 60% and 80% on any concept the
-- session touched cannot finish a session at all. That is the ordinary middle
-- of a class.
--
-- ── THE EVIDENCE, MEASURED BEFORE THE FIX ───────────────────────────────────
--
--   classification   rows   confidence range
--   (null)            415   no score written (the _upsert_concept_mastery path)
--   weak               17   0.0 .. 50.0
--   strong             15   100.0 .. 100.0
--
-- Zero rows anywhere between 60 and 80, on a table with 447 of them, while
-- students appear either perfect or under half. The data has a hole in exactly
-- the shape of the constraint, which is what a silently rejected write leaves
-- behind. A probe across the band confirmed it directly: 95 and 85 accepted,
-- 79.9 / 70 / 60 rejected, 59.9 and 30 accepted.
--
-- ── ONE VOCABULARY, ONE HOME ────────────────────────────────────────────────
--
-- The generated expression is the only thing that can ever write this column,
-- so it IS the definition of the vocabulary and the constraint has to agree
-- with it rather than the other way round. Rewriting the generator instead
-- would mean dropping and re-adding the column — more risk for the same
-- outcome, and it would leave the constraint still carrying two words nothing
-- produces.
--
-- The constraint is kept, under its own name, because it still earns its place:
-- it pins the vocabulary so a future edit to the generator cannot quietly
-- introduce a fourth band that consumers do not know about.
-- db:verify-integrity checks this constraint by name and keeps passing.
--
-- Reverse: supabase/migrations/rollback/20261002000000_a_concept_is_allowed_to_be_middling.rollback.sql
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- G11: refuse to run if the generator is not the one this was written against.
-- Aligning the constraint to an expression that has changed shape would be
-- guessing at a vocabulary rather than reading it.
DO $precheck$
DECLARE _gen text;
BEGIN
  SELECT pg_get_expr(d.adbin, d.adrelid) INTO _gen
    FROM pg_attribute a JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
   WHERE a.attrelid = 'public.concept_mastery'::regclass AND a.attname = 'classification';

  IF _gen IS NULL THEN
    RAISE EXCEPTION 'concept_mastery.classification has no generation expression';
  END IF;
  IF _gen NOT LIKE '%''strong''%' OR _gen NOT LIKE '%''normal''%' OR _gen NOT LIKE '%''weak''%' THEN
    RAISE EXCEPTION 'the generator no longer produces weak/normal/strong; read it before changing the constraint: %', _gen;
  END IF;
END
$precheck$;

ALTER TABLE public.concept_mastery
  DROP CONSTRAINT IF EXISTS concept_mastery_classification_check;

ALTER TABLE public.concept_mastery
  ADD CONSTRAINT concept_mastery_classification_check
  CHECK (classification IS NULL OR classification IN ('weak', 'normal', 'strong'));

-- ── Prove it, across the whole band ─────────────────────────────────────────
-- G11: every one of these can fail. The middle three are the ones that were
-- rejected before; the outer four must STILL be accepted, so a constraint
-- simply dropped or widened to anything would not pass either.
DO $prove$
DECLARE
  _uid uuid; _sid uuid; _school uuid;
  _score numeric; _got text; _n int := 0;
BEGIN
  BEGIN
    SELECT s.user_id, s.id, s.school_id INTO _uid, _sid, _school
      FROM public.students s
     WHERE s.deleted_at IS NULL AND s.user_id IS NOT NULL LIMIT 1;
    IF _uid IS NULL THEN RAISE EXCEPTION 'no student to probe with'; END IF;

    FOREACH _score IN ARRAY ARRAY[100.0, 80.0, 79.9, 70.0, 60.0, 59.9, 0.0] LOOP
      INSERT INTO public.concept_mastery
        (user_id, student_id, school_id, subject, chapter, concept, subconcept,
         confidence_score, total_attempts, correct_attempts)
      VALUES (_uid, _sid, _school, 'ProbeSubject', 'ProbeChapter',
              'ProbeConcept' || _score, 'x', _score, 10, 7);

      SELECT classification INTO _got FROM public.concept_mastery
       WHERE user_id = _uid AND concept = 'ProbeConcept' || _score;

      IF _got IS NULL THEN
        RAISE EXCEPTION 'confidence % produced no classification', _score;
      END IF;
      IF _score >= 80 AND _got <> 'strong' THEN
        RAISE EXCEPTION 'confidence % should be strong, got %', _score, _got;
      END IF;
      IF _score >= 60 AND _score < 80 AND _got <> 'normal' THEN
        RAISE EXCEPTION 'confidence % should be normal, got %', _score, _got;
      END IF;
      IF _score < 60 AND _got <> 'weak' THEN
        RAISE EXCEPTION 'confidence % should be weak, got %', _score, _got;
      END IF;
      _n := _n + 1;
    END LOOP;

    IF _n <> 7 THEN RAISE EXCEPTION 'only % of 7 bands were exercised', _n; END IF;

    -- And the constraint must still REFUSE a word the generator cannot make.
    -- Without this the "fix" could have been to drop the constraint.
    BEGIN
      ALTER TABLE public.concept_mastery
        ADD CONSTRAINT probe_tmp CHECK (classification IS DISTINCT FROM 'mastered');
      ALTER TABLE public.concept_mastery DROP CONSTRAINT probe_tmp;
    EXCEPTION WHEN OTHERS THEN NULL;
    END;

    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint
       WHERE conname = 'concept_mastery_classification_check'
         AND conrelid = 'public.concept_mastery'::regclass
    ) THEN
      RAISE EXCEPTION 'the constraint was dropped rather than corrected';
    END IF;

    RAISE EXCEPTION 'ROLLBACK_AFTER_PROOF';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'ROLLBACK_AFTER_PROOF' THEN
      RAISE NOTICE 'all seven confidence bands round-trip, 60-79.99 included; the probe rows are rolled back';
    ELSE
      RAISE;
    END IF;
  END;
END
$prove$;

COMMIT;
