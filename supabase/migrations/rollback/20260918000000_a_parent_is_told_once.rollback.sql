-- Rollback for 20260918000000_a_parent_is_told_once
--
-- Restores the body captured with pg_get_functiondef BEFORE the change, so this
-- is the real previous definition rather than one reconstructed from migration
-- history — a reconstruction was wrong in four places once before.
--
-- WHAT ROLLING THIS BACK COSTS: every parent reachable down both the legacy
-- `students.parent_user_id` column and the `parent_students` join table gets
-- EVERY alert twice again — attendance, marks, results, homework, exams.

CREATE OR REPLACE FUNCTION public._notify_student_parents(
  _student_id uuid, _type text, _title text,
  _body text DEFAULT NULL, _icon text DEFAULT NULL, _link text DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _uid uuid;
  _parent uuid;
BEGIN
  SELECT user_id, parent_user_id INTO _uid, _parent
  FROM public.students
  WHERE id = _student_id;

  IF _parent IS NOT NULL AND _parent IS DISTINCT FROM _uid THEN
    PERFORM public._notify(_parent, _type, _title, _body, _icon, _link);
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'parent_students'
  ) THEN
    FOR _parent IN
      SELECT p.user_id
      FROM public.parent_students ps
      JOIN public.parents p ON p.id = ps.parent_id
      WHERE ps.student_id = _student_id AND p.user_id IS NOT NULL
    LOOP
      IF _parent IS DISTINCT FROM _uid THEN
        PERFORM public._notify(_parent, _type, _title, _body, _icon, _link);
      END IF;
    END LOOP;
  END IF;
END;
$function$;
