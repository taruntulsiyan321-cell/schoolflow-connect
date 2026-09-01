-- =====================================================================
-- CHUNK 1 — the three isolation proofs the build document demands.
--
-- SAFETY: this script creates a second institution and some rows in it,
-- proves isolation against them, and then RAISES an exception on purpose.
-- The raise aborts the transaction, so every fixture row is rolled back and
-- NOTHING it created survives. The proof output arrives as the text of that
-- exception. It is designed to be impossible to leave debris behind.
--
-- Run it AFTER 20260825120000_chunk1_tenancy_and_identity.sql is applied.
-- =====================================================================

DO $proof$
DECLARE
  _out      text := E'\n===== CHUNK 1 ISOLATION PROOFS =====\n';
  _schoolA  uuid;
  _schoolB  uuid;
  _classB   uuid;
  _qa       uuid;   -- account active at School A
  _pend     uuid;   -- account whose ONLY membership will be pending
  _mB       uuid;
  _sess     uuid := gen_random_uuid();
  _n        int;
  _nA       int;
  _ok       boolean := true;
  _sess_before int;
BEGIN
  -- ---------- locate the real institution and two test accounts ----------
  SELECT id INTO _schoolA FROM public.schools ORDER BY created_at LIMIT 1;

  SELECT p.id INTO _qa FROM public.profiles p
   WHERE p.email = 'qa.automation@wisdomcampus.com';

  SELECT p.id INTO _pend FROM public.profiles p
   WHERE p.email = 'garvitg055@gmail.com';

  IF _schoolA IS NULL OR _qa IS NULL OR _pend IS NULL THEN
    RAISE EXCEPTION 'proof setup: could not find institution A (%), qa account (%), or pending-test account (%)',
      _schoolA, _qa, _pend;
  END IF;

  -- ---------- fixture: a second institution with data in it ----------
  INSERT INTO public.schools (name, slug, is_active, board)
  VALUES ('ZZ Proof Institution B', 'zz-proof-b', true, 'rbse')
  RETURNING id INTO _schoolB;

  INSERT INTO public.classes (name, section, school_id, kind, is_active)
  VALUES ('Proof Class B', 'B', _schoolB, 'class', true)
  RETURNING id INTO _classB;

  INSERT INTO public.students (full_name, admission_number, school_id, class_id)
  VALUES ('ZZ Proof Student B', 'PROOF-B-001', _schoolB, _classB);

  SELECT count(*) INTO _nA FROM public.classes WHERE school_id = _schoolA;
  _out := _out || format('fixture: institution A has %s class(es); institution B has 1 class, 1 student%s',
                         _nA, E'\n');

  -- ================================================================
  -- PROOF 1 — a session scoped to School A cannot read any row of School B
  -- ================================================================
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', _qa, 'role', 'authenticated', 'session_id', _sess)::text, true);
  SET LOCAL ROLE authenticated;

  SELECT count(*) INTO _n FROM public.classes  WHERE school_id = _schoolB;
  _out := _out || format('%sPROOF 1  session scoped to School A%s', E'\n', E'\n');
  _out := _out || format('  classes visible in School B ......... %s   (expected 0)%s', _n, E'\n');
  IF _n <> 0 THEN _ok := false; END IF;

  SELECT count(*) INTO _n FROM public.students WHERE school_id = _schoolB;
  _out := _out || format('  students visible in School B ........ %s   (expected 0)%s', _n, E'\n');
  IF _n <> 0 THEN _ok := false; END IF;

  SELECT count(*) INTO _n FROM public.schools  WHERE id = _schoolB;
  _out := _out || format('  School B institution row visible .... %s   (expected 0)%s', _n, E'\n');
  IF _n <> 0 THEN _ok := false; END IF;

  SELECT count(*) INTO _n FROM public.classes  WHERE school_id = _schoolA;
  _out := _out || format('  classes visible in own School A ..... %s   (expected %s, proves the read works at all)%s',
                         _n, _nA, E'\n');
  IF _n <> _nA THEN _ok := false; END IF;

  RESET ROLE;
  PERFORM set_config('request.jwt.claims', NULL, true);

  -- ================================================================
  -- PROOF 2 — an account with memberships at two schools sees only the active one
  -- ================================================================
  INSERT INTO public.memberships (account_id, school_id, role, status, responded_at)
  VALUES (_qa, _schoolB, 'student', 'active', now())
  RETURNING id INTO _mB;

  -- The count BEFORE the switch. This check used to read `= 1` outright, which
  -- is a snapshot of production rather than the guarantee it names: _qa is the
  -- real qa.automation account, not a fixture, and public.sessions holds one row
  -- per GoTrue auth session for it — three by 2026-09-01, accumulated over two
  -- days of ordinary sign-ins. The proof went red on 2026-08-30 12:27 UTC, when
  -- the second row was committed, and stayed red for a reason that had nothing
  -- to do with switching.
  --
  -- The guarantee is "switching REPLACES, never adds". That is a delta, so it is
  -- measured as one. Strictly stronger than `= 1`: an added row now fails no
  -- matter how many rows already existed, and the check no longer depends on how
  -- often anyone has logged in.
  SELECT count(*) INTO _sess_before FROM public.sessions WHERE account_id = _qa;

  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', _qa, 'role', 'authenticated', 'session_id', _sess)::text, true);
  SET LOCAL ROLE authenticated;

  PERFORM public.rpc_switch_membership(_mB);   -- switch REPLACES, never adds

  _out := _out || format('%sPROOF 2  same account, now a member of BOTH schools, switched to School B%s', E'\n', E'\n');

  SELECT count(*) INTO _n FROM public.memberships WHERE account_id = _qa AND status = 'active';
  _out := _out || format('  active memberships held ............. %s   (expected 2)%s', _n, E'\n');
  IF _n <> 2 THEN _ok := false; END IF;

  SELECT count(*) INTO _n FROM public.sessions WHERE account_id = _qa;
  _out := _out || format('  session rows added by the switch .... %s   (expected 0 — switching replaces; %s existed before)%s',
                         _n - _sess_before, _sess_before, E'\n');
  IF _n <> _sess_before THEN _ok := false; END IF;

  -- And the replacement actually happened: the row the caller's auth session
  -- owns now points at the new membership. Without this, a switch that did
  -- nothing at all would pass the delta check — zero added is also what "no
  -- change whatsoever" looks like.
  SELECT count(*) INTO _n FROM public.sessions
   WHERE account_id = _qa AND active_membership_id = _mB;
  _out := _out || format('  session rows now pointing at B ...... %s   (expected 1 — the switch took effect)%s', _n, E'\n');
  IF _n <> 1 THEN _ok := false; END IF;

  SELECT count(*) INTO _n FROM public.classes WHERE school_id = _schoolB;
  _out := _out || format('  classes visible in School B ......... %s   (expected 1 — now the active one)%s', _n, E'\n');
  IF _n <> 1 THEN _ok := false; END IF;

  SELECT count(*) INTO _n FROM public.classes WHERE school_id = _schoolA;
  _out := _out || format('  classes visible in School A ......... %s   (expected 0 — no longer active)%s', _n, E'\n');
  IF _n <> 0 THEN _ok := false; END IF;

  RESET ROLE;
  PERFORM set_config('request.jwt.claims', NULL, true);

  -- ================================================================
  -- PROOF 3 — a pending membership grants zero access
  -- ================================================================
  INSERT INTO public.memberships (account_id, school_id, role, status, invited_by, invited_at)
  VALUES (_pend, _schoolB, 'student', 'pending', _qa, now());

  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', _pend, 'role', 'authenticated', 'session_id', gen_random_uuid())::text, true);
  SET LOCAL ROLE authenticated;

  _out := _out || format('%sPROOF 3  account whose ONLY membership is pending at School B%s', E'\n', E'\n');

  SELECT count(*) INTO _n FROM public.classes  WHERE school_id = _schoolB;
  _out := _out || format('  classes visible in School B ......... %s   (expected 0)%s', _n, E'\n');
  IF _n <> 0 THEN _ok := false; END IF;

  SELECT count(*) INTO _n FROM public.students WHERE school_id = _schoolB;
  _out := _out || format('  students visible in School B ........ %s   (expected 0)%s', _n, E'\n');
  IF _n <> 0 THEN _ok := false; END IF;

  SELECT count(*) INTO _n FROM public.classes;
  _out := _out || format('  classes visible anywhere at all ..... %s   (expected 0)%s', _n, E'\n');
  IF _n <> 0 THEN _ok := false; END IF;

  IF public.active_membership_id() IS NOT NULL THEN
    _out := _out || format('  active_membership_id() .............. NOT NULL   (expected NULL)%s', E'\n');
    _ok := false;
  ELSE
    _out := _out || format('  active_membership_id() .............. NULL      (expected NULL)%s', E'\n');
  END IF;

  -- ---------- bonus: the super-admin bypass must be inert ----------
  _out := _out || format('%sBYPASS  super-admin bypass with no super admins and no open window%s', E'\n', E'\n');
  _out := _out || format('  is_super_admin() .................... %s   (expected false)%s',
                         public.is_super_admin(), E'\n');
  _out := _out || format('  super_admin_has_any_access() ........ %s   (expected false)%s',
                         public.super_admin_has_any_access(), E'\n');
  _out := _out || format('  super_admin_has_access(School B) .... %s   (expected false)%s',
                         public.super_admin_has_access(_schoolB), E'\n');
  IF public.is_super_admin() OR public.super_admin_has_any_access()
     OR public.super_admin_has_access(_schoolB) THEN
    _ok := false;
  END IF;

  RESET ROLE;
  PERFORM set_config('request.jwt.claims', NULL, true);

  _out := _out || format('%s===== RESULT: %s =====%s',
                         E'\n',
                         CASE WHEN _ok THEN 'ALL PROOFS PASSED' ELSE 'AT LEAST ONE PROOF FAILED' END,
                         E'\n');
  _out := _out || 'All fixture rows are being rolled back by the deliberate abort below.';

  -- Deliberate abort: rolls back School B, its class, its student, and all
  -- three test memberships. This is the only exit from this block.
  RAISE EXCEPTION '%', _out;
END;
$proof$;
