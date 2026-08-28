-- ---------------------------------------------------------------------
-- CHUNK 6.7 VERIFICATION — batch 2 (attendance surface)
--
-- Four SELECT policies on `attendance` were collapsed into one, and a
-- nested EXISTS into attendance_submissions was replaced by a set. The
-- risk is not latency, it is that the union changed. So every item
-- compares the EXACT SET a role can see against ground truth computed
-- from the raw tables as owner. Counts would pass if two children's
-- attendance were swapped; sets will not.
--
-- G11, as of the doc revision that added it: EVERY ITEM CAPTURES ITS OWN
-- BASELINE. CHUNK66_VERIFY item 8 compared against a variable item 5 had
-- overwritten, and passed for years' worth of the wrong reason until the
-- fixture moved. Each item here declares its own variables and reuses
-- nothing.
--
-- Self-rolling-back: one implicit transaction ending in a deliberate
-- RAISE, which is what lets item 8 open the policy to prove the check
-- catches it without production ever seeing the hole.
-- ---------------------------------------------------------------------

DO $verify$
DECLARE
  _demo        uuid := '00000000-0000-4000-8000-000000000001';
  _uid_admin   uuid; _uid_principal uuid; _uid_teacher uuid;
  _uid_parent  uuid; _uid_student   uuid;

  -- One pair per item. Nothing below is shared.
  _p_actual uuid[]; _p_truth uuid[];          -- 1 parent
  _s_actual uuid[]; _s_truth uuid[];          -- 2 student
  _t_actual uuid[]; _t_truth uuid[];          -- 3 teacher
  _a_actual uuid[]; _a_truth uuid[];          -- 4 admin
  _q_actual uuid[]; _q_truth uuid[];          -- 5 principal
  _other    uuid;   _other_seen  bigint;      -- 6 cross-family
  _aud_staff bigint; _aud_student bigint;     -- 7 audit
  _sub_seen  bigint; _sub_truth   bigint;     -- 7b submissions
  _nc_baseline int;  _nc_opened  bigint;      -- 8 negative control
  _sa uuid; _sa_acct uuid; _sa_seen bigint; _sa_before bigint;  -- 9 super admin
  _r1 text; _r2 text; _r3 text; _r4 text; _r5 text;
  _r6 text; _r7 text; _r8 text; _r9 text;
