-- ROLLBACK 20261080000000 — every signed-in user on a board can read every
-- approved bank row again, answers included, and the practice catalog runs as
-- the caller (which is what needs that read). Restores the state
-- 20261060000000 left.
BEGIN;

CREATE OR REPLACE FUNCTION public.rpc_practice_bank_catalog(
  _class_level integer,
  _board text,
  _stream text DEFAULT NULL::text,
  _subject text DEFAULT NULL::text,
  _exam_id uuid DEFAULT NULL::uuid
)
 RETURNS TABLE(subject text, chapter text, questions integer)
 LANGUAGE sql
 STABLE SECURITY INVOKER
 SET search_path TO 'public'
AS $function$
  SELECT qb.subject, qb.chapter, count(*)::int
    FROM public.question_bank qb
   WHERE qb.is_approved
     AND qb.is_active
     AND NULLIF(btrim(qb.subject), '') IS NOT NULL
     AND (
       (_exam_id IS NOT NULL AND qb.exam_id = _exam_id)
       OR
       (_exam_id IS NULL
        AND qb.exam_id IS NULL
        AND qb.class_level = _class_level
        AND (qb.board = _board OR qb.board = 'both' OR qb.board IS NULL)
        AND (_stream IS NULL OR qb.stream = _stream OR qb.stream IS NULL))
     )
     AND (_subject IS NULL OR lower(qb.subject) = lower(_subject))
   GROUP BY qb.subject, qb.chapter
   ORDER BY qb.subject, qb.chapter
$function$;

CREATE POLICY qb_select_approved_board ON public.question_bank
  FOR SELECT TO authenticated
  USING (
    is_approved
    AND (
      (exam_id IS NULL
       AND (board IS NULL OR board = 'both'
            OR board = (SELECT s.board FROM public.schools s WHERE s.id = (SELECT public.get_my_school_id()))))
      OR (exam_id IS NOT NULL
          AND exam_id = (SELECT ea.exam_id FROM public.exam_accounts ea WHERE ea.school_id = (SELECT public.get_my_school_id())))
    )
  );

DELETE FROM public.schema_migrations WHERE version = '20261080000000_the_bank_is_staff_only_again';

COMMIT;
