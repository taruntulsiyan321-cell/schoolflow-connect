-- ROLLBACK 20261154000000 — the bank no longer knows which questions are
-- answered with a figure.
--
-- A view cannot lose a column in place, so question_bank_student is dropped
-- and made again exactly as live had it before (nothing depends on it), with
-- its grants as they were: everything to authenticated and service_role,
-- nothing to anon (a new view picks up the schema's default grants).

BEGIN;

DROP VIEW public.question_bank_student;

CREATE VIEW public.question_bank_student AS
 SELECT id,
    class_level,
    subject,
    chapter,
    difficulty,
    question,
    options,
    source,
    is_approved,
    created_at,
    board,
    source_type,
    exam_year,
    stream,
    question_format,
    updated_at,
    is_active,
    chapter_id,
    variant_tier,
    topic_id,
    exam_id
   FROM question_bank q
  WHERE is_approved AND (exam_id IS NULL AND NOT (EXISTS ( SELECT 1
           FROM exam_accounts ea
          WHERE ea.school_id = (( SELECT get_my_school_id() AS get_my_school_id)))) AND (board IS NULL OR board = 'both'::text OR board = (( SELECT s.board
           FROM schools s
          WHERE s.id = (( SELECT get_my_school_id() AS get_my_school_id))))) OR exam_id IS NOT NULL AND (chapter_id IN ( SELECT s.chapter_id
           FROM exam_accounts ea
             JOIN exam_syllabus_chapters s ON s.exam_id = ea.exam_id AND s.stream = ea.stream
          WHERE ea.school_id = (( SELECT get_my_school_id() AS get_my_school_id)) AND ea.exam_id = q.exam_id)));

REVOKE ALL ON public.question_bank_student FROM PUBLIC, anon;
GRANT ALL ON public.question_bank_student TO authenticated, service_role;

DROP FUNCTION public.answers_are_numbers(jsonb);

COMMIT;
