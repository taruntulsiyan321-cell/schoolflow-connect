-- ===========================================================================
-- THE PRIVATE STUDENT TABLES STOP BEING ANON-WRITABLE
--
-- Five tables hold one student's own material and nobody else's: their
-- uploads, the questions and notes drawn from them, the questions captured
-- from another app's screen, and the app list that capture obeys. Each has RLS
-- on with a single owner policy, `owner_id = auth.uid()`.
--
-- Each also had **every table privilege granted to `anon`** — Supabase's
-- default grant on a new table in `public`. *Measured 2026-09-24:* anon held
-- SELECT, INSERT, UPDATE and DELETE on all five.
--
-- That is not a leak today, and this migration is not a leak fix. RLS closes
-- it: probed over the real API as anon, selects return `[]` and inserts are
-- refused 42501. It is a defence-in-depth fix. The whole fence rests on one
-- policy per table, so a policy dropped by a later migration, an `ALTER TABLE
-- ... DISABLE ROW LEVEL SECURITY`, or a second permissive policy added without
-- thinking, turns a signed-out stranger into a reader and writer of a
-- student's private work. With the grant gone there is nothing behind the
-- policy to fall back to.
--
-- 20261046000000 took this route for `competitive_exams` and `exam_accounts`
-- and asserted it in its proof. These five predate that habit.
--
-- WHAT `authenticated` KEEPS, and why — every verb below is one that real
-- code performs today, found by reading the callers rather than guessing:
--
--   student_uploads              SELECT, INSERT, UPDATE, DELETE
--     client inserts the row and lists and deletes uploads; the edge function
--     updates status/verdict through the USER's JWT (custom-practice-upload
--     index.ts:62, :94), not the service role, so UPDATE is required.
--   student_upload_questions     SELECT, INSERT, DELETE
--     client reads them to practise; persist.ts inserts and deletes through
--     the user's JWT.
--   student_upload_notes         SELECT, INSERT, DELETE
--     same shape as the questions above.
--   student_capture_questions    SELECT, DELETE
--     the edge function writes these with the service role, so no INSERT or
--     UPDATE is needed. §11 of the capture spec gives the student the right to
--     see and delete anything captured, which is what these two are for.
--   student_capture_allowed_apps SELECT, INSERT, DELETE
--     the edge function reads the list through the user's JWT
--     (screen-capture-mistake index.ts:144); the student chooses the apps.
--
-- `service_role` is untouched: the edge functions run as it.
--
-- Rollback: rollback/20261078000000_private_student_tables_are_not_anon_writable.rollback.sql
-- ===========================================================================

BEGIN;

REVOKE ALL ON TABLE public.student_uploads FROM PUBLIC, anon;
REVOKE ALL ON TABLE public.student_upload_questions FROM PUBLIC, anon;
REVOKE ALL ON TABLE public.student_upload_notes FROM PUBLIC, anon;
REVOKE ALL ON TABLE public.student_capture_questions FROM PUBLIC, anon;
REVOKE ALL ON TABLE public.student_capture_allowed_apps FROM PUBLIC, anon;

REVOKE ALL ON TABLE public.student_uploads FROM authenticated;
REVOKE ALL ON TABLE public.student_upload_questions FROM authenticated;
REVOKE ALL ON TABLE public.student_upload_notes FROM authenticated;
REVOKE ALL ON TABLE public.student_capture_questions FROM authenticated;
REVOKE ALL ON TABLE public.student_capture_allowed_apps FROM authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.student_uploads TO authenticated;
GRANT SELECT, INSERT, DELETE ON TABLE public.student_upload_questions TO authenticated;
GRANT SELECT, INSERT, DELETE ON TABLE public.student_upload_notes TO authenticated;
GRANT SELECT, DELETE ON TABLE public.student_capture_questions TO authenticated;
GRANT SELECT, INSERT, DELETE ON TABLE public.student_capture_allowed_apps TO authenticated;

-- ── Proof ──────────────────────────────────────────────────────────────────

DO $verify$
DECLARE
  _t text;
  _v text;
  _tables text[] := ARRAY[
    'student_uploads', 'student_upload_questions', 'student_upload_notes',
    'student_capture_questions', 'student_capture_allowed_apps'
  ];
