-- get_auth_context() declares RETURNS TABLE(..., email text, ...), which makes
-- "email" an implicitly-scoped variable name for the whole function body.
-- The profile-bootstrap INSERT's subquery `(SELECT email FROM auth.users
-- WHERE id = _uid)` references the bare column name, which Postgres cannot
-- resolve between the auth.users.email column and the function's own return
-- column ("column reference \"email\" is ambiguous", 42702). This fires on
-- every authenticated call — confirmed live via direct RPC invocation as the
-- admin demo user. The two other same-day INSERT/SELECT blocks in this
-- function are unaffected: full_name/is_active/school_id aren't return-table
-- column names.
-- Fix: fully qualify the auth.users columns in that one subquery. No other
-- behavior changed.
--
-- A second, previously-masked bug surfaced once the first was fixed: this
-- function is declared STABLE but performs INSERTs (profile/role bootstrap)
-- — Postgres rejects that at execution time ("INSERT is not allowed in a
-- non-volatile function", 0A000). The ambiguous-column parse error above
-- always fired first, so this runtime check was never reached before now.
-- Function is inherently a writer; VOLATILE (the default) is correct.
--
-- A third instance of the same bare-reference-vs-return-column ambiguity
-- was found on re-scan: `WHERE user_id = _uid` in the intended_role block
-- collides with the RETURNS TABLE's own `user_id` column, for the identical
-- reason as the `email` fix above. Also qualified.
CREATE OR REPLACE FUNCTION public.get_auth_context()
RETURNS TABLE (
  user_id uuid,
  email text,
  full_name text,
  photo_url text,
  is_active boolean,
  role public.app_role,
  school_id uuid,
  school_name text,
  school_slug text,
  school_logo_url text
)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  _uid uuid := auth.uid();
  _intended text;
BEGIN
  IF _uid IS NULL THEN
    RETURN;
  END IF;

  PERFORM public.link_portal_on_auth(_uid);

  INSERT INTO public.profiles (id, full_name, email, school_id, is_active)
  SELECT _uid,
         coalesce((SELECT raw_user_meta_data->>'full_name' FROM auth.users WHERE auth.users.id = _uid), ''),
         (SELECT auth.users.email FROM auth.users WHERE auth.users.id = _uid),
         NULL,
         true
  ON CONFLICT (id) DO NOTHING;

  -- Apply intended_role if still missing (student|parent only). Never invent student.
  IF NOT EXISTS (SELECT 1 FROM public.user_roles WHERE public.user_roles.user_id = _uid) THEN
    SELECT lower(coalesce(raw_user_meta_data->>'intended_role', ''))
      INTO _intended FROM auth.users WHERE auth.users.id = _uid;
    IF _intended IN ('student', 'parent') THEN
      INSERT INTO public.user_roles (user_id, role)
      VALUES (_uid, _intended::public.app_role)
      ON CONFLICT (user_id) DO NOTHING;
    END IF;
  END IF;

  RETURN QUERY
  SELECT
    p.id,
    p.email,
    p.full_name,
    p.photo_url,
    p.is_active,
    ur.role,
    p.school_id,
    s.name,
    s.slug,
    s.logo_url
  FROM public.profiles p
  LEFT JOIN public.user_roles ur ON ur.user_id = p.id
  LEFT JOIN public.schools s ON s.id = p.school_id
  WHERE p.id = _uid;
END;
$$;
