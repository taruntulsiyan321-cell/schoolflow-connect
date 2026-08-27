-- =====================================================================
-- CHUNK 6.6 VERIFICATION — can_read_mark restructured
--
-- The whole risk of this chunk is stated in the build doc: "A performance
-- fix that opens a hole is a worse bug." So the checks below are not
-- "does it still return rows" — they compare the EXACT SET each role can
-- see against ground truth computed from the raw tables as owner, so that
-- over-exposure and under-exposure are both failures.
--
-- Comparing sets rather than counts is deliberate. Two sets of the same
-- size can be different sets, and a policy that swapped one child's marks
-- for another's would pass a count check perfectly.
--
-- Everything runs in a transaction that ends in RAISE, so nothing here is
-- committed.
-- =====================================================================
DO $$
DECLARE
  _school       uuid := '00000000-0000-4000-8000-000000000001';
  _r1 text; _r2 text; _r3 text; _r4 text; _r5 text; _r6 text; _r7 text; _r8 text;
  _r9 text; _r10 text;
  _uid_parent   uuid; _uid_student uuid; _uid_teacher uuid;
  _uid_admin    uuid; _uid_principal uuid;
  _actual       uuid[]; _expected uuid[];
  _n bigint; _m bigint;
  _sa           uuid; _sa_acct uuid;
  _other_child  uuid;
  _es           uuid; _stu uuid;
  _ok boolean;
