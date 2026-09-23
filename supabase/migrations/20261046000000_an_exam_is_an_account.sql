-- ===========================================================================
-- AN EXAM IS AN ACCOUNT
--
-- The individual student: no school, preparing for one competitive exam. The
-- ruling (2026-09-23): the exam is chosen on the login page, it is FIXED on
-- that account for ever, and preparing for another exam means another account.
-- One phone number may hold one account per exam.
--
-- -- WHY THE SPACE IS A TENANT OF ONE ---------------------------------------
--
-- Every learning table in this database is fenced on school_id, and the column
-- is NOT NULL on all of them. Loosening that fence for individuals would mean
-- reopening the one rule that keeps every school's data apart. So an
-- individual is not an exception to the fence: they get their own tenant, of
-- which they are the only member. There is no teacher, no principal, no parent
-- and no classmate in that space, so "shared with nobody" is what the existing
-- fence already enforces, with nothing new to trust.
--
-- schools.kind tells the two apart: 'school' for an organisation, 'individual'
-- for one person's own space.
--
-- -- WHAT THIS ADDS ---------------------------------------------------------
--
--   competitive_exams   the list the login page shows. CUET is the first.
--                       NOT named "exams": public.exams already exists and is
--                       the school's exam SCHEDULE (class_id, max_marks,
--                       results_published_at, 18 rows live).
--   schools.kind        'school' (every existing row) or 'individual'
--   exam_accounts       one row per individual space: which exam, whose
--                       account. exam_id cannot be updated -- the "no going
--                       back".
--   rpc_create_exam_account   opens the space, the student and the membership
--                       in one transaction, for a phone the sign-in path has
--                       ALREADY verified. service_role only: it is called by
--                       verify-msg91-widget, never by a browser.
--   rpc_set_my_display_name   the name typed after verifying, written to the
--                       profile and the student row together.
--
-- -- THE ABSORPTION HAZARD, AND WHY THE PROFILE CARRIES THE SPACE -----------
--
-- get_auth_context() -- the first call the app makes after sign-in -- runs
-- link_portal_on_auth(). That function looks for an unlinked school student or
-- teacher matching this account's email or phone and, on a match, sets
-- students.user_id, grants a membership in THAT SCHOOL and writes its
-- school_id onto the profile. It does so GLOBALLY, across every institution,
-- whenever profiles.school_id IS NULL (its `_allow_global` flag).
--
-- An exam account whose profile named no space would therefore be one matching
-- portal_phone away from being silently pulled into a school -- the exact
-- opposite of "shared with nobody". So rpc_create_exam_account writes the
-- space onto the profile as well as the membership: with profiles.school_id
-- set, _allow_global is false and the only rows link_portal_on_auth will
-- consider are those of the individual's own space, which contains nobody
-- else. The proof below demonstrates the absorption happening first, then
-- refuses to pass unless the same attempt fails afterwards.
--
-- Rollback: rollback/20261046000000_an_exam_is_an_account.rollback.sql
-- ===========================================================================

BEGIN;

-- -- 1. The exams the login page offers --------------------------------------

