-- Rollback: 20261069000000_upload_chapter_tally
-- Restores the bank-only _write_chapter_tally from 20260829240000.

BEGIN;

CREATE OR REPLACE FUNCTION public._write_chapter_tally(_session_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE _n integer := 0;
BEGIN
  INSERT INTO public.chapter_tally (user_id, student_id, school_id, chapter_id, session_id, attempted, correct)
  SELECT ps.user_id, ps.student_id, ps.school_id, qb.chapter_id, ps.id,
         count(*)::int,
         count(*) FILTER (WHERE qa.is_correct IS TRUE)::int
    FROM public.question_attempts qa
    JOIN public.practice_sessions ps ON ps.id = qa.session_id
    JOIN public.question_bank qb     ON qb.id = qa.bank_question_id
   WHERE qa.session_id = _session_id
     AND qb.chapter_id IS NOT NULL
   GROUP BY ps.user_id, ps.student_id, ps.school_id, qb.chapter_id, ps.id
  ON CONFLICT (session_id, chapter_id) DO UPDATE
    SET attempted = EXCLUDED.attempted,
        correct   = EXCLUDED.correct;

  GET DIAGNOSTICS _n = ROW_COUNT;
  RETURN _n;
END;
$function$;

REVOKE ALL ON FUNCTION public._write_chapter_tally(uuid) FROM PUBLIC, anon, authenticated;

COMMIT;
