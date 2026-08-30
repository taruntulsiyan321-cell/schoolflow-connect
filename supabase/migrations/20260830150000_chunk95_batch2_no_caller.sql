-- ═══════════════════════════════════════════════════════════════════════════
-- CHUNK 9.5 — BATCH 2: functions with no caller, computed from the database
--
-- The batch definition was 205 "functions with no caller found", produced by
-- grepping the client for `.rpc("name")`. Every number in it was wrong, and one
-- of the ways it was wrong would have taken production down without erroring.
--
-- A comment already in this codebase predicted it. Chunk 6.7 batch 1, written
-- weeks before this chunk existed, granted my_accessible_school_ids explicitly
-- and said why:
--
--     "Once 90 tenant fences call it, a routine REVOKE EXECUTE ON ALL
--      FUNCTIONS IN SCHEMA public FROM PUBLIC hardening step would stop every
--      fenced query for every end user, on every table, with a permission
--      error."
--
-- This is that step. The comment only helped because the population was
-- measured instead of trusted.
--
-- ── The seven caller classes, measured ─────────────────────────────────────
--
-- None of these is a `.rpc()` call. None appears in a client grep. Counts are
-- against the 348 functions in `public` that `authenticated` can execute.
--
--   class                        count  why it breaks
--   ---------------------------  -----  ------------------------------------
--   RLS policy expressions          35  evaluated AS THE QUERYING USER.
--                                       same_school is called by policies on
--                                       82 of 140 tables; has_role 69;
--                                       my_accessible_school_ids 29.
--   Extension functions            114  pgvector, invoked by OPERATORS and by
--                                       index handlers, never by name.
--   INVOKER function bodies          3  inner calls are checked against the
--                                       end user: _recovery_chapter_is_mine,
--                                       _recovery_variant_pool, _recovery_const.
--   Column DEFAULTs                  1  default_school_id() is the DEFAULT on
--                                       school_id across 14 TABLES. Revoking
--                                       it denies no read — it fails every
--                                       INSERT into those tables.
--   Trigger functions               21  EXECUTE is not checked when a trigger
--                                       fires, so these are safe, but they are
--                                       excluded and named rather than assumed.
--   CHECK constraints                0  measured, none.
--   Index expressions                0  measured, none in public reference a
--                                       candidate. (pgvector's handlers do,
--                                       and are already excluded above.)
--
-- Checked and NOT at risk, because the question was asked: gen_random_uuid and
-- uuid_generate_v4 back 121 column DEFAULTs, but live in pg_catalog and
-- extensions, so a public-scoped revoke never reaches them. That one would not
-- have produced a permission error either — it would have failed every insert
-- in the app.
--
-- ── The grep under-reports by more than a third ────────────────────────────
--
-- After the seven classes, 73 candidates remained. Re-checking them for a BARE
-- NAME anywhere in src/, supabase/functions/ and e2e/ — rather than the
-- `.rpc("name")` shape — found references for 26 of them.
--
-- The one that matters: rpc_start_session, the login bootstrap, is called as
--
--     await (supabase.rpc as any)("rpc_start_session");
--
-- The `as any` cast sits between `.rpc` and the argument, so the pattern
-- `\.rpc\(\s*"name"` does not match it. Revoking it would have broken sign-in
-- for every user of the product.
--
-- ── Three more excluded: entry points whose UI is not built yet ────────────
--
--   rpc_recovery_session_plan   7C-C's entry point, INVOKER, no screen yet
--   rpc_switch_membership       the panel picker; the database is ahead of
--                               src/auth here and has been since Chunk 1
--   rpc_super_admin_open_access the super-admin grant path
--
-- "No caller" for these means "the caller has not been written yet", which is
-- not the same fact at all.
--
-- ── The arithmetic ─────────────────────────────────────────────────────────
--
--   348  authenticated-executable in public
--  -114  extension (pgvector)
--  - 21  trigger functions
--  -  3  callees of an INVOKER
--  -----
--   210  ours, non-trigger
--  - 35  referenced by an RLS policy
--  -  1  used in a column DEFAULT (default_school_id)
--  -----
--   174
--  - 98  referenced by the client (batches 3 and 4)
--  -----
--    73
--  - 26  referenced by bare name, missed by the .rpc() pattern
--  -  3  entry points pending UI
--  -----
--    44  BATCH 2
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 1. Refuse to run if the premise has moved ──────────────────────────────
-- Every exclusion class is recomputed here rather than trusted from the header.
-- If any count has changed since this batch was calculated, the list below is
-- stale and revoking it would be acting on an old measurement.
DO $premise$
DECLARE _pol int; _ext int; _dflt int; _inv int;
BEGIN
  SELECT count(*) INTO _ext
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='public' AND p.prokind IN ('f','p')
     AND has_function_privilege('authenticated', p.oid,'EXECUTE')
     AND EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid=p.oid AND d.deptype='e');

  SELECT count(*) INTO _pol
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='public' AND p.prokind IN ('f','p')
     AND has_function_privilege('authenticated', p.oid,'EXECUTE')
     AND (SELECT string_agg(coalesce(pg_get_expr(pl.polqual,pl.polrelid),'')||' '||
                            coalesce(pg_get_expr(pl.polwithcheck,pl.polrelid),''),' ')
            FROM pg_policy pl) ~ ('\m'||p.proname||'\M');

  SELECT count(DISTINCT p.proname) INTO _dflt
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='public' AND p.prokind IN ('f','p')
     AND has_function_privilege('authenticated', p.oid,'EXECUTE')
     AND (SELECT string_agg(coalesce(c.column_default,'')||' '||coalesce(c.generation_expression,''),' ')
            FROM information_schema.columns c WHERE c.table_schema='public') ~ ('\m'||p.proname||'\M');

  IF _ext < 100 OR _pol < 30 OR _dflt < 1 THEN
    RAISE EXCEPTION
      'Chunk 9.5 batch 2 premise moved: extension=% (expected ~114), policy-referenced=% (expected ~35), default-referenced=% (expected >=1). Recompute the batch before revoking anything.',
      _ext, _pol, _dflt;
  END IF;

  RAISE NOTICE 'batch 2 premise holds: % extension, % policy-referenced, % default-referenced excluded.',
    _ext, _pol, _dflt;
