-- =============================================================================
-- Riverside Public School — a school waiting for its people
-- =============================================================================
-- The owner's ruling (2026-09-15): the test school must be a real school, and its
-- teachers, students and parents must be added by its admin THROUGH THE APP — never
-- accounts written into the database — "only then can we check that everything is
-- connected properly and working properly". So 20260925200000 (the pasted roster:
-- 12 teachers, 224 students, 26 logins written by SQL) and 20260925210000 (every
-- other login, 216 parents and the subject teachers, by SQL) were rolled back from
-- live and deleted. What a school is handed over with is all that remains, here:
--
--   the institution, its 2025-26 year, classes 8–12 as five class groups and twelve
--   sections (8-A, 8-B, 9-A, 9-B, 10-A, 10-B, 10-C, 11-A, 11-B, 12-A, 12-B, 12-C),
--   and its two leaders' logins: admin@rps.e2e.test (Ravi Krishnan) and
--   principal@rps.e2e.test (Sunita Menon), password E2eSchool123!.
--
-- NO teacher, student or parent, no class teacher, no subject taught. The admin adds
-- them through the admin panel and records each person's email; each person signs up
-- at /auth with that email and is linked to their record. Whatever that does not
-- connect is a defect of the app.
--
-- School id 00000000-0000-4000-8000-000000000003; section ids md5('rps-sec-<class>-<section>').
-- Idempotent. Apply: npm run db:seed:e2e-school   Remove: npm run db:seed:e2e-school:remove
-- =============================================================================

DO $school$
DECLARE
  _school   constant uuid := '00000000-0000-4000-8000-000000000003';
  _ay       constant uuid := md5('rps-ay-2025-26')::uuid;
  _hash     constant text := extensions.crypt('E2eSchool123!', extensions.gen_salt('bf'));
  -- Section and the seats it has.
  _sections constant text[] := ARRAY['8-A:25','8-B:25','9-A:27','9-B:27','10-A:21','10-B:21','10-C:21',
                                     '11-A:30','11-B:30','12-A:19','12-B:19','12-C:19'];
  _board uuid;
  _grade int;
  _s text;
  _g text;
  _sec text;
