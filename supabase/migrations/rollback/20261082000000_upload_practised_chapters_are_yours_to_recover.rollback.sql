-- Rollback 20261082000000 — restore KI58 bank-only practised arm.
BEGIN;

CREATE OR REPLACE FUNCTION public._recovery_chapter_is_for(_uid uuid, _chapter_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1
      FROM public.chapters ch
      JOIN public.section_subjects ss ON ss.curriculum_subject_id = ch.curriculum_subject_id
      JOIN public.students st        ON st.class_id = ss.section_id
     WHERE ch.id = _chapter_id
       AND st.user_id = _uid
  )
  OR EXISTS (
    SELECT 1
      FROM public.question_attempts qa
      JOIN public.question_bank qb ON qb.id = qa.bank_question_id
     WHERE qa.user_id = _uid
       AND qb.chapter_id = _chapter_id
  )
$function$;

DO $verify$
DECLARE
  _src text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO _src
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = '_recovery_chapter_is_for';
  IF position('generated_question' IN _src) > 0 THEN
    RAISE EXCEPTION 'ROLLBACK VERIFY FAILED: still reads generated_question';
  END IF;
END
$verify$;

COMMIT;
