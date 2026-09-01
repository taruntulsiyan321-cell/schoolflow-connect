-- ═══════════════════════════════════════════════════════════════════════════
-- CHUNK 9.5 BATCH 3 — take `anon` off 124 signatures
--
-- Batches 1 and 2 asked "does anything call this at all". Batch 3 asks a
-- different question of what is left, and the difference is the whole chunk:
--
--     `anon` is the role a browser holds BEFORE anyone signs in, and the anon
--     key ships in the client bundle. Every function `anon` can EXECUTE is
--     reachable by anyone on the internet with a copy of the app.
--
-- 289 functions in `public` are EXECUTE-able by anon today. Among them:
-- rpc_bulk_upsert_attendance, rpc_principal_school_health, rpc_teacher_battle_-
-- reports, admin_revoke_student_account, admin_set_teacher_access. They are
-- SECURITY DEFINER and fence themselves on auth.uid(), which is NULL for anon,
-- so the argument is that they refuse. G13 exists because that argument was
-- wrong five times. A grant is a fence; a body is an argument.
--
-- ── The arithmetic, computed from the catalog ─────────────────────────────
--
--   289  EXECUTE-able by anon
--  -114  EXTENSION       pgvector, invoked by operators and index handlers
--  - 23  POLICY_ANON     named in a policy that applies to anon
--  - 21  TRIGGER         fired by a trigger; EXECUTE is not consulted
--  -  1  DEFAULT_EXPR    default_school_id(), the DEFAULT on 14 tables
--  -  0  INDEX_OR_CHECK  none
--  -  2  INVOKER_CALLEE  _recovery_chapter_is_mine, _recovery_variant_pool
--  -  4  SIGNED_OUT      claim_signup_role, get_auth_context, get_my_role,
--                        link_portal_on_auth
--  ----
--    124  signatures (122 distinct names; two carry two overloads each)
--
-- Reproduce with: node scripts/report-anon-execute.mjs
--
-- ── POLICY_ANON is batch 2's near-miss, re-aimed ──────────────────────────
--
-- 108 policies in public are declared `TO authenticated, anon` and 69 more apply
-- to ALL roles — every RESTRICTIVE tenancy fence among them. Revoke `same_school`
-- from anon and an anon read of those tables stops returning zero rows and starts
-- returning "permission denied for function same_school": a 500 where there was a
-- clean empty result, reported by nothing at revoke time.
--
--     same_school                94 anon-applicable policies
--     my_accessible_school_ids   40
--     has_role                   26
--
-- Those counts come from a SQL cross-check written independently of the report
-- script, and the two agree on all 23 names. The guard below re-derives the class
-- a third time, at apply time, against the live catalog — so drift since the list
-- was computed fails the migration instead of taking the app down later.
--
-- ── THE VERIFICATION SUITE IS CARRIED THROUGH, NOT SUBTRACTED ─────────────
--
-- Batch 2 lost twelve functions to the suite and the instinct is to subtract that
-- class again. It would be wrong here, and the reason is worth stating rather
-- than inherited: those twelve broke because the suite CALLS them, as
-- `authenticated`. Batch 3 revokes `anon` and `PUBLIC` and leaves every
-- `authenticated` grant standing, so a call made as `authenticated` is untouched.
--
-- 35 of the 124 are called by a verification file. All 35 stay in. Subtracting
-- them would leave 35 functions open to the internet for a reason that does not
-- apply to them.
--
-- Two premises make that true, and both are checked rather than asserted:
--   a. no verification file calls anything as `anon`         — checked, none does
--   b. no verification file asserts anon STILL holds EXECUTE on a batch-3 name —
--      checked, none does. (CHUNK67_VERIFY does assert exactly that for
--      my_accessible_school_ids, which is in POLICY_ANON and stays granted.)
--
-- Asked as one question against all 124 names at once, not discovered one re-run
-- at a time: a rotted verification file reports only its FIRST failure, so
-- iterating converges slowly and looks like progress while the population is
-- still unknown.
--
-- ── How SIGNED_OUT was determined, after two wrong methods ────────────────
--
-- File-path globs missed ResetPassword.tsx, a public route. A transitive import
-- closure reached every dashboard through `lazy(() => import(...))` and reported
-- 127 signed-out functions against a batch of 1 — a clean number from a blind
-- gate, which is the shape the doc now names outright.
--
-- So it was MEASURED. The dev server was driven to each of the three unguarded
-- routes in src/App.tsx with storage cleared, and the network log read:
--
--     /                 Landing            0 requests to the Supabase project
--     /auth             sign-in page       0 requests to the Supabase project
--     /reset-password   expired-link view  0 requests to the Supabase project
--
-- The client's anon RPC surface is empty. Sign-in runs through GoTrue, which is
-- not a function in `public`. The four kept anyway are the identity and signup
-- calls that can run on the branch where signUp issues no session — wider than
-- the measurement, deliberately, because keeping an unnecessary grant is the
-- safe direction and revoking a necessary one is not.
--
-- claim_signup_role is called as `(supabase.rpc as any)("claim_signup_role", …)`
-- in src/pages/Auth.tsx — the same cast that hid 26 functions from batch 2's
-- `.rpc(` grep. The name search here is a bare-word search for that reason.
--
-- ── Two that end up callable by service_role only ─────────────────────────
--
-- ai_kms_complete_chunk_embed and ai_kms_defer_unset_embeddings hold anon but
-- NOT authenticated — an asymmetry left by an earlier blanket grant. Both are
-- embedding-worker calls made by the service role. After this they are reachable
-- by service_role alone, which is what they were always for. Asserted below
-- rather than assumed.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- The batch, by name. Both overloads of the two overloaded names are in scope,
-- so revoking by name is exact here; the count assertion below proves it.
CREATE TEMP TABLE _b3(name text PRIMARY KEY) ON COMMIT DROP;
INSERT INTO _b3(name) VALUES
  ('active_membership_id'),('active_membership_school_id'),('admin_connect_student_account'),
  ('admin_connect_teacher_account'),('admin_revoke_student_account'),('admin_revoke_teacher_account'),
  ('admin_set_teacher_access'),('admin_set_unique_role'),('ai_analytics_summary_v1'),
  ('ai_benchmark_gate_passed'),('ai_kms_approve_version'),('ai_kms_complete_chunk_embed'),
  ('ai_kms_defer_unset_embeddings'),('ai_kms_enqueue_embedding_jobs'),('ai_kms_register_document'),
  ('ai_kms_reject_version'),('ai_kms_retrieve_chunks'),('ai_kms_submit_version'),
  ('ai_prompt_promote'),('ai_session_memory_append'),('ai_session_memory_close'),
  ('ai_session_memory_open'),('ai_session_memory_read'),('bump_ai_answer_cache_hit'),
  ('can_manage_homework'),('chat_attachment_url_allowed'),('chat_caller_role'),
  ('chat_can_create_class_group'),('chat_can_dm'),('effective_role'),
  ('emit_academic_event'),('ensure_default_role'),('get_user_role'),
  ('is_battle_participant'),('is_chat_participant'),('is_class_of_my_child'),
  ('is_my_child'),('is_my_student_record'),('match_ai_answer_cache'),
  ('match_question_bank'),('process_academic_event'),('process_pending_academic_events'),
  ('publish_due_scheduled_homework'),('rpc_academic_revision_plan'),('rpc_accept_battle_invite'),
  ('rpc_add_community_answer'),('rpc_apply_progression'),('rpc_assign_concept_recovery'),
  ('rpc_battle_curriculum'),('rpc_battle_feed'),('rpc_battle_monitor'),
  ('rpc_bulk_upsert_attendance'),('rpc_cache_agent_insight'),('rpc_challenge_student'),
  ('rpc_classmates'),('rpc_close_homework'),('rpc_complete_recovery_assignment'),
  ('rpc_complete_revision'),('rpc_compute_session_analytics'),('rpc_create_class_battle'),
  ('rpc_create_community_doubt'),('rpc_create_open_battle'),('rpc_create_quick_battle'),
  ('rpc_create_template_solo_battle'),('rpc_decision_engine_rollout_summary_v1'),
  ('rpc_ensure_battle_report'),('rpc_ensure_featured_battle'),('rpc_ensure_featured_battles_all'),
  ('rpc_finish_battle'),('rpc_finish_practice_session'),('rpc_generate_battle'),
  ('rpc_get_academic_brain'),('rpc_get_battle_report'),('rpc_get_cached_agent_insight'),
  ('rpc_get_concept_recovery_report'),('rpc_get_my_student_identity'),('rpc_get_recovery_assignment'),
  ('rpc_get_student_progression'),('rpc_invite_member'),('rpc_join_battle_by_code'),
  ('rpc_leaderboard'),('rpc_list_practice_history'),('rpc_mark_best_community_answer'),
  ('rpc_mirror_battle_answer'),('rpc_parent_child_snapshot'),('rpc_parent_concept_analytics'),
  ('rpc_parent_weekly_digest'),('rpc_pick_question_templates'),('rpc_post_assessment_concept_analysis'),
  ('rpc_principal_concept_analytics'),('rpc_principal_school_health'),('rpc_progression_leaderboard'),
  ('rpc_record_community_doubt_view'),('rpc_record_question_attempt'),('rpc_recovery_session_plan'),
  ('rpc_recovery_v2'),('rpc_refresh_academic_brain'),('rpc_refresh_featured_battles'),
  ('rpc_respond_to_invitation'),('rpc_revision_plan_v2'),('rpc_rotate_featured_battles'),
  ('rpc_save_battle_ai_insights'),('rpc_save_practice_session'),('rpc_set_featured_badges'),
  ('rpc_start_practice_session'),('rpc_student_academic_snapshot'),('rpc_student_concept_mastery'),
  ('rpc_student_performance_charts'),('rpc_student_recovery_zone'),('rpc_submit_battle_answer'),
  ('rpc_submit_recovery_answer'),('rpc_teacher_battle_reports'),('rpc_teacher_class_progression_insights'),
  ('rpc_teacher_concept_analytics'),('rpc_teacher_doubt_dashboard'),('rpc_toggle_question_bookmark'),
  ('rpc_vote_community_answer'),('rpc_vote_community_doubt'),('rpc_weak_areas_v2'),
  ('super_admin_has_access'),('teacher_teaches_class_subject'),('write_academic_audit');


