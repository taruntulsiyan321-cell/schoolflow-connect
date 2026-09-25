-- ===========================================================================
-- NO STUDENT QUESTION IS LEFT UNTAGGED
--
-- Ruled 2026-09-25: every question a student uploads or captures is filed
-- under a chapter of their stream's syllabus, and one from outside the stream
-- is not saved. The taggers do that now (_shared/syllabusTagger.ts); this
-- makes the database refuse the alternative, and clears what was stored
-- before the rule:
--
--   * 2 upload questions on a test account (Riya Verma), Business Studies
--     statements on management — filed under Nature and Significance of
--     Management, which is what they test.
--   * 6 Chemistry upload questions on the CUET audit account, and the 1
--     mistake made on them — outside CUET Commerce, so removed, and their
--     two uploads marked unusable with the reason, as the tagger now does.
--
-- Then CHECK constraints: an upload question, an upload note and a captured
-- question always carry a chapter, and so does a mistake made on one of
-- them. The recorded rows let the rollback restore everything.
--
-- ROLLBACK: rollback/20261096000000_no_student_question_is_left_untagged.rollback.sql
-- ===========================================================================

BEGIN;

CREATE TABLE public.untagged_cleanup_20261096 (
  seq        bigserial PRIMARY KEY,
  kind       text NOT NULL,     -- tagged | deleted | upload_marked
  table_name text NOT NULL,
  row_id     uuid NOT NULL,
  payload    jsonb NOT NULL     -- the whole row as it was
);
ALTER TABLE public.untagged_cleanup_20261096 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.untagged_cleanup_20261096 FROM PUBLIC, anon, authenticated;

-- 1. Filed: the two management questions.
INSERT INTO public.untagged_cleanup_20261096 (kind, table_name, row_id, payload)
SELECT 'tagged', 'student_upload_questions', q.id, to_jsonb(q)
  FROM public.student_upload_questions q
 WHERE q.id IN ('9df79f8f-dae9-4adb-895d-399039ed0b2e', 'b332277e-d920-4753-b03f-dac9cfbc6b54')
   AND q.chapter_id IS NULL;

UPDATE public.student_upload_questions q
   SET chapter_id = c.id
  FROM public.chapters c
  JOIN public.curriculum_subjects cs ON cs.id = c.curriculum_subject_id
  JOIN public.curriculum_classes cc ON cc.id = cs.curriculum_class_id
  JOIN public.boards b ON b.id = cc.board_id
 WHERE b.code = 'cuet' AND cs.name = 'Business Studies' AND c.name = 'Nature and Significance of Management'
   AND q.id IN (SELECT row_id FROM public.untagged_cleanup_20261096 WHERE kind = 'tagged');

-- 2. Removed: what is left untagged is the audit account's Chemistry.
DO $check$
BEGIN
  IF EXISTS (SELECT 1 FROM public.student_upload_questions q
               JOIN public.student_uploads u ON u.id = q.upload_id
              WHERE q.chapter_id IS NULL AND u.owner_id <> '095998bc-535c-4417-a434-1720bd7861cd') THEN
    RAISE EXCEPTION 'untagged upload questions remain outside the audit account — measure again';
  END IF;
END $check$;

INSERT INTO public.untagged_cleanup_20261096 (kind, table_name, row_id, payload)
SELECT 'deleted', 'student_mistakes', m.id, to_jsonb(m)
  FROM public.student_mistakes m
 WHERE m.chapter_id IS NULL AND (m.upload_question_id IS NOT NULL OR m.capture_question_id IS NOT NULL);
DELETE FROM public.student_mistakes m
 WHERE m.id IN (SELECT row_id FROM public.untagged_cleanup_20261096 WHERE kind = 'deleted' AND table_name = 'student_mistakes');

INSERT INTO public.untagged_cleanup_20261096 (kind, table_name, row_id, payload)
SELECT 'upload_marked', 'student_uploads', u.id, to_jsonb(u)
  FROM public.student_uploads u
 WHERE u.id IN (SELECT q.upload_id FROM public.student_upload_questions q WHERE q.chapter_id IS NULL);
INSERT INTO public.untagged_cleanup_20261096 (kind, table_name, row_id, payload)
SELECT 'deleted', 'student_upload_questions', q.id, to_jsonb(q)
  FROM public.student_upload_questions q WHERE q.chapter_id IS NULL;
DELETE FROM public.student_upload_questions q WHERE q.chapter_id IS NULL;

UPDATE public.student_uploads u
   SET status = 'unusable', verdict = 'unusable',
       refusal_reason = 'Chemistry isn''t one of your CUET Commerce subjects, so it wasn''t saved.',
       updated_at = now()
 WHERE u.id IN (SELECT row_id FROM public.untagged_cleanup_20261096 WHERE kind = 'upload_marked');

-- 3. From here, the database refuses a student question without a chapter.
ALTER TABLE public.student_upload_questions
  ADD CONSTRAINT student_upload_questions_filed CHECK (chapter_id IS NOT NULL);
ALTER TABLE public.student_upload_notes
  ADD CONSTRAINT student_upload_notes_filed CHECK (chapter_id IS NOT NULL);
ALTER TABLE public.student_capture_questions
  ADD CONSTRAINT student_capture_questions_filed CHECK (chapter_id IS NOT NULL);
ALTER TABLE public.student_mistakes
  ADD CONSTRAINT student_mistakes_private_filed
  CHECK ((upload_question_id IS NULL AND capture_question_id IS NULL) OR chapter_id IS NOT NULL);

DO $proof$
DECLARE _n int;
BEGIN
  SELECT count(*) INTO _n FROM public.student_upload_questions WHERE id IN
    ('9df79f8f-dae9-4adb-895d-399039ed0b2e', 'b332277e-d920-4753-b03f-dac9cfbc6b54') AND chapter_id IS NOT NULL;
  IF _n <> 2 THEN RAISE EXCEPTION 'the management questions were not filed (% of 2)', _n; END IF;
  -- The constraint refuses: a probe insert must fail.
  BEGIN
    INSERT INTO public.student_capture_questions (owner_id, school_id, fingerprint, question_text, answer_source)
    SELECT s.user_id, s.school_id, '__probe_untagged__', '__probe__', 'screen' FROM public.students s LIMIT 1;
    RAISE EXCEPTION 'an untagged capture was accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
END
$proof$;

COMMIT;
