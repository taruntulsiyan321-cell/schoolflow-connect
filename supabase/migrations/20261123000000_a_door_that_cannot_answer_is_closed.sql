-- ═══════════════════════════════════════════════════════════════════════════
-- A DOOR THAT CANNOT ANSWER IS CLOSED
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Found 2026-09-29 running `npm run verify:chunk-files` after the recovery
-- migrations: CHUNK7F_LADDER_SIZED_BY_MISTAKES_VERIFY rotted with
-- `42501 permission denied for function _brought_question_askable`.
--
-- WHAT THAT EXPOSED. Two recovery helpers carry EXECUTE for `authenticated`:
--
--   _recovery_session_plan_for(uuid, uuid)   SECURITY INVOKER, granted
--   rpc_recovery_session_plan(uuid)          SECURITY INVOKER, granted
--
-- `lint-tenant-scope`'s allowlist records them as safe because a student
-- calling them gets "a plan built from their own mistakes and an empty bank —
-- degraded, never wider". That was true when it was written. It is not true
-- now: measured as a real signed-in CUET student on 2026-09-29, both refuse
-- with `42501 permission denied for table variant_generation_queue`, because
-- 20261118000000 made the plan builder enqueue variant generation, and that
-- queue is not readable by a client. The functions cannot complete for any
-- client, for any argument.
--
-- So each is a granted door that can only fail, and one of them
-- (`_recovery_session_plan_for`) takes a USER ID as its first argument. It does
-- not leak today — the curriculum predicate refuses a chapter that is not the
-- caller's, and the queue error stops it before anything is returned — but it
-- is protected by an accident of a downstream table grant rather than by a
-- fence. The moment the plan stops touching that queue it becomes a way to ask
-- for another student's recovery plan.
--
-- Nothing calls either one. The app starts recovery through the definer
-- `rpc_start_recovery_session` (src/academic/services/recoveryEngineService.ts)
-- and reads the card through the definer `rpc_student_recovery_queue`; grepped
-- across src/, supabase/functions/ and scripts/, the only mentions are comments
-- and the two allowlist entries. So EXECUTE goes, and a refusal becomes the
-- design rather than a side effect.
--
-- WHAT STILL WORKS, AND WHY. Every real caller reaches the plan from inside a
-- SECURITY DEFINER — rpc_start_recovery_session, rpc_student_recovery_queue
-- (through the internal _recovery_queue_for), rpc_submit_recovery_session, and
-- the learning-reminders cron — where the effective user is the owner, for whom
-- nothing is revoked. The proof below runs the student-facing path as a real
-- student and asserts it still answers.
--
-- ROLLBACK: rollback/20261123000000_a_door_that_cannot_answer_is_closed.rollback.sql
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- Recorded first: what the grants are, so the rollback and the reader can see.
DO $before$
DECLARE _r record;
BEGIN
  FOR _r IN
    SELECT p.proname AS n, pg_get_function_identity_arguments(p.oid) AS args,
           has_function_privilege('authenticated', p.oid, 'EXECUTE') AS auth,
           has_function_privilege('anon', p.oid, 'EXECUTE') AS anon
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.proname IN ('_recovery_session_plan_for', 'rpc_recovery_session_plan')
  LOOP
    RAISE NOTICE 'before: %(%) authenticated=% anon=%', _r.n, _r.args, _r.auth, _r.anon;
  END LOOP;
END
$before$;

