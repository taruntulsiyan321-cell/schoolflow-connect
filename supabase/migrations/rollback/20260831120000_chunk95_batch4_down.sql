-- ═══════════════════════════════════════════════════════════════════════════
-- REVERSE OF: 20260831120000_chunk95_batch4_triggers.sql
--
-- Restores EXECUTE to `anon` and, for the 21 trigger functions, to
-- `authenticated` as well.
--
-- READ THIS BEFORE RUNNING IT. Batch 4's premise was tested, not assumed: the
-- migration built a table with a trigger on a function `authenticated` no longer
-- held EXECUTE on, inserted as `authenticated`, and the trigger fired. Postgres
-- does not consult EXECUTE when a trigger fires.
--
-- So if a trigger has stopped working, this file is almost certainly not the
-- fix, and running it will hide the real cause behind a grant that was never
-- doing anything. Find out what actually broke first.
--
-- PUBLIC is deliberately not restored, here as in batch 3.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

DO $restore$
DECLARE r record; _t int := 0; _p int := 0;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure::text AS sig,
           p.proname NOT IN ('_recovery_chapter_is_mine','_recovery_variant_pool') AS is_trigger_fn
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.proname = ANY (ARRAY[
         'handle_new_user','messages_guard_chat_update','protect_profile_tenant_fields',
         'tg_academic_events_autprocess','tg_community_doubt_first_answer_solves',
         'tg_emit_attendance_event','tg_emit_homework_event','tg_emit_homework_submission_event',
         'tg_emit_marks_event','tg_emit_notice_event','tg_emit_remark_event',
         'tg_fees_compute_status','tg_homework_submission_student_guard','tg_log_attendance_change',
         'tg_marks_within_max','tg_set_school_id_from_session','tg_set_updated_at',
         'tg_students_ensure_academic_profile','tg_students_prevent_orphan_history',
         'tg_user_roles_read_only','trg_messages_notify_receiver',
         '_recovery_chapter_is_mine','_recovery_variant_pool'])
  LOOP
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO anon', r.sig);
    IF r.is_trigger_fn THEN
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', r.sig);
      _t := _t + 1;
    ELSE
      _p := _p + 1;
    END IF;
  END LOOP;
  RAISE NOTICE 'batch 4 rollback: % trigger function(s) restored to anon and authenticated, % callee(s) to anon.', _t, _p;
END
$restore$;

COMMIT;