END
$premise$;


-- ── 2. Prove the revoke will actually change something ─────────────────────
DO $before$
DECLARE _n int;
BEGIN
  SELECT count(*) INTO _n
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='public'
     AND p.proname = ANY (ARRAY[
       'admin_connect_teacher_account','admin_link_user_to_student','admin_link_user_to_teacher',
       'admin_set_unique_role','ai_cosine_similarity','ai_kms_assert_staff','ai_lexical_overlap',
       'can_read_mark','can_read_test','chat_caller_role','chat_can_create_class_group','chat_dm_key',
       'current_auth_session_id','effective_role','get_chat_groups','get_teacher_directory',
       'get_user_role','membership_role_at','my_children_class_ids','my_children_student_ids',
       'my_class_teacher_class_ids','my_teacher_class_ids','normalize_phone',
       'progression_league_for_xp','progression_level_for_xp','progression_xp_for_level',
       'require_active_profile','rls_auto_enable','rpc_backfill_question_concepts',
       'rpc_close_homework','rpc_create_class_group','rpc_generate_battle','rpc_invite_member',
       'rpc_mark_group_messages_read','rpc_open_conversation','rpc_parent_child_snapshot',
       'rpc_record_concept_mistake','rpc_respond_to_invitation','rpc_send_direct_message',
       'rpc_send_group_message','rpc_student_improvement_plans','rpc_student_revision_queue',
       'super_admin_has_access','tg_homework_compute_is_late'])
     AND has_function_privilege('authenticated', p.oid, 'EXECUTE');

  IF _n = 0 THEN
    RAISE EXCEPTION
      'batch 2: none of the listed functions is executable by authenticated, so this migration would close nothing and its after-check would be vacuous.';
  END IF;
  RAISE NOTICE 'batch 2: % function(s) currently executable by authenticated.', _n;
END
$before$;


