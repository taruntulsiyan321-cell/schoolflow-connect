-- ═══════════════════════════════════════════════════════════════════════════
-- ROLLBACK: the eight merged-in topics and every respelling, put back
--
-- Reads public.topic_merge_20261128000000, which 20261128000000 wrote before
-- changing anything, and puts every row back as it was: the merged-in topics
-- re-created with their own ids, every re-pointed topic_id back, every
-- respelled text back, the folded revision and mastery rows re-inserted and
-- the rows they were folded into restored field by field. The case-insensitive
-- index is 20261126000000's and stays.
--
-- Note what you are restoring: eight topics listed twice under two names,
-- which the owner ruled are one each (KNOWN_ISSUES 107). Anything written to a
-- merged row after the merge is overwritten by the restore of that row.
--
-- Undoes: 20261128000000_the_same_topic_under_two_names_is_one.sql
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- The losing twins, with their own ids.
INSERT INTO public.topics (id, chapter_id, name, created_by, created_at)
SELECT (m.row_before->>'id')::uuid, (m.row_before->>'chapter_id')::uuid, m.row_before->>'name',
       NULLIF(m.row_before->>'created_by', '')::uuid, (m.row_before->>'created_at')::timestamptz
  FROM public.topic_merge_20261128000000 m
 WHERE m.kind = 'topic_deleted';

-- Every re-pointed topic_id.
UPDATE public.question_bank x SET topic_id = (m.row_before->>'topic_id')::uuid
  FROM public.topic_merge_20261128000000 m
 WHERE m.kind = 'repointed' AND m.table_name = 'question_bank' AND x.id = m.row_id;
UPDATE public.student_upload_questions x SET topic_id = (m.row_before->>'topic_id')::uuid
  FROM public.topic_merge_20261128000000 m
 WHERE m.kind = 'repointed' AND m.table_name = 'student_upload_questions' AND x.id = m.row_id;
UPDATE public.student_upload_notes x SET topic_id = (m.row_before->>'topic_id')::uuid
  FROM public.topic_merge_20261128000000 m
 WHERE m.kind = 'repointed' AND m.table_name = 'student_upload_notes' AND x.id = m.row_id;
UPDATE public.student_capture_questions x SET topic_id = (m.row_before->>'topic_id')::uuid
  FROM public.topic_merge_20261128000000 m
 WHERE m.kind = 'repointed' AND m.table_name = 'student_capture_questions' AND x.id = m.row_id;
UPDATE public.homework x SET topic_id = (m.row_before->>'topic_id')::uuid
  FROM public.topic_merge_20261128000000 m
 WHERE m.kind = 'repointed' AND m.table_name = 'homework' AND x.id = m.row_id;

-- Every respelled text.
UPDATE public.question_attempts x SET
  topic = m.row_before->>'topic', concept = m.row_before->>'concept', subconcept = m.row_before->>'subconcept'
  FROM public.topic_merge_20261128000000 m
 WHERE m.kind = 'respelled' AND m.table_name = 'question_attempts' AND x.id = m.row_id;
UPDATE public.student_mistakes x SET
  topic = m.row_before->>'topic', concept = m.row_before->>'concept', subconcept = m.row_before->>'subconcept'
  FROM public.topic_merge_20261128000000 m
 WHERE m.kind = 'respelled' AND m.table_name = 'student_mistakes' AND x.id = m.row_id;
UPDATE public.revision_queue x SET topic = m.row_before->>'topic'
  FROM public.topic_merge_20261128000000 m
 WHERE m.kind = 'respelled' AND m.table_name = 'revision_queue' AND x.id = m.row_id;

-- The revision rows: the kept one as it was, the folded one back.
UPDATE public.revision_queue x SET
  priority = (m.row_before->>'priority')::int,
  due_date = (m.row_before->>'due_date')::date
  FROM public.topic_merge_20261128000000 m
 WHERE m.kind = 'revision_kept' AND x.id = m.row_id;
INSERT INTO public.revision_queue
SELECT (jsonb_populate_record(NULL::public.revision_queue, m.row_before)).*
  FROM public.topic_merge_20261128000000 m
 WHERE m.kind = 'revision_folded';

-- Mastery: respelled rows back to their spelling; the kept row as it was; the
-- folded row back. classification is generated and is not written.
UPDATE public.concept_mastery x SET
  concept = m.row_before->>'concept', subconcept = m.row_before->>'subconcept'
  FROM public.topic_merge_20261128000000 m
 WHERE m.kind = 'mastery_respelled' AND x.id = m.row_id;

UPDATE public.concept_mastery x SET
  student_id              = r.student_id,
  class_level             = r.class_level,
  total_attempts          = r.total_attempts,
  correct_attempts        = r.correct_attempts,
  recovery_attempts       = r.recovery_attempts,
  recovery_correct        = r.recovery_correct,
  mistake_count           = r.mistake_count,
  last_attempt_at         = r.last_attempt_at,
  last_outcome_correct    = r.last_outcome_correct,
  forgetting_events_count = r.forgetting_events_count,
  half_life_estimate      = r.half_life_estimate,
  confidence_score        = r.confidence_score,
  mastery_score           = r.mastery_score,
  updated_at              = r.updated_at
  FROM public.topic_merge_20261128000000 m
  CROSS JOIN LATERAL jsonb_populate_record(NULL::public.concept_mastery, m.row_before - 'classification') r
 WHERE m.kind = 'mastery_kept' AND x.id = m.row_id;

INSERT INTO public.concept_mastery (
  id, user_id, student_id, class_level, subject, chapter, concept, subconcept, mastery_score,
  total_attempts, correct_attempts, recovery_attempts, recovery_correct, mistake_count,
  last_attempt_at, updated_at, school_id, confidence_score, half_life_estimate,
  forgetting_events_count, last_outcome_correct)
SELECT r.id, r.user_id, r.student_id, r.class_level, r.subject, r.chapter, r.concept, r.subconcept, r.mastery_score,
       r.total_attempts, r.correct_attempts, r.recovery_attempts, r.recovery_correct, r.mistake_count,
       r.last_attempt_at, r.updated_at, r.school_id, r.confidence_score, r.half_life_estimate,
       r.forgetting_events_count, r.last_outcome_correct
  FROM public.topic_merge_20261128000000 m
  CROSS JOIN LATERAL jsonb_populate_record(NULL::public.concept_mastery, m.row_before - 'classification') r
 WHERE m.kind = 'mastery_folded';

DO $check$
BEGIN
  IF (SELECT count(*) FROM public.topics t JOIN public.topic_merge_20261128000000 m
        ON m.kind = 'topic_deleted' AND m.row_id = t.id)
     <> (SELECT count(*) FROM public.topic_merge_20261128000000 WHERE kind = 'topic_deleted') THEN
    RAISE EXCEPTION 'not every twin came back';
  END IF;
END
$check$;

DROP TABLE public.topic_merge_20261128000000;

DELETE FROM public.schema_migrations
 WHERE version = '20261128000000_the_same_topic_under_two_names_is_one';

COMMIT;
