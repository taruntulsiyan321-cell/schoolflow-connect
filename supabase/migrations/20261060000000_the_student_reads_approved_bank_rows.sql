-- ===========================================================================
-- THE STUDENT READS APPROVED BANK ROWS (AND THE EXAM'S)
--
-- Live ledger has 20261049000000_the_bank_is_staff_only_students_read_the_view,
-- which left only staff/super-admin SELECT on question_bank. practiceService and
-- rpc_practice_bank_catalog (SECURITY INVOKER) still read the table, so every
-- student — school and CUET — got an empty bank. The CUET seed (20 rows) is
-- present; RLS hid it.
--
-- Restores qb_select_approved_board:
--   school  → exam_id IS NULL + board match (chunk 7A intent)
--   exam    → exam_id = caller's exam_accounts.exam_id
--
-- Refreshes question_bank_student to the same fence + exam_id column.
--
-- Rollback: rollback/20261060000000_the_student_reads_approved_bank_rows.rollback.sql
-- ===========================================================================

BEGIN;

DROP POLICY IF EXISTS qb_select_approved_board ON public.question_bank;

CREATE POLICY qb_select_approved_board ON public.question_bank
  FOR SELECT TO authenticated
  USING (
    is_approved
    AND (
      (
        exam_id IS NULL
        AND (
          board IS NULL
          OR board = 'both'
          OR board = (
            SELECT s.board
              FROM public.schools s
             WHERE s.id = (SELECT public.get_my_school_id())
          )
        )
      )
      OR (
        exam_id IS NOT NULL
        AND exam_id = (
          SELECT ea.exam_id
            FROM public.exam_accounts ea
           WHERE ea.school_id = (SELECT public.get_my_school_id())
        )
      )
    )
  );

COMMENT ON POLICY qb_select_approved_board ON public.question_bank IS
  'Approved school-bank rows (exam_id NULL, board match) or approved rows for the caller''s exam_accounts.exam_id.';

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

GRANT SELECT ON public.question_bank_student TO authenticated, anon;

DO $proof$
DECLARE
  _exam uuid;
  _cat  int;
BEGIN
  SELECT id INTO _exam FROM public.competitive_exams WHERE code = 'cuet' AND is_active;
  IF _exam IS NULL THEN
    RAISE EXCEPTION 'ROLLED BACK: no active cuet exam';
  END IF;

  SELECT count(*)::int INTO _cat
    FROM public.rpc_practice_bank_catalog(NULL, NULL, NULL, NULL, _exam);
  IF _cat < 5 THEN
    RAISE EXCEPTION 'ROLLED BACK: exam catalog thin (% chapter rows)', _cat;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename = 'question_bank'
       AND policyname = 'qb_select_approved_board'
  ) THEN
    RAISE EXCEPTION 'ROLLED BACK: qb_select_approved_board missing';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM public.rpc_practice_bank_catalog(12, 'rbse', NULL, NULL, NULL) c
      JOIN public.question_bank qb
        ON qb.exam_id = _exam
       AND qb.subject = c.subject
       AND qb.chapter IS NOT DISTINCT FROM c.chapter
       AND qb.is_approved AND qb.is_active
     WHERE NOT EXISTS (
       SELECT 1 FROM public.question_bank s
        WHERE s.exam_id IS NULL AND s.is_approved AND s.is_active
          AND s.class_level = 12
          AND (s.board = 'rbse' OR s.board = 'both' OR s.board IS NULL)
          AND s.subject = c.subject
          AND s.chapter IS NOT DISTINCT FROM c.chapter
     )
  ) THEN
    RAISE EXCEPTION 'ROLLED BACK: school catalog leaked a CUET-only chapter';
  END IF;

  RAISE NOTICE 'OK: student SELECT restored; exam catalog % chapter rows', _cat;
END
$proof$;

COMMIT;
