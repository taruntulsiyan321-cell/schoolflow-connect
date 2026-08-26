-- =====================================================================
-- CHUNK 1 — verification items 4, 5 and 6 (added to the build doc later).
--
--   4. A declined invitation leaves no access and notifies the admin.
--   5. The same human as teacher and parent at one school has two memberships
--      and two distinct local_person_id values, and switching changes what is
--      visible.
--   6. Super admin access writes a log row and a school notification.
--
-- SAFETY: ends in a deliberate RAISE. Every fixture — the invitation, the
-- second membership, the extra parent record, the super_admins row — is rolled
-- back. Nothing survives.
-- =====================================================================

DO $p$
DECLARE
  _out     text := E'\n===== CHUNK 1 — PROOFS 4, 5, 6 =====\n';
  _ok      boolean := true;
  _schoolA uuid;
  _admin   uuid;
  _teach   uuid;   -- Priya: teacher account, will also become a parent
  _invitee uuid;   -- account with an identifier but no membership
  _inv     uuid;
  _n       int;
  _n2      int;
  _mstat   text;
  _istat   text;
  _iexp    timestamptz;
  _parentrec uuid;
  _mteach  uuid;
  _mparent uuid;
  _child   uuid;
  _sa      uuid;
  _saacct  uuid;
  _log     uuid;
  _sess    uuid := gen_random_uuid();