-- ── 3. Revoke from PUBLIC, anon AND authenticated ──────────────────────────
-- Revoking from PUBLIC alone closes nothing: these hold EXPLICIT grants, which
-- are not inherited through PUBLIC and are not removed by revoking from it.
-- service_role is kept — it is the platform's own path and is not reachable by
-- a signed-in user.
DO $revoke$
DECLARE r record; _n int := 0;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure::text AS sig
      FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
     WHERE n.nspname='public'
       AND p.proname = ANY (ARRAY[
         'admin_connect_teacher_account','admin_link_user_to_student','admin_link_user_to_teacher',
         'admin_set_unique_role','ai_cosine_similarity','ai_kms_assert_staff','ai_lexical_overlap',
         'can_read_mark','can_read_test','chat_caller_role','chat_can_create_class_group','chat_dm_key',
         'current_auth_session_id','effective_role','get_chat_groups','get_teacher_directory',
         'get_user_role','membership_role_at','my_children_class_ids','my_children_student_ids',
         'my_class_teacher_class_ids','my_teacher_class_ids','normalize_phone',
         'progression_league_for_xp','progression_level_for_xp','progression_xp_for_level',
         'require_active_profile','rls_auto_enable','rpc_backfill_question_concepts',
         'rpc_close_homework','rpc_create_class_group','rpc_generate_battle','rpc_invite_member',
         'rpc_mark_group_messages_read','rpc_open_conversation','rpc_parent_child_snapshot',
         'rpc_record_concept_mistake','rpc_respond_to_invitation','rpc_send_direct_message',
         'rpc_send_group_message','rpc_student_improvement_plans','rpc_student_revision_queue',
         'super_admin_has_access','tg_homework_compute_is_late'])
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon, authenticated', r.sig);
    _n := _n + 1;
  END LOOP;

  RAISE NOTICE 'batch 2: revoked EXECUTE on % function signature(s).', _n;
END
$revoke$;


-- ── 4. Assert the revoke landed, against `authenticated` ───────────────────
-- Against authenticated, never against public: asserting against public passes
-- while every signed-in user keeps access, which is how step 3 of this chunk
-- was originally written.
DO $after$
DECLARE _left text;
BEGIN
  SELECT string_agg(p.proname, ', ') INTO _left
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='public'
     AND p.proname = ANY (ARRAY[
       'can_read_mark','my_children_student_ids','require_active_profile','rpc_close_homework',
       'rpc_send_direct_message','super_admin_has_access','effective_role','get_user_role'])
     AND (has_function_privilege('authenticated', p.oid,'EXECUTE')
       OR has_function_privilege('anon', p.oid,'EXECUTE'));

  IF _left IS NOT NULL THEN
    RAISE EXCEPTION 'batch 2: still executable by anon or authenticated: %', _left;
  END IF;
END
$after$;


-- ── 5. VERIFICATION 3a — read a fenced table as a real student ─────────────
--
-- The catalog cannot answer this. Every one of the 35 policy-called functions
-- would pass a "was it revoked" check while the app returned permission denied
-- on the next read, because a policy is evaluated as the querying user and the
-- failure is deferred to read time.
--
-- So: become a real student and read fenced tables. Rows must come back.
DO $read$
DECLARE
  _uid uuid; _n bigint; _fail text := '';
BEGIN
  SELECT id INTO _uid FROM auth.users WHERE email = 'arjun.mehta@wisdomcampus.com';
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'batch 2 item 3a: no demo student to read as; the check would be vacuous.';
  END IF;

  -- set_config changes what auth.uid() RETURNS. It does NOT change the database
  -- role, so without SET LOCAL ROLE this would still run as the owner with RLS
  -- bypassed and EXECUTE checked against postgres — which is how an earlier
  -- probe in this chunk reported "STILL RUNS" for functions it had just revoked.
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', _uid, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;

  SELECT count(*) INTO _n FROM public.students;
  IF _n = 0 THEN _fail := _fail || 'students=0 '; END IF;

  SELECT count(*) INTO _n FROM public.question_bank;
  IF _n = 0 THEN _fail := _fail || 'question_bank=0 '; END IF;

  SELECT count(*) INTO _n FROM public.chapters;
  IF _n = 0 THEN _fail := _fail || 'chapters=0 '; END IF;

  SELECT count(*) INTO _n FROM public.section_subjects;
  IF _n = 0 THEN _fail := _fail || 'section_subjects=0 '; END IF;

  SELECT count(*) INTO _n FROM public.classes;
  IF _n = 0 THEN _fail := _fail || 'classes=0 '; END IF;

  RESET ROLE;
  PERFORM set_config('request.jwt.claims', NULL, true);

  IF _fail <> '' THEN
    RAISE EXCEPTION
      'batch 2 item 3a: a real student can no longer read fenced tables (%). A function an RLS policy calls has lost its grant — this is the deferred failure the batch exists to avoid.',
      _fail;
  END IF;
END
$read$;

COMMIT;
