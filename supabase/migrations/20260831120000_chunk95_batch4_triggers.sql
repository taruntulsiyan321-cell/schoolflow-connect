-- ═══════════════════════════════════════════════════════════════════════════
-- CHUNK 9.5 BATCH 4 — the 21 trigger functions, and two callees batch 3 freed
--
-- These need NO grant at all, to any role.
--
-- Postgres does not consult EXECUTE privilege when a trigger fires. The trigger
-- is attached to the table; the firing is the table's, not the caller's. So a
-- trigger function granted to anon and authenticated is carrying a permission
-- that has never been used for its actual purpose — while remaining directly
-- callable by anyone who names it.
--
-- Directly calling one raises "trigger functions can only be called as
-- triggers", so this is not an open door in the way batch 3's were. It is a
-- grant that means nothing, and a grant that means nothing is exactly what
-- hides the ones that mean something: 21 of them sitting in the ACL is 21
-- entries a reviewer has to dismiss before reaching a real finding.
--
-- ── The premise, and why it is proven rather than cited ───────────────────
--
-- "EXECUTE is not checked when a trigger fires" is a claim about Postgres, and
-- this chunk has already found five claims about how permissions behave that
-- were wrong in this database. So the migration builds a throwaway table with a
-- trigger on one of the functions it just revoked, inserts into it AS
-- authenticated, and asserts the trigger ran.
--
-- If the premise were false that insert would raise 42501 and this migration
-- would roll back — which is the whole point of testing it here rather than
-- discovering it on a teacher's attendance screen.
--
-- ── The two extra ────────────────────────────────────────────────────────
--
-- _recovery_chapter_is_mine and _recovery_variant_pool were excluded from batch
-- 3 as INVOKER_CALLEE: they are called from the body of rpc_recovery_session_plan,
-- a SECURITY INVOKER function, so the inner call was checked against the end
-- user. Batch 3 revoked anon from that caller. With no anon caller left, the
-- callees no longer need anon either.
--
-- That is a second-order effect worth naming: closing a caller frees its
-- callees, so the exclusion classes are not fixed — they have to be recomputed
-- after each batch rather than carried forward. Recomputing after batch 3 is
-- what surfaced these two.
--
-- They keep `authenticated`, because rpc_recovery_session_plan still has
-- authenticated callers and is still an INVOKER.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

CREATE TEMP TABLE _b4(name text PRIMARY KEY, total_revoke boolean) ON COMMIT DROP;
INSERT INTO _b4(name, total_revoke) VALUES
  -- Trigger functions: nothing needs EXECUTE on these, so all three go.
  ('handle_new_user', true),
  ('messages_guard_chat_update', true),
  ('protect_profile_tenant_fields', true),
  ('tg_academic_events_autprocess', true),
  ('tg_community_doubt_first_answer_solves', true),
  ('tg_emit_attendance_event', true),
  ('tg_emit_homework_event', true),
  ('tg_emit_homework_submission_event', true),
  ('tg_emit_marks_event', true),
  ('tg_emit_notice_event', true),
  ('tg_emit_remark_event', true),
  ('tg_fees_compute_status', true),
  ('tg_homework_submission_student_guard', true),
  ('tg_log_attendance_change', true),
  ('tg_marks_within_max', true),
  ('tg_set_school_id_from_session', true),
  ('tg_set_updated_at', true),
  ('tg_students_ensure_academic_profile', true),
  ('tg_students_prevent_orphan_history', true),
  ('tg_user_roles_read_only', true),
  ('trg_messages_notify_receiver', true),
  -- Freed callees: anon and PUBLIC only. authenticated still reaches them
  -- through rpc_recovery_session_plan, which is SECURITY INVOKER.
  ('_recovery_chapter_is_mine', false),
  ('_recovery_variant_pool', false);


