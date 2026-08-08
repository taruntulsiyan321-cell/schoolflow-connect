-- =============================================================================
-- Canonical phone normalization.
--
-- Problem: phone numbers have been stored in whatever format each entry
-- point happened to produce -- admin-entered portal_phone/parent_mobile with
-- no country code ("9876543210"), MSG91-verified auth.users.phone always
-- with one ("919876543210"). public.normalize_phone() only ever stripped
-- non-digit characters, so it never reconciled these, and multiple
-- independent app-side implementations (loginIdentifier.ts,
-- admin-link-account/index.ts) had the exact same gap. Net effect:
-- link_portal_on_auth's phone-based matching silently failed for the common
-- case of an admin typing a bare 10-digit Indian mobile number, and phone
-- linking via admin-link-account could create a duplicate auth.users row for
-- someone who already had a widget-verified account under the
-- country-code-prefixed form of the same number.
--
-- Fix: one canonical format everywhere -- digits only, always
-- country-code-prefixed (default: India, "91", since this app has no
-- evidence of any other country in use -- see src/lib/phone.ts for the full
-- rationale). normalize_phone() now produces that format instead of a bare
-- digit-strip. Existing stored values are backfilled below. The one
-- remaining raw-string comparison in link_portal_on_auth (portal_phone) is
-- hardened to match parent_mobile's existing pattern of normalizing at
-- comparison time too, so a future non-normalized write can't silently
-- reintroduce this bug.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.normalize_phone(_raw text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN _raw IS NULL THEN NULL
    WHEN regexp_replace(_raw, '\D', '', 'g') = '' THEN NULL
    WHEN length(regexp_replace(_raw, '\D', '', 'g')) = 10
      THEN '91' || regexp_replace(_raw, '\D', '', 'g')
    WHEN length(regexp_replace(_raw, '\D', '', 'g')) BETWEEN 10 AND 15
      THEN regexp_replace(_raw, '\D', '', 'g')
    ELSE NULL
  END;
$$;

COMMENT ON FUNCTION public.normalize_phone(text) IS
  'Canonical phone form: digits only, always country-code-prefixed (default India "91" for bare 10-digit input). Mirrored in src/lib/phone.ts and supabase/functions/_shared/phone.ts -- keep all three in sync.';

-- ── link_portal_on_auth: normalize portal_phone at comparison time too ──────
-- Identical to the version in 20260802640000_auth_rls_session_auditor_closures.sql
-- except the two "Student by portal_phone" lookups now wrap the stored
-- column in normalize_phone(), matching what "Parent by parent_mobile"
-- already did below it.
CREATE OR REPLACE FUNCTION public.link_portal_on_auth(_uid uuid DEFAULT auth.uid())
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  _email text;
  _phone text;
  _profile_school uuid;
  _default_school uuid := public.default_school_id();
  _allow_global boolean;
  _teacher_id uuid;
  _student_id uuid;
  _parent_student_id uuid;
  _has_role boolean;
  _match_count int;
BEGIN
  IF _uid IS NULL THEN RETURN; END IF;
  IF auth.uid() IS NOT NULL AND _uid IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Cannot link portal for another user';
  END IF;

  SELECT lower(email), public.normalize_phone(phone) INTO _email, _phone
  FROM auth.users WHERE id = _uid;

  SELECT school_id INTO _profile_school FROM public.profiles WHERE id = _uid;
  _allow_global := (_profile_school IS NULL OR _profile_school = _default_school);

  SELECT EXISTS(SELECT 1 FROM public.user_roles WHERE user_id = _uid) INTO _has_role;

  -- Teacher by email
  IF _email IS NOT NULL THEN
    _teacher_id := NULL;
    IF _profile_school IS NOT NULL THEN
      SELECT id INTO _teacher_id
      FROM public.teachers
      WHERE lower(email) = _email
        AND user_id IS NULL
        AND school_id = _profile_school
      LIMIT 1;
    END IF;
    -- Unambiguous global only when unbound or stuck on default school
    IF _teacher_id IS NULL AND _allow_global THEN
      SELECT count(*)::int INTO _match_count
      FROM public.teachers
      WHERE lower(email) = _email AND user_id IS NULL;
      IF _match_count = 1 THEN
        SELECT id INTO _teacher_id
        FROM public.teachers
        WHERE lower(email) = _email AND user_id IS NULL
        LIMIT 1;
      END IF;
    END IF;

    IF _teacher_id IS NOT NULL THEN
      UPDATE public.teachers SET user_id = _uid WHERE id = _teacher_id;
      IF NOT _has_role THEN
        INSERT INTO public.user_roles (user_id, role) VALUES (_uid, 'teacher') ON CONFLICT (user_id) DO NOTHING;
        _has_role := true;
      END IF;
      UPDATE public.profiles p
        SET school_id = t.school_id
        FROM public.teachers t
        WHERE p.id = _uid AND t.id = _teacher_id AND t.school_id IS NOT NULL
          AND (p.school_id IS NULL OR p.school_id = _default_school);
      _profile_school := coalesce((SELECT school_id FROM public.teachers WHERE id = _teacher_id), _profile_school);
      _allow_global := (_profile_school IS NULL OR _profile_school = _default_school);
    END IF;
  END IF;

  -- Student by portal_email
  IF _email IS NOT NULL THEN
    _student_id := NULL;
    IF _profile_school IS NOT NULL THEN
      SELECT id INTO _student_id
      FROM public.students
      WHERE user_id IS NULL
        AND lower(portal_email) = _email
        AND school_id = _profile_school
      LIMIT 1;
    END IF;
    IF _student_id IS NULL AND _allow_global THEN
      SELECT count(*)::int INTO _match_count
      FROM public.students
      WHERE user_id IS NULL AND lower(portal_email) = _email;
      IF _match_count = 1 THEN
        SELECT id INTO _student_id
        FROM public.students
        WHERE user_id IS NULL AND lower(portal_email) = _email
        LIMIT 1;
      END IF;
    END IF;

    IF _student_id IS NOT NULL THEN
      UPDATE public.students SET user_id = _uid WHERE id = _student_id;
      IF NOT _has_role THEN
        INSERT INTO public.user_roles (user_id, role) VALUES (_uid, 'student') ON CONFLICT (user_id) DO NOTHING;
        _has_role := true;
      END IF;
      UPDATE public.profiles p
        SET school_id = s.school_id
        FROM public.students s
        WHERE p.id = _uid AND s.id = _student_id AND s.school_id IS NOT NULL
          AND (p.school_id IS NULL OR p.school_id = _default_school);
      _profile_school := coalesce((SELECT school_id FROM public.students WHERE id = _student_id), _profile_school);
      _allow_global := (_profile_school IS NULL OR _profile_school = _default_school);
    END IF;
  END IF;

  -- Student by portal_phone -- normalize_phone() now wraps the stored
  -- column too (previously only the incoming _phone was normalized).
  IF _phone IS NOT NULL AND _student_id IS NULL THEN
    _student_id := NULL;
    IF _profile_school IS NOT NULL THEN
      SELECT id INTO _student_id
      FROM public.students
      WHERE user_id IS NULL
        AND normalize_phone(portal_phone) = _phone
        AND school_id = _profile_school
      LIMIT 1;
    END IF;
    IF _student_id IS NULL AND _allow_global THEN
      SELECT count(*)::int INTO _match_count
      FROM public.students
      WHERE user_id IS NULL AND normalize_phone(portal_phone) = _phone;
      IF _match_count = 1 THEN
        SELECT id INTO _student_id
        FROM public.students
        WHERE user_id IS NULL AND normalize_phone(portal_phone) = _phone
        LIMIT 1;
      END IF;
    END IF;

    IF _student_id IS NOT NULL THEN
      UPDATE public.students SET user_id = _uid WHERE id = _student_id;
      IF NOT _has_role THEN
        INSERT INTO public.user_roles (user_id, role) VALUES (_uid, 'student') ON CONFLICT (user_id) DO NOTHING;
        _has_role := true;
      END IF;
      UPDATE public.profiles p
        SET school_id = s.school_id
        FROM public.students s
        WHERE p.id = _uid AND s.id = _student_id AND s.school_id IS NOT NULL
          AND (p.school_id IS NULL OR p.school_id = _default_school);
      _profile_school := coalesce((SELECT school_id FROM public.students WHERE id = _student_id), _profile_school);
      _allow_global := (_profile_school IS NULL OR _profile_school = _default_school);
    END IF;
  END IF;

  -- Parent by parent_portal_email
  IF _email IS NOT NULL THEN
    _parent_student_id := NULL;
    IF _profile_school IS NOT NULL THEN
      SELECT id INTO _parent_student_id
      FROM public.students
      WHERE parent_user_id IS NULL
        AND lower(parent_portal_email) = _email
        AND school_id = _profile_school
      LIMIT 1;
    END IF;
    IF _parent_student_id IS NULL AND _allow_global THEN
      SELECT count(*)::int INTO _match_count
      FROM public.students
      WHERE parent_user_id IS NULL AND lower(parent_portal_email) = _email;
      IF _match_count = 1 THEN
        SELECT id INTO _parent_student_id
        FROM public.students
        WHERE parent_user_id IS NULL AND lower(parent_portal_email) = _email
        LIMIT 1;
      END IF;
    END IF;

    IF _parent_student_id IS NOT NULL THEN
      UPDATE public.students SET parent_user_id = _uid WHERE id = _parent_student_id;
      IF NOT _has_role THEN
        INSERT INTO public.user_roles (user_id, role) VALUES (_uid, 'parent') ON CONFLICT (user_id) DO NOTHING;
        _has_role := true;
      END IF;
      UPDATE public.profiles p
        SET school_id = s.school_id
        FROM public.students s
        WHERE p.id = _uid AND s.id = _parent_student_id AND s.school_id IS NOT NULL
          AND (p.school_id IS NULL OR p.school_id = _default_school);
      _profile_school := coalesce((SELECT school_id FROM public.students WHERE id = _parent_student_id), _profile_school);
      _allow_global := (_profile_school IS NULL OR _profile_school = _default_school);
    END IF;
  END IF;

  -- Parent by parent_mobile
  IF _phone IS NOT NULL THEN
    _parent_student_id := NULL;
    IF _profile_school IS NOT NULL THEN
      SELECT id INTO _parent_student_id
      FROM public.students
      WHERE parent_user_id IS NULL
        AND public.normalize_phone(parent_mobile) = _phone
        AND school_id = _profile_school
      LIMIT 1;
    END IF;
    IF _parent_student_id IS NULL AND _allow_global THEN
      SELECT count(*)::int INTO _match_count
      FROM public.students
      WHERE parent_user_id IS NULL AND public.normalize_phone(parent_mobile) = _phone;
      IF _match_count = 1 THEN
        SELECT id INTO _parent_student_id
        FROM public.students
        WHERE parent_user_id IS NULL AND public.normalize_phone(parent_mobile) = _phone
        LIMIT 1;
      END IF;
    END IF;

    IF _parent_student_id IS NOT NULL THEN
      UPDATE public.students SET parent_user_id = _uid WHERE id = _parent_student_id;
      IF NOT _has_role THEN
        INSERT INTO public.user_roles (user_id, role) VALUES (_uid, 'parent') ON CONFLICT (user_id) DO NOTHING;
      END IF;
      UPDATE public.profiles p
        SET school_id = s.school_id
        FROM public.students s
        WHERE p.id = _uid AND s.id = _parent_student_id AND s.school_id IS NOT NULL
          AND (p.school_id IS NULL OR p.school_id = _default_school);
    END IF;
  END IF;
END;
$$;

COMMENT ON FUNCTION public.link_portal_on_auth(uuid) IS
  'Links teacher/student/parent portal rows by email/phone. School-scoped when profile has school; unambiguous global fallback recovers default-school pins. Overwrites profile.school_id from portal. Phone comparisons always go through normalize_phone() on both sides.';

-- ── Backfill: bring every already-stored phone value to canonical form ──────
-- Idempotent (WHERE clause only touches rows that would actually change) and
-- safe to re-run. Skips any value normalize_phone() can't parse (leaves it
-- untouched rather than nulling it out -- a human should look at those).
--
-- Several of these columns carry uniqueness constraints (students.portal_phone
-- has a partial unique index; auth.users.phone is unique). Normalizing two
-- independently-entered values (e.g. "9876543210" and "919876543210" for the
-- same real number, stored on two different rows by mistake) can therefore
-- collide. Each row is updated in its own sub-transaction via the
-- BEGIN/EXCEPTION block below so a genuine duplicate only skips that one row
-- (logged via RAISE NOTICE for manual review) instead of aborting the whole
-- migration.
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN
    SELECT id, portal_phone FROM public.students
    WHERE portal_phone IS NOT NULL
      AND public.normalize_phone(portal_phone) IS NOT NULL
      AND portal_phone <> public.normalize_phone(portal_phone)
  LOOP
    BEGIN
      UPDATE public.students SET portal_phone = public.normalize_phone(r.portal_phone) WHERE id = r.id;
    EXCEPTION WHEN unique_violation THEN
      RAISE NOTICE 'phone backfill: students.portal_phone id=% left unnormalized -- normalized value already used by another row (likely a duplicate entry, needs manual review)', r.id;
    END;
  END LOOP;

  FOR r IN
    SELECT id, parent_mobile FROM public.students
    WHERE parent_mobile IS NOT NULL
      AND public.normalize_phone(parent_mobile) IS NOT NULL
      AND parent_mobile <> public.normalize_phone(parent_mobile)
  LOOP
    BEGIN
      UPDATE public.students SET parent_mobile = public.normalize_phone(r.parent_mobile) WHERE id = r.id;
    EXCEPTION WHEN unique_violation THEN
      RAISE NOTICE 'phone backfill: students.parent_mobile id=% left unnormalized -- collision, needs manual review', r.id;
    END;
  END LOOP;

  FOR r IN
    SELECT id, phone FROM public.students
    WHERE phone IS NOT NULL
      AND public.normalize_phone(phone) IS NOT NULL
      AND phone <> public.normalize_phone(phone)
  LOOP
    BEGIN
      UPDATE public.students SET phone = public.normalize_phone(r.phone) WHERE id = r.id;
    EXCEPTION WHEN unique_violation THEN
      RAISE NOTICE 'phone backfill: students.phone id=% left unnormalized -- collision, needs manual review', r.id;
    END;
  END LOOP;

  FOR r IN
    SELECT id, phone FROM public.parents
    WHERE phone IS NOT NULL
      AND public.normalize_phone(phone) IS NOT NULL
      AND phone <> public.normalize_phone(phone)
  LOOP
    BEGIN
      UPDATE public.parents SET phone = public.normalize_phone(r.phone) WHERE id = r.id;
    EXCEPTION WHEN unique_violation THEN
      RAISE NOTICE 'phone backfill: parents.phone id=% left unnormalized -- collision, needs manual review', r.id;
    END;
  END LOOP;

  FOR r IN
    SELECT id, portal_phone FROM public.parents
    WHERE portal_phone IS NOT NULL
      AND public.normalize_phone(portal_phone) IS NOT NULL
      AND portal_phone <> public.normalize_phone(portal_phone)
  LOOP
    BEGIN
      UPDATE public.parents SET portal_phone = public.normalize_phone(r.portal_phone) WHERE id = r.id;
    EXCEPTION WHEN unique_violation THEN
      RAISE NOTICE 'phone backfill: parents.portal_phone id=% left unnormalized -- collision, needs manual review', r.id;
    END;
  END LOOP;

  FOR r IN
    SELECT id, mobile FROM public.teachers
    WHERE mobile IS NOT NULL
      AND public.normalize_phone(mobile) IS NOT NULL
      AND mobile <> public.normalize_phone(mobile)
  LOOP
    BEGIN
      UPDATE public.teachers SET mobile = public.normalize_phone(r.mobile) WHERE id = r.id;
    EXCEPTION WHEN unique_violation THEN
      RAISE NOTICE 'phone backfill: teachers.mobile id=% left unnormalized -- collision, needs manual review', r.id;
    END;
  END LOOP;

  FOR r IN
    SELECT id, phone FROM public.profiles
    WHERE phone IS NOT NULL
      AND public.normalize_phone(phone) IS NOT NULL
      AND phone <> public.normalize_phone(phone)
  LOOP
    BEGIN
      UPDATE public.profiles SET phone = public.normalize_phone(r.phone) WHERE id = r.id;
    EXCEPTION WHEN unique_violation THEN
      RAISE NOTICE 'phone backfill: profiles.phone id=% left unnormalized -- collision, needs manual review', r.id;
    END;
  END LOOP;

  -- auth.users.phone: normally already canonical (every account-creation
  -- path in this app passes country-code-prefixed digits), but
  -- admin-link-account's phone path did not enforce that -- see
  -- phoneAuthLink.ts/admin-link-account fixes in this same change. A
  -- collision here means two separate accounts were created for what turns
  -- out to be the same real phone number -- that needs a human decision
  -- (which account keeps the role/history), not an automatic merge, so it's
  -- only logged, never forced.
  FOR r IN
    SELECT id, phone FROM auth.users
    WHERE phone IS NOT NULL
      AND phone <> ''
      AND public.normalize_phone(phone) IS NOT NULL
      AND phone <> public.normalize_phone(phone)
  LOOP
    BEGIN
      UPDATE auth.users SET phone = public.normalize_phone(r.phone) WHERE id = r.id;
    EXCEPTION WHEN unique_violation THEN
      RAISE NOTICE 'phone backfill: auth.users.phone id=% left unnormalized -- another account already uses this number in canonical form; likely a duplicate account pair needing manual merge review', r.id;
    END;
  END LOOP;
END $$;
