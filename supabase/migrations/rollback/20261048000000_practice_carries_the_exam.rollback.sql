-- Rollback 20261048000000_practice_carries_the_exam
BEGIN;

DELETE FROM public.question_bank WHERE exam_id IN (
  SELECT id FROM public.competitive_exams WHERE code = 'cuet'
);

-- Topics/chapters/subjects under CUET board (safe: only our seed board)
DELETE FROM public.topics t
 USING public.chapters ch
 JOIN public.curriculum_subjects cs ON cs.id = ch.curriculum_subject_id
 JOIN public.curriculum_classes cc ON cc.id = cs.curriculum_class_id
 JOIN public.boards b ON b.id = cc.board_id
 WHERE t.chapter_id = ch.id AND b.code = 'cuet';

DELETE FROM public.chapters ch
 USING public.curriculum_subjects cs
 JOIN public.curriculum_classes cc ON cc.id = cs.curriculum_class_id
 JOIN public.boards b ON b.id = cc.board_id
 WHERE ch.curriculum_subject_id = cs.id AND b.code = 'cuet';

DELETE FROM public.curriculum_subjects cs
 USING public.curriculum_classes cc
 JOIN public.boards b ON b.id = cc.board_id
 WHERE cs.curriculum_class_id = cc.id AND b.code = 'cuet';

DELETE FROM public.curriculum_classes cc
 USING public.boards b
 WHERE cc.board_id = b.id AND b.code = 'cuet';

DELETE FROM public.boards WHERE code = 'cuet';

DROP FUNCTION IF EXISTS public.rpc_practice_bank_catalog(integer, text, text, text, uuid);

CREATE FUNCTION public.rpc_practice_bank_catalog(
  _class_level integer,
  _board text,
  _stream text DEFAULT NULL,
  _subject text DEFAULT NULL
)
RETURNS TABLE (subject text, chapter text, questions integer)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path TO 'public'
AS $catalog$
  SELECT qb.subject, qb.chapter, count(*)::int
    FROM public.question_bank qb
   WHERE qb.is_approved
     AND qb.is_active
     AND qb.class_level = _class_level
     AND (qb.board = _board OR qb.board = 'both' OR qb.board IS NULL)
     AND (_stream IS NULL OR qb.stream = _stream OR qb.stream IS NULL)
     AND (_subject IS NULL OR lower(qb.subject) = lower(_subject))
     AND NULLIF(btrim(qb.subject), '') IS NOT NULL
   GROUP BY qb.subject, qb.chapter
   ORDER BY qb.subject, qb.chapter
$catalog$;

REVOKE ALL ON FUNCTION public.rpc_practice_bank_catalog(integer, text, text, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rpc_practice_bank_catalog(integer, text, text, text)
  TO authenticated;

ALTER TABLE public.question_bank DROP CONSTRAINT IF EXISTS question_bank_board_check;
ALTER TABLE public.question_bank
  ADD CONSTRAINT question_bank_board_check
  CHECK (board IS NULL OR board IN ('rbse', 'cbse', 'icse', 'other', 'both'));

DROP INDEX IF EXISTS public.question_bank_exam_id_idx;
ALTER TABLE public.question_bank DROP COLUMN IF EXISTS exam_id;

COMMIT;