-- ── GUARD ─────────────────────────────────────────────────────────────────
DO $guard$
DECLARE _bad text; _n int;
BEGIN
  -- Every name exists.
  SELECT string_agg(b.name, ', ') INTO _bad
    FROM _b4 b
   WHERE NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                      WHERE n.nspname = 'public' AND p.proname = b.name);
  IF _bad IS NOT NULL THEN
    RAISE EXCEPTION 'batch 4 GUARD: these names do not exist, so the list is stale: %', _bad;
  END IF;

  -- Every total_revoke name really is a trigger function with a trigger
  -- attached. This is the load-bearing premise of the whole batch: if one of
  -- them is also called directly, revoking EXECUTE from everybody breaks it.
  SELECT string_agg(b.name, ', ') INTO _bad
    FROM _b4 b
    JOIN pg_proc p ON p.proname = b.name
    JOIN pg_namespace n ON n.oid = p.pronamespace AND n.nspname = 'public'
   WHERE b.total_revoke
     AND (pg_get_function_result(p.oid) <> 'trigger'
          OR NOT EXISTS (SELECT 1 FROM pg_trigger t WHERE t.tgfoid = p.oid AND NOT t.tgisinternal));
  IF _bad IS NOT NULL THEN
    RAISE EXCEPTION
      'batch 4 GUARD: these do not RETURN trigger or have no trigger attached, so "nothing needs EXECUTE" does not hold for them: %', _bad;
  END IF;

  -- Nothing here may be named by a policy that applies to anon.
  SELECT string_agg(DISTINCT b.name, ', ') INTO _bad
    FROM _b4 b
   WHERE EXISTS (
     SELECT 1 FROM pg_policy p
       JOIN pg_class c ON c.oid = p.polrelid
       JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public'
        AND (p.polroles = '{0}' OR 'anon'::regrole = ANY(p.polroles))
        AND (coalesce(pg_get_expr(p.polqual, p.polrelid), '') || ' ' ||
             coalesce(pg_get_expr(p.polwithcheck, p.polrelid), '')) ~ ('\m' || b.name || '\M'));
  IF _bad IS NOT NULL THEN
    RAISE EXCEPTION 'batch 4 GUARD: named in a policy that applies to anon: %', _bad;
  END IF;

  -- And nothing that gets a TOTAL revoke may be named by any policy at all, or
  -- by a column DEFAULT — those are evaluated as the querying/inserting role.
  SELECT string_agg(DISTINCT b.name, ', ') INTO _bad
    FROM _b4 b
   WHERE b.total_revoke
     AND (EXISTS (
       SELECT 1 FROM pg_policy p
         JOIN pg_class c ON c.oid = p.polrelid
         JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public'
          AND (coalesce(pg_get_expr(p.polqual, p.polrelid), '') || ' ' ||
               coalesce(pg_get_expr(p.polwithcheck, p.polrelid), '')) ~ ('\m' || b.name || '\M'))
      OR EXISTS (
       SELECT 1 FROM pg_attrdef ad
         JOIN pg_class c ON c.oid = ad.adrelid
         JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public'
          AND pg_get_expr(ad.adbin, ad.adrelid) ~ ('\m' || b.name || '\M')));
  IF _bad IS NOT NULL THEN
    RAISE EXCEPTION 'batch 4 GUARD: total-revoke candidate is named by a policy or a column DEFAULT: %', _bad;
  END IF;

  SELECT count(*) INTO _n
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    JOIN _b4 b ON b.name = p.proname
   WHERE n.nspname = 'public' AND has_function_privilege('anon', p.oid, 'EXECUTE');
  IF _n = 0 THEN
    RAISE EXCEPTION
      'batch 4: none of these is anon-executable, so there is nothing to close and the after-check would pass vacuously.';
  END IF;
  RAISE NOTICE 'batch 4 before: % signature(s) anon-executable.', _n;
END
$guard$;


-- ── THE REVOKE ────────────────────────────────────────────────────────────
DO $revoke$
DECLARE r record; _t int := 0; _p int := 0;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure::text AS sig, b.total_revoke
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      JOIN _b4 b ON b.name = p.proname
     WHERE n.nspname = 'public'
     ORDER BY 1
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC', r.sig);
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM anon', r.sig);
    IF r.total_revoke THEN
      EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM authenticated', r.sig);
      _t := _t + 1;
    ELSE
      -- Keep authenticated, and make it EXPLICIT rather than leaving it to the
      -- PUBLIC grant that was just removed. tg_user_roles_read_only and
      -- rpc_recovery_session_plan both held authenticated only through PUBLIC;
      -- assuming a grant survives a PUBLIC revoke is what broke batch 3's first
      -- run.
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', r.sig);
      _p := _p + 1;
    END IF;
  END LOOP;
  RAISE NOTICE 'batch 4: % closed to every role, % closed to anon and PUBLIC only.', _t, _p;
END
$revoke$;


-- ── THE PREMISE, PROVEN BY FIRING A TRIGGER ───────────────────────────────
--
-- A throwaway table, a trigger on a function `authenticated` no longer holds
-- EXECUTE on, and an INSERT as `authenticated`. If Postgres consulted EXECUTE
-- when firing a trigger, this raises 42501 and the whole migration rolls back.
-- The sentinel matters. The first version of this compared the written
-- updated_at against clock_timestamp() taken just before the insert, and failed:
-- tg_set_updated_at writes now(), which is TRANSACTION START time and therefore
-- earlier than any clock_timestamp() read inside the same transaction. The
-- trigger had fired correctly and the probe called it a failure.
--
-- So the row is inserted carrying an explicit sentinel the trigger must
-- overwrite. That tests "did this trigger write this column" without depending
-- on which clock the trigger uses.
DO $premise$
DECLARE _role text; _after timestamptz; _has boolean;
  _sentinel constant timestamptz := '1970-01-01T00:00:00Z';
