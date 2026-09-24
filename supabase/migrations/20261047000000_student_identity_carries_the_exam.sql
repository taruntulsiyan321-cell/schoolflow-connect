-- ===========================================================================
-- STUDENT IDENTITY CARRIES THE EXAM
--
-- An individual student (schools.kind = 'individual') has no class and no
-- board. The panel must know which competitive exam their space prepares for,
-- from the same identity call everything already reads —
-- rpc_get_my_student_identity — not a second fetch.
--
-- Preserves every column Chunk 15
-- (20260826120000_chunk15_converge_user_roles.sql lines 462–496) returned,
-- then adds school_kind and the exam (null for organisation schools).
--
-- Does NOT modify 20261046000000 (already live). Depends on schools.kind,
-- exam_accounts, competitive_exams, and rpc_create_exam_account from that
-- migration.
--
-- Rollback: rollback/20261047000000_student_identity_carries_the_exam.rollback.sql
-- ===========================================================================

BEGIN;

-- RETURNS TABLE columns are OUT parameters: CREATE OR REPLACE cannot add them.
DROP FUNCTION IF EXISTS public.rpc_get_my_student_identity();

CREATE FUNCTION public.rpc_get_my_student_identity()
RETURNS TABLE(
  user_id uuid,
  role public.app_role,
  has_student_role boolean,
  student_id uuid,
  school_id uuid,
  class_id uuid,
  class_name text,
  class_section text,
  class_display_name text,
  class_category text,
  school_kind text,
  exam_id uuid,
  exam_code text,
  exam_name text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _uid uuid := auth.uid();
  _role public.app_role;
  _has_student_role boolean := false;
  _local uuid;
BEGIN
  IF _uid IS NULL THEN RETURN; END IF;

  BEGIN PERFORM public.link_portal_on_auth(_uid); EXCEPTION WHEN OTHERS THEN NULL; END;

  _role := public.effective_role(_uid);
  _has_student_role := (_role = 'student'::public.app_role);
  _local := public.active_local_person_id();

  RETURN QUERY
  SELECT
    _uid,
    _role,
    _has_student_role,
    s.id,
    COALESCE(s.school_id, public.get_my_school_id()),
    s.class_id,
    c.name, c.section, c.display_name, c.category,
    sch.kind,
    ea.exam_id,
    ce.code,
    ce.name
  FROM (SELECT _uid AS uid) AS u
  LEFT JOIN public.students s
         ON s.id = _local AND _has_student_role
  LEFT JOIN public.classes c ON c.id = s.class_id
  LEFT JOIN public.schools sch
         ON sch.id = COALESCE(s.school_id, public.get_my_school_id())
  LEFT JOIN public.exam_accounts ea
         ON ea.school_id = sch.id AND sch.kind = 'individual'
  LEFT JOIN public.competitive_exams ce ON ce.id = ea.exam_id;
END;
$$;

COMMENT ON FUNCTION public.rpc_get_my_student_identity() IS
  'SSOT student academic identity: role, student_id, school_id, class metadata, schools.kind, and — for kind=individual — the fixed competitive exam on exam_accounts. Bypasses classes RLS for own row via SECURITY DEFINER.';

GRANT EXECUTE ON FUNCTION public.rpc_get_my_student_identity() TO authenticated;

-- ── Proof (fixtures removed before COMMIT) ─────────────────────────────────
DO $proof$
DECLARE
  _cols     text[];
  _victim   uuid;
  _oldname  text;
  _oldph    text;
  _res      jsonb;
  _space    uuid;
  _student  uuid;
  _kind     text;
  _ecode    text;
  _ename    text;
  _eid      uuid;
  _sid      uuid;
  _school_uid uuid;
BEGIN
  -- 1. The function must expose the new OUT columns (and keep prior ones).
  SELECT array_agg(p.parameter_name::text ORDER BY p.ordinal_position)
    INTO _cols
  FROM information_schema.parameters p
  WHERE p.specific_schema = 'public'
    AND p.specific_name = (
      SELECT pp.specific_name
        FROM information_schema.routines pp
       WHERE pp.specific_schema = 'public'
         AND pp.routine_name = 'rpc_get_my_student_identity'
       LIMIT 1
    )
    AND p.parameter_mode = 'OUT';

  IF _cols IS NULL OR NOT (
       'user_id' = ANY (_cols)
   AND 'role' = ANY (_cols)
   AND 'has_student_role' = ANY (_cols)
   AND 'student_id' = ANY (_cols)
   AND 'school_id' = ANY (_cols)
   AND 'class_id' = ANY (_cols)
   AND 'class_name' = ANY (_cols)
   AND 'class_section' = ANY (_cols)
   AND 'class_display_name' = ANY (_cols)
   AND 'class_category' = ANY (_cols)
   AND 'school_kind' = ANY (_cols)
   AND 'exam_id' = ANY (_cols)
   AND 'exam_code' = ANY (_cols)
   AND 'exam_name' = ANY (_cols)
  ) THEN
    RAISE EXCEPTION
      'ROLLED BACK: rpc_get_my_student_identity OUT columns incomplete: %', _cols;
  END IF;

  -- 2. Disposable individual fixture (same free-account pattern as 202610460).
  SELECT u.id INTO _victim
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
    RAISE EXCEPTION
      'ROLLED BACK (control): no account free of memberships — identity exam path untested';
  END IF;

  SELECT p.full_name, p.phone INTO _oldname, _oldph
    FROM public.profiles p WHERE p.id = _victim;

  _res := public.rpc_create_exam_account(_victim, 'cuet', '919999900047', 'Proof Identity');
  _space   := (_res->>'space_id')::uuid;
  _student := (_res->>'student_id')::uuid;
  IF (_res->>'created')::boolean IS NOT TRUE OR _space IS NULL OR _student IS NULL THEN
    RAISE EXCEPTION 'ROLLED BACK: exam account was not opened (%)', _res;
  END IF;

  -- 3a. Positive control — individual: school_kind + exam_code set via the RPC.
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', _victim, 'role', 'authenticated')::text, true);

  SELECT g.school_kind, g.exam_id, g.exam_code, g.exam_name, g.school_id
    INTO _kind, _eid, _ecode, _ename, _sid
  FROM public.rpc_get_my_student_identity() g
  LIMIT 1;

  PERFORM set_config('request.jwt.claims', NULL, true);

  IF _kind IS DISTINCT FROM 'individual'
     OR _ecode IS DISTINCT FROM 'cuet'
     OR _eid IS NULL
     OR _ename IS NULL
     OR _sid IS DISTINCT FROM _space THEN
    RAISE EXCEPTION
      'ROLLED BACK: individual identity missing exam — kind=% code=% exam=% school=% (want space %)',
      _kind, _ecode, _eid, _sid, _space;
  END IF;

  -- 3b. Positive control — school: exam_* must be null.
  SELECT m.account_id INTO _school_uid
    FROM public.memberships m
    JOIN public.schools s ON s.id = m.school_id AND s.kind = 'school'
   WHERE m.role = 'student'
     AND m.status = 'active'
     AND m.account_id IS DISTINCT FROM _victim
   LIMIT 1;
  IF _school_uid IS NULL THEN
    RAISE EXCEPTION
      'ROLLED BACK (control): no organisation student membership — school null-exam path untested';
  END IF;

  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', _school_uid, 'role', 'authenticated')::text, true);

  SELECT g.school_kind, g.exam_id, g.exam_code, g.exam_name
    INTO _kind, _eid, _ecode, _ename
  FROM public.rpc_get_my_student_identity() g
  LIMIT 1;

  PERFORM set_config('request.jwt.claims', NULL, true);

  IF _kind IS DISTINCT FROM 'school'
     OR _eid IS NOT NULL
     OR _ecode IS NOT NULL
     OR _ename IS NOT NULL THEN
    RAISE EXCEPTION
      'ROLLED BACK: school identity must carry null exam_* — kind=% exam=% code=% name=%',
      _kind, _eid, _ecode, _ename;
  END IF;

  -- 4. Undo the fixture — schema ships, rows do not.
  UPDATE public.profiles
     SET school_id = NULL, full_name = _oldname, phone = _oldph
   WHERE id = _victim;
  DELETE FROM public.memberships WHERE school_id = _space;
  DELETE FROM public.students WHERE school_id = _space;
  DELETE FROM public.exam_accounts WHERE school_id = _space;
  DELETE FROM public.schools WHERE id = _space;

  IF EXISTS (SELECT 1 FROM public.schools WHERE id = _space)
     OR EXISTS (SELECT 1 FROM public.memberships WHERE account_id = _victim)
     OR EXISTS (SELECT 1 FROM public.students WHERE user_id = _victim)
     OR EXISTS (SELECT 1 FROM public.exam_accounts WHERE school_id = _space)
     OR (SELECT count(*) FROM public.profiles p
          WHERE p.id = _victim
            AND p.full_name IS NOT DISTINCT FROM _oldname
            AND p.phone IS NOT DISTINCT FROM _oldph
            AND p.school_id IS NULL) <> 1 THEN
    RAISE EXCEPTION 'ROLLED BACK: the proof left fixtures behind';
  END IF;

  RAISE NOTICE
    'OK: rpc_get_my_student_identity returns school_kind + exam_*; individual has exam_code; school has null exam_*';
END
$proof$;

COMMIT;
