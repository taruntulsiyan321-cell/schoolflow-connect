-- ROLLBACK 20261091000000 — exam accounts lose their stream, the syllabus
-- table goes, and the practice catalog serves an exam's whole bank again
-- (its 20261080000000 definition, restored verbatim).
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
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT qb.subject, qb.chapter, count(*)::int
    FROM public.question_bank qb
   WHERE qb.is_approved
     AND qb.is_active
     AND NULLIF(btrim(qb.subject), '') IS NOT NULL
     AND (
       (_exam_id IS NOT NULL
        AND qb.exam_id = _exam_id
        AND _exam_id = (SELECT ea.exam_id
                          FROM public.exam_accounts ea
                         WHERE ea.school_id = (SELECT public.get_my_school_id())))
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

DROP TABLE public.exam_syllabus_chapters;
ALTER TABLE public.exam_accounts DROP COLUMN stream;

DELETE FROM public.schema_migrations WHERE version = '20261091000000_a_cuet_account_studies_its_stream';

COMMIT;