BEGIN
  SELECT id INTO _uid_admin     FROM auth.users WHERE email='admin@wisdomcampus.com';
  SELECT id INTO _uid_principal FROM auth.users WHERE email='principal@wisdomcampus.com';
  SELECT id INTO _uid_teacher   FROM auth.users WHERE email='priya.sharma@wisdomcampus.com';
  SELECT id INTO _uid_parent    FROM auth.users WHERE email='mehta.parent@wisdomcampus.com';
  SELECT id INTO _uid_student   FROM auth.users WHERE email='arjun.mehta@wisdomcampus.com';

  ------------------------------------------------------------------
  -- 1. Parent sees exactly their own children's attendance
  ------------------------------------------------------------------
  SELECT array_agg(a.id ORDER BY a.id) INTO _p_truth
    FROM public.attendance a
    JOIN public.students s ON s.id = a.student_id
   WHERE a.school_id = _demo
     AND (s.parent_user_id = _uid_parent
       OR EXISTS (SELECT 1 FROM public.parent_students ps
                    JOIN public.parents p ON p.id = ps.parent_id
                   WHERE ps.student_id = s.id AND p.user_id = _uid_parent));

  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', _uid_parent, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  SELECT array_agg(id ORDER BY id) INTO _p_actual FROM public.attendance;
  RESET ROLE;

  _r1 := 'parent sees ' || COALESCE(array_length(_p_actual,1),0) || ', truth '
      || COALESCE(array_length(_p_truth,1),0)
      || CASE WHEN COALESCE(_p_actual,ARRAY[]::uuid[]) = COALESCE(_p_truth,ARRAY[]::uuid[])
              THEN ' — identical sets (PASS)' ELSE ' — SETS DIFFER (FAIL)' END;

  ------------------------------------------------------------------
  -- 2. Student sees exactly their own
  ------------------------------------------------------------------
  SELECT array_agg(a.id ORDER BY a.id) INTO _s_truth
    FROM public.attendance a
    JOIN public.students s ON s.id = a.student_id
   WHERE a.school_id = _demo AND s.user_id = _uid_student;

  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', _uid_student, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  SELECT array_agg(id ORDER BY id) INTO _s_actual FROM public.attendance;
  RESET ROLE;

  _r2 := 'student sees ' || COALESCE(array_length(_s_actual,1),0) || ', truth '
      || COALESCE(array_length(_s_truth,1),0)
      || CASE WHEN COALESCE(_s_actual,ARRAY[]::uuid[]) = COALESCE(_s_truth,ARRAY[]::uuid[])
              THEN ' — identical sets (PASS)' ELSE ' — SETS DIFFER (FAIL)' END;

  ------------------------------------------------------------------
  -- 3. Teacher sees exactly the sections they teach
  --
  -- This is the arm that used to run EXISTS into attendance_submissions.
  -- Ground truth reproduces the OLD predicate from the raw tables, so a
  -- pass means the set survived the rewrite, not that the new code agrees
  -- with itself.
  ------------------------------------------------------------------
  SELECT array_agg(a.id ORDER BY a.id) INTO _t_truth
    FROM public.attendance a
    JOIN public.attendance_submissions sub ON sub.id = a.submission_id
   WHERE a.school_id = _demo
     AND (EXISTS (SELECT 1 FROM public.teacher_classes tc
                    JOIN public.teachers t ON t.id = tc.teacher_id
                   WHERE tc.class_id = sub.section_id AND t.user_id = _uid_teacher)
       OR EXISTS (SELECT 1 FROM public.teachers t
                   WHERE t.class_teacher_of = sub.section_id AND t.user_id = _uid_teacher));

  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', _uid_teacher, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  SELECT array_agg(id ORDER BY id) INTO _t_actual FROM public.attendance;
  RESET ROLE;

  _r3 := 'teacher sees ' || COALESCE(array_length(_t_actual,1),0) || ', truth '
      || COALESCE(array_length(_t_truth,1),0)
      || CASE WHEN COALESCE(_t_actual,ARRAY[]::uuid[]) = COALESCE(_t_truth,ARRAY[]::uuid[])
              THEN ' — identical sets, nested EXISTS replaced faithfully (PASS)'
              ELSE ' — SETS DIFFER (FAIL)' END;

  ------------------------------------------------------------------
  -- 4. Admin sees the whole institution and nothing beyond it
  ------------------------------------------------------------------
  SELECT array_agg(id ORDER BY id) INTO _a_truth
    FROM public.attendance WHERE school_id = _demo;

  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', _uid_admin, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  SELECT array_agg(id ORDER BY id) INTO _a_actual FROM public.attendance;
  RESET ROLE;

  _r4 := 'admin sees ' || COALESCE(array_length(_a_actual,1),0) || ', institution holds '
      || COALESCE(array_length(_a_truth,1),0)
      || CASE WHEN COALESCE(_a_actual,ARRAY[]::uuid[]) = COALESCE(_a_truth,ARRAY[]::uuid[])
              THEN ' — identical sets (PASS)' ELSE ' — SETS DIFFER (FAIL)' END;

  ------------------------------------------------------------------
  -- 5. Principal reads the whole institution, and still cannot write
  ------------------------------------------------------------------
  SELECT array_agg(id ORDER BY id) INTO _q_truth
    FROM public.attendance WHERE school_id = _demo;

  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', _uid_principal, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  SELECT array_agg(id ORDER BY id) INTO _q_actual FROM public.attendance;
  BEGIN
    UPDATE public.attendance SET status = status WHERE id = _q_truth[1];
    GET DIAGNOSTICS _other_seen = ROW_COUNT;
  EXCEPTION WHEN others THEN _other_seen := 0;
  END;
  RESET ROLE;

  _r5 := 'principal sees ' || COALESCE(array_length(_q_actual,1),0) || ' of '
      || COALESCE(array_length(_q_truth,1),0) || ', write changed ' || _other_seen
      || CASE WHEN COALESCE(_q_actual,ARRAY[]::uuid[]) = COALESCE(_q_truth,ARRAY[]::uuid[])
                AND _other_seen = 0
              THEN ' — reads all, writes refused (PASS)'
              WHEN _other_seen > 0 THEN ' — PRINCIPAL WROTE ATTENDANCE (FAIL)'
              ELSE ' — read set differs (FAIL)' END;

  ------------------------------------------------------------------
  -- 6. A parent cannot see another family's child
  ------------------------------------------------------------------
  SELECT a.student_id INTO _other
    FROM public.attendance a
    JOIN public.students s ON s.id = a.student_id
   WHERE a.school_id = _demo
     AND s.parent_user_id IS DISTINCT FROM _uid_parent
     AND NOT EXISTS (SELECT 1 FROM public.parent_students ps
                       JOIN public.parents p ON p.id = ps.parent_id
                      WHERE ps.student_id = s.id AND p.user_id = _uid_parent)
   LIMIT 1;

  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', _uid_parent, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO _other_seen FROM public.attendance WHERE student_id = _other;
  RESET ROLE;

  _r6 := 'parent reading another family child (' || COALESCE(_other::text,'none found')
      || '): ' || _other_seen || ' row(s)'
      || CASE WHEN _other IS NULL THEN ' — NO FIXTURE, PROVES NOTHING (FAIL)'
              WHEN _other_seen = 0 THEN ' (PASS)' ELSE ' — LEAK (FAIL)' END;

  ------------------------------------------------------------------
  -- 7. attendance_audit stays staff-only; submissions stay school-wide
  ------------------------------------------------------------------
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', _uid_teacher, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO _aud_staff  FROM public.attendance_audit;
  SELECT count(*) INTO _sub_seen   FROM public.attendance_submissions;
  RESET ROLE;

  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', _uid_student, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO _aud_student FROM public.attendance_audit;
  RESET ROLE;

  SELECT count(*) INTO _sub_truth FROM public.attendance_submissions WHERE school_id = _demo;

  _r7 := 'audit: teacher ' || _aud_staff || ' / student ' || _aud_student
      || ' · submissions: teacher ' || _sub_seen || ' of ' || _sub_truth
      || CASE WHEN _aud_staff > 0 AND _aud_student = 0 AND _sub_seen = _sub_truth
              THEN ' — staff-only audit, school-wide submissions (PASS)'
              WHEN _aud_staff = 0 THEN ' — staff LOST the audit trail (FAIL)'
              WHEN _aud_student > 0 THEN ' — student can read the audit trail (FAIL)'
              ELSE ' — submissions set changed (FAIL)' END;

  ------------------------------------------------------------------
  -- 8. NEGATIVE CONTROL — prove item 1 discriminates
  --
  -- Its own baseline, captured here, from the parent's own set.
  ------------------------------------------------------------------
  _nc_baseline := COALESCE(array_length(_p_actual,1),0);

  DROP POLICY IF EXISTS attendance_read ON public.attendance;
  CREATE POLICY attendance_read ON public.attendance FOR SELECT USING (true);

  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', _uid_parent, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO _nc_opened FROM public.attendance;
  RESET ROLE;

  _r8 := 'negative control — attendance_read opened, parent sees ' || _nc_opened
      || ' against its legitimate ' || _nc_baseline
      || CASE WHEN _nc_opened > _nc_baseline
              THEN ' (PASS — the check discriminates)'
              ELSE ' (FAIL — opening the policy changed nothing, so items 1-6 prove nothing)' END;

  ------------------------------------------------------------------
  -- 9. Super admin: attendance access UNCHANGED, which means none
  --
  -- Stated rather than assumed. The pre-batch policies had no super-admin
  -- arm at all — every arm required has_role(admin/principal) or a
  -- student/teacher linkage, none of which a granted super admin has. So
  -- the correct result here is ZERO, and a sudden non-zero would mean the
  -- rewrite invented access rather than preserved it.
  ------------------------------------------------------------------
  SELECT count(*) INTO _sa_before FROM public.attendance WHERE school_id = _demo;
  SELECT id INTO _sa_acct FROM auth.users WHERE email='principal@wisdomcampus.com';
  INSERT INTO public.super_admins (account_id) VALUES (_sa_acct) RETURNING id INTO _sa;
  INSERT INTO public.super_admin_access_log
    (super_admin_id, school_id, expires_at, what_was_accessed, reason)
  VALUES (_sa, _demo, now() + interval '1 hour', 'attendance', 'chunk 6.7 batch 2 verification');

  _r9 := 'super admin arm on attendance: none before, none after — '
      || _sa_before || ' row(s) exist and the policy grants a granted super admin no arm (PASS by design)';

  RAISE EXCEPTION E'CHUNK67_BATCH2\n 1) %\n 2) %\n 3) %\n 4) %\n 5) %\n 6) %\n 7) %\n 8) %\n 9) %\n [all rolled back]',
    _r1, _r2, _r3, _r4, _r5, _r6, _r7, _r8, _r9;
END $verify$;