-- ── GUARD: re-derive every exclusion class against the live catalog ────────
--
-- The list above was computed by a script against a database that has since been
-- read many times. This re-derives the same exclusions here, now, and refuses to
-- proceed if any listed name has since acquired a caller that would break. It is
-- the third independent derivation of POLICY_ANON, which is the class that would
-- take production down.
DO $guard$
DECLARE _bad text;
BEGIN
  -- a. named in a policy that applies to anon (or to ALL roles)
  SELECT string_agg(DISTINCT b.name, ', ') INTO _bad
    FROM _b3 b
   WHERE EXISTS (
     SELECT 1 FROM pg_policy p
       JOIN pg_class c ON c.oid = p.polrelid
       JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public'
        AND (p.polroles = '{0}' OR 'anon'::regrole = ANY(p.polroles))
        AND (coalesce(pg_get_expr(p.polqual, p.polrelid), '') || ' ' ||
             coalesce(pg_get_expr(p.polwithcheck, p.polrelid), '')) ~ ('\m' || b.name || '\M'));
  IF _bad IS NOT NULL THEN
    RAISE EXCEPTION
      'batch 3 GUARD: these are named in a policy that applies to anon, so revoking would turn an empty read into permission denied — deferred, invisible, in production: %', _bad;
  END IF;

  -- b. named in a column DEFAULT (evaluated as the INSERTing role)
  SELECT string_agg(DISTINCT b.name, ', ') INTO _bad
    FROM _b3 b
   WHERE EXISTS (
     SELECT 1 FROM pg_attrdef ad
       JOIN pg_class c ON c.oid = ad.adrelid
       JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public'
        AND pg_get_expr(ad.adbin, ad.adrelid) ~ ('\m' || b.name || '\M'));
  IF _bad IS NOT NULL THEN
    RAISE EXCEPTION 'batch 3 GUARD: named in a column DEFAULT: %', _bad;
  END IF;

  -- c. named in an index expression or a CHECK constraint
  SELECT string_agg(DISTINCT b.name, ', ') INTO _bad
    FROM _b3 b
   WHERE EXISTS (
     SELECT 1 FROM pg_index i
       JOIN pg_class c ON c.oid = i.indrelid
       JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND i.indexprs IS NOT NULL
        AND pg_get_indexdef(i.indexrelid) ~ ('\m' || b.name || '\M'))
      OR EXISTS (
     SELECT 1 FROM pg_constraint o
       JOIN pg_namespace n ON n.oid = o.connamespace
      WHERE n.nspname = 'public' AND o.contype = 'c'
        AND pg_get_constraintdef(o.oid) ~ ('\m' || b.name || '\M'));
  IF _bad IS NOT NULL THEN
    RAISE EXCEPTION 'batch 3 GUARD: named in an index expression or CHECK: %', _bad;
  END IF;

  -- d. fired by a trigger
  SELECT string_agg(DISTINCT b.name, ', ') INTO _bad
    FROM _b3 b
    JOIN pg_proc p ON p.proname = b.name
    JOIN pg_namespace n ON n.oid = p.pronamespace AND n.nspname = 'public'
   WHERE EXISTS (SELECT 1 FROM pg_trigger t WHERE t.tgfoid = p.oid AND NOT t.tgisinternal);
  IF _bad IS NOT NULL THEN
    RAISE EXCEPTION 'batch 3 GUARD: fired by a trigger: %', _bad;
  END IF;

  -- e. owned by an extension
  SELECT string_agg(DISTINCT b.name, ', ') INTO _bad
    FROM _b3 b
    JOIN pg_proc p ON p.proname = b.name
    JOIN pg_namespace n ON n.oid = p.pronamespace AND n.nspname = 'public'
   WHERE EXISTS (SELECT 1 FROM pg_depend d
                  WHERE d.objid = p.oid AND d.classid = 'pg_proc'::regclass AND d.deptype = 'e');
  IF _bad IS NOT NULL THEN
    RAISE EXCEPTION 'batch 3 GUARD: owned by an extension: %', _bad;
  END IF;

  -- f. every listed name must actually exist
  SELECT string_agg(b.name, ', ') INTO _bad
    FROM _b3 b
   WHERE NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                      WHERE n.nspname = 'public' AND p.proname = b.name);
  IF _bad IS NOT NULL THEN
    RAISE EXCEPTION 'batch 3 GUARD: these names do not exist, so the list is stale: %', _bad;
  END IF;