BEGIN
  SELECT id INTO _board FROM public.boards WHERE code = 'rbse';
  IF _board IS NULL THEN
    INSERT INTO public.boards (name, code) VALUES ('RBSE', 'rbse') ON CONFLICT (code) DO NOTHING;
    SELECT id INTO _board FROM public.boards WHERE code = 'rbse';
  END IF;

  INSERT INTO public.schools (
    id, name, slug, is_active, board, stream, status, session_start_date, session_end_date, academic_year,
    email, phone, principal_name, address
  ) VALUES (
    _school, 'Riverside Public School', 'riverside-public', true, 'rbse', 'science', 'active',
    DATE '2025-04-01', DATE '2026-03-31', '2025-26',
    'office@rps.e2e.test', '01411234567', 'Sunita Menon', 'Sector 12, Educational City, Jaipur'
  )
  ON CONFLICT (id) DO UPDATE SET
    name = EXCLUDED.name, slug = EXCLUDED.slug, is_active = true, board = EXCLUDED.board, stream = EXCLUDED.stream,
    status = 'active', session_start_date = EXCLUDED.session_start_date, session_end_date = EXCLUDED.session_end_date,
    academic_year = EXCLUDED.academic_year, email = EXCLUDED.email, phone = EXCLUDED.phone,
    principal_name = EXCLUDED.principal_name, address = EXCLUDED.address;

  INSERT INTO public.academic_years (id, school_id, name, starts_on, ends_on, is_current)
  VALUES (_ay, _school, '2025-26', DATE '2025-04-01', DATE '2026-03-31', true)
  ON CONFLICT (id) DO UPDATE SET is_current = true, starts_on = EXCLUDED.starts_on, ends_on = EXCLUDED.ends_on;
  UPDATE public.academic_years SET is_current = (id = _ay) WHERE school_id = _school;

  FOR _grade IN 8..12 LOOP
    INSERT INTO public.curriculum_classes (board_id, label, level)
    VALUES (_board, 'Class ' || _grade, _grade)
    ON CONFLICT (board_id, level) DO NOTHING;
    INSERT INTO public.class_groups (id, school_id, academic_year_id, curriculum_class_id, label)
    SELECT md5('rps-cg-' || _grade)::uuid, _school, _ay, cc.id, 'Class ' || _grade
      FROM public.curriculum_classes cc
     WHERE cc.board_id = _board AND cc.level = _grade
    ON CONFLICT (id) DO NOTHING;
  END LOOP;

  FOREACH _s IN ARRAY _sections LOOP
    _sec := split_part(_s, ':', 1);
    _g := split_part(_sec, '-', 1);
    INSERT INTO public.classes (
      id, school_id, name, section, academic_year, academic_year_id, class_group_id,
      is_active, kind, display_name, category, capacity
    ) VALUES (
      md5('rps-sec-' || _sec)::uuid, _school, _g, split_part(_sec, '-', 2), '2025-26', _ay, md5('rps-cg-' || _g)::uuid,
      true, 'class', 'Class ' || _sec, CASE WHEN _g::int >= 11 THEN 'Senior Secondary' ELSE 'Secondary' END,
      split_part(_s, ':', 2)::int
    )
    ON CONFLICT (id) DO UPDATE SET
      class_group_id = EXCLUDED.class_group_id, academic_year_id = EXCLUDED.academic_year_id,
      display_name = EXCLUDED.display_name, is_active = true, capacity = EXCLUDED.capacity;
  END LOOP;

  -- The school's two leaders. Their logins are how the school is handed over; everyone
  -- else is added by the admin through the app.
  INSERT INTO auth.users (
    id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
    created_at, updated_at, confirmation_token, email_change, email_change_token_new, recovery_token
  )
  SELECT l.id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', l.email, _hash, now(),
         '{"provider":"email","providers":["email"]}'::jsonb, jsonb_build_object('full_name', l.full_name), now(), now(),
         '', '', '', ''
    FROM (VALUES (md5('rps-auth-admin')::uuid, 'admin@rps.e2e.test', 'Ravi Krishnan'),
                 (md5('rps-auth-principal')::uuid, 'principal@rps.e2e.test', 'Sunita Menon')) l(id, email, full_name)
   WHERE NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = l.id);

  INSERT INTO auth.identities (id, user_id, identity_data, provider, provider_id, last_sign_in_at, created_at, updated_at)
  SELECT u.id, u.id, jsonb_build_object('sub', u.id::text, 'email', u.email), 'email', u.id::text, now(), now(), now()
    FROM auth.users u
   WHERE u.id IN (md5('rps-auth-admin')::uuid, md5('rps-auth-principal')::uuid)
     AND NOT EXISTS (SELECT 1 FROM auth.identities i WHERE i.user_id = u.id AND i.provider = 'email');

  INSERT INTO public.profiles (id, full_name, email, school_id)
  VALUES (md5('rps-auth-admin')::uuid, 'Ravi Krishnan', 'admin@rps.e2e.test', _school),
         (md5('rps-auth-principal')::uuid, 'Sunita Menon', 'principal@rps.e2e.test', _school)
  ON CONFLICT (id) DO UPDATE SET full_name = EXCLUDED.full_name, email = EXCLUDED.email, school_id = EXCLUDED.school_id;

  PERFORM public._grant_membership(md5('rps-auth-admin')::uuid, _school, 'admin');
  PERFORM public._grant_membership(md5('rps-auth-principal')::uuid, _school, 'principal');

  RAISE NOTICE 'Riverside Public School stands: 12 sections, its admin and its principal, waiting for its people';
END
$school$;

-- =============================================================================
-- Proof
--
-- The school stands exactly — its year, its five class groups on the curriculum, its
-- twelve sections with their seats — its two leaders sign in (and a wrong password
-- opens neither), it holds no person the app did not add, and its admin can do the one
-- thing everything else depends on: add a student to a section, under their own row
-- security.
-- =============================================================================

DO $verify$
DECLARE
  _school   constant uuid := '00000000-0000-4000-8000-000000000003';
  _ay       constant uuid := md5('rps-ay-2025-26')::uuid;
  _sections constant text[] := ARRAY['8-A:25','8-B:25','9-A:27','9-B:27','10-A:21','10-B:21','10-C:21',
                                     '11-A:30','11-B:30','12-A:19','12-B:19','12-C:19'];
  _s text; _sec text; _t text; _role text;
  _n bigint; _m bigint; _k bigint;
