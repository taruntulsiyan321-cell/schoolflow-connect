-- ============================================================
-- CHAT CONTACTS RPC
-- ============================================================

CREATE OR REPLACE FUNCTION public.get_chat_contacts()
RETURNS TABLE(user_id uuid, name text, role text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  caller_id uuid := auth.uid();
  caller_role text;
BEGIN
  -- Get the primary role of the caller
  SELECT ur.role::text INTO caller_role
  FROM public.user_roles ur
  WHERE ur.user_id = caller_id
  ORDER BY 
    CASE ur.role
      WHEN 'admin' THEN 1
      WHEN 'principal' THEN 2
      WHEN 'teacher' THEN 3
      WHEN 'student' THEN 4
      WHEN 'parent' THEN 5
      ELSE 6
    END
  LIMIT 1;

  IF caller_role IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT DISTINCT
    u.id AS user_id,
    COALESCE(p.full_name, u.email, u.phone, 'Unknown') AS name,
    ur.role::text AS role
  FROM auth.users u
  JOIN public.user_roles ur ON ur.user_id = u.id
  LEFT JOIN public.profiles p ON p.id = u.id
  WHERE u.id != caller_id
  AND (
    -- Admins and Principals can chat with everyone
    caller_role IN ('admin', 'principal')
    -- Teachers can chat with everyone
    OR caller_role = 'teacher'
    -- Students can chat with teachers, admins, principals
    OR (caller_role = 'student' AND ur.role IN ('teacher', 'admin', 'principal'))
    -- Parents can chat with teachers, admins, principals
    OR (caller_role = 'parent' AND ur.role IN ('teacher', 'admin', 'principal'))
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_chat_contacts() FROM anon, public;
GRANT EXECUTE ON FUNCTION public.get_chat_contacts() TO authenticated;