BEGIN
  CREATE TEMP TABLE _b4_probe(id int PRIMARY KEY, updated_at timestamptz);
  CREATE TRIGGER _b4_probe_touch BEFORE INSERT OR UPDATE ON _b4_probe
    FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();
  GRANT INSERT, SELECT ON _b4_probe TO authenticated;

  SELECT has_function_privilege('authenticated', 'public.tg_set_updated_at()'::regprocedure, 'EXECUTE')
    INTO _has;
  IF _has THEN
    RAISE EXCEPTION
      'batch 4 premise test is vacuous: authenticated still holds EXECUTE on tg_set_updated_at, so a successful insert would prove nothing.';
  END IF;

  SET LOCAL ROLE authenticated;
  _role := current_user;
  INSERT INTO _b4_probe(id, updated_at) VALUES (1, _sentinel);
  RESET ROLE;

  IF _role <> 'authenticated' THEN
    RAISE EXCEPTION 'batch 4 premise test ran as %, not authenticated — it proves nothing.', _role;
  END IF;

  SELECT updated_at INTO _after FROM _b4_probe WHERE id = 1;
  IF _after IS NULL THEN
    RAISE EXCEPTION
      'batch 4: updated_at is NULL, which this insert did not write — something other than the trigger changed the row.';
  END IF;
  IF _after = _sentinel THEN
    RAISE EXCEPTION
      'batch 4: the trigger did NOT fire — the sentinel survived. The insert succeeded and the trigger body never ran, which is worse than a refusal because nothing reports it.';
  END IF;

  DROP TABLE _b4_probe;
  RAISE NOTICE 'batch 4 premise: a trigger fired for a role holding no EXECUTE on its function. Confirmed.';
END
$premise$;


-- ── AFTER ─────────────────────────────────────────────────────────────────
DO $after$
DECLARE _still text; _fail text := ''; _n bigint; _role text; _uid uuid;
BEGIN
  SELECT string_agg(p.oid::regprocedure::text, ', ') INTO _still
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    JOIN _b4 b ON b.name = p.proname
   WHERE n.nspname = 'public' AND has_function_privilege('anon', p.oid, 'EXECUTE');
  IF _still IS NOT NULL THEN
    _fail := _fail || format('(1) still anon-executable: %s. ', _still);
  END IF;

  SELECT string_agg(p.oid::regprocedure::text, ', ') INTO _still
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    JOIN _b4 b ON b.name = p.proname
   WHERE n.nspname = 'public' AND b.total_revoke
     AND has_function_privilege('authenticated', p.oid, 'EXECUTE');
  IF _still IS NOT NULL THEN
    _fail := _fail || format('(2) trigger function still authenticated-executable: %s. ', _still);
  END IF;

  SELECT string_agg(p.oid::regprocedure::text, ', ') INTO _still
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    JOIN _b4 b ON b.name = p.proname
   WHERE n.nspname = 'public' AND NOT b.total_revoke
     AND NOT has_function_privilege('authenticated', p.oid, 'EXECUTE');
  IF _still IS NOT NULL THEN
    _fail := _fail || format('(3) a kept callee lost authenticated: %s. ', _still);
  END IF;

  -- Every trigger is still attached. A revoke cannot detach one, but asserting
  -- it costs a line and the alternative is trusting that it cannot.
  SELECT string_agg(b.name, ', ') INTO _still
    FROM _b4 b
    JOIN pg_proc p ON p.proname = b.name
    JOIN pg_namespace n ON n.oid = p.pronamespace AND n.nspname = 'public'
   WHERE b.total_revoke
     AND NOT EXISTS (SELECT 1 FROM pg_trigger t WHERE t.tgfoid = p.oid AND NOT t.tgisinternal);
  IF _still IS NOT NULL THEN
    _fail := _fail || format('(4) trigger no longer attached: %s. ', _still);
  END IF;

  -- Item 3a, carried forward: a real student still reads fenced tables, and the
  -- recovery plan is still reachable through its invoker.
  SELECT u.id INTO _uid FROM auth.users u WHERE u.email = 'arjun.mehta@wisdomcampus.com';
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', _uid, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  _role := current_user;
  SELECT count(*) INTO _n FROM public.students;      IF _n = 0 THEN _fail := _fail || '(5) students=0 '; END IF;
  SELECT count(*) INTO _n FROM public.question_bank; IF _n = 0 THEN _fail := _fail || '(5) question_bank=0 '; END IF;
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', NULL, true);
  IF _role <> 'authenticated' THEN
    _fail := _fail || format('(5) probe ran as %s. ', _role);
  END IF;

  -- And anon still reads a fenced table as zero rows rather than an error.
  SET LOCAL ROLE anon;
  _role := current_user;
  BEGIN
    SELECT count(*) INTO _n FROM public.students;
    IF _n <> 0 THEN _fail := _fail || format('(6) anon read %s student rows. ', _n); END IF;
  EXCEPTION WHEN insufficient_privilege THEN
    _fail := _fail || '(6) an anon read now raises permission denied instead of returning zero rows. ';
  END;
  RESET ROLE;
  IF _role <> 'anon' THEN _fail := _fail || format('(6) probe ran as %s. ', _role); END IF;

  IF _fail <> '' THEN
    RAISE EXCEPTION 'batch 4: %', _fail;
  END IF;
  RAISE NOTICE 'batch 4 after: all checks passed.';
END
$after$;

COMMIT;