BEGIN
  -- 1. anon holds NOTHING on any of them.
  FOREACH _t IN ARRAY _tables LOOP
    FOREACH _v IN ARRAY ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE'] LOOP
      IF has_table_privilege('anon', format('public.%I', _t), _v) THEN
        RAISE EXCEPTION 'ROLLED BACK: anon still holds % on %', _v, _t;
      END IF;
    END LOOP;
  END LOOP;

  -- 2. POSITIVE CONTROL. The loop above would pass just as well against a
  --    table nobody can touch, or against a privilege name Postgres ignores.
  --    authenticated must still hold exactly what its callers perform.
  IF NOT has_table_privilege('authenticated', 'public.student_uploads', 'SELECT')
     OR NOT has_table_privilege('authenticated', 'public.student_uploads', 'INSERT')
     OR NOT has_table_privilege('authenticated', 'public.student_uploads', 'UPDATE')
     OR NOT has_table_privilege('authenticated', 'public.student_uploads', 'DELETE') THEN
    RAISE EXCEPTION 'ROLLED BACK: the upload path lost a privilege it uses';
  END IF;
  IF NOT has_table_privilege('authenticated', 'public.student_upload_questions', 'SELECT')
     OR NOT has_table_privilege('authenticated', 'public.student_upload_questions', 'INSERT')
     OR NOT has_table_privilege('authenticated', 'public.student_upload_questions', 'DELETE') THEN
    RAISE EXCEPTION 'ROLLED BACK: persist.ts can no longer write extracted questions';
  END IF;
  IF NOT has_table_privilege('authenticated', 'public.student_upload_notes', 'SELECT')
     OR NOT has_table_privilege('authenticated', 'public.student_upload_notes', 'INSERT')
     OR NOT has_table_privilege('authenticated', 'public.student_upload_notes', 'DELETE') THEN
    RAISE EXCEPTION 'ROLLED BACK: persist.ts can no longer write notes';
  END IF;
  IF NOT has_table_privilege('authenticated', 'public.student_capture_questions', 'SELECT')
     OR NOT has_table_privilege('authenticated', 'public.student_capture_questions', 'DELETE') THEN
    RAISE EXCEPTION 'ROLLED BACK: the student cannot see or delete their captures (capture spec §11)';
  END IF;
  IF NOT has_table_privilege('authenticated', 'public.student_capture_allowed_apps', 'SELECT')
     OR NOT has_table_privilege('authenticated', 'public.student_capture_allowed_apps', 'INSERT')
     OR NOT has_table_privilege('authenticated', 'public.student_capture_allowed_apps', 'DELETE') THEN
    RAISE EXCEPTION 'ROLLED BACK: the student cannot choose which apps capture obeys';
  END IF;

  -- 3. What was NOT granted stays not granted, or the grants above were lazy.
  IF has_table_privilege('authenticated', 'public.student_capture_questions', 'INSERT')
     OR has_table_privilege('authenticated', 'public.student_capture_questions', 'UPDATE') THEN
    RAISE EXCEPTION 'ROLLED BACK: only the service role writes captured questions';
  END IF;
  IF has_table_privilege('authenticated', 'public.student_upload_questions', 'UPDATE')
     OR has_table_privilege('authenticated', 'public.student_upload_notes', 'UPDATE') THEN
    RAISE EXCEPTION 'ROLLED BACK: nothing updates extracted questions or notes in place';
  END IF;

  -- 4. service_role keeps its own way in — the edge functions run as it.
  FOREACH _t IN ARRAY _tables LOOP
    IF NOT has_table_privilege('service_role', format('public.%I', _t), 'SELECT') THEN
      RAISE EXCEPTION 'ROLLED BACK: service_role lost SELECT on %', _t;
    END IF;
  END LOOP;

  -- 5. And RLS is still the primary fence. This migration adds a second layer;
  --    it does not replace the first, and must never be read as having done so.
  FOREACH _t IN ARRAY _tables LOOP
    IF NOT (SELECT c.relrowsecurity FROM pg_class c
             JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
            WHERE c.relname = _t) THEN
      RAISE EXCEPTION 'ROLLED BACK: row level security is off on %', _t;
    END IF;
  END LOOP;

  RAISE NOTICE 'OK: anon holds nothing on the five private student tables; authenticated keeps exactly the verbs its callers perform; RLS still on';
END
$verify$;

COMMIT;
