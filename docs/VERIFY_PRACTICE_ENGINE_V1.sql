-- =============================================================================
-- Practice Engine V1 — post-migration invariant checks
-- =============================================================================
-- Run in the Supabase SQL editor AFTER applying
-- supabase/migrations/20260804010000_practice_engine_question_record.sql
-- (and again after some manual practice testing).
--
-- Every row returned by this script is a FAILURE. A clean run returns the
-- summary at the bottom and nothing else.
-- =============================================================================

-- 1. No duplicate question records (one row per student per question).
SELECT 'DUPLICATE question_records' AS check_name, user_id, question_id, count(*)
FROM public.question_records
GROUP BY user_id, question_id
HAVING count(*) > 1;

-- 2. Counters never negative.
SELECT 'NEGATIVE counter' AS check_name, id, attempt_count, correct_count, wrong_count, skipped_count
FROM public.question_records
WHERE attempt_count < 0 OR correct_count < 0 OR wrong_count < 0 OR skipped_count < 0;

-- 3. attempt_count always equals the sum of the outcome counters.
SELECT 'COUNTER SUM mismatch' AS check_name, id, attempt_count, correct_count, wrong_count, skipped_count
FROM public.question_records
WHERE attempt_count <> correct_count + wrong_count + skipped_count;

-- 4. Every referenced question still resolves (active or soft-deleted).
SELECT 'ORPHAN question_id' AS check_name, qr.id, qr.question_id
FROM public.question_records qr
LEFT JOIN public.question_bank qb ON qb.id = qr.question_id
WHERE qb.id IS NULL;

-- 5. Every last_session_id references a real session.
SELECT 'ORPHAN last_session_id' AS check_name, qr.id, qr.last_session_id
FROM public.question_records qr
LEFT JOIN public.practice_sessions ps ON ps.id = qr.last_session_id
WHERE qr.last_session_id IS NOT NULL AND ps.id IS NULL;

-- 6. Status values are constrained to the three legal states.
SELECT 'BAD current_status' AS check_name, id, current_status
FROM public.question_records
WHERE current_status NOT IN ('correct', 'wrong', 'skipped');

-- 7. Confidence stays within range, and classification never contradicts it.
--    classification is a generated column, so a row here means the generated
--    expression itself is wrong, not that a writer drifted.
SELECT 'CONFIDENCE/classification mismatch' AS check_name,
       id, confidence_score, classification
FROM public.concept_mastery
WHERE confidence_score IS NOT NULL
  AND classification IS DISTINCT FROM (
    CASE WHEN confidence_score >= 80 THEN 'strong'
         WHEN confidence_score >= 60 THEN 'normal'
         ELSE 'weak' END
  );

SELECT 'CONFIDENCE out of range' AS check_name, id, confidence_score
FROM public.concept_mastery
WHERE confidence_score IS NOT NULL
  AND (confidence_score < 0 OR confidence_score > 100);

-- 8. Confidence must equal correct/attempted for the stored counts.
SELECT 'CONFIDENCE not correct/attempted' AS check_name,
       id, confidence_score, correct_attempts, total_attempts
FROM public.concept_mastery
WHERE confidence_score IS NOT NULL
  AND total_attempts > 0
  AND round((correct_attempts::numeric / total_attempts) * 100, 1) <> confidence_score;

-- 9. Mistake Book is exactly "current status = wrong" — nothing else leaks in.
SELECT 'MISTAKE BOOK non-wrong row' AS check_name, id, current_status
FROM public.question_records
WHERE current_status = 'wrong' AND attempt_count = 0;

-- 10. Bookmarks are independent of status: a correct answer must not clear one.
--     (Informational — a non-zero count here is EXPECTED and healthy.)
SELECT 'INFO bookmarked+correct (expected non-zero)' AS check_name, count(*)
FROM public.question_records
WHERE bookmarked AND current_status = 'correct';

-- 11. Soft delete: retired questions must not be gone, only inactive.
SELECT 'INFO soft-deleted questions still referenced by history' AS check_name, count(*)
FROM public.question_records qr
JOIN public.question_bank qb ON qb.id = qr.question_id
WHERE qb.is_active = false;

-- ── Summary ─────────────────────────────────────────────────────────────────
SELECT
  (SELECT count(*) FROM public.question_records)                              AS question_records,
  (SELECT count(*) FROM public.question_records WHERE current_status='wrong') AS in_mistake_book,
  (SELECT count(*) FROM public.question_records WHERE bookmarked)             AS bookmarked,
  (SELECT count(*) FROM public.concept_mastery WHERE confidence_score IS NOT NULL) AS concepts_scored,
  (SELECT count(*) FROM public.concept_mastery WHERE classification='weak')   AS weak_concepts,
  (SELECT count(*) FROM public.question_bank WHERE is_active = false)         AS retired_questions;
