-- ═══════════════════════════════════════════════════════════════════════════
-- CHUNK 9.5 batches 3 and 4 — the anon surface, and why each survivor survives
--
-- Self-rolling-back: one implicit transaction ending in a deliberate RAISE.
--
-- This does NOT check a list of names. A list goes stale the moment someone adds
-- a function, and the failure is silent — the new function gets Postgres's
-- default EXECUTE-to-PUBLIC grant, PUBLIC reaches anon, and a name-list gate
-- reports clean because the new name was never on it.
--
-- It checks the INVARIANT instead: every function `anon` can execute must be
-- explainable by one of four classes, each re-derived from the live catalog on
-- every run. Anything else is a finding, whether it was written today or a year
-- ago.
--
--     EXTENSION      owned by pgvector — invoked by operators and index
--                    handlers, never by name
--     POLICY_ANON    named in an RLS policy that applies to anon. Revoking these
--                    turns an empty anon read into "permission denied for
--                    function" — a 500 where there was a clean zero, reported by
--                    nothing at revoke time. same_school alone is named by 94 of
--                    them, my_accessible_school_ids by 40, has_role by 26.
--     DEFAULT_EXPR   named in a column DEFAULT, evaluated as the INSERTing role
--     SIGNED_OUT     the four identity and signup calls that can run before a
--                    session exists
--
-- Batches 3 and 4 took the anon surface from 289 to 142, and all 142 fall in
-- those four classes. The number this file cares about is the fifth bucket:
-- it must be empty.
--
-- CHUNK95_ANON_SURFACE_VERIFY_OK means every item ran and passed.
-- ═══════════════════════════════════════════════════════════════════════════

DO $verify$
DECLARE
  _unexplained text;
  _n_ext int; _n_pol int; _n_def int; _n_signed int;
  _fail text := '';
  _role text; _n bigint; _uid uuid;
  _sentinel constant timestamptz := '1970-01-01T00:00:00Z';
  _after timestamptz;
