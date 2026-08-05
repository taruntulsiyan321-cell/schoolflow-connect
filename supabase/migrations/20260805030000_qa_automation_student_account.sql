-- Dedicated, clean student account reserved for automated Playwright
-- verification. Never reuse arjun.mehta@wisdomcampus.com for this again --
-- that account now carries hundreds of sessions/bookmarks/mistakes/history
-- entries from this engagement's own testing, which makes every new
-- verification run harder to reason about (stale backlogs, ambiguous
-- "before" counts, slow queue-paging).
--
-- Reuses the existing _demo_upsert_auth_user() helper
-- (supabase/SEED_DEMO_DATA.sql) -- not redefined here. Clones school_id and
-- class_id from the current arjun.mehta student row rather than hardcoding
-- a class UUID, so this account is guaranteed to resolve to the same
-- board/stream/class (Class 11-A Commerce) Practice already works against,
-- regardless of which exact class row is live.
--
-- Idempotent: fixed UUID + ON CONFLICT, safe to re-run.

DO $qa$
DECLARE
  _pw text := 'QaAutomation123!';
  u_qa uuid := 'da000000-0001-4000-8000-000000000001';
  _source_user uuid := 'd1000003-0001-4000-8000-000000000001'; -- arjun.mehta
  _school_id uuid;
  _class_id uuid;
  _student_id uuid;
BEGIN
  SELECT school_id, class_id INTO _school_id, _class_id
  FROM public.students
  WHERE user_id = _source_user
  LIMIT 1;

  IF _school_id IS NULL THEN
    RAISE EXCEPTION 'Could not find school_id/class_id from source student row (user_id=%) -- update _source_user in this migration to a currently-working student account first', _source_user;
  END IF;

  PERFORM public._demo_upsert_auth_user(
    u_qa, 'qa.automation@wisdomcampus.com', _pw, 'QA Automation'
  );

  INSERT INTO public.profiles (id, full_name, email, school_id)
  VALUES (u_qa, 'QA Automation', 'qa.automation@wisdomcampus.com', _school_id)
  ON CONFLICT (id) DO UPDATE SET
    full_name = EXCLUDED.full_name,
    email = EXCLUDED.email,
    school_id = EXCLUDED.school_id;

  INSERT INTO public.user_roles (user_id, role)
  VALUES (u_qa, 'student'::public.app_role)
  ON CONFLICT (user_id, role) DO NOTHING;

  -- admission_number is NOT NULL UNIQUE on this table -- fixed, idempotent value.
  INSERT INTO public.students (id, user_id, school_id, class_id, full_name, admission_number, roll_number)
  VALUES (
    gen_random_uuid(), u_qa, _school_id, _class_id,
    'QA Automation', 'QA-AUTOMATION-001', 'QA-01'
  )
  ON CONFLICT (user_id) DO UPDATE SET
    school_id = EXCLUDED.school_id,
    class_id = EXCLUDED.class_id
  RETURNING id INTO _student_id;

  RAISE NOTICE 'QA automation account ready: qa.automation@wisdomcampus.com / % (school_id=%, class_id=%)', _pw, _school_id, _class_id;
END;
$qa$;
