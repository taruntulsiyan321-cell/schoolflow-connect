-- Riverside used as the owner ruled: the ADMIN adds a teacher (with their email) and a student in 8-A (with their
-- login email reserved through admin_connect_student_account), under the admin's own row security; then each
-- person's login comes into being and the app's own trigger (handle_new_user -> link_portal_on_auth) links them to
-- the record the admin made. The teacher then sets homework for 8-A. Everything here must go with the rollback.
DO $use$
DECLARE
  _school  constant uuid := '00000000-0000-4000-8000-000000000003';
  _admin   constant uuid := md5('rps-auth-admin')::uuid;
  _sec     constant uuid := md5('rps-sec-8-A')::uuid;
  _t_uid   constant uuid := md5('rps-use-220-teacher')::uuid;
  _s_uid   constant uuid := md5('rps-use-220-student')::uuid;
  _teacher uuid; _student uuid; _n bigint;
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object('sub', _admin, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  INSERT INTO public.teachers (school_id, full_name, email, subject, class_teacher_of, is_class_teacher)
  VALUES (_school, 'Use Teacher', 'use.teacher@rps.e2e.test', 'Mathematics', _sec, true);
  -- school_id written here as a correct writer would; the admin panel omits it (the defect this run found).
  INSERT INTO public.teacher_classes (teacher_id, class_id, school_id, subject)
  SELECT id, _sec, _school, 'Mathematics' FROM public.teachers WHERE email = 'use.teacher@rps.e2e.test';
  INSERT INTO public.students (school_id, full_name, admission_number, class_id)
  VALUES (_school, 'Use Student', 'RPS-USE-220', _sec);
  PERFORM public.admin_connect_student_account((SELECT id FROM public.students WHERE admission_number = 'RPS-USE-220'), 'use.student@rps.e2e.test', 'student');
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', '', true);
  SELECT id INTO _teacher FROM public.teachers WHERE email = 'use.teacher@rps.e2e.test';
  SELECT id INTO _student FROM public.students WHERE admission_number = 'RPS-USE-220';
  UPDATE public.classes SET class_teacher_id = _teacher WHERE id = _sec;

  INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data,
                          raw_user_meta_data, created_at, updated_at, confirmation_token, email_change, email_change_token_new, recovery_token)
  VALUES (_t_uid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'use.teacher@rps.e2e.test',
          extensions.crypt('E2eSchool123!', extensions.gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', ''),
         (_s_uid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'use.student@rps.e2e.test',
          extensions.crypt('E2eSchool123!', extensions.gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', '');

  SELECT count(*) INTO _n FROM public.memberships
   WHERE school_id = _school AND ((account_id = _t_uid AND role = 'teacher' AND local_person_id = _teacher)
                               OR (account_id = _s_uid AND role = 'student' AND local_person_id = _student));
  IF _n <> 2 THEN
    RAISE EXCEPTION 'USE FAILED: the app''s own sign-in trigger linked % of the 2 people the admin added', _n;
  END IF;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', _t_uid, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  INSERT INTO public.homework (school_id, class_id, subject, title, description, closes_at, status)
  VALUES (_school, _sec, 'Mathematics', 'rps-use-220 homework', 'q', now() + interval '1 day', 'published');
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', '', true);
  LOOP EXIT WHEN public.process_pending_academic_events(500) = 0; END LOOP;
  RAISE NOTICE 'use OK: the admin added a teacher and a student, the trigger linked both logins, the teacher set homework';
END
$use$;
