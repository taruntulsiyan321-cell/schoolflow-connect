-- Rollback for 20261047000000_student_identity_carries_the_exam.sql
--
-- Restores the Chunk 15 RETURNS TABLE signature and body
-- (20260826120000_chunk15_converge_user_roles.sql lines 462–496)
-- without school_kind / exam_* columns.

BEGIN;

DROP FUNCTION IF EXISTS public.rpc_get_my_student_identity();

CREATE FUNCTION public.rpc_get_my_student_identity()
RETURNS TABLE(user_id uuid, role public.app_role, has_student_role boolean, student_id uuid,
              school_id uuid, class_id uuid, class_name text, class_section text,
              class_display_name text, class_category text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
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
    c.name, c.section, c.display_name, c.category
  FROM (SELECT _uid AS uid) AS u
  LEFT JOIN public.students s
         ON s.id = _local AND _has_student_role
  LEFT JOIN public.classes c ON c.id = s.class_id;
END;
$$;

COMMENT ON FUNCTION public.rpc_get_my_student_identity() IS
  'SSOT student academic identity for client: role, student_id, school_id, class metadata. Bypasses classes RLS for own row via SECURITY DEFINER.';

GRANT EXECUTE ON FUNCTION public.rpc_get_my_student_identity() TO authenticated;

COMMIT;
