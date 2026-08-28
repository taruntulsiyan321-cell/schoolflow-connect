-- ---------------------------------------------------------------------
-- CHUNK 6.7 VERIFICATION — batch 3 (notifications)
--
-- G11, verify against the OLD behaviour: every ground truth below is the
-- predicate that was REPLACED — `user_id = auth.uid()` combined with
-- same_school() — reconstructed from the raw tables as owner. Comparing
-- the new policy to its own logic would prove only self-consistency.
--
-- G11, each item captures its own baseline: every item declares its own
-- variables and reuses nothing from an earlier one.
--
-- Self-rolling-back: one implicit transaction ending in a deliberate
-- RAISE, which is what lets item 6 open the policy without production
-- seeing the hole.
-- ---------------------------------------------------------------------

DO $verify$
DECLARE
  _demo   uuid := '00000000-0000-4000-8000-000000000001';
  _scale  uuid := '00000000-0000-4000-8000-000000000002';

  _uid_admin uuid; _uid_parent uuid; _uid_student uuid;

  _a_actual uuid[]; _a_truth uuid[];              -- 1 admin
  _p_actual uuid[]; _p_truth uuid[];              -- 2 parent
  _s_actual uuid[]; _s_truth uuid[];              -- 3 student
  _x_target uuid;   _x_seen bigint;               -- 4 cross-user
  _f_other  bigint; _f_seen bigint;               -- 5 cross-institution
  _nc_base  int;    _nc_open bigint;              -- 6 negative control
  _w_own    bigint; _w_other bigint; _w_id uuid;  -- 7 write path
  _r1 text; _r2 text; _r3 text; _r4 text; _r5 text; _r6 text; _r7 text;