BEGIN

  -- The four classes, derived live. Named here only for SIGNED_OUT, which is a
  -- product decision rather than a catalog fact and therefore cannot be derived.
  CREATE TEMP TABLE _anon_ok(name text PRIMARY KEY, why text) ON COMMIT DROP;

  INSERT INTO _anon_ok(name, why)
  SELECT DISTINCT p.proname, 'EXTENSION'
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND EXISTS (SELECT 1 FROM pg_depend d
                  WHERE d.objid = p.oid AND d.classid = 'pg_proc'::regclass AND d.deptype = 'e')
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS _n_ext = ROW_COUNT;

  INSERT INTO _anon_ok(name, why)
  SELECT DISTINCT p.proname, 'POLICY_ANON'
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND EXISTS (
       SELECT 1 FROM pg_policy pol
         JOIN pg_class c ON c.oid = pol.polrelid
         JOIN pg_namespace pn ON pn.oid = c.relnamespace
        WHERE pn.nspname = 'public'
          AND (pol.polroles = '{0}' OR 'anon'::regrole = ANY(pol.polroles))
          AND (coalesce(pg_get_expr(pol.polqual, pol.polrelid), '') || ' ' ||
               coalesce(pg_get_expr(pol.polwithcheck, pol.polrelid), '')) ~ ('\m' || p.proname || '\M'))
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS _n_pol = ROW_COUNT;

  INSERT INTO _anon_ok(name, why)
  SELECT DISTINCT p.proname, 'DEFAULT_EXPR'
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND EXISTS (
       SELECT 1 FROM pg_attrdef ad
         JOIN pg_class c ON c.oid = ad.adrelid
         JOIN pg_namespace an ON an.oid = c.relnamespace
        WHERE an.nspname = 'public'
          AND pg_get_expr(ad.adbin, ad.adrelid) ~ ('\m' || p.proname || '\M'))
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS _n_def = ROW_COUNT;

  INSERT INTO _anon_ok(name, why) VALUES
    ('claim_signup_role',   'SIGNED_OUT'),
    ('get_auth_context',    'SIGNED_OUT'),
    ('get_my_role',         'SIGNED_OUT'),
    ('link_portal_on_auth', 'SIGNED_OUT')
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS _n_signed = ROW_COUNT;

  -- A derived class that comes back empty would let everything through. Each
  -- one must have found something, or the derivation has rotted and this file
  -- would report clean while measuring nothing.
  IF _n_ext = 0 OR _n_pol = 0 OR _n_def = 0 THEN
    RAISE EXCEPTION
      'CHUNK95_ANON_SURFACE_VERIFY: a derived class came back EMPTY (extension=%, policy=%, default=%). The derivation has rotted; every check below would pass on a blind gate.',
      _n_ext, _n_pol, _n_def;
  END IF;


  -- ═════════════════════════════════════════════════════════════════════
  -- 1. THE INVARIANT — no anon grant outside the four classes.
  -- ═════════════════════════════════════════════════════════════════════
  SELECT string_agg(p.oid::regprocedure::text, ', ' ORDER BY p.oid::regprocedure::text)
    INTO _unexplained
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.prokind IN ('f','p')
     AND has_function_privilege('anon', p.oid, 'EXECUTE')
     AND p.proname NOT IN (SELECT name FROM _anon_ok);

  IF _unexplained IS NOT NULL THEN
    _fail := _fail || format(
      '(FAIL) 1: anon can EXECUTE these and no class explains why — a signed-out visitor holding the public anon key can call them: %s. ',
      _unexplained);
  END IF;


  -- ═════════════════════════════════════════════════════════════════════
  -- 2. NEGATIVE CONTROL for item 1. Three functions batch 3 closed, named
  --    individually. If item 1 ever passes because the class tables have
  --    swallowed everything, these still catch it.
  -- ═════════════════════════════════════════════════════════════════════
  SELECT string_agg(p.proname, ', ') INTO _unexplained
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.proname IN ('rpc_bulk_upsert_attendance','rpc_principal_school_health','admin_set_teacher_access')
     AND has_function_privilege('anon', p.oid, 'EXECUTE');
  IF _unexplained IS NOT NULL THEN
    _fail := _fail || format('(FAIL) 2: batch 3 has been undone for: %s. ', _unexplained);
  END IF;

  -- The other half of the control: those three must still EXIST and still be
  -- reachable by authenticated. "Not anon-executable" is also true of a function
  -- somebody deleted.
  SELECT string_agg(p.proname, ', ') INTO _unexplained
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.proname IN ('rpc_bulk_upsert_attendance','rpc_principal_school_health','admin_set_teacher_access')
     AND NOT has_function_privilege('authenticated', p.oid, 'EXECUTE');
  IF _unexplained IS NOT NULL THEN
    _fail := _fail || format('(FAIL) 2: these lost authenticated too, so item 2 passes for the wrong reason: %s. ', _unexplained);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
                  WHERE n.nspname='public' AND p.proname='rpc_bulk_upsert_attendance') THEN
    _fail := _fail || '(FAIL) 2: rpc_bulk_upsert_attendance does not exist; the control names something absent. ';
  END IF;


  -- ═════════════════════════════════════════════════════════════════════
  -- 3. POLICY_ANON WAS RIGHT — an anon read still returns ZERO ROWS and
  --    does not raise. This is the deferred failure the class exists to
  --    avoid, and it is invisible to any catalog check: the grants would
  --    all read correctly while the app returned 500s.
  -- ═════════════════════════════════════════════════════════════════════
  SET LOCAL ROLE anon;
  _role := current_user;
  BEGIN
    SELECT count(*) INTO _n FROM public.students;
    IF _n <> 0 THEN _fail := _fail || format('(FAIL) 3: anon read %s student rows. ', _n); END IF;
    SELECT count(*) INTO _n FROM public.attendance;
    IF _n <> 0 THEN _fail := _fail || format('(FAIL) 3: anon read %s attendance rows. ', _n); END IF;
    SELECT count(*) INTO _n FROM public.marks;
    IF _n <> 0 THEN _fail := _fail || format('(FAIL) 3: anon read %s mark rows. ', _n); END IF;
  EXCEPTION WHEN insufficient_privilege THEN
    _fail := _fail ||
      '(FAIL) 3: an anon read raises permission denied instead of returning zero rows — a policy helper has lost its anon grant. ';
  END;
  RESET ROLE;
  IF _role <> 'anon' THEN
    _fail := _fail || format('(FAIL) 3: probe ran as %s, not anon. ', _role);
  END IF;


  -- ═════════════════════════════════════════════════════════════════════
  -- 4. A REAL STUDENT still reads the fenced tables. Not the catalog.
  -- ═════════════════════════════════════════════════════════════════════
  SELECT u.id INTO _uid FROM auth.users u WHERE u.email = 'arjun.mehta@wisdomcampus.com';
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'CHUNK95_ANON_SURFACE_VERIFY: demo student missing; item 4 cannot run as a real role.';
  END IF;
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', _uid, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  _role := current_user;
  SELECT count(*) INTO _n FROM public.students;         IF _n = 0 THEN _fail := _fail || '(FAIL) 4: students=0 '; END IF;
  SELECT count(*) INTO _n FROM public.classes;          IF _n = 0 THEN _fail := _fail || '(FAIL) 4: classes=0 '; END IF;
  SELECT count(*) INTO _n FROM public.section_subjects; IF _n = 0 THEN _fail := _fail || '(FAIL) 4: section_subjects=0 '; END IF;
  SELECT count(*) INTO _n FROM public.question_bank;    IF _n = 0 THEN _fail := _fail || '(FAIL) 4: question_bank=0 '; END IF;
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', NULL, true);
  IF _role <> 'authenticated' THEN
    _fail := _fail || format('(FAIL) 4: probe ran as %s. ', _role);
  END IF;


  -- ═════════════════════════════════════════════════════════════════════
  -- 5. BATCH 4'S PREMISE, still true. Triggers fire without EXECUTE.
  --    A sentinel the trigger must overwrite, not a timestamp comparison:
  --    tg_set_updated_at writes now(), which is TRANSACTION START time and
  --    is therefore earlier than any clock_timestamp() read beside it. The
  --    first version of this check failed on a trigger that had worked.
  -- ═════════════════════════════════════════════════════════════════════
  IF has_function_privilege('authenticated', 'public.tg_set_updated_at()'::regprocedure, 'EXECUTE') THEN
    _fail := _fail || '(FAIL) 5: authenticated holds EXECUTE on tg_set_updated_at again, so this check would prove nothing. ';
  ELSE
    CREATE TEMP TABLE _anon_probe(id int PRIMARY KEY, updated_at timestamptz) ON COMMIT DROP;
    CREATE TRIGGER _anon_probe_touch BEFORE INSERT ON _anon_probe
      FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();
    GRANT INSERT, SELECT ON _anon_probe TO authenticated;

    SET LOCAL ROLE authenticated;
    _role := current_user;
    INSERT INTO _anon_probe(id, updated_at) VALUES (1, _sentinel);
    RESET ROLE;

    SELECT updated_at INTO _after FROM _anon_probe WHERE id = 1;
    IF _role <> 'authenticated' THEN
      _fail := _fail || format('(FAIL) 5: probe ran as %s. ', _role);
    ELSIF _after = _sentinel THEN
      _fail := _fail || '(FAIL) 5: the trigger did not fire — the sentinel survived. Trigger firing now depends on EXECUTE, so batch 4 has broken every trigger it revoked. ';
    END IF;
  END IF;


  IF _fail <> '' THEN
    RAISE EXCEPTION E'CHUNK95_ANON_SURFACE_VERIFY — AT LEAST ONE CHECK FAILED\n%', _fail;
  END IF;

  RAISE EXCEPTION
    'CHUNK95_ANON_SURFACE_VERIFY_OK — 5/5 passed. Every anon EXECUTE grant is explained by extension (%), anon-applicable policy (%), column default (%) or signed-out entry point (%). Rolling back.',
    _n_ext, _n_pol, _n_def, _n_signed;
END
$verify$;