END
$guard$;


-- ── BEFORE: anon can execute all of them now, or the after-check is vacuous ─
DO $before$
DECLARE _n int; _sigs int;
BEGIN
  SELECT count(*) INTO _sigs
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    JOIN _b3 b ON b.name = p.proname
   WHERE n.nspname = 'public';

  SELECT count(*) INTO _n
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    JOIN _b3 b ON b.name = p.proname
   WHERE n.nspname = 'public' AND has_function_privilege('anon', p.oid, 'EXECUTE');

  IF _sigs <> 124 THEN
    RAISE EXCEPTION
      'batch 3: the 122 names resolve to % signatures, expected 124. An overload has appeared or gone — revoking by name would take something unmeasured with it.', _sigs;
  END IF;
  IF _n <> _sigs THEN
    RAISE EXCEPTION
      'batch 3: only % of % signatures are anon-executable, so this batch has already been partly applied and the after-check would not prove it was this migration that closed them.', _n, _sigs;
  END IF;
  RAISE NOTICE 'batch 3 before: % signatures, all anon-executable.', _sigs;
END
$before$;


-- ── Capture what `authenticated` holds BEFORE anything is revoked ─────────
--
-- Batch 2's correction was that 290 of 305 functions hold an EXPLICIT
-- authenticated grant, so revoking PUBLIC alone changes nothing while making the
-- verification pass. This is the residual where the opposite is true, and it is
-- invisible to anyone who only checked the first direction:
--
--     13 functions in `public` hold authenticated EXECUTE ONLY through PUBLIC.
--
-- For those, REVOKE … FROM PUBLIC silently takes authenticated's access away.
-- One of them is in this batch — rpc_recovery_session_plan(uuid), created in
-- Chunk 7C-C1 without an explicit grant — and it is the recovery session plan,
-- i.e. a student-facing screen.
--
-- The first run of this migration proved that by failing on it. The pre-state is
-- now captured and restored explicitly, which is what the chunk's step 3 says to
-- do: "grant back explicitly, per function, to the narrowest role that needs it."
--
-- The other ten are the my_* policy helpers, which stay in POLICY_ANON and are
-- untouched here. They are worth recording anyway: every RLS policy that calls
-- them depends on a PUBLIC grant, so a future blanket REVOKE … FROM PUBLIC over
-- them breaks the fence for authenticated as well as anon.
CREATE TEMP TABLE _b3_auth_before(sig text PRIMARY KEY) ON COMMIT DROP;
INSERT INTO _b3_auth_before(sig)
  SELECT p.oid::regprocedure::text
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    JOIN _b3 b ON b.name = p.proname
   WHERE n.nspname = 'public'
     AND has_function_privilege('authenticated', p.oid, 'EXECUTE');