BEGIN
  SELECT id INTO _uid_admin   FROM auth.users WHERE email='admin@wisdomcampus.com';
  SELECT id INTO _uid_parent  FROM auth.users WHERE email='mehta.parent@wisdomcampus.com';
  SELECT id INTO _uid_student FROM auth.users WHERE email='arjun.mehta@wisdomcampus.com';

  ------------------------------------------------------------------
  -- 1. Admin sees exactly their own notifications — not the school's
  ------------------------------------------------------------------
  -- notifications has no operator arm: even an admin only ever sees rows
  -- addressed to them. That is the pre-existing rule and it must survive.
  SELECT array_agg(n.id ORDER BY n.id) INTO _a_truth
    FROM public.notifications n
   WHERE n.user_id = _uid_admin
     AND (n.school_id IS NULL OR n.school_id = _demo);

  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', _uid_admin, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  SELECT array_agg(id ORDER BY id) INTO _a_actual FROM public.notifications;
  RESET ROLE;

  _r1 := 'admin sees ' || COALESCE(array_length(_a_actual,1),0) || ', truth '
      || COALESCE(array_length(_a_truth,1),0)
      || CASE WHEN COALESCE(_a_actual,ARRAY[]::uuid[]) = COALESCE(_a_truth,ARRAY[]::uuid[])
              THEN ' — identical sets, own rows only (PASS)' ELSE ' — SETS DIFFER (FAIL)' END;

  ------------------------------------------------------------------
  -- 2. Parent
  ------------------------------------------------------------------
  SELECT array_agg(n.id ORDER BY n.id) INTO _p_truth
    FROM public.notifications n
   WHERE n.user_id = _uid_parent
     AND (n.school_id IS NULL OR n.school_id = _demo);

  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', _uid_parent, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  SELECT array_agg(id ORDER BY id) INTO _p_actual FROM public.notifications;
  RESET ROLE;

  _r2 := 'parent sees ' || COALESCE(array_length(_p_actual,1),0) || ', truth '
      || COALESCE(array_length(_p_truth,1),0)
      || CASE WHEN COALESCE(_p_actual,ARRAY[]::uuid[]) = COALESCE(_p_truth,ARRAY[]::uuid[])
              THEN ' — identical sets (PASS)' ELSE ' — SETS DIFFER (FAIL)' END;

  ------------------------------------------------------------------
  -- 3. Student
  ------------------------------------------------------------------
  SELECT array_agg(n.id ORDER BY n.id) INTO _s_truth
    FROM public.notifications n
   WHERE n.user_id = _uid_student
     AND (n.school_id IS NULL OR n.school_id = _demo);

  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', _uid_student, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  SELECT array_agg(id ORDER BY id) INTO _s_actual FROM public.notifications;
  RESET ROLE;

  _r3 := 'student sees ' || COALESCE(array_length(_s_actual,1),0) || ', truth '
      || COALESCE(array_length(_s_truth,1),0)
      || CASE WHEN COALESCE(_s_actual,ARRAY[]::uuid[]) = COALESCE(_s_truth,ARRAY[]::uuid[])
              THEN ' — identical sets (PASS)' ELSE ' — SETS DIFFER (FAIL)' END;

  ------------------------------------------------------------------
  -- 4. A parent cannot read another user's notifications
  ------------------------------------------------------------------
  SELECT n.user_id INTO _x_target
    FROM public.notifications n
   WHERE n.user_id IS DISTINCT FROM _uid_parent
     AND (n.school_id IS NULL OR n.school_id = _demo)
   LIMIT 1;

  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', _uid_parent, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO _x_seen FROM public.notifications WHERE user_id = _x_target;
  RESET ROLE;

  _r4 := 'parent reading another user (' || COALESCE(_x_target::text,'none found') || '): '
      || _x_seen || ' row(s)'
      || CASE WHEN _x_target IS NULL THEN ' — NO FIXTURE, PROVES NOTHING (FAIL)'
              WHEN _x_seen = 0 THEN ' (PASS)' ELSE ' — LEAK (FAIL)' END;

  ------------------------------------------------------------------
  -- 5. The fence overrides the self-read arm
  --
  -- First attempt at this item compared against the scale institution and
  -- found it holds no notifications, so it reported "proves nothing" —
  -- correct, but a gap. The stronger test does not need a fixture: plant
  -- one notification in the OTHER institution addressed to THIS admin.
  --
  -- The permissive arm (user_id = auth.uid()) says yes. The RESTRICTIVE
  -- fence says no. RESTRICTIVE must win, and if the rewrite had weakened
  -- the fence this is the row that would appear. Planted as owner and
  -- rolled back with everything else.
  ------------------------------------------------------------------
  INSERT INTO public.notifications (user_id, type, title, read, school_id)
  VALUES (_uid_admin, 'verification', 'planted in the other institution', false, _scale);

  SELECT count(*) INTO _f_other
    FROM public.notifications WHERE school_id = _scale AND user_id = _uid_admin;

  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', _uid_admin, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO _f_seen
    FROM public.notifications WHERE school_id = _scale AND user_id = _uid_admin;
  RESET ROLE;

  _r5 := 'planted ' || _f_other || ' notification in the other institution addressed to this admin; they see '
      || _f_seen
      || CASE WHEN _f_other = 0 THEN ' — PLANT FAILED, proves nothing (FAIL)'
              WHEN _f_seen = 0 THEN ' — RESTRICTIVE fence beat the self-read arm (PASS)'
              ELSE ' — CROSS-INSTITUTION LEAK (FAIL)' END;

  ------------------------------------------------------------------
  -- 6. NEGATIVE CONTROL — its own baseline, from item 2's parent set
  ------------------------------------------------------------------
  _nc_base := COALESCE(array_length(_p_actual,1),0);

  DROP POLICY IF EXISTS "notif self read" ON public.notifications;
  CREATE POLICY "notif self read" ON public.notifications FOR SELECT USING (true);

  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', _uid_parent, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO _nc_open FROM public.notifications;
  RESET ROLE;

  _r6 := 'negative control — notif self read opened, parent sees ' || _nc_open
      || ' against its legitimate ' || _nc_base
      || CASE WHEN _nc_open > _nc_base THEN ' (PASS — the check discriminates)'
              ELSE ' (FAIL — opening the policy changed nothing, so items 1-4 prove nothing)' END;

  ------------------------------------------------------------------
  -- 7. The write path still works, and still only on your own row
  --
  -- The hoist to (SELECT auth.uid()) was applied to the UPDATE check too.
  -- That is safe because it reads no table, but "safe in principle" is not
  -- evidence — so exercise both halves.
  ------------------------------------------------------------------
  SELECT id INTO _w_id FROM public.notifications WHERE user_id = _uid_parent LIMIT 1;

  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', _uid_parent, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    UPDATE public.notifications SET user_id = user_id WHERE id = _w_id;
    GET DIAGNOSTICS _w_own = ROW_COUNT;
  EXCEPTION WHEN others THEN _w_own := 0;
  END;
  BEGIN
    UPDATE public.notifications SET user_id = user_id WHERE user_id = _x_target;
    GET DIAGNOSTICS _w_other = ROW_COUNT;
  EXCEPTION WHEN others THEN _w_other := 0;
  END;
  RESET ROLE;

  _r7 := 'parent updating own row changed ' || _w_own || ', another user row changed ' || _w_other
      || CASE WHEN _w_own = 1 AND _w_other = 0 THEN ' — own writable, others refused (PASS)'
              WHEN _w_own = 0 THEN ' — parent CANNOT write their own notification (FAIL)'
              ELSE ' — parent WROTE another user row (FAIL)' END;

  RAISE EXCEPTION E'CHUNK67_BATCH3\n 1) %\n 2) %\n 3) %\n 4) %\n 5) %\n 6) %\n 7) %\n [all rolled back]',
    _r1, _r2, _r3, _r4, _r5, _r6, _r7;
END $verify$;