REVOKE ALL ON FUNCTION public._recovery_session_plan_for(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.rpc_recovery_session_plan(uuid) FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public._recovery_session_plan_for(uuid, uuid) IS
  'The recovery ladder for one student and one chapter. INTERNAL: EXECUTE revoked from PUBLIC, anon and authenticated (20261123000000) because it takes a user id and, since 20261118000000, cannot complete as a client at all. Reached only from a SECURITY DEFINER caller that passes the student it is planning for.';
COMMENT ON FUNCTION public.rpc_recovery_session_plan(uuid) IS
  'Superseded. SECURITY INVOKER wrapper that passed auth.uid() to _recovery_session_plan_for; nothing in the app has called it since recovery moved to the definer rpc_start_recovery_session, and since 20261118000000 it refuses every client with 42501 on variant_generation_queue. EXECUTE revoked from PUBLIC, anon and authenticated (20261123000000).';

-- ── THE PROOF ─────────────────────────────────────────────────────────────
--
--   1. Neither function is executable by anon or authenticated any more.
--   2. A real student's recovery card still answers, and answers content —
--      which is only possible if the definer path still reaches the plan.
--      (This is the control: if revoking had broken the chain, this raises.)
--   3. Called directly as that student, each is now refused for want of
--      EXECUTE — a decision — rather than for want of a table grant.
--   4. The revision check, which also plans, still answers.
DO $proof$
DECLARE
  _uid uuid; _chap uuid; _queue jsonb; _plan jsonb; _err text; _n int;
BEGIN
  SELECT count(*) INTO _n
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.proname IN ('_recovery_session_plan_for', 'rpc_recovery_session_plan')
     AND (has_function_privilege('authenticated', p.oid, 'EXECUTE')
       OR has_function_privilege('anon', p.oid, 'EXECUTE'));
  IF _n <> 0 THEN
    RAISE EXCEPTION '% of the two functions can still be executed by a client role', _n;
  END IF;

  SELECT sm.user_id, sm.chapter_id INTO _uid, _chap
    FROM public.student_mistakes sm
   WHERE sm.status = 'open' AND sm.chapter_id IS NOT NULL
     AND (sm.question_id IS NOT NULL OR sm.upload_question_id IS NOT NULL
          OR sm.capture_question_id IS NOT NULL)
   GROUP BY sm.user_id, sm.chapter_id
   LIMIT 1;
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'no student with an open mistake, so the definer path cannot be exercised';
  END IF;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', _uid)::text, true);
  SET LOCAL ROLE authenticated;
  _queue := public.rpc_student_recovery_queue();
  RESET ROLE;
  IF _queue IS NULL OR jsonb_typeof(_queue) <> 'array' OR jsonb_array_length(_queue) = 0 THEN
    RAISE EXCEPTION
      'CONTROL FAILED: the recovery card answered % for a student with an open mistake — the definer path is broken',
      coalesce(_queue::text, 'NULL');
  END IF;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', _uid)::text, true);
  SET LOCAL ROLE authenticated;
  _plan := public.rpc_revision_session_plan(_chap);
  RESET ROLE;
  IF _plan IS NULL OR (_plan->>'total') IS NULL THEN
    RAISE EXCEPTION 'the revision check stopped answering';
  END IF;

  BEGIN
    PERFORM set_config('request.jwt.claims', json_build_object('sub', _uid)::text, true);
    SET LOCAL ROLE authenticated;
    PERFORM public._recovery_session_plan_for(_uid, _chap);
    RESET ROLE;
    RAISE EXCEPTION '_recovery_session_plan_for still answers a client';
  EXCEPTION
    WHEN insufficient_privilege THEN
      RESET ROLE;
    WHEN OTHERS THEN
      _err := SQLSTATE || ' ' || SQLERRM;
      RESET ROLE;
      RAISE EXCEPTION '_recovery_session_plan_for refused for the wrong reason: %', _err;
  END;

  BEGIN
    PERFORM set_config('request.jwt.claims', json_build_object('sub', _uid)::text, true);
    SET LOCAL ROLE authenticated;
    PERFORM public.rpc_recovery_session_plan(_chap);
    RESET ROLE;
    RAISE EXCEPTION 'rpc_recovery_session_plan still answers a client';
  EXCEPTION
    WHEN insufficient_privilege THEN
      RESET ROLE;
    WHEN OTHERS THEN
      _err := SQLSTATE || ' ' || SQLERRM;
      RESET ROLE;
      RAISE EXCEPTION 'rpc_recovery_session_plan refused for the wrong reason: %', _err;
  END;

  RAISE NOTICE 'both doors closed; the card answers % chapter(s) and the check answers a total of %',
    jsonb_array_length(_queue), _plan->>'total';
END
$proof$;

INSERT INTO public.schema_migrations (version)
VALUES ('20261123000000_a_door_that_cannot_answer_is_closed')
ON CONFLICT (version) DO NOTHING;

COMMIT;
