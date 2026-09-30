-- ═══════════════════════════════════════════════════════════════════════════
-- ROLLBACK: a brought question's attempt filed under the chapter again
--
-- Restores rpc_record_question_attempt from the definition 20261127000000
-- saved. Note what you are restoring: an upload or capture attempt is filed
-- under its chapter's name, and the practice analytics list that beside the
-- question's real topic.
--
-- Undoes: 20261127000000_a_brought_question_is_filed_under_its_own_topic.sql
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

DO $restore$
DECLARE _def text;
BEGIN
  SELECT definition INTO _def FROM public.routines_pre_20261127000000
   WHERE object = 'public.rpc_record_question_attempt';
  IF _def IS NULL THEN
    RAISE EXCEPTION 'no saved definition in routines_pre_20261127000000 — cannot restore';
  END IF;
  EXECUTE _def;
END
$restore$;

DROP TABLE public.routines_pre_20261127000000;

DELETE FROM public.schema_migrations
 WHERE version = '20261127000000_a_brought_question_is_filed_under_its_own_topic';

COMMIT;
