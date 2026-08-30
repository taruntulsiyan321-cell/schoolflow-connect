-- ═══════════════════════════════════════════════════════════════════════════
-- CHUNK 9.5 batch 2 — final narrowing, and the reason it took three passes
--
-- The previous migration restored five functions the verification suite calls
-- as a real role. Re-running the suite then rotted a SIXTH file on
-- rpc_respond_to_invitation — in the same file whose first failure had just
-- been fixed.
--
-- That is the lesson worth recording: **a rotted verification file reports
-- only its FIRST failure.** Fixing one reveals the next in the same file, so
-- iterating failure-by-failure converges slowly and looks like progress while
-- the real population is still unknown. The right move is to ask the whole
-- question at once — grep every revoked name against the verification
-- directory — which is what produced this list.
--
-- Seven more, all called by a verification file:
--
--   admin_connect_teacher_account   admin action
--   admin_set_unique_role           admin action
--   chat_caller_role                role layer, swept by CHUNK15_VERIFY
--   effective_role                  role layer, swept by CHUNK15_VERIFY
--   get_user_role                   role layer, swept by CHUNK15_VERIFY
--   rpc_parent_child_snapshot       parent panel
--   rpc_respond_to_invitation       Chunk 1: "Accept / Decline / This isn't me"
--
-- Same reasoning as the previous five. A verification file calling a function
-- AS authenticated is a recorded decision that some role should be able to
-- call it; three of these are unambiguously live product actions whose client
-- caller is written some way the grep cannot see, or is not written yet.
--
-- ── Batch 2 closed 32, not 205 ─────────────────────────────────────────────
--
--   205  the batch as originally defined, from a `.rpc("name")` grep
--   -114 pgvector, invoked by operators
--   - 35 called by an RLS policy, evaluated as the querying user
--   - 21 trigger functions
--   -  3 callees of an INVOKER
--   -  1 default_school_id(), the DEFAULT on school_id across 14 tables
--   - 98 referenced by the client after all
--   - 26 referenced by bare name, missed by the .rpc() pattern
--   -  3 entry points whose UI is not built yet
--   - 12 called by the verification suite as a real role
--   ----
--     32 actually closed
--
-- Six of the nine exclusion classes are invisible to a client grep. The batch
-- definition was not slightly wrong; it was wrong by a factor of six, and the
-- single largest class would have taken production down with a deferred
-- failure that reports nothing at revoke time.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

DO $restore$
DECLARE r record; _n int := 0;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure::text AS sig
      FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
     WHERE n.nspname='public'
       AND p.proname = ANY (ARRAY[
         'admin_connect_teacher_account','admin_set_unique_role','chat_caller_role',
         'effective_role','get_user_role','rpc_parent_child_snapshot',
         'rpc_respond_to_invitation'])
  LOOP
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO anon, authenticated', r.sig);
    _n := _n + 1;
  END LOOP;

  IF _n = 0 THEN
    RAISE EXCEPTION 'batch 2 final narrowing: none of the seven was found; the list is stale.';
  END IF;
  RAISE NOTICE 'batch 2 final narrowing: restored EXECUTE on % signature(s).', _n;
END
$restore$;

-- ── The 32 that remain closed, asserted by name ────────────────────────────
-- Named individually rather than counted, so a later blanket GRANT cannot
-- quietly re-open them while a count still looks right.
DO $assert$
DECLARE _reopened text;
BEGIN
  SELECT string_agg(p.proname, ', ') INTO _reopened
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='public'
     AND p.proname = ANY (ARRAY[
       'admin_link_user_to_student','admin_link_user_to_teacher','ai_cosine_similarity',
       'ai_kms_assert_staff','ai_lexical_overlap','can_read_mark','can_read_test','chat_dm_key',
       'current_auth_session_id','get_chat_groups','get_teacher_directory','membership_role_at',
       'my_children_class_ids','my_children_student_ids','my_class_teacher_class_ids',
       'my_teacher_class_ids','normalize_phone','progression_league_for_xp',
       'progression_level_for_xp','progression_xp_for_level','require_active_profile',
       'rls_auto_enable','rpc_backfill_question_concepts','rpc_create_class_group',
       'rpc_mark_group_messages_read','rpc_open_conversation','rpc_record_concept_mistake',
       'rpc_send_direct_message','rpc_send_group_message','rpc_student_improvement_plans',
       'rpc_student_revision_queue','tg_homework_compute_is_late'])
     AND (has_function_privilege('authenticated', p.oid,'EXECUTE')
       OR has_function_privilege('anon', p.oid,'EXECUTE'));

  IF _reopened IS NOT NULL THEN
    RAISE EXCEPTION 'batch 2: these should still be closed but are executable: %', _reopened;
  END IF;
END
$assert$;

-- ── Item 3a again, because the grants moved again ──────────────────────────
DO $read$
DECLARE _uid uuid; _n bigint; _fail text := '';
BEGIN
  SELECT id INTO _uid FROM auth.users WHERE email = 'arjun.mehta@wisdomcampus.com';
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', _uid, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;

  SELECT count(*) INTO _n FROM public.students;         IF _n = 0 THEN _fail := _fail || 'students '; END IF;
  SELECT count(*) INTO _n FROM public.question_bank;    IF _n = 0 THEN _fail := _fail || 'question_bank '; END IF;
  SELECT count(*) INTO _n FROM public.classes;          IF _n = 0 THEN _fail := _fail || 'classes '; END IF;
  SELECT count(*) INTO _n FROM public.section_subjects; IF _n = 0 THEN _fail := _fail || 'section_subjects '; END IF;

  RESET ROLE;
  PERFORM set_config('request.jwt.claims', NULL, true);

  IF _fail <> '' THEN
    RAISE EXCEPTION 'item 3a: a real student can no longer read: %', _fail;
  END IF;
END
$read$;

COMMIT;
