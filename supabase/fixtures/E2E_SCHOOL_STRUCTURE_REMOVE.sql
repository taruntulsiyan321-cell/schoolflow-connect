-- Tear down Riverside Public School E2E structure (school id …0003).
-- Does not touch Wisdom Campus (…0001) or Northfield scale (…0002).

DO $rm$
DECLARE
  _school uuid := '00000000-0000-4000-8000-000000000003';
  _uids   uuid[];
BEGIN
  SELECT coalesce(array_agg(DISTINCT u), ARRAY[]::uuid[])
    INTO _uids
    FROM (
      SELECT user_id AS u FROM public.teachers WHERE school_id = _school AND user_id IS NOT NULL
      UNION
      SELECT user_id FROM public.students WHERE school_id = _school AND user_id IS NOT NULL
      UNION
      SELECT account_id FROM public.memberships WHERE school_id = _school
    ) x;

  DELETE FROM public.student_enrolments WHERE school_id = _school;
  DELETE FROM public.section_subjects WHERE school_id = _school;
  DELETE FROM public.teacher_classes WHERE school_id = _school OR teacher_id IN (
    SELECT id FROM public.teachers WHERE school_id = _school
  );
  DELETE FROM public.students WHERE school_id = _school;

  UPDATE public.teachers SET class_teacher_of = NULL WHERE school_id = _school;
  UPDATE public.classes SET class_teacher_id = NULL WHERE school_id = _school;

  DELETE FROM public.classes WHERE school_id = _school;
  DELETE FROM public.class_groups WHERE school_id = _school;
  DELETE FROM public.teachers WHERE school_id = _school;
  DELETE FROM public.memberships WHERE school_id = _school;
  DELETE FROM public.academic_years WHERE school_id = _school;
  DELETE FROM public.schools WHERE id = _school;

  IF cardinality(_uids) > 0 THEN
    DELETE FROM public.memberships WHERE account_id = ANY (_uids);
    DELETE FROM public.accounts WHERE id = ANY (_uids);
    DELETE FROM public.profiles WHERE id = ANY (_uids);
    DELETE FROM auth.identities WHERE user_id = ANY (_uids);
    DELETE FROM auth.users WHERE id = ANY (_uids);
  END IF;

  RAISE NOTICE 'E2E SCHOOL removed: Riverside Public School (% auth users cleaned)', cardinality(_uids);
END
$rm$;
