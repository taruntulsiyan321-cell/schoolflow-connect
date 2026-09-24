-- Rollback: remove student SELECT on question_bank; revert view to board-only.
BEGIN;

DROP POLICY IF EXISTS qb_select_approved_board ON public.question_bank;

CREATE OR REPLACE VIEW public.question_bank_student AS
  SELECT
    q.id,
    q.class_level,
    q.subject,
    q.chapter,
    q.difficulty,
    q.question,
    q.options,
    q.source,
    q.is_approved,
    q.created_at,
    q.board,
    q.source_type,
    q.exam_year,
    q.stream,
    q.question_format,
    q.updated_at,
    q.is_active,
    q.chapter_id,
    q.variant_tier,
    q.topic_id
  FROM public.question_bank q
  WHERE q.is_approved
    AND (
      q.board IS NULL
      OR q.board = 'both'
      OR q.board = (
        SELECT s.board
          FROM public.schools s
         WHERE s.id = (SELECT public.get_my_school_id())
      )
    );

GRANT SELECT ON public.question_bank_student TO authenticated, anon;

COMMIT;