BEGIN
  -- 1. The institution, its one current year, its five class groups each on its own class of the curriculum.
  IF NOT EXISTS (SELECT 1 FROM public.schools WHERE id = _school AND name = 'Riverside Public School' AND is_active AND status = 'active') THEN
    RAISE EXCEPTION 'ROLLED BACK: Riverside Public School is missing or inactive';
  END IF;
  IF (SELECT count(*) FROM public.academic_years WHERE school_id = _school AND is_current) <> 1
     OR NOT EXISTS (SELECT 1 FROM public.academic_years WHERE id = _ay AND school_id = _school AND is_current) THEN
    RAISE EXCEPTION 'ROLLED BACK: Riverside does not have exactly one current year, 2025-26';
  END IF;
  SELECT count(*), count(*) FILTER (WHERE cc.level::text = split_part(g.label, ' ', 2) AND b.code = 'rbse') INTO _n, _m
    FROM public.class_groups g
    LEFT JOIN public.curriculum_classes cc ON cc.id = g.curriculum_class_id
    LEFT JOIN public.boards b ON b.id = cc.board_id
   WHERE g.school_id = _school;
  IF _n <> 5 OR _m <> 5 THEN
    RAISE EXCEPTION 'ROLLED BACK: Riverside has % class group(s), % on their own RBSE class; expected 5 and 5', _n, _m;
  END IF;

  -- 2. Exactly its twelve sections, each in its class group with its seats, none with a class teacher yet.
  FOREACH _s IN ARRAY _sections LOOP
    _sec := split_part(_s, ':', 1);
    IF NOT EXISTS (SELECT 1 FROM public.classes c JOIN public.class_groups g ON g.id = c.class_group_id
                    WHERE c.id = md5('rps-sec-' || _sec)::uuid AND c.school_id = _school AND c.is_active
                      AND c.name = split_part(_sec, '-', 1) AND c.section = split_part(_sec, '-', 2)
                      AND c.display_name = 'Class ' || _sec AND c.capacity = split_part(_s, ':', 2)::int
                      AND c.academic_year_id = _ay AND g.label = 'Class ' || split_part(_sec, '-', 1)
                      AND c.class_teacher_id IS NULL) THEN
      RAISE EXCEPTION 'ROLLED BACK: section % is missing, misplaced, or already has a class teacher', _sec;
    END IF;
  END LOOP;
  IF (SELECT count(*) FROM public.classes WHERE school_id = _school) <> 12 THEN
    RAISE EXCEPTION 'ROLLED BACK: Riverside has % sections, expected 12', (SELECT count(*) FROM public.classes WHERE school_id = _school);
  END IF;

  -- 3. Its two leaders sign in with the E2E password and not another; each with an identity, a profile of this
  --    school, and their one role here. No other login or member.
  SELECT count(*) INTO _n FROM auth.users u
   WHERE u.email IN ('admin@rps.e2e.test', 'principal@rps.e2e.test') AND u.email_confirmed_at IS NOT NULL
     AND u.encrypted_password = extensions.crypt('E2eSchool123!', u.encrypted_password);
  IF _n <> 2 OR (SELECT count(*) FROM auth.users WHERE email LIKE '%@rps.e2e.test') <> 2 THEN
    RAISE EXCEPTION 'ROLLED BACK: % of Riverside''s logins accept the E2E password (of %), expected 2 of 2',
      _n, (SELECT count(*) FROM auth.users WHERE email LIKE '%@rps.e2e.test');
  END IF;
  IF EXISTS (SELECT 1 FROM auth.users u WHERE u.email LIKE '%@rps.e2e.test'
               AND u.encrypted_password = extensions.crypt('not-the-password', u.encrypted_password)) THEN
    RAISE EXCEPTION 'ROLLED BACK: a wrong password opens a Riverside login';
  END IF;
  IF (SELECT count(*) FROM auth.identities i JOIN auth.users u ON u.id = i.user_id
       WHERE u.email LIKE '%@rps.e2e.test' AND i.provider = 'email') <> 2
     OR (SELECT count(*) FROM public.profiles p JOIN auth.users u ON u.id = p.id
          WHERE u.email LIKE '%@rps.e2e.test' AND p.school_id = _school) <> 2 THEN
    RAISE EXCEPTION 'ROLLED BACK: a Riverside leader lacks their email identity or their profile of this school';
  END IF;
  IF (SELECT array_agg(m.role::text || ':' || u.email ORDER BY m.role::text)
        FROM public.memberships m JOIN auth.users u ON u.id = m.account_id
       WHERE m.school_id = _school AND m.status = 'active')
     IS DISTINCT FROM ARRAY['admin:admin@rps.e2e.test', 'principal:principal@rps.e2e.test']
     OR (SELECT count(*) FROM public.memberships WHERE school_id = _school) <> 2 THEN
    RAISE EXCEPTION 'ROLLED BACK: Riverside''s members are not exactly its admin and its principal';
  END IF;

  -- 4. Waiting for its people: nothing the admin adds through the app is here yet.
  FOREACH _t IN ARRAY ARRAY['teachers', 'students', 'parents', 'parent_students', 'student_enrolments', 'section_subjects',
                            'teacher_classes', 'teacher_assignments', 'homework', 'attendance', 'marks', 'exams', 'tests'] LOOP
    IF to_regclass('public.' || _t) IS NOT NULL THEN
      EXECUTE format('SELECT count(*) FROM public.%I WHERE school_id = $1', _t) INTO _n USING _school;
      IF _n <> 0 THEN
        RAISE EXCEPTION 'ROLLED BACK: Riverside already holds % row(s) of %, which only its admin may add', _n, _t;
      END IF;
    END IF;
  END LOOP;

  -- 5. Its leaders under their own row security, inside a savepoint that always ends by raising P0999: the admin
  --    reads the school and adds a student to 8-A; the principal reads the twelve sections.
  BEGIN
    PERFORM set_config('request.jwt.claims', json_build_object('sub', md5('rps-auth-admin')::uuid, 'role', 'authenticated')::text, true);
    SET LOCAL ROLE authenticated;
    _role := public.get_my_role()::text;
    SELECT count(*), count(*) FILTER (WHERE school_id <> _school) INTO _n, _m FROM public.classes;
    INSERT INTO public.students (school_id, full_name, admission_number, class_id)
    VALUES (_school, 'Verify Probe', 'RPS-VERIFY-PROBE', md5('rps-sec-8-A')::uuid);
    SELECT count(*) INTO _k FROM public.students WHERE admission_number = 'RPS-VERIFY-PROBE';
    RESET ROLE;
    IF _role IS DISTINCT FROM 'admin' OR _n <> 12 OR _m <> 0 OR _k <> 1 THEN
      RAISE EXCEPTION 'ROLLED BACK: admin@rps.e2e.test acts as %, reads % sections (% of another school) and sees % student after adding one to 8-A; expected admin, 12, 0, 1',
        _role, _n, _m, _k;
    END IF;

    PERFORM set_config('request.jwt.claims', json_build_object('sub', md5('rps-auth-principal')::uuid, 'role', 'authenticated')::text, true);
    SET LOCAL ROLE authenticated;
    _role := public.get_my_role()::text;
    SELECT count(*), count(*) FILTER (WHERE school_id <> _school) INTO _n, _m FROM public.classes;
    RESET ROLE;
    IF _role IS DISTINCT FROM 'principal' OR _n <> 12 OR _m <> 0 THEN
      RAISE EXCEPTION 'ROLLED BACK: principal@rps.e2e.test acts as % and reads % sections (% of another school); expected principal, 12, 0',
        _role, _n, _m;
    END IF;

    RAISE EXCEPTION USING ERRCODE = 'P0999', MESSAGE = 'verify probes rolled back';
  EXCEPTION WHEN SQLSTATE 'P0999' THEN
    NULL;
  END;

  RAISE NOTICE 'verify OK: Riverside Public School stands — one current year, five class groups on the RBSE curriculum, exactly its twelve sections with their seats and no class teacher, its admin and principal signing in with the E2E password and not another, no other member, and no teacher, student, parent or subject: the admin adds a student to 8-A under their own row security, and the principal reads the twelve sections';
END
$verify$;
