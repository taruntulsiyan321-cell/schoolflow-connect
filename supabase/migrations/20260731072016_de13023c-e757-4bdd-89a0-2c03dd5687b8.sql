DROP VIEW IF EXISTS public.teacher_directory;

CREATE OR REPLACE FUNCTION public.get_teacher_directory()
RETURNS TABLE (
  id uuid,
  full_name text,
  subject text,
  department text,
  qualification text,
  photo_url text,
  is_class_teacher boolean,
  class_teacher_of uuid,
  status text,
  school_id uuid
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT t.id, t.full_name, t.subject, t.department, t.qualification, t.photo_url,
         t.is_class_teacher, t.class_teacher_of, t.status, t.school_id
  FROM public.teachers t
  WHERE auth.uid() IS NOT NULL;
$$;

REVOKE ALL ON FUNCTION public.get_teacher_directory() FROM public;
GRANT EXECUTE ON FUNCTION public.get_teacher_directory() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_teacher_directory() TO service_role;