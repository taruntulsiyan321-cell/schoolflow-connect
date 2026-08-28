-- ---------------------------------------------------------------------
-- CHUNK 6.7 VERIFICATION — batch 1 (academic_events)
--
-- Self-rolling-back: everything below happens inside one implicit transaction
-- and the file ends in a deliberate RAISE, so nothing it does survives. That
-- is what lets item 4 deliberately open the fence to prove the check catches
-- it — production never sees the hole.
--
-- Getting CHUNK67_VERIFY_OK back means every item ran and passed.
-- ---------------------------------------------------------------------

DO $verify$
DECLARE
  _admin    uuid;
  _parent   uuid;
  _demo     uuid := '00000000-0000-4000-8000-000000000001';
  _scale    uuid := '00000000-0000-4000-8000-000000000002';
  _n        bigint;
  _h        text;
  _h_before text;
  _h_after  text;
  _txt      text;
  _fail     text := '';
BEGIN

  SELECT id INTO _admin  FROM auth.users WHERE email = 'admin@wisdomcampus.com';
  SELECT id INTO _parent FROM auth.users WHERE email = 'mehta.parent@wisdomcampus.com';
  IF _admin IS NULL OR _parent IS NULL THEN
    RAISE EXCEPTION 'CHUNK67_VERIFY: demo accounts missing; cannot verify as a real role.';
  END IF;

  -- =================================================================
  -- ITEM 1 — the fence is still a fence.
  --
  -- A rewrite that accidentally produced a PERMISSIVE policy would GRANT
  -- access rather than constrain it, and every timing number would look
  -- wonderful. Shape is checked before behaviour.
  -- =================================================================

  SELECT count(*) INTO _n
    FROM pg_policy p
   WHERE p.polrelid = 'public.academic_events'::regclass
     AND p.polname  = 'academic_events_tenant_fence'
     AND NOT p.polpermissive
     AND p.polcmd = '*'
     AND p.polwithcheck IS NOT NULL
     AND pg_get_expr(p.polqual, p.polrelid) = pg_get_expr(p.polwithcheck, p.polrelid);
  IF _n <> 1 THEN
    _fail := _fail || '(FAIL) item 1: the tenant fence is not a RESTRICTIVE FOR ALL policy with a matching WITH CHECK. ';
  END IF;

  SELECT count(*) INTO _n
    FROM pg_policy p
   WHERE p.polrelid = 'public.academic_events'::regclass
     AND coalesce(pg_get_expr(p.polqual, p.polrelid), '')
       || coalesce(pg_get_expr(p.polwithcheck, p.polrelid), '') LIKE '%same_school%';
  IF _n <> 0 THEN
    _fail := _fail || format('(FAIL) item 1: %s policy on academic_events still calls same_school per row. ', _n);
  END IF;

  -- The grant the whole chunk rests on. Without it a hardening step that
  -- revokes EXECUTE from PUBLIC would close every fenced table for every user.
  IF NOT has_function_privilege('authenticated', 'public.my_accessible_school_ids()', 'EXECUTE')
     OR NOT has_function_privilege('anon', 'public.my_accessible_school_ids()', 'EXECUTE') THEN
    _fail := _fail || '(FAIL) item 1: my_accessible_school_ids() is not executable by anon and authenticated. ';
  END IF;


  -- =================================================================
  -- ITEM 2 — set equality, per role, by row CONTENT.
  --
  -- Counts are invariant under a swap: if the rewrite made one school's rows
  -- appear in place of another's, every count would be unchanged. Hashing
  -- each row and then the sorted multiset of hashes fails on substitution as
  -- well as on addition or removal.
  -- =================================================================

  -- Admin of the demo school sees the demo school's events and nothing else.
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', _admin, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*), coalesce(md5(string_agg(h, ',' ORDER BY h)), '-')
    INTO _n, _h
    FROM (SELECT md5(x::text) AS h FROM public.academic_events x) s;
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', NULL, true);

  IF _n = 0 THEN
    _fail := _fail || '(FAIL) item 2: the demo admin can read NO academic_events. The fence was over-tightened. ';
  END IF;


  -- The set the admin sees must be exactly the demo school's rows. Computed
  -- here as the table owner (RLS bypassed) so it is an independent expectation
  -- rather than a restatement of what the policy just returned.
  SELECT count(*), coalesce(md5(string_agg(h, ',' ORDER BY h)), '-')
    INTO _n, _h_before
    FROM (SELECT md5(x::text) AS h FROM public.academic_events x WHERE x.school_id = _demo) s;

  IF _h IS DISTINCT FROM _h_before THEN
    _fail := _fail ||
      '(FAIL) item 2: the demo admin''s visible academic_events do not match the demo school''s rows exactly. ';
  END IF;


  -- =================================================================
  -- ITEM 3 — cross-institution isolation AT SCALE.
  --
  -- The scale fixture is a second institution, so this is no longer a
  -- 13-student assertion: 2,520 of the events in this table belong to
  -- Northfield, and no demo-school role may see any of them.
  -- =================================================================

  SELECT count(*) INTO _n FROM public.academic_events WHERE school_id = _scale;
  IF _n < 2000 THEN
    _fail := _fail || format(
      '(FAIL) item 3: only %s scale-institution events exist, so cross-institution isolation is not being tested at volume. ', _n);
  END IF;

  FOR _txt IN SELECT unnest(ARRAY['admin@wisdomcampus.com','principal@wisdomcampus.com',
                                  'priya.sharma@wisdomcampus.com','mehta.parent@wisdomcampus.com',
                                  'arjun.mehta@wisdomcampus.com'])
  LOOP
    DECLARE _uid uuid; _seen bigint;
    BEGIN
      SELECT id INTO _uid FROM auth.users WHERE email = _txt;
      PERFORM set_config('request.jwt.claims',
        json_build_object('sub', _uid, 'role', 'authenticated')::text, true);
      SET LOCAL ROLE authenticated;
      SELECT count(*) INTO _seen FROM public.academic_events WHERE school_id = _scale;
      RESET ROLE;
      PERFORM set_config('request.jwt.claims', NULL, true);

      IF _seen <> 0 THEN
        _fail := _fail || format('(FAIL) item 3: %s can see %s event(s) belonging to the other institution. ',
                                 _txt, _seen);
      END IF;
    END;
  END LOOP;


  -- =================================================================
  -- ITEM 4 — NEGATIVE CONTROL.
  --
  -- "A gate never seen to fail is a gate never seen to work."
  --
  -- Deliberately open the fence, confirm item 3's check reports the breach,
  -- then let the transaction roll it back. If the check does NOT notice, then
  -- every pass it has ever reported was meaningless, and that is the failure
  -- worth catching.
  -- =================================================================

  -- Baseline: what the parent can see right now.
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', _parent, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  SELECT coalesce(md5(string_agg(h, ',' ORDER BY h)), '-') INTO _h_before
    FROM (SELECT md5(x::text) AS h FROM public.academic_events x) s;
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', NULL, true);

  -- Open the hole: a fence that admits everything.
  EXECUTE 'DROP POLICY academic_events_tenant_fence ON public.academic_events';
  EXECUTE 'CREATE POLICY academic_events_tenant_fence ON public.academic_events '
       || 'AS RESTRICTIVE FOR ALL TO anon, authenticated USING (true) WITH CHECK (true)';
  EXECUTE 'DROP POLICY academic_events_admin_select ON public.academic_events';
  EXECUTE 'CREATE POLICY academic_events_admin_select ON public.academic_events '
       || 'FOR SELECT USING (true)';

  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', _parent, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  SELECT coalesce(md5(string_agg(h, ',' ORDER BY h)), '-'), count(*) INTO _h_after, _n
    FROM (SELECT md5(x::text) AS h FROM public.academic_events x) s;
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', NULL, true);

  IF _h_after IS NOT DISTINCT FROM _h_before THEN
    _fail := _fail ||
      '(FAIL) item 4: the fence was replaced with USING(true) and the content hash did NOT change. '
      || 'The instrument cannot detect an open fence, so every pass it reports is worthless. ';
  END IF;

  IF _n = 0 THEN
    _fail := _fail ||
      '(FAIL) item 4: with the fence wide open the parent still saw 0 rows, so the probe is not reading the table at all '
      || 'and a "0 rows" pass elsewhere would be indistinguishable from an inability to read. ';
  END IF;

  -- The transaction rolls back, restoring both policies. Nothing here commits.


  -- =================================================================
  -- Report.
  -- =================================================================

  IF _fail <> '' THEN
    RAISE EXCEPTION 'CHUNK67_VERIFY — AT LEAST ONE CHECK FAILED: %', _fail;
  END IF;

  RAISE EXCEPTION 'CHUNK67_VERIFY_OK — batch 1 verified; negative control fired; rolling back.';
END
$verify$;