-- ── THE REVOKE, then the explicit re-grant ────────────────────────────────
DO $revoke$
DECLARE r record; _n int := 0; _regrant int := 0;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure::text AS sig
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      JOIN _b3 b ON b.name = p.proname
     WHERE n.nspname = 'public'
     ORDER BY 1
  LOOP
    -- PUBLIC as well as anon: an explicit anon grant is not inherited through
    -- PUBLIC and revoking one does not remove the other. Revoking only anon
    -- would leave PUBLIC carrying the same access while
    -- has_function_privilege('anon', …) went false — a green check and no change.
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC', r.sig);
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM anon', r.sig);
    _n := _n + 1;
  END LOOP;

  -- Restore exactly what was there, by signature, from the captured pre-state.
  -- Not "grant authenticated on all 124": that would hand the two KMS worker
  -- calls a grant they did not have, quietly widening the surface under cover of
  -- a migration whose stated purpose is to narrow it.
  FOR r IN SELECT sig FROM _b3_auth_before ORDER BY 1 LOOP
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', r.sig);
    _regrant := _regrant + 1;
  END LOOP;

  RAISE NOTICE 'batch 3: revoked PUBLIC and anon on %; re-granted authenticated explicitly on %.', _n, _regrant;
END
$revoke$;


-- ── AFTER ─────────────────────────────────────────────────────────────────
DO $after$
DECLARE
  _still text; _lost text; _svc text;
  _uid uuid; _n bigint; _role text; _fail text := '';