CREATE TABLE public.competitive_exams (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code          text NOT NULL UNIQUE
                CHECK (code = lower(code) AND code ~ '^[a-z0-9_]{2,32}$'),
  name          text NOT NULL,
  is_active     boolean NOT NULL DEFAULT true,
  display_order integer NOT NULL DEFAULT 100,
  created_at    timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.competitive_exams IS
  'The competitive exams an individual account can be opened for. The login page reads it BEFORE anyone is signed in, so anon may select the active ones; nobody but the service role may write.';

ALTER TABLE public.competitive_exams ENABLE ROW LEVEL SECURITY;
-- Supabase grants ALL on new public tables to anon/authenticated by default
-- privilege; state the whole grant rule rather than relying on RLS alone.
REVOKE ALL ON TABLE public.competitive_exams FROM PUBLIC, anon, authenticated;
CREATE POLICY competitive_exams_select_active ON public.competitive_exams
  FOR SELECT TO anon, authenticated USING (is_active);
GRANT SELECT ON TABLE public.competitive_exams TO anon, authenticated;

INSERT INTO public.competitive_exams (code, name, display_order)
VALUES ('cuet', 'CUET', 10);

-- -- 2. A school row is an organisation, or one person's own space -----------

ALTER TABLE public.schools
  ADD COLUMN kind text NOT NULL DEFAULT 'school'
  CONSTRAINT schools_kind_known CHECK (kind IN ('school', 'individual'));
COMMENT ON COLUMN public.schools.kind IS
  'school = an organisation with staff and classes. individual = one student''s private space, exactly one member, opened by rpc_create_exam_account. Anything that counts or lists institutions means kind = ''school''.';

-- -- 3. The individual space, and the exam it can never leave ----------------

CREATE TABLE public.exam_accounts (
  school_id  uuid PRIMARY KEY REFERENCES public.schools(id) ON DELETE CASCADE,
  exam_id    uuid NOT NULL REFERENCES public.competitive_exams(id) ON DELETE RESTRICT,
  account_id uuid NOT NULL UNIQUE REFERENCES public.accounts(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.exam_accounts IS
  'One individual student''s space and the exam it prepares for. account_id is UNIQUE: a login is one exam account, and another exam means another login (one phone may hold both). exam_id is immutable -- see exam_account_is_fixed.';

ALTER TABLE public.exam_accounts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.exam_accounts FROM PUBLIC, anon, authenticated;
CREATE POLICY exam_accounts_select_own ON public.exam_accounts
  FOR SELECT TO authenticated USING (account_id = auth.uid());
GRANT SELECT ON TABLE public.exam_accounts TO authenticated;

-- "Select this exam and you cannot go back": the row may be created and
-- deleted, never re-pointed. Without this, one UPDATE would carry a whole
-- history of practice, mistakes and revision into a different exam.
CREATE FUNCTION public.tg_exam_account_is_fixed() RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $fn$
BEGIN
  IF NEW.exam_id IS DISTINCT FROM OLD.exam_id
     OR NEW.account_id IS DISTINCT FROM OLD.account_id
     OR NEW.school_id IS DISTINCT FROM OLD.school_id THEN
    RAISE EXCEPTION
      'an exam account is fixed to its exam and its owner; open a new account for another exam';
  END IF;
  RETURN NEW;
END
$fn$;

CREATE TRIGGER exam_account_is_fixed BEFORE UPDATE ON public.exam_accounts
  FOR EACH ROW EXECUTE FUNCTION public.tg_exam_account_is_fixed();

-- -- 4. Opening the account ---------------------------------------------------
--
-- Called by verify-msg91-widget with the service role, after MSG91 has
-- verified the phone. Never reachable from a browser: a caller who could name
-- their own account_id could otherwise mint spaces for somebody else.
CREATE FUNCTION public.rpc_create_exam_account(
  _account_id uuid,
  _exam_code  text,
  _phone      text DEFAULT NULL,
  _full_name  text DEFAULT ''
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  _exam    public.competitive_exams%ROWTYPE;
  _space   uuid;
  _student uuid;
  _name    text := NULLIF(btrim(COALESCE(_full_name, '')), '');
BEGIN
  IF _account_id IS NULL THEN
    RAISE EXCEPTION 'account_id is required';
  END IF;

  SELECT * INTO _exam FROM public.competitive_exams
   WHERE code = lower(btrim(COALESCE(_exam_code, ''))) AND is_active;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'no active exam with code %', _exam_code;
  END IF;

  -- Idempotent: the same verified sign-in arriving twice returns the account
  -- it already opened rather than a second space.
  SELECT ea.school_id INTO _space
    FROM public.exam_accounts ea WHERE ea.account_id = _account_id;
  IF _space IS NOT NULL THEN
    SELECT s.id INTO _student FROM public.students s WHERE s.user_id = _account_id;
    RETURN jsonb_build_object('space_id', _space, 'student_id', _student,
                              'exam', _exam.code, 'created', false);
  END IF;

  -- A super admin's route into a tenant is the access-log grant and nothing
  -- else (10.20). Handing them a space of their own would be a second,
  -- unlogged one, and get_my_school_id closes its profile fallback to them
  -- anyway, so the account would not work.
  IF EXISTS (SELECT 1 FROM public.super_admins sa
              WHERE sa.account_id = _account_id AND sa.revoked_at IS NULL) THEN
    RAISE EXCEPTION 'a super admin account cannot be an exam account';
  END IF;

  -- An account already inside an organisation never becomes an exam account:
  -- its data belongs to that school's fence, and two active memberships would
  -- leave "which space am I in" to chance.
  IF EXISTS (SELECT 1 FROM public.memberships m WHERE m.account_id = _account_id) THEN
    RAISE EXCEPTION 'this account already belongs to an organisation';
  END IF;
  IF EXISTS (SELECT 1 FROM public.students s WHERE s.user_id = _account_id) THEN
    RAISE EXCEPTION 'this account is already a student of an institution';
  END IF;

  INSERT INTO public.schools (name, kind, is_active, board)
  VALUES (COALESCE(_name, 'Individual') || ' (' || _exam.name || ')',
          'individual', true, NULL)
  RETURNING id INTO _space;

  INSERT INTO public.exam_accounts (school_id, exam_id, account_id)
  VALUES (_space, _exam.id, _account_id);

  -- No class: an individual prepares for an exam, not a syllabus year, so
  -- class_id stays NULL and the question bank is chosen by exam.
  INSERT INTO public.students (user_id, school_id, full_name, admission_number, class_id)
  VALUES (_account_id, _space, COALESCE(_name, 'Student'),
          upper(_exam.code) || '-' || to_char(now(), 'YYYY') || '-'
            || substr(replace(_account_id::text, '-', ''), 1, 8),
          NULL)
  RETURNING id INTO _student;

  PERFORM public._grant_membership(_account_id, _space,
                                   'student'::public.app_role, _student);

  -- The profile carries the space for the reason set out in the header: with
  -- profiles.school_id NULL, link_portal_on_auth matches unlinked school
  -- people GLOBALLY and would absorb this account into the first school whose
  -- portal_email or portal_phone happened to match. The verified number lives
  -- here too, because auth.users.phone is UNIQUE and one phone holds an
  -- account per exam.
  UPDATE public.profiles
     SET school_id = _space,
         phone     = COALESCE(NULLIF(btrim(COALESCE(_phone, '')), ''), phone),
         full_name = COALESCE(_name, full_name)
   WHERE id = _account_id;

  RETURN jsonb_build_object('space_id', _space, 'student_id', _student,
                            'exam', _exam.code, 'created', true);
END
$fn$;

REVOKE ALL ON FUNCTION public.rpc_create_exam_account(uuid, text, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_create_exam_account(uuid, text, text, text)
  TO service_role;

-- -- 5. The name typed after verifying ----------------------------------------
--
-- Profile and student row together: the app reads the name from both, and a
-- student whose two names disagree is the same decision in two places.
CREATE FUNCTION public.rpc_set_my_display_name(_full_name text) RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  _uid  uuid := auth.uid();
  _name text := btrim(COALESCE(_full_name, ''));
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'auth required';
  END IF;
  IF length(_name) < 2 OR length(_name) > 80 THEN
    RAISE EXCEPTION 'a name is between 2 and 80 characters';
  END IF;

  UPDATE public.profiles SET full_name = _name WHERE id = _uid;
  UPDATE public.students SET full_name = _name WHERE user_id = _uid;
  RETURN _name;
END
$fn$;

REVOKE ALL ON FUNCTION public.rpc_set_my_display_name(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rpc_set_my_display_name(text) TO authenticated;

-- -- 6. "The only school" means the only ORGANISATION --------------------------
--
-- default_school_id() falls back to the single school when exactly one exists.
-- Individual spaces are rows in the same table, so without this the count is
-- never one again and the fallback quietly dies the moment the first
-- individual signs up.
CREATE OR REPLACE FUNCTION public.default_school_id()
 RETURNS uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT COALESCE(
    public.get_my_school_id(),
    (SELECT s.id FROM public.schools s
      WHERE s.kind = 'school'
        AND (SELECT count(*) FROM public.schools WHERE kind = 'school') = 1)
  )
$function$;

-- -- Proof, on a real account, with its fixtures removed before COMMIT --------

DO $verify$
DECLARE
  _victim  uuid;
  _vemail  text;
  _decoy   uuid;
  _dstud   uuid;
  _org     uuid;
  _res     jsonb;
  _again   jsonb;
  _space   uuid;
  _student uuid;
  _fence   uuid;
  _boss    uuid;
  _other   uuid;
  _boss_probe uuid;
  _n       int;
  _msg     text;
  _oldname text;
  _oldph   text;
BEGIN
  -- An account that has never been anywhere: no membership, no student row,
  -- not a super admin, and with an email link_portal_on_auth can match on.
  SELECT u.id, lower(u.email) INTO _victim, _vemail
    FROM auth.users u
   WHERE u.email IS NOT NULL
     AND EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = u.id)
     AND NOT EXISTS (SELECT 1 FROM public.memberships m WHERE m.account_id = u.id)
     AND NOT EXISTS (SELECT 1 FROM public.students s WHERE s.user_id = u.id)
     AND NOT EXISTS (SELECT 1 FROM public.super_admins sa
                      WHERE sa.account_id = u.id AND sa.revoked_at IS NULL)
   ORDER BY u.email
   LIMIT 1;
  IF _victim IS NULL THEN
    RAISE EXCEPTION 'ROLLED BACK (control): no account free of memberships, so the sign-up path was never exercised';
  END IF;

  -- The proof borrows a real person's profile; give it back exactly as found.
  SELECT p.full_name, p.phone INTO _oldname, _oldph
    FROM public.profiles p WHERE p.id = _victim;

  -- Somebody else, for the "the owner cannot be swapped" attempt.
  SELECT a.id INTO _boss_probe FROM public.accounts a WHERE a.id <> _victim LIMIT 1;
  IF _boss_probe IS NULL THEN
    RAISE EXCEPTION 'ROLLED BACK (control): only one account exists, so an owner swap cannot be attempted';
  END IF;

  -- ---- CONTROL: the absorption this design defends against is LIVE ---------
  -- A school with an unlinked student carrying the victim's email. While the
  -- victim's profile names no space, link_portal_on_auth matches globally.
  INSERT INTO public.schools (name, kind) VALUES ('Proof decoy school', 'school')
  RETURNING id INTO _decoy;
  INSERT INTO public.students (school_id, full_name, admission_number, portal_email)
  VALUES (_decoy, 'Decoy Student', 'DECOY-0001', _vemail)
  RETURNING id INTO _dstud;

  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', _victim, 'role', 'authenticated')::text, true);
  PERFORM public.link_portal_on_auth(_victim);
  PERFORM set_config('request.jwt.claims', NULL, true);

  SELECT count(*) INTO _n FROM public.memberships
   WHERE account_id = _victim AND school_id = _decoy;
  IF _n <> 1 THEN
    RAISE EXCEPTION 'ROLLED BACK (control): link_portal_on_auth did not absorb an unprotected account, so the after-test below proves nothing';
  END IF;

  -- Undo the absorption completely, back to an account that has been nowhere.
  DELETE FROM public.memberships WHERE account_id = _victim;
  DELETE FROM public.students WHERE id = _dstud;
  UPDATE public.profiles SET school_id = NULL WHERE id = _victim;

  -- ---- The account is opened ----------------------------------------------
  _res := public.rpc_create_exam_account(_victim, 'cuet', '919999900001', 'Proof Student');
  _space   := (_res->>'space_id')::uuid;
  _student := (_res->>'student_id')::uuid;

  IF (_res->>'created')::boolean IS NOT TRUE OR _space IS NULL OR _student IS NULL THEN
    RAISE EXCEPTION 'ROLLED BACK: the account was not opened (%)', _res;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.schools WHERE id = _space AND kind = 'individual') THEN
    RAISE EXCEPTION 'ROLLED BACK: the space is not marked individual';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.exam_accounts ea
                   JOIN public.competitive_exams e ON e.id = ea.exam_id
                  WHERE ea.school_id = _space AND e.code = 'cuet'
                    AND ea.account_id = _victim) THEN
    RAISE EXCEPTION 'ROLLED BACK: the space is not tied to CUET for this account';
  END IF;

  SELECT count(*) INTO _n FROM public.memberships WHERE school_id = _space;
  IF _n <> 1 THEN
    RAISE EXCEPTION 'ROLLED BACK: the space has % members, so it is not private', _n;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.memberships
                  WHERE school_id = _space AND account_id = _victim
                    AND role = 'student' AND status = 'active') THEN
    RAISE EXCEPTION 'ROLLED BACK: the one member is not this account, active, as a student';
  END IF;
  IF EXISTS (SELECT 1 FROM public.students WHERE id = _student AND class_id IS NOT NULL) THEN
    RAISE EXCEPTION 'ROLLED BACK: an individual student was given a class';
  END IF;

  -- The fence follows the account: signed in as them, this IS their space.
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', _victim, 'role', 'authenticated')::text, true);
  _fence := public.get_my_school_id();
  PERFORM set_config('request.jwt.claims', NULL, true);
  IF _fence IS DISTINCT FROM _space THEN
    RAISE EXCEPTION 'ROLLED BACK: the fence puts this student in %, not their own space %', _fence, _space;
  END IF;

  -- ---- The same absorption attempt, now that the account is opened --------
  INSERT INTO public.students (school_id, full_name, admission_number, portal_email)
  VALUES (_decoy, 'Decoy Student', 'DECOY-0002', _vemail)
  RETURNING id INTO _dstud;

  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', _victim, 'role', 'authenticated')::text, true);
  PERFORM public.link_portal_on_auth(_victim);
  PERFORM set_config('request.jwt.claims', NULL, true);

  SELECT count(*) INTO _n FROM public.memberships WHERE account_id = _victim;
  IF _n <> 1 THEN
    RAISE EXCEPTION 'ROLLED BACK: the exam account picked up % extra membership(s) from a school', _n - 1;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.memberships
                  WHERE account_id = _victim AND school_id = _space) THEN
    RAISE EXCEPTION 'ROLLED BACK: the exam account was moved out of its own space';
  END IF;
  IF EXISTS (SELECT 1 FROM public.students WHERE id = _dstud AND user_id IS NOT NULL) THEN
    RAISE EXCEPTION 'ROLLED BACK: a school student row claimed this exam account';
  END IF;
  IF (SELECT school_id FROM public.profiles WHERE id = _victim) IS DISTINCT FROM _space THEN
    RAISE EXCEPTION 'ROLLED BACK: the profile no longer names the exam space';
  END IF;

  DELETE FROM public.students WHERE id = _dstud;

  -- ---- Opening it twice returns the same account --------------------------
  _again := public.rpc_create_exam_account(_victim, 'cuet', '919999900001', 'Proof Student');
  IF (_again->>'created')::boolean IS NOT FALSE
     OR (_again->>'space_id')::uuid IS DISTINCT FROM _space THEN
    RAISE EXCEPTION 'ROLLED BACK: a repeated sign-in opened a second account (%)', _again;
  END IF;

  -- ---- The exam cannot be moved -------------------------------------------
  -- A real move, to a different exam: `SET exam_id = exam_id` is not a change
  -- and the trigger rightly permits it, so it would have proved nothing.
  INSERT INTO public.competitive_exams (code, name, is_active, display_order)
  VALUES ('proof_second_exam', 'Proof Second Exam', false, 999)
  RETURNING id INTO _other;

  _msg := '';
  BEGIN
    UPDATE public.exam_accounts SET exam_id = _other WHERE school_id = _space;
  EXCEPTION WHEN others THEN GET STACKED DIAGNOSTICS _msg = MESSAGE_TEXT;
  END;
  IF _msg NOT LIKE '%fixed to its exam%' THEN
    RAISE EXCEPTION 'ROLLED BACK: an exam account let itself be moved to another exam (%)', _msg;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.exam_accounts ea
                   JOIN public.competitive_exams e ON e.id = ea.exam_id
                  WHERE ea.school_id = _space AND e.code = 'cuet') THEN
    RAISE EXCEPTION 'ROLLED BACK: the account no longer sits on the exam it was opened for';
  END IF;

  -- And the owner cannot be swapped either.
  _msg := '';
  BEGIN
    UPDATE public.exam_accounts SET account_id = _boss_probe WHERE school_id = _space;
  EXCEPTION WHEN others THEN GET STACKED DIAGNOSTICS _msg = MESSAGE_TEXT;
  END;
  IF _msg NOT LIKE '%fixed to its exam%' THEN
    RAISE EXCEPTION 'ROLLED BACK: an exam account let its owner be changed (%)', _msg;
  END IF;

  DELETE FROM public.competitive_exams WHERE id = _other;

  -- ---- An account inside a school is refused ------------------------------
  SELECT m.account_id INTO _org FROM public.memberships m
    JOIN public.schools s ON s.id = m.school_id AND s.kind = 'school' LIMIT 1;
  IF _org IS NULL THEN
    RAISE EXCEPTION 'ROLLED BACK (control): no account inside a school, so that refusal is untested';
  END IF;
  _msg := '';
  BEGIN
    PERFORM public.rpc_create_exam_account(_org, 'cuet', NULL, 'Org Student');
  EXCEPTION WHEN others THEN GET STACKED DIAGNOSTICS _msg = MESSAGE_TEXT;
  END;
  IF _msg NOT LIKE '%already belongs to an organisation%' THEN
    RAISE EXCEPTION 'ROLLED BACK: an account inside a school was given an exam space too (%)', _msg;
  END IF;

  -- ---- A super admin is refused -------------------------------------------
  SELECT sa.account_id INTO _boss FROM public.super_admins sa
   WHERE sa.revoked_at IS NULL LIMIT 1;
  IF _boss IS NULL THEN
    RAISE EXCEPTION 'ROLLED BACK (control): no live super admin, so that refusal is untested';
  END IF;
  _msg := '';
  BEGIN
    PERFORM public.rpc_create_exam_account(_boss, 'cuet', NULL, 'Boss');
  EXCEPTION WHEN others THEN GET STACKED DIAGNOSTICS _msg = MESSAGE_TEXT;
  END;
  IF _msg NOT LIKE '%super admin%' THEN
    RAISE EXCEPTION 'ROLLED BACK: a super admin was given an exam space (%)', _msg;
  END IF;

  -- ---- An exam that does not exist is refused -----------------------------
  _msg := '';
  BEGIN
    PERFORM public.rpc_create_exam_account(_victim, 'no_such_exam', NULL, '');
  EXCEPTION WHEN others THEN GET STACKED DIAGNOSTICS _msg = MESSAGE_TEXT;
  END;
  IF _msg NOT LIKE '%no active exam%' THEN
    RAISE EXCEPTION 'ROLLED BACK: an account was opened for an exam that does not exist (%)', _msg;
  END IF;

  -- ---- "One school" counts organisations, not individuals -----------------
  IF (SELECT count(*) FROM public.schools WHERE kind = 'school')
     >= (SELECT count(*) FROM public.schools) THEN
    RAISE EXCEPTION 'ROLLED BACK: the individual space is being counted as an institution';
  END IF;
  IF EXISTS (SELECT 1 FROM public.schools WHERE id = _space AND kind = 'school') THEN
    RAISE EXCEPTION 'ROLLED BACK: the individual space is marked as a school';
  END IF;

  -- ---- The new tables are readable, never writable, from the browser ------
  IF NOT has_table_privilege('anon', 'public.competitive_exams', 'SELECT')
     OR NOT has_table_privilege('authenticated', 'public.competitive_exams', 'SELECT') THEN
    RAISE EXCEPTION 'ROLLED BACK: the login page cannot read the exam list';
  END IF;
  IF has_table_privilege('anon', 'public.competitive_exams', 'INSERT')
     OR has_table_privilege('authenticated', 'public.competitive_exams', 'UPDATE')
     OR has_table_privilege('anon', 'public.exam_accounts', 'SELECT')
     OR has_table_privilege('authenticated', 'public.exam_accounts', 'INSERT')
     OR has_table_privilege('authenticated', 'public.exam_accounts', 'UPDATE')
     OR has_table_privilege('authenticated', 'public.exam_accounts', 'DELETE') THEN
    RAISE EXCEPTION 'ROLLED BACK: a browser role can write the exam tables';
  END IF;
  IF has_function_privilege('authenticated',
       'public.rpc_create_exam_account(uuid, text, text, text)', 'EXECUTE')
     OR has_function_privilege('anon',
       'public.rpc_create_exam_account(uuid, text, text, text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'ROLLED BACK: a browser can open an exam account for any account id';
  END IF;

  -- ---- Undo the proof: the schema ships, the fixtures do not --------------
  -- The profile lets go of the space FIRST: profiles.school_id is a foreign
  -- key, so the school cannot be deleted while it still points there.
  UPDATE public.profiles
     SET school_id = NULL, full_name = _oldname, phone = _oldph
   WHERE id = _victim;
  DELETE FROM public.memberships WHERE school_id = _space;
  DELETE FROM public.students WHERE school_id IN (_space, _decoy);
  DELETE FROM public.exam_accounts WHERE school_id = _space;
  DELETE FROM public.schools WHERE id IN (_space, _decoy);

  IF EXISTS (SELECT 1 FROM public.schools WHERE id IN (_space, _decoy))
     OR EXISTS (SELECT 1 FROM public.memberships WHERE account_id = _victim)
     OR EXISTS (SELECT 1 FROM public.students WHERE user_id = _victim)
     OR EXISTS (SELECT 1 FROM public.exam_accounts)
     OR (SELECT count(*) FROM public.profiles p
          WHERE p.id = _victim AND p.full_name IS NOT DISTINCT FROM _oldname
            AND p.phone IS NOT DISTINCT FROM _oldph
            AND p.school_id IS NULL) <> 1 THEN
    RAISE EXCEPTION 'ROLLED BACK: the proof left fixtures behind';
  END IF;

  RAISE NOTICE 'OK: an exam account opens once, is private, has no class, is fixed to its exam, refuses organisation and super-admin accounts, and is no longer absorbable by link_portal_on_auth';
END
$verify$;

COMMIT;