BEGIN
  SELECT id INTO _schoolA FROM public.schools ORDER BY created_at LIMIT 1;
  SELECT id INTO _admin   FROM public.profiles WHERE email = 'admin@wisdomcampus.com';
  SELECT id INTO _teach   FROM public.profiles WHERE email = 'priya.sharma@wisdomcampus.com';
  SELECT id INTO _invitee FROM public.profiles WHERE email = 'garvitg055@gmail.com';
  SELECT id INTO _saacct  FROM public.profiles WHERE email = 'tulsiyantarun23@gmail.com';

  -- =================================================================
  -- PROOF 4 — declined invitation: no access, admin notified
  -- =================================================================
  _out := _out || format('%sPROOF 4  declined invitation%s', E'\n', E'\n');

  SELECT count(*) INTO _n FROM public.notifications
   WHERE user_id = _admin AND type = 'invitation_declined';

  -- The admin issues the invitation.
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', _admin, 'role', 'authenticated', 'session_id', gen_random_uuid())::text, true);
  SET LOCAL ROLE authenticated;
  _inv := public.rpc_invite_member('email', 'garvitg055@gmail.com', 'student', NULL);
  RESET ROLE;

  SELECT m.status::text INTO _mstat FROM public.memberships m
   WHERE m.account_id = _invitee AND m.school_id = _schoolA AND m.role = 'student';
  _out := _out || format('  membership created by invite ........ %s   (expected pending)%s', _mstat, E'\n');
  IF _mstat <> 'pending' THEN _ok := false; END IF;

  -- The invitee declines.
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', _invitee, 'role', 'authenticated', 'session_id', gen_random_uuid())::text, true);
  SET LOCAL ROLE authenticated;
  PERFORM public.rpc_respond_to_invitation(_inv, false);

  -- Still inside the invitee's session: prove zero access.
  SELECT count(*) INTO _n2 FROM public.students;
  _out := _out || format('  students visible to decliner ........ %s   (expected 0)%s', _n2, E'\n');
  IF _n2 <> 0 THEN _ok := false; END IF;

  SELECT count(*) INTO _n2 FROM public.classes;
  _out := _out || format('  classes visible to decliner ......... %s   (expected 0)%s', _n2, E'\n');
  IF _n2 <> 0 THEN _ok := false; END IF;
  RESET ROLE;

  SELECT m.status::text INTO _mstat FROM public.memberships m
   WHERE m.account_id = _invitee AND m.school_id = _schoolA AND m.role = 'student';
  SELECT i.status::text, i.expires_at INTO _istat, _iexp FROM public.invitations i WHERE i.id = _inv;
  _out := _out || format('  membership after decline ............ %s   (expected declined)%s', _mstat, E'\n');
  _out := _out || format('  invitation after decline ............ %s   (expected declined)%s', _istat, E'\n');
  _out := _out || format('  invitation expired .................. %s   (expected t)%s',
                         (_iexp IS NOT NULL), E'\n');
  IF _mstat <> 'declined' OR _istat <> 'declined' OR _iexp IS NULL THEN _ok := false; END IF;

  SELECT count(*) INTO _n2 FROM public.notifications
   WHERE user_id = _admin AND type = 'invitation_declined';
  _out := _out || format('  admin notifications (before -> after)  %s -> %s   (expected +1)%s', _n, _n2, E'\n');
  IF _n2 <> _n + 1 THEN _ok := false; END IF;

  -- =================================================================
  -- PROOF 5 — one human, teacher AND parent at the SAME institution
  -- =================================================================
  _out := _out || format('%sPROOF 5  same human, teacher and parent at one institution%s', E'\n', E'\n');

  -- A separate local record. The teacher record and the parent record are two
  -- distinct rows and are never merged (locked decision 2).
  INSERT INTO public.parents (school_id, user_id, full_name, email)
  VALUES (_schoolA, _teach, 'Priya Sharma (as parent)', 'priya.parent.proof@example.invalid')
  RETURNING id INTO _parentrec;

  SELECT s.id INTO _child FROM public.students s
   WHERE s.school_id = _schoolA AND s.class_id IS NOT NULL AND s.user_id IS NOT NULL
   ORDER BY s.admission_number LIMIT 1;

  INSERT INTO public.parent_students (school_id, parent_id, student_id, relationship, is_primary)
  VALUES (_schoolA, _parentrec, _child, 'Mother', true);

  INSERT INTO public.memberships (account_id, school_id, role, local_person_id, status, responded_at)
  VALUES (_teach, _schoolA, 'parent', _parentrec, 'active', now())
  RETURNING id INTO _mparent;

  SELECT m.id INTO _mteach FROM public.memberships m
   WHERE m.account_id = _teach AND m.school_id = _schoolA AND m.role = 'teacher';

  SELECT count(*) INTO _n FROM public.memberships m
   WHERE m.account_id = _teach AND m.school_id = _schoolA AND m.status = 'active';
  _out := _out || format('  memberships at ONE institution ...... %s   (expected 2)%s', _n, E'\n');
  IF _n <> 2 THEN _ok := false; END IF;

  SELECT count(DISTINCT m.local_person_id) INTO _n FROM public.memberships m
   WHERE m.account_id = _teach AND m.school_id = _schoolA AND m.status = 'active'
     AND m.local_person_id IS NOT NULL;
  _out := _out || format('  distinct local_person_id values ..... %s   (expected 2 — records never merged)%s', _n, E'\n');
  IF _n <> 2 THEN _ok := false; END IF;

  -- Active as TEACHER
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', _teach, 'role', 'authenticated', 'session_id', _sess)::text, true);
  SET LOCAL ROLE authenticated;
  PERFORM public.rpc_switch_membership(_mteach);
  SELECT count(*) INTO _n FROM public.students;
  _out := _out || format('  as TEACHER, students visible ........ %s   (expected 12 — her classes)%s', _n, E'\n');
  IF _n <> 12 THEN _ok := false; END IF;

  -- Switch to PARENT, same human, same institution
  PERFORM public.rpc_switch_membership(_mparent);
  SELECT count(*) INTO _n2 FROM public.students;
  _out := _out || format('  as PARENT,  students visible ........ %s   (expected 1 — only her child)%s', _n2, E'\n');
  IF _n2 <> 1 THEN _ok := false; END IF;
  RESET ROLE;

  _out := _out || format('  switching changed visibility ........ %s   (expected t)%s', (_n <> _n2), E'\n');
  IF _n = _n2 THEN _ok := false; END IF;

  -- =================================================================
  -- PROOF 6 — super admin access is logged and the school is notified
  -- =================================================================
  _out := _out || format('%sPROOF 6  super admin access%s', E'\n', E'\n');

  INSERT INTO public.super_admins (account_id) VALUES (_saacct) RETURNING id INTO _sa;

  SELECT count(*) INTO _n FROM public.notifications WHERE type = 'super_admin_access';

  -- Before opening access: a super admin is just an account with no memberships.
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', _saacct, 'role', 'authenticated', 'session_id', gen_random_uuid())::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO _n2 FROM public.students;
  _out := _out || format('  students visible BEFORE opening ..... %s   (expected 0)%s', _n2, E'\n');
  IF _n2 <> 0 THEN _ok := false; END IF;

  _log := public.rpc_super_admin_open_access(_schoolA, 'student records', 'support ticket #proof', 60);

  SELECT count(*) INTO _n2 FROM public.students;
  _out := _out || format('  students visible AFTER opening ...... %s   (expected 13)%s', _n2, E'\n');
  IF _n2 <> 13 THEN _ok := false; END IF;
  RESET ROLE;

  SELECT count(*) INTO _n2 FROM public.super_admin_access_log WHERE id = _log;
  _out := _out || format('  access-log row written .............. %s   (expected 1 — the row IS the grant)%s', _n2, E'\n');
  IF _n2 <> 1 THEN _ok := false; END IF;

  SELECT count(*) INTO _n2 FROM public.notifications WHERE type = 'super_admin_access';
  _out := _out || format('  school notifications (before->after)   %s -> %s   (expected +2: admin+principal)%s',
                         _n, _n2, E'\n');
  IF _n2 <> _n + 2 THEN _ok := false; END IF;

  SELECT count(*) INTO _n2 FROM public.super_admin_access_log
   WHERE id = _log AND school_notified_at IS NOT NULL
     AND expires_at <= accessed_at + interval '60 minutes';
  _out := _out || format('  window <= 60 min and notified ....... %s   (expected 1)%s', _n2, E'\n');
  IF _n2 <> 1 THEN _ok := false; END IF;

  -- The per-grant cap is enforced, not advisory.
  BEGIN
    PERFORM set_config('request.jwt.claims',
      json_build_object('sub', _saacct, 'role', 'authenticated', 'session_id', gen_random_uuid())::text, true);
    SET LOCAL ROLE authenticated;
    PERFORM public.rpc_super_admin_open_access(_schoolA, 'x', 'y', 61);
    RESET ROLE;
    _out := _out || format('  61-minute grant .................... ACCEPTED   (expected rejected)%s', E'\n');
    _ok := false;
  EXCEPTION WHEN others THEN
    RESET ROLE;
    _out := _out || format('  61-minute grant .................... rejected   (expected rejected)%s', E'\n');
  END;

  PERFORM set_config('request.jwt.claims', NULL, true);

  _out := _out || format('%s===== RESULT: %s =====%s', E'\n',
                         CASE WHEN _ok THEN 'ALL PROOFS PASSED' ELSE 'AT LEAST ONE PROOF FAILED' END, E'\n');
  _out := _out || 'Every fixture is being rolled back by the deliberate abort below.';
  RAISE EXCEPTION '%', _out;
END;
$p$;
