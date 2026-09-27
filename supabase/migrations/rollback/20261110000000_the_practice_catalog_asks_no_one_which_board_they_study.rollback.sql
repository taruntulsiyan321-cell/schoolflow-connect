-- ROLLBACK 20261110000000 — the practice catalog takes the board and the exam
-- from the request again.
--
-- THIS RESTORES THE SECOND HOME: `_board` and `_exam_id` are whatever the
-- client sends, beside question_bank_student, which derives both from the
-- caller. The app must be rolled back with it: it calls the three-argument
-- form this drops.
--
-- The five-argument form is put back exactly as 20261091000000 defined it —
-- body, SECURITY DEFINER and comment. Its grants were never changed (the
-- forward replaced it in place), so they are not touched here.

BEGIN;

DROP FUNCTION IF EXISTS public.rpc_practice_bank_catalog(integer, text, text);

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
        AND qb.chapter_id IN (
          SELECT s.chapter_id
            FROM public.exam_accounts ea
            JOIN public.exam_syllabus_chapters s ON s.exam_id = ea.exam_id AND s.stream = ea.stream
           WHERE ea.school_id = (SELECT public.get_my_school_id())
             AND ea.exam_id = _exam_id))
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

COMMENT ON FUNCTION public.rpc_practice_bank_catalog(integer, text, text, text, uuid) IS
  'Practice subject/chapter counts. School: class+board+stream, exam_id IS NULL. Individual: exam_id.';

-- Fail closed: exactly the old signature, a definer again, callable by
-- authenticated and never by anon.
DO $check$
BEGIN
  IF (SELECT string_agg(p.oid::regprocedure::text, ',') FROM pg_proc p
       WHERE p.proname = 'rpc_practice_bank_catalog' AND p.pronamespace = 'public'::regnamespace)
     IS DISTINCT FROM 'rpc_practice_bank_catalog(integer,text,text,text,uuid)' THEN
    RAISE EXCEPTION 'the catalog was not restored to its 20261091000000 signature';
  END IF;
  IF NOT (SELECT p.prosecdef FROM pg_proc p
           WHERE p.oid = 'public.rpc_practice_bank_catalog(integer,text,text,text,uuid)'::regprocedure) THEN
    RAISE EXCEPTION 'the restored catalog is not SECURITY DEFINER — it would read nothing';
  END IF;
  IF has_function_privilege('anon', 'public.rpc_practice_bank_catalog(integer,text,text,text,uuid)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.rpc_practice_bank_catalog(integer,text,text,text,uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'the restored catalog has the wrong grants';
  END IF;
END
$check$;

DELETE FROM public.schema_migrations
 WHERE version = '20261110000000_the_practice_catalog_asks_no_one_which_board_they_study';

COMMIT;
