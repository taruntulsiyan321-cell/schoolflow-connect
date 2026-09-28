-- ROLLBACK 20261117000000 — puts the overlapping arms back.
--
-- THIS RESTORES THE DEFECT: an exam account is a tenant of one whose school
-- board is NULL, so the school arm's `board IS NULL` case matches for it again
-- and every board-less school question falls back inside its door. Measured on
-- production 2026-09-27: 62 such rows per CUET account, and the account on the
-- fixture exam saw 62 while its own exam holds none.
--
-- It is exact: the view is restored to the definition 20261060000000 gave it,
-- column for column and predicate for predicate. Nothing but the view changes —
-- no row, no grant, no policy — so a student's own mistakes, attempts,
-- sessions, recovery and revision are untouched by both the migration and this.

BEGIN;

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
    q.topic_id,
    q.exam_id
  FROM public.question_bank q
  WHERE q.is_approved
    AND (
      (
        q.exam_id IS NULL
        AND (
          q.board IS NULL
          OR q.board = 'both'
          OR q.board = (
            SELECT s.board
              FROM public.schools s
             WHERE s.id = (SELECT public.get_my_school_id())
          )
        )
      )
      OR (
        q.exam_id IS NOT NULL
        AND q.exam_id = (
          SELECT ea.exam_id
            FROM public.exam_accounts ea
           WHERE ea.school_id = (SELECT public.get_my_school_id())
        )
      )
    );

COMMENT ON VIEW public.question_bank_student IS
  'Approved bank rows a student may read: their school''s board, or their own exam account''s exam.';

-- Fail closed: the overlap must be back, or this rollback did not land.
DO $verify$
DECLARE
  _def text := pg_get_viewdef('public.question_bank_student'::regclass, true);
BEGIN
  IF position('exam_accounts' IN _def) = 0 THEN
    RAISE EXCEPTION 'the restored view has no exam arm at all';
  END IF;
  IF position('NOT EXISTS' IN _def) > 0 THEN
    RAISE EXCEPTION 'the exam-account exclusion is still in the school arm — the rollback did not replace the view';
  END IF;
END
$verify$;

DELETE FROM public.schema_migrations
 WHERE version = '20261117000000_an_exam_account_reads_its_own_exam_and_nothing_else';

COMMIT;
