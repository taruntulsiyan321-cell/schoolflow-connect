-- ═══════════════════════════════════════════════════════════════════════════
-- ROLLBACK: the view fences by exam only again; the pool restates the syllabus
--
-- Restores question_bank_student and _student_bank_pool from the definitions
-- 20261129000000 saved, and re-activates the questions it retired. Note what
-- you are restoring: an exam account can be served a question its syllabus
-- does not list wherever the view is read directly (KNOWN_ISSUES 104).
--
-- Undoes: 20261129000000_the_syllabus_is_the_fence_wherever_the_bank_is_read.sql
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

DO $restore$
DECLARE _view text; _pool text;
BEGIN
  SELECT definition INTO _view FROM public.routines_pre_20261129000000 WHERE object = 'view:public.question_bank_student';
  SELECT definition INTO _pool FROM public.routines_pre_20261129000000 WHERE object = 'public._student_bank_pool(integer,text)';
  IF _view IS NULL OR _pool IS NULL THEN
    RAISE EXCEPTION 'no saved definitions in routines_pre_20261129000000 — cannot restore';
  END IF;
  EXECUTE 'CREATE OR REPLACE VIEW public.question_bank_student AS ' || _view;
  EXECUTE _pool;
END
$restore$;

COMMENT ON VIEW public.question_bank_student IS NULL;

UPDATE public.question_bank q SET is_active = true
  FROM public.routines_pre_20261129000000 r
 WHERE r.object = 'retired:' || q.id;

DROP TABLE public.routines_pre_20261129000000;

DELETE FROM public.schema_migrations
 WHERE version = '20261129000000_the_syllabus_is_the_fence_wherever_the_bank_is_read';

COMMIT;