BEGIN
  -- 1. anon can execute none of them.
  SELECT string_agg(p.proname, ', ') INTO _still
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    JOIN _b3 b ON b.name = p.proname
   WHERE n.nspname = 'public' AND has_function_privilege('anon', p.oid, 'EXECUTE');
  IF _still IS NOT NULL THEN
    _fail := _fail || format('(1) still anon-executable: %s. ', _still);
  END IF;

  -- 2. authenticated holds EXACTLY what it held before — asserted against the
  --    captured pre-state in both directions. A one-sided check would pass while
  --    the re-grant widened the surface, which is the failure mode of a migration
  --    that restores by rule instead of by measurement.
  SELECT string_agg(b.sig, ', ') INTO _lost
    FROM _b3_auth_before b
   WHERE NOT has_function_privilege('authenticated', b.sig::regprocedure, 'EXECUTE');
  IF _lost IS NOT NULL THEN
    _fail := _fail || format('(2) authenticated lost EXECUTE on: %s. ', _lost);
  END IF;

  SELECT string_agg(p.oid::regprocedure::text, ', ') INTO _lost
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    JOIN _b3 b ON b.name = p.proname
   WHERE n.nspname = 'public'
     AND has_function_privilege('authenticated', p.oid, 'EXECUTE')
     AND p.oid::regprocedure::text NOT IN (SELECT sig FROM _b3_auth_before);
  IF _lost IS NOT NULL THEN
    _fail := _fail || format('(2) authenticated GAINED EXECUTE it did not have before: %s. ', _lost);
  END IF;

  -- 3. The two KMS calls are now service_role-only — reachable by their real
  --    caller, and by nobody else.
  SELECT string_agg(p.oid::regprocedure::text, ', ') INTO _svc
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.proname IN ('ai_kms_complete_chunk_embed','ai_kms_defer_unset_embeddings')
     AND NOT has_function_privilege('service_role', p.oid, 'EXECUTE');
  IF _svc IS NOT NULL THEN
    _fail := _fail || format('(3) the KMS worker calls are now reachable by nobody at all: %s. ', _svc);
  END IF;

  -- 4. THE POLICY_ANON PROOF. As anon, a fenced table must still return ZERO
  --    ROWS and not raise. If a policy helper had been revoked this would be
  --    42501 "permission denied for function", which is the deferred failure
  --    this whole exclusion class exists to avoid — and a catalog check would
  --    have reported clean while the app returned 500s.
  SET LOCAL ROLE anon;
  _role := current_user;
  BEGIN
    SELECT count(*) INTO _n FROM public.students;
    IF _n <> 0 THEN
      _fail := _fail || format('(4) anon can READ %s student rows — the tenancy fence is not holding. ', _n);
    END IF;
    SELECT count(*) INTO _n FROM public.attendance;
    IF _n <> 0 THEN
      _fail := _fail || format('(4) anon can READ %s attendance rows. ', _n);
    END IF;
    SELECT count(*) INTO _n FROM public.classes;
    IF _n <> 0 THEN
      _fail := _fail || format('(4) anon can READ %s class rows. ', _n);
    END IF;
  EXCEPTION WHEN insufficient_privilege THEN
    _fail := _fail ||
      '(4) an anon read now raises permission denied instead of returning zero rows: a policy helper was revoked. ';
  END;
  RESET ROLE;
  IF _role <> 'anon' THEN
    _fail := _fail || format('(4) the anon probe ran as %s, so it proved nothing. ', _role);
  END IF;

  -- 5. Item 3a, carried from batch 2: a REAL student still reads fenced tables.
  --    Not the catalog — the actual read.
  SELECT u.id INTO _uid FROM auth.users u WHERE u.email = 'arjun.mehta@wisdomcampus.com';
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', _uid, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  _role := current_user;
  SELECT count(*) INTO _n FROM public.students;         IF _n = 0 THEN _fail := _fail || '(5) students=0 '; END IF;
  SELECT count(*) INTO _n FROM public.classes;          IF _n = 0 THEN _fail := _fail || '(5) classes=0 '; END IF;
  SELECT count(*) INTO _n FROM public.section_subjects; IF _n = 0 THEN _fail := _fail || '(5) section_subjects=0 '; END IF;
  SELECT count(*) INTO _n FROM public.question_bank;    IF _n = 0 THEN _fail := _fail || '(5) question_bank=0 '; END IF;
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', NULL, true);
  IF _role <> 'authenticated' THEN
    _fail := _fail || format('(5) the student probe ran as %s. ', _role);
  END IF;

  IF _fail <> '' THEN
    RAISE EXCEPTION 'batch 3: %', _fail;
  END IF;
  RAISE NOTICE 'batch 3 after: anon closed on 124, authenticated intact, anon reads still return 0 rows, student reads intact.';
END
$after$;

COMMIT;