BEGIN
  SELECT id INTO _uid_parent    FROM auth.users WHERE email='mehta.parent@wisdomcampus.com';
  SELECT id INTO _uid_student   FROM auth.users WHERE email='arjun.mehta@wisdomcampus.com';
  SELECT id INTO _uid_teacher   FROM auth.users WHERE email='priya.sharma@wisdomcampus.com';
  SELECT id INTO _uid_admin     FROM auth.users WHERE email='admin@wisdomcampus.com';
  SELECT id INTO _uid_principal FROM auth.users WHERE email='principal@wisdomcampus.com';

  ------------------------------------------------------------------
  -- 1. Parent sees EXACTLY their own children's published marks
  ------------------------------------------------------------------
  -- Ground truth, as owner, straight from the raw tables.
  SELECT array_agg(m.id ORDER BY m.id) INTO _expected
    FROM public.marks m
    JOIN public.exams e   ON e.id = m.exam_id
    JOIN public.students s ON s.id = m.student_id
   WHERE e.results_published_at IS NOT NULL
     AND s.school_id = _school
     AND (s.parent_user_id = _uid_parent
       OR EXISTS (SELECT 1 FROM public.parent_students ps
                    JOIN public.parents p ON p.id = ps.parent_id
                   WHERE ps.student_id = s.id AND p.user_id = _uid_parent));

  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', _uid_parent, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  SELECT array_agg(id ORDER BY id) INTO _actual FROM public.marks;
  RESET ROLE;

  _r1 := 'parent sees ' || COALESCE(array_length(_actual,1),0) || ' mark(s), ground truth '
      || COALESCE(array_length(_expected,1),0)
      || CASE WHEN COALESCE(_actual, ARRAY[]::uuid[]) = COALESCE(_expected, ARRAY[]::uuid[])
              THEN ' — identical sets (PASS)' ELSE ' — SETS DIFFER (FAIL)' END;

  ------------------------------------------------------------------
  -- 2. A parent cannot see another family's child
  ------------------------------------------------------------------
  -- Pick a student in the same school who is NOT this parent's child and
  -- who does have a published mark. If the policy leaked, it would appear.
  SELECT m.student_id INTO _other_child
    FROM public.marks m
    JOIN public.exams e ON e.id = m.exam_id
    JOIN public.students s ON s.id = m.student_id
   WHERE e.results_published_at IS NOT NULL
     AND s.school_id = _school
     AND s.parent_user_id IS DISTINCT FROM _uid_parent
     AND NOT EXISTS (SELECT 1 FROM public.parent_students ps
                       JOIN public.parents p ON p.id = ps.parent_id
                      WHERE ps.student_id = s.id AND p.user_id = _uid_parent)
   LIMIT 1;

  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', _uid_parent, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO _n FROM public.marks WHERE student_id = _other_child;
  RESET ROLE;

  _r2 := 'parent reading another family child (' || COALESCE(_other_child::text,'none found')
      || '): ' || _n || ' row(s)'
      || CASE WHEN _other_child IS NULL THEN ' — NO FIXTURE, PROVES NOTHING (FAIL)'
              WHEN _n = 0 THEN ' (PASS)' ELSE ' — LEAK (FAIL)' END;

  ------------------------------------------------------------------
  -- 3. Unpublished results stay invisible to parent, visible to teacher
  ------------------------------------------------------------------
  -- Both halves asserted: "0 rows" alone cannot distinguish "correctly
  -- hidden" from "this role cannot read the table at all".
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', _uid_parent, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO _n
    FROM public.marks m JOIN public.exams e ON e.id = m.exam_id
   WHERE e.results_published_at IS NULL;
  SELECT count(*) INTO _m FROM public.marks;
  RESET ROLE;

  _r3 := 'parent: ' || _n || ' unpublished mark(s) visible, ' || _m || ' total visible'
      || CASE WHEN _n = 0 AND _m > 0 THEN ' — hidden while reads work (PASS)'
              WHEN _m = 0 THEN ' — parent cannot read marks at all (FAIL)'
              ELSE ' — UNPUBLISHED LEAK (FAIL)' END;

  ------------------------------------------------------------------
  -- 4. Student sees exactly their own published marks, nobody else's
  ------------------------------------------------------------------
  SELECT array_agg(m.id ORDER BY m.id) INTO _expected
    FROM public.marks m
    JOIN public.exams e    ON e.id = m.exam_id
    JOIN public.students s ON s.id = m.student_id
   WHERE e.results_published_at IS NOT NULL
     AND s.school_id = _school
     AND s.user_id = _uid_student;

  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', _uid_student, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  SELECT array_agg(id ORDER BY id) INTO _actual FROM public.marks;
  RESET ROLE;

  _r4 := 'student sees ' || COALESCE(array_length(_actual,1),0) || ', ground truth '
      || COALESCE(array_length(_expected,1),0)
      || CASE WHEN COALESCE(_actual, ARRAY[]::uuid[]) = COALESCE(_expected, ARRAY[]::uuid[])
              THEN ' — identical sets (PASS)' ELSE ' — SETS DIFFER (FAIL)' END;

  ------------------------------------------------------------------
  -- 5. Teacher sees exactly the marks of the classes they teach
  ------------------------------------------------------------------
  SELECT array_agg(m.id ORDER BY m.id) INTO _expected
    FROM public.marks m
    JOIN public.exams e ON e.id = m.exam_id
   WHERE e.school_id = _school
     AND (EXISTS (SELECT 1 FROM public.teacher_classes tc
                    JOIN public.teachers t ON t.id = tc.teacher_id
                   WHERE tc.class_id = e.class_id AND t.user_id = _uid_teacher)
       OR EXISTS (SELECT 1 FROM public.teachers t
                   WHERE t.class_teacher_of = e.class_id AND t.user_id = _uid_teacher));

  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', _uid_teacher, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  SELECT array_agg(id ORDER BY id) INTO _actual FROM public.marks;
  RESET ROLE;

  _r5 := 'teacher sees ' || COALESCE(array_length(_actual,1),0) || ', ground truth '
      || COALESCE(array_length(_expected,1),0)
      || CASE WHEN COALESCE(_actual, ARRAY[]::uuid[]) = COALESCE(_expected, ARRAY[]::uuid[])
              THEN ' — identical sets (PASS)' ELSE ' — SETS DIFFER (FAIL)' END;

  ------------------------------------------------------------------
  -- 6. Operators see the whole institution, and nothing beyond it
  ------------------------------------------------------------------
  SELECT count(*) INTO _m FROM public.marks WHERE school_id = _school;

  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', _uid_admin, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO _n FROM public.marks;
  RESET ROLE;

  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', _uid_principal, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO _m FROM public.marks;
  RESET ROLE;

  _r6 := 'admin sees ' || _n || ', principal sees ' || _m || ', institution holds '
      || (SELECT count(*) FROM public.marks WHERE school_id = _school)
      || CASE WHEN _n = (SELECT count(*) FROM public.marks WHERE school_id = _school)
                AND _m = (SELECT count(*) FROM public.marks WHERE school_id = _school)
              THEN ' (PASS)' ELSE ' (FAIL)' END;

  ------------------------------------------------------------------
  -- 7. Super admin — the arm role dispatch would silently revoke
  ------------------------------------------------------------------
  -- A super admin acting in a granted institution has NO membership row,
  -- so active_membership_role() is NULL and every role arm is false. If
  -- their access lived only in those arms it would be gone. Prove it is
  -- not: grant live access and confirm both read and upload still work.
  SELECT id INTO _sa_acct FROM auth.users WHERE email='admin@wisdomcampus.com';
  INSERT INTO public.super_admins (account_id) VALUES (_sa_acct) RETURNING id INTO _sa;
  INSERT INTO public.super_admin_access_log
    (super_admin_id, school_id, expires_at, what_was_accessed, reason)
  VALUES (_sa, _school, now() + interval '1 hour', 'marks', 'chunk 6.6 verification');

  SELECT es.id, m.student_id INTO _es, _stu
    FROM public.marks m JOIN public.exam_subjects es ON es.id = m.exam_subject_id LIMIT 1;

  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', _sa_acct, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO _n FROM public.marks;
  BEGIN
    UPDATE public.marks SET marks_obtained = marks_obtained
     WHERE exam_subject_id = _es AND student_id = _stu;
    GET DIAGNOSTICS _m = ROW_COUNT;
    _ok := true;
  EXCEPTION WHEN others THEN _ok := false; _m := 0;
  END;
  RESET ROLE;

  _r7 := 'super admin in a granted institution: reads ' || _n || ' mark(s), upload changed ' || _m
      || CASE WHEN _n > 0 AND _ok AND _m > 0 THEN ' — read and write intact (PASS)'
              WHEN _n = 0 THEN ' — super admin LOST READ (FAIL)'
              ELSE ' — super admin LOST WRITE (FAIL)' END;

  ------------------------------------------------------------------
  -- 8. NEGATIVE CONTROL — prove these checks can actually fail
  ------------------------------------------------------------------
  -- "A gate never seen to fail is a gate never seen to work." Break the
  -- thing item 1 guards, confirm the same comparison now reports a leak,
  -- and put it back. Without this, items 1-6 passing proves only that the
  -- comparison ran, not that it discriminates.
  DROP POLICY IF EXISTS marks_read ON public.marks;
  CREATE POLICY marks_read ON public.marks FOR SELECT USING (true);

  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', _uid_parent, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO _n FROM public.marks;
  RESET ROLE;

  _r8 := 'negative control — with marks_read deliberately opened, parent sees ' || _n
      || CASE WHEN _n > COALESCE(array_length(_expected,1),0)
              THEN ' (PASS — the check discriminates)'
              ELSE ' (FAIL — opening the policy changed nothing, so items 1-6 prove nothing)' END;
  -- The RAISE below rolls this back with everything else; the real policy
  -- is restored by that rollback, not by a repair statement that might
  -- itself fail.

  ------------------------------------------------------------------
  -- 9. students — the riskiest change in this chunk
  ------------------------------------------------------------------
  -- Three SELECT policies collapsed into one set membership, so prove the
  -- union is unchanged: a parent must still see exactly their own
  -- children, by set and not by count.
  SELECT array_agg(s.id ORDER BY s.id) INTO _expected
    FROM public.students s
   WHERE s.school_id = _school
     AND s.deleted_at IS NULL
     AND (s.exit_date IS NULL OR s.exit_date > CURRENT_DATE)
     AND (s.parent_user_id = _uid_parent
       OR EXISTS (SELECT 1 FROM public.parent_students ps
                    JOIN public.parents p ON p.id = ps.parent_id
                   WHERE ps.student_id = s.id AND p.user_id = _uid_parent));

  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', _uid_parent, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  SELECT array_agg(id ORDER BY id) INTO _actual FROM public.students;
  RESET ROLE;

  _r9 := 'parent sees ' || COALESCE(array_length(_actual,1),0) || ' student(s), ground truth '
      || COALESCE(array_length(_expected,1),0)
      || CASE WHEN COALESCE(_actual, ARRAY[]::uuid[]) = COALESCE(_expected, ARRAY[]::uuid[])
              THEN ' — identical sets (PASS)' ELSE ' — SETS DIFFER (FAIL)' END;

  ------------------------------------------------------------------
  -- 10. Operators keep the whole roster
  ------------------------------------------------------------------
  -- This is what the live smoke gate was failing on, so assert the roster
  -- is WHOLE, not merely non-empty.
  SELECT count(*) INTO _m FROM public.students
   WHERE school_id = _school AND deleted_at IS NULL;

  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', _uid_admin, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO _n FROM public.students;
  RESET ROLE;

  _r10 := 'admin sees ' || _n || ' of ' || _m || ' live student(s)'
       || CASE WHEN _n = _m THEN ' — roster whole (PASS)'
               WHEN _n = 0 THEN ' — admin LOST THE ROSTER (FAIL)'
               ELSE ' — roster incomplete (FAIL)' END;


  RAISE EXCEPTION E'\n 1) %\n 2) %\n 3) %\n 4) %\n 5) %\n 6) %\n 7) %\n 8) %\n 9) %\n10) %\n [all rolled back]',
    _r1, _r2, _r3, _r4, _r5, _r6, _r7, _r8, _r9, _r10;
END $$;
